"""Bake the room's lighting (Cycles, CPU) into the four atlases and save room.blend with the bake UVs.

    blender -b blender/room.blend -P blender/scripts/bake.py                     # final: full size, 512 samples
    blender -b blender/room.blend -P blender/scripts/bake.py -- --scale 0.25 --samples 32 --atlas desk   # test

Each atlas gets a second UV map "bake" (smart project, islands scaled by area and packed together with a
8-16 px margin at the final size), one Combined bake (diffuse and glossy direct + indirect, emission; AO comes from
the global illumination), then OIDN denoising and the scene's AgX view transform, so the PNG in
blender/.cache/bake/<atlas>.png already looks like the Cycles render and is shown unlit on the site.
"""

import argparse
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np

REPO = Path(__file__).resolve().parents[2]
BAKE_DIR = REPO / "blender" / ".cache" / "bake"
BLEND = REPO / "blender" / "room.blend"

ATLAS_SIZES = {"env": 4096, "desk": 4096, "props": 2048, "posters": 2048}
# Island margin in pixels at the final size: the plan's floor is 8 px; the props atlas needs the floor because its
# scanned and modelled props bring about 3,700 islands into 2048 px.
MARGIN_PX = {"env": 16, "desk": 16, "props": 8, "posters": 16}
MAX_THREADS = 24
TARGET_NODE = "bake_target"


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="bake.py")
    parser.add_argument("--atlas", default=",".join(ATLAS_SIZES), help="comma-separated atlas names")
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


def denoise_and_save(image, path: Path):
    """OIDN-denoise a float bake through the compositor and write it with the scene's view transform."""
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
        for o in hidden:
            o.hide_render = False
    finally:
        (scene.render.engine, scene.render.resolution_x, scene.render.resolution_y,
         scene.render.resolution_percentage, scene.render.filepath, scene.render.film_transparent,
         scene.compositing_node_group, scene.camera) = saved
        bpy.data.objects.remove(empty_cam, do_unlink=True)
        bpy.data.node_groups.remove(tree)


def bake_atlas(atlas: str, size: int, samples: int):
    objs = atlas_objects(atlas)
    if not objs:
        print(f"bake: no objects for atlas {atlas}")
        return
    started = time.monotonic()
    make_bake_uvs(objs, ATLAS_SIZES[atlas], MARGIN_PX[atlas])
    t_uv = time.monotonic()
    name = f"bake_{atlas}"
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    image = bpy.data.images.new(name, size, size, float_buffer=True, alpha=False)
    image.colorspace_settings.name = "Linear Rec.709"
    attach_target(objs, image)
    select_only(objs)
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    bake = scene.render.bake
    bake.margin, bake.margin_type = max(2, MARGIN_PX[atlas] * size // ATLAS_SIZES[atlas]), "EXTEND"
    bake.use_clear = True
    bpy.ops.object.bake(type="COMBINED", pass_filter={"EMIT", "DIRECT", "INDIRECT", "DIFFUSE", "GLOSSY"},
                        margin=bake.margin, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES",
                        uv_layer="bake")
    t_bake = time.monotonic()
    BAKE_DIR.mkdir(parents=True, exist_ok=True)
    out = BAKE_DIR / f"{atlas}.png"
    denoise_and_save(image, out)
    # Swap the float buffer for the saved, display-ready PNG so room.blend references the file.
    bpy.data.images.remove(image)
    saved_image = bpy.data.images.load(str(out), check_existing=False)
    saved_image.name = name
    attach_target(objs, saved_image)
    print(f"bake: {atlas} {size}px {samples} spp {len(objs)} objects in {time.monotonic() - started:.0f} s "
          f"(uv {t_uv - started:.0f} s, bake {t_bake - t_uv:.0f} s) -> {out}")


def main():
    args = parse_args()
    scene = bpy.context.scene
    saved = (scene.cycles.samples, scene.cycles.use_denoising, scene.render.threads)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = min(args.threads, MAX_THREADS)
    for atlas in args.atlas.split(","):
        size = max(256, int(ATLAS_SIZES[atlas] * args.scale))
        bake_atlas(atlas, size, args.samples)
    scene.cycles.samples, scene.cycles.use_denoising, scene.render.threads = saved
    if not args.no_save:
        for img in bpy.data.images:
            if img.filepath and not img.packed_file:
                img.filepath = bpy.path.relpath(img.filepath, start=str(BLEND.parent))
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True, relative_remap=True)
        print(f"bake: saved {BLEND}")


if __name__ == "__main__":
    main()
