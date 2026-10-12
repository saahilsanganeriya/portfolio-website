"""Bake the room's lighting (Cycles, CPU) into its atlases, and the window view by day and by night; save
room.blend with the bake UVs.

    blender -b blender/room.blend -P blender/scripts/bake.py                     # final: full size, 512 samples
    blender -b blender/room.blend -P blender/scripts/bake.py -- --scale 0.25 --samples 32 --atlas desk   # test
    blender -b blender/room.blend -P blender/scripts/bake.py -- --atlas window_sf,window_delhi            # view only

Each atlas gets a second UV map "bake" (an object's own clean UVs or a smart projection, scaled by area and
packed together with an 6-16 px margin at the final size), one Combined bake (diffuse and glossy, direct and
indirect, emission; AO comes from the global illumination), then OIDN denoising and the scene's AgX view transform,
so the PNG in blender/.cache/bake/<atlas>.png already looks like the Cycles render and is shown unlit on the site.

The room atlases bake without the window view (the camera-invisible env_sky card lights the room through the
window). The view's halves (window_sf, window_delhi) bake alone, once per state, into <atlas>_<state>.png plus a
linear <atlas>_<state>.exr that export.py shows in the stills.
"""

import argparse
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import window_view  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
BAKE_DIR = REPO / "blender" / ".cache" / "bake"
BLEND = REPO / "blender" / "room.blend"

ATLAS_SIZES = {"env": 4096, "desk": 4096, "props": 4096, "window_sf": 1024, "window_delhi": 1024}
# Island margin in pixels at the final size: the plan's floor is 8 px; the props atlas needs the floor because its
# scanned and modelled props bring thousands of islands into it. The view's atlases are small and seen from afar.
MARGIN_PX = {"env": 16, "desk": 16, "props": 8, "window_sf": 6, "window_delhi": 6}
STATES = ("day", "night")
# The world seen through the open front of the view while it bakes: a pale sky by day, a dark one by night.
VIEW_WORLD = {"day": ((0.62, 0.70, 0.82, 1.0), 0.35), "night": ((0.010, 0.012, 0.022, 1.0), 0.35)}

MAX_THREADS = 24
TARGET_NODE = "bake_target"


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="bake.py")
    parser.add_argument("--atlas", default=",".join(ATLAS_SIZES), help="comma-separated atlas names")
    parser.add_argument("--states", default=",".join(STATES), help="view states to bake (window atlases)")
    parser.add_argument("--scale", type=float, default=1.0, help="fraction of the final atlas size (tests)")
    parser.add_argument("--samples", type=int, default=512)
    parser.add_argument("--threads", type=int, default=MAX_THREADS)
    parser.add_argument("--no-save", action="store_true", help="do not write room.blend")
    return parser.parse_args(argv)


def atlas_objects(atlas: str) -> list[bpy.types.Object]:
    return sorted((o for o in bpy.context.scene.objects
                   if o.type == "MESH" and o.get("atlas") == atlas and not o.hide_render), key=lambda o: o.name)


def select_only(objs):
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def make_bake_uvs(objs, size: int, margin_px: int):
    """Give every object a 'bake' UV map, then pack all islands into one atlas.

    An object whose own UV map has no overlapping faces (Henry's lightmap UVs, the props' unwraps) keeps that
    layout, which has far fewer islands than a smart projection of a scanned model; the rest are smart-projected.
    The margin is a fraction of the final atlas size, so test bakes at a smaller scale use the same layout.
    """
    to_project = []
    for obj in objs:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        mesh = obj.data
        source = next((uv for uv in mesh.uv_layers if uv.active_render and uv.name != "bake"), None)
        bake_uv = mesh.uv_layers.get("bake") or mesh.uv_layers.new(name="bake")
        if source is not None and obj.get("bake_uv") != "project" and overlap_fraction(mesh, source) < 0.01:
            coords = np.empty(len(mesh.loops) * 2, dtype=np.float32)
            source.data.foreach_get("uv", coords)
            bake_uv.data.foreach_set("uv", coords)
        else:
            to_project.append(obj)
        mesh.uv_layers.active = bake_uv
        if source is not None:
            source.active_render = True
    if to_project:
        select_only(to_project)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.reveal()
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=False, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")
    print(f"bake: {len(objs) - len(to_project)} objects keep their UVs, {len(to_project)} smart-projected")
    normalise_texel_density(objs)
    select_only(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                            merge_overlap=False, margin_method="FRACTION", margin=margin_px / size,
                            pin=False, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def overlap_fraction(mesh, layer, res: int = 256) -> float:
    """Share of covered texels that two or more UV triangles cover (rasterised at res x res)."""
    mesh.calc_loop_triangles()
    n = len(mesh.loop_triangles)
    if n == 0:
        return 1.0
    loops = np.empty(n * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("loops", loops)
    uv = np.empty(len(mesh.loops) * 2, dtype=np.float64)
    layer.data.foreach_get("uv", uv)
    tris = uv.reshape(-1, 2)[loops].reshape(n, 3, 2)
    lo, hi = tris.reshape(-1, 2).min(axis=0), tris.reshape(-1, 2).max(axis=0)
    span = float((hi - lo).max())
    if span <= 0:
        return 1.0
    tris = (tris - lo) / span * (res - 1)
    count = np.zeros((res, res), dtype=np.int32)
    for a, b, c in tris:
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
        x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
        denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(denom) < 1e-12:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1] + 0.5
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / denom
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / denom
        inside = (w0 > 0) & (w1 > 0) & (w0 + w1 < 1)
        sub = count[max(y0, 0):y1 + 1, max(x0, 0):x1 + 1]
        sub += inside[: sub.shape[0], : sub.shape[1]]
    covered = np.count_nonzero(count)
    return float(np.count_nonzero(count > 1)) / covered if covered else 1.0


def normalise_texel_density(objs):
    """Scale each object's UVs so its share of UV area is its world surface area times its 'texel' weight.

    Smart project already keeps one density within an object, so a per-object factor is enough; unlike
    average_islands_scale it cannot blow a degenerate sliver island (a 2 mm LED) up to atlas size. A shared
    factor then brings the total UV area to about 0.75 and each object back to the 0-1 tile for packing.
    """
    factors, weighted_total = {}, 0.0
    for obj in objs:
        mesh = obj.data
        uvs = mesh.uv_layers["bake"].data
        scale = obj.matrix_world.to_scale()
        world_area = sum(p.area for p in mesh.polygons) * abs(scale.x * scale.y * scale.z) ** (2 / 3)
        uv_area = 0.0
        for poly in mesh.polygons:
            pts = [uvs[i].uv for i in poly.loop_indices]
            uv_area += abs(sum(a.x * b.y - b.x * a.y for a, b in zip(pts, pts[1:] + pts[:1]))) / 2
        if world_area <= 0 or uv_area <= 0:
            continue
        weighted = world_area * float(obj.get("texel", 1.0))
        factors[obj.name] = math.sqrt(weighted / uv_area)
        weighted_total += weighted
    shared = math.sqrt(0.75 / weighted_total)
    for obj in objs:
        if obj.name not in factors:
            continue
        uvs = obj.data.uv_layers["bake"].data
        coords = [lu.uv * (factors[obj.name] * shared) for lu in uvs]
        lo_u, lo_v = min(c.x for c in coords), min(c.y for c in coords)
        for lu, c in zip(uvs, coords):
            lu.uv = (c.x - lo_u, c.y - lo_v)


def attach_target(objs, image):
    """Point every material on these objects at the atlas image through an active, unlinked image node."""
    for mat in {slot.material for o in objs for slot in o.material_slots if slot.material}:
        nodes = mat.node_tree.nodes
        node = nodes.get(TARGET_NODE) or nodes.new("ShaderNodeTexImage")
        node.name = node.label = TARGET_NODE
        node.location = (900, -300)
        node.image = image
        node.interpolation = "Linear"
        for n in nodes:
            n.select = False
        node.select = True
        nodes.active = node


def fill_gaps(image):
    """Fill every texel the bake left empty (alpha 0) from the nearest baked texels, by push-pull.

    The site samples small mip levels from afar; empty black texels between islands bled into the projector
    screen and a poster there. Each level halves the image with alpha-weighted averages; going back up, a texel
    with no baked texel under it takes its parent's colour.
    """
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    known = px[..., 3] > 0.5
    levels = [(px[..., :3] * known[..., None], known.astype(np.float32))]
    while min(levels[-1][1].shape) > 1:
        c, m = levels[-1]
        ch, cw = c.shape[0] // 2, c.shape[1] // 2
        levels.append((c.reshape(ch, 2, cw, 2, 3).sum(axis=(1, 3)), m.reshape(ch, 2, cw, 2).sum(axis=(1, 3))))
    c, m = levels[-1]
    colour = c / np.maximum(m, 1e-8)[..., None]
    for c, m in reversed(levels[:-1]):
        parent = np.repeat(np.repeat(colour, 2, axis=0), 2, axis=1)
        colour = np.where((m > 0)[..., None], c / np.maximum(m, 1e-8)[..., None], parent)
    px[..., :3] = np.where(known[..., None], px[..., :3], colour)
    px[..., 3] = 1.0
    image.pixels.foreach_set(px.ravel())
    image.update()


def denoise_and_save(image, path: Path, exr: Path | None = None):
    """OIDN-denoise a float bake through the compositor and write it with the scene's view transform (and, when
    asked, the same denoised result as linear half-float EXR)."""
    scene = bpy.context.scene
    saved = (scene.render.engine, scene.render.resolution_x, scene.render.resolution_y,
             scene.render.resolution_percentage, scene.render.filepath, scene.render.film_transparent,
             scene.compositing_node_group, scene.camera)
    tree = bpy.data.node_groups.new("bake_denoise", "CompositorNodeTree")
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    src = tree.nodes.new("CompositorNodeImage")
    src.image = image
    denoise = tree.nodes.new("CompositorNodeDenoise")
    out = tree.nodes.new("NodeGroupOutput")
    tree.links.new(src.outputs["Image"], denoise.inputs["Image"])
    tree.links.new(denoise.outputs["Image"], out.inputs[0])
    empty_cam = bpy.data.objects.new("bake_cam", bpy.data.cameras.new("bake_cam"))
    scene.collection.objects.link(empty_cam)
    try:
        scene.compositing_node_group = tree
        scene.camera = empty_cam
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.render.film_transparent = False
        scene.render.resolution_x, scene.render.resolution_y = image.size
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_depth = "8"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.filepath = str(path)
        # Workbench would draw the scene underneath; hide everything for this pass.
        hidden = [o for o in scene.objects if not o.hide_render]
        for o in hidden:
            o.hide_render = True
        bpy.ops.render.render(write_still=True)
        if exr is not None:
            scene.render.image_settings.file_format = "OPEN_EXR"
            scene.render.image_settings.color_depth = "16"
            scene.render.image_settings.color_mode = "RGB"
            scene.render.filepath = str(exr)
            bpy.ops.render.render(write_still=True)
            scene.render.image_settings.file_format = "PNG"
            scene.render.image_settings.color_depth = "8"
        for o in hidden:
            o.hide_render = False
    finally:
        (scene.render.engine, scene.render.resolution_x, scene.render.resolution_y,
         scene.render.resolution_percentage, scene.render.filepath, scene.render.film_transparent,
         scene.compositing_node_group, scene.camera) = saved
        bpy.data.objects.remove(empty_cam, do_unlink=True)
        bpy.data.node_groups.remove(tree)


def bake_atlas(atlas: str, size: int, samples: int, out_name: str | None = None, make_uvs=True, exr=False):
    objs = atlas_objects(atlas)
    if not objs:
        print(f"bake: no objects for atlas {atlas}")
        return
    out_name = out_name or atlas
    started = time.monotonic()
    if make_uvs or any("bake" not in o.data.uv_layers for o in objs):
        make_bake_uvs(objs, ATLAS_SIZES[atlas], MARGIN_PX[atlas])
    t_uv = time.monotonic()
    name = f"bake_{out_name}"
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    image = bpy.data.images.new(name, size, size, float_buffer=True, alpha=True)
    image.colorspace_settings.name = "Linear Rec.709"
    image.pixels.foreach_set(np.zeros(size * size * 4, dtype=np.float32))
    attach_target(objs, image)
    select_only(objs)
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    # Cycles bakes object by object and dilates each one on its own, so its margin must stay under half the gap
    # between islands or it paints over a neighbour; fill_gaps() fills the rest of the atlas afterwards.
    margin = max(1, MARGIN_PX[atlas] * size // ATLAS_SIZES[atlas] // 2)
    bake = scene.render.bake
    bake.margin, bake.margin_type, bake.use_clear = margin, "EXTEND", False
    bpy.ops.object.bake(type="COMBINED", pass_filter={"EMIT", "DIRECT", "INDIRECT", "DIFFUSE", "GLOSSY"},
                        margin=margin, margin_type="EXTEND", use_clear=False, target="IMAGE_TEXTURES",
                        uv_layer="bake")
    fill_gaps(image)
    t_bake = time.monotonic()
    BAKE_DIR.mkdir(parents=True, exist_ok=True)
    out = BAKE_DIR / f"{out_name}.png"
    denoise_and_save(image, out, BAKE_DIR / f"{out_name}.exr" if exr else None)
    # Swap the float buffer for the saved, display-ready PNG so room.blend references the file.
    bpy.data.images.remove(image)
    saved_image = bpy.data.images.load(str(out), check_existing=False)
    saved_image.name = name
    attach_target(objs, saved_image)
    print(f"bake: {out_name} {size}px {samples} spp {len(objs)} objects in {time.monotonic() - started:.0f} s "
          f"(uv {t_uv - started:.0f} s, bake {t_bake - t_uv:.0f} s) -> {out}")


def is_view(obj) -> bool:
    return str(obj.get("atlas", "")).startswith("window_")


def set_light_probes(value: float):
    """Poster and photo prints carry a light_probe switch: 1 turns their art into white paper, so the bake records
    only the light falling on them (the site draws the art over it)."""
    for mat in bpy.data.materials:
        if mat.node_tree and "light_probe" in mat.node_tree.nodes:
            mat.node_tree.nodes["light_probe"].outputs[0].default_value = value


def bake_room(atlases, scale, samples):
    hidden = [o for o in bpy.context.scene.objects if is_view(o) and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    set_light_probes(1.0)
    try:
        for atlas in atlases:
            bake_atlas(atlas, max(256, int(ATLAS_SIZES[atlas] * scale)), samples)
    finally:
        set_light_probes(0.0)
        for o in hidden:
            o.hide_render = False


def bake_view(atlases, states, scale, samples):
    """Bake the window view alone: everything else and every room light hidden, the view's own lights for the
    state on, its materials switched by window_view.set_night."""
    scene = bpy.context.scene
    view_lights = set(bpy.data.collections["window_lights"].objects)
    others = [o for o in scene.objects if not is_view(o) and o not in view_lights and not o.hide_render]
    bg = scene.world.node_tree.nodes["Background"]
    saved_bg = (tuple(bg.inputs["Color"].default_value), bg.inputs["Strength"].default_value)
    for o in others:
        o.hide_render = True
    try:
        for i, state in enumerate(states):
            window_view.set_night(1.0 if state == "night" else 0.0)
            for light in view_lights:
                light.hide_render = light["window_mode"] != state
            bg.inputs["Color"].default_value, bg.inputs["Strength"].default_value = VIEW_WORLD[state]
            for atlas in atlases:
                bake_atlas(atlas, max(128, int(ATLAS_SIZES[atlas] * scale)), samples, out_name=f"{atlas}_{state}",
                           make_uvs=i == 0, exr=True)
    finally:
        window_view.set_night(0.0)
        for light in view_lights:
            light.hide_render = True
        bg.inputs["Color"].default_value, bg.inputs["Strength"].default_value = saved_bg
        for o in others:
            o.hide_render = False


def main():
    args = parse_args()
    scene = bpy.context.scene
    saved = (scene.cycles.samples, scene.cycles.use_denoising, scene.render.threads)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = min(args.threads, MAX_THREADS)
    atlases = args.atlas.split(",")
    room = [a for a in atlases if not a.startswith("window_")]
    view = [a for a in atlases if a.startswith("window_")]
    if room:
        bake_room(room, args.scale, args.samples)
    if view:
        bake_view(view, args.states.split(","), args.scale, args.samples)
    scene.cycles.samples, scene.cycles.use_denoising, scene.render.threads = saved
    if not args.no_save:
        for img in bpy.data.images:
            if img.filepath and not img.packed_file:
                img.filepath = bpy.path.relpath(img.filepath, start=str(BLEND.parent))
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True, relative_remap=True)
        print(f"bake: saved {BLEND}")


if __name__ == "__main__":
    main()
