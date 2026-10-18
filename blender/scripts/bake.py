"""Bake the set's lighting (Cycles, CPU) into its four atlases, and the window view's two halves by day; save
room.blend with the bake UVs.

    blender -b blender/room.blend -P blender/scripts/bake.py -t 16                # final: full size, 256 samples
    blender -b blender/room.blend -P blender/scripts/bake.py -- --scale 0.25 --samples 32   # quick look
    blender -b blender/room.blend -P blender/scripts/bake.py -- --atlas desk      # one atlas (the desk, last)
    blender -b blender/room.blend -P blender/scripts/bake.py -- --atlas window_sf,window_delhi   # view only
    blender -b blender/room.blend -P blender/scripts/bake.py -- --regrade env   # new exposure, no re-bake

Each atlas gets a second UV map "bake" (an object's own clean UVs or a smart projection, scaled by its area times
its "texel" weight, so the density is uniform within an object, and packed together with a margin, MARGIN_PX). Then one Combined bake of the view-independent light only (diffuse, direct and indirect, and
emission; the site adds the shine of the surfaces tagged "gloss" live, since a glossy bake is right from one viewpoint
only), with metals and glass baked as diffuse in their own colour so they do not come out black, a diffuse-colour
and a normal bake that guide OIDN's denoising, the scene's AgX view transform, and the void fade: each texel blends toward
the void colour by room_lib.void_fade() of the surface point it shows (read from a bake of world positions), so the
walls' tops and free ends and the floor's rim meet the site's clear colour with no edge. The PNG in
blender/.cache/bake/<atlas>.png already looks like the Cycles render and is shown unlit on the site.

The atlases bake larger than they ship (export.py resamples them), so each shipped texel averages several baked
ones. The set bakes without the window view (the camera-invisible env_sky card lights the set through the window);
the view's halves (window_sf, window_delhi) bake alone into <atlas>_day.png plus a linear <atlas>_day.exr that
export.py shows in the stills. Every atlas also keeps its denoised linear light (<atlas>_linear.exr) and its void
fade (<atlas>_fade.npy), so --regrade can redo the view transform and the fade after an exposure change in minutes.
"""

import argparse
import json
import math
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import bpy
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import room_lib  # noqa: E402
import window_view  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
BAKE_DIR = REPO / "blender" / ".cache" / "bake"
BLEND = REPO / "blender" / "room.blend"

# Bake sizes (coordinator ruling, 2026-10-17 08:00Z, for a night-long budget): the desk hero atlas bakes at 1.5x the
# 4096 px it ships at, so every shipped texel averages a couple of baked ones, and so does the bezel's (3072 for 2304);
# art and props bake at their 4096 ship size, and the walls and floor, smooth diffuse light, at 3072. The view's halves
# ship at their bake size: San Francisco's larger, for the Painted Ladies' trim and windows, each half's KTX2 kept under
# about 0.6 MB.
ATLAS_SIZES = {"desk": 6144, "bezel": 3072, "art": 4096, "props": 4096, "env": 3072, "window_sf": 1792,
               "window_delhi": 1536}
SHIP_PX = 4096
# Island margin at the bake size: 8 px at the shipped size everywhere (the view keeps 6 px). The desk had CRAFT-R8's
# 16 px; once its top was cut into the rectangles the views see (build_room.split_desk_top_by_view), that margin round
# ~150 islands left it 52 % full, and 8 px brought it back to 64 % (round eight's fill with one desk-top island).
MARGIN_PX = {"desk": 12, "bezel": 12, "art": 8, "props": 8, "env": 6, "window_sf": 6, "window_delhi": 6}
# Margins copy texels from the face across a UV seam (Extend left a sawtooth along slanted island edges, which the site
# sampled as beads wherever one surface is split into islands: the CRT bezel's creases, the desk top's rectangles).
MARGIN_TYPE = "ADJACENT_FACES"
# Islands of the desk atlas stay axis-aligned: its desk-top rectangles pack tighter (52 % vs 50 % at 16 px).
PACK_ROTATE = {"desk": "AXIS_ALIGNED"}
# The world seen through the open front of the view while it bakes: a pale day sky.
VIEW_WORLD = ((0.62, 0.70, 0.82, 1.0), 0.35)
GUIDE_SAMPLES = 4  # the albedo and normal guides for OIDN (they barely change within a texel)

MAX_THREADS = 16  # the devbox is shared: the coordinator caps Blender at 16 threads
TARGET_NODE = "bake_target"


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="bake.py")
    parser.add_argument("--atlas", default=",".join(ATLAS_SIZES), help="comma-separated atlas names")
    parser.add_argument("--scale", type=float, default=1.0, help="fraction of the final atlas size (tests)")
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--threads", type=int, default=MAX_THREADS)
    parser.add_argument("--no-save", action="store_true", help="do not write room.blend")
    parser.add_argument("--save-as", default="", help="write the baked blend here instead (a parallel lane)")
    parser.add_argument("--regrade", default="", help="atlases to re-grade from their saved light, without baking")
    parser.add_argument("--guide-workers", type=int, default=GUIDE_WORKERS,
                        help="processes for the guide passes (1: in this process)")
    parser.add_argument("--guide-worker", default="", help=argparse.SUPPRESS)
    parser.add_argument("--gpu", action="store_true", help="Cycles on the GPU: OptiX, else CUDA")
    return parser.parse_args(argv)


def use_gpu() -> str:
    """Point Cycles at the GPU (OptiX, else CUDA); returns the backend. The device choice lives in the user
    preferences, not the blend, so every process (the guide pool's too) has to make it."""
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        found = [d for d in prefs.devices if d.type == backend]
        if found:
            for d in prefs.devices:
                d.use = d.type == backend
            bpy.context.scene.cycles.device = "GPU"
            print(f"bake: Cycles on {backend}: {', '.join(d.name for d in found)}")
            return backend
    raise SystemExit("bake: --gpu asked for, but Cycles finds no OptiX or CUDA device")


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


def make_bake_uvs(objs, size: int, margin_px: int, rotate: str = "ANY"):
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
        if source is not None and obj.get("bake_uv") not in ("project", "unwrap") and overlap_fraction(mesh, source) < 0.01:
            coords = np.empty(len(mesh.loops) * 2, dtype=np.float32)
            source.data.foreach_get("uv", coords)
            bake_uv.data.foreach_set("uv", coords)
        else:
            to_project.append(obj)
        mesh.uv_layers.active = bake_uv
        if source is not None:
            source.active_render = True
    # bake_uv "unwrap": the object's marked seams alone part its islands (the CRT bezel: build_room.mark_bezel_sides).
    unwrap = [o for o in to_project if o.get("bake_uv") == "unwrap"]
    if unwrap:
        select_only(unwrap)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.reveal()
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="ANGLE_BASED", fill_holes=True, correct_aspect=False, margin_method="FRACTION",
                          margin=0.0)
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.average_islands_scale()
        bpy.ops.object.mode_set(mode="OBJECT")
    to_project = [o for o in to_project if o.get("bake_uv") != "unwrap"]
    # An object may ask for a wider projection angle (extra project_angle): islands cut at a crease bake beaded edges
    # there, each side sampling the other face's shadow on its border texels.
    for angle in sorted({float(o.get("project_angle", 60.0)) for o in to_project}):
        group = [o for o in to_project if float(o.get("project_angle", 60.0)) == angle]
        select_only(group)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.reveal()
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=False, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")
    print(f"bake: {len(objs) - len(to_project) - len(unwrap)} objects keep their UVs, {len(unwrap)} unwrapped, "
          f"{len(to_project)} smart-projected")
    normalise_texel_density(objs)
    select_only(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method=rotate, scale=True,
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
    image.pixels.foreach_set(filled(pixels(image)).ravel())
    image.update()


def filled(px: np.ndarray) -> np.ndarray:
    """fill_gaps on an (h, w, 4) array: the result is opaque everywhere."""
    px = px.copy()
    px[..., :3] = push_pull(px[..., :3], px[..., 3] > 0.5)
    px[..., 3] = 1.0
    return px


def push_pull(rgb, known):
    """Colours for the unknown texels of rgb from the known ones (see fill_gaps). Any size: a level with an odd side
    is padded with one empty row or column before it halves (6144 = 3 x 2048 halves to 3, then pads to 4)."""
    levels = [(rgb * known[..., None], known.astype(np.float32))]
    while min(levels[-1][1].shape) > 1:
        c, m = levels[-1]
        pad_h, pad_w = c.shape[0] % 2, c.shape[1] % 2
        if pad_h or pad_w:
            c = np.pad(c, ((0, pad_h), (0, pad_w), (0, 0)))
            m = np.pad(m, ((0, pad_h), (0, pad_w)))
        ch, cw = c.shape[0] // 2, c.shape[1] // 2
        levels.append((c.reshape(ch, 2, cw, 2, 3).sum(axis=(1, 3)), m.reshape(ch, 2, cw, 2).sum(axis=(1, 3))))
    c, m = levels[-1]
    colour = c / np.maximum(m, 1e-8)[..., None]
    for c, m in reversed(levels[:-1]):
        parent = np.repeat(np.repeat(colour, 2, axis=0), 2, axis=1)[: m.shape[0], : m.shape[1]]
        colour = np.where((m > 0)[..., None], c / np.maximum(m, 1e-8)[..., None], parent)
    return np.where(known[..., None], rgb, colour)


def float_image(name: str, size: int) -> bpy.types.Image:
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    image = bpy.data.images.new(name, size, size, float_buffer=True, alpha=True)
    image.colorspace_settings.name = "Non-Color" if name.endswith(("_normal", "_position")) else "Linear Rec.709"
    image.pixels.foreach_set(np.zeros(size * size * 4, dtype=np.float32))
    return image


def pixels(image) -> np.ndarray:
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def bake_pass(objs, image, kind, samples, margin, fill=True, **extra):
    """One Cycles bake of objs into image (their materials' active bake_target node points at it)."""
    attach_target(objs, image)
    select_only(objs)
    bpy.context.scene.cycles.samples = samples
    bpy.ops.object.bake(type=kind, margin=margin, margin_type=MARGIN_TYPE, use_clear=False, target="IMAGE_TEXTURES",
                        uv_layer="bake", **extra)
    if fill:
        fill_gaps(image)


def bake_positions(objs, size, margin) -> np.ndarray:
    """World position (x, y, z) per texel, from an emission bake through one probe material; floor objects emit z
    pushed down by FLOOR_FLAG so void_fade can tell the floor's rim from the walls' tops. Unfilled (h, w, 4)."""
    image = float_image("bake_position", size)
    probes = {}
    for floor in (False, True):
        mat = bpy.data.materials.new(f"position_probe_{int(floor)}")
        nt = mat.node_tree
        nt.nodes.clear()
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        emit = nt.nodes.new("ShaderNodeEmission")
        shift = nt.nodes.new("ShaderNodeVectorMath")
        shift.operation = "ADD"
        shift.inputs[1].default_value = (0.0, 0.0, -FLOOR_FLAG if floor else 0.0)
        nt.links.new(geo.outputs["Position"], shift.inputs[0])
        nt.links.new(shift.outputs["Vector"], emit.inputs["Color"])
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
        probes[floor] = mat
    saved = {o.name: [slot.material for slot in o.material_slots] for o in objs}
    try:
        for o in objs:
            for slot in o.material_slots:
                slot.material = probes[o.name.startswith("floor")]
        bake_pass(objs, image, "EMIT", 1, margin, fill=False)
    finally:
        for o in objs:
            for slot, mat in zip(o.material_slots, saved[o.name]):
                slot.material = mat
        for mat in probes.values():
            bpy.data.materials.remove(mat)
    pos = pixels(image)
    bpy.data.images.remove(image)
    return pos


FLOOR_FLAG = 100.0


def void_fade_map(pos: np.ndarray) -> np.ndarray:
    floor = pos[..., 2] < -FLOOR_FLAG / 2
    z = np.where(floor, pos[..., 2] + FLOOR_FLAG, pos[..., 2])
    return room_lib.void_fade(pos[..., 0], pos[..., 1], z, floor=floor)


# The guide passes run in a bounded pool of Blender processes, each baking a run of the atlas's objects (in their
# sorted order) into its own image, threads shared out under MAX_THREADS. Cycles syncs the whole scene again for every
# object it bakes, mostly on one core, so round eight spent as long on the 4-sample guides as on the light itself
# (props: 1,377 s of 2,740 s). Each object bakes exactly as it would alone, and the runs merge in order.
GUIDE_WORKERS = 4


def guide_passes(objs, size, margin, positions: bool) -> dict[str, np.ndarray]:
    """The albedo and normal bakes that guide OIDN, and the world positions for the void fade: unfilled (h, w, 4)."""
    out = {}
    albedo = float_image("guide_albedo", size)
    bake_pass(objs, albedo, "DIFFUSE", GUIDE_SAMPLES, margin, fill=False, pass_filter={"COLOR"})
    out["albedo"] = pixels(albedo)
    normal = float_image("guide_normal", size)
    bake_pass(objs, normal, "NORMAL", GUIDE_SAMPLES, margin, fill=False, normal_space="OBJECT")
    out["normal"] = pixels(normal)
    for img in (albedo, normal):
        bpy.data.images.remove(img)
    if positions:
        out["position"] = bake_positions(objs, size, margin)
    return out


def pooled_guide_passes(objs, size, margin, positions: bool, workers: int, tag: str) -> dict[str, np.ndarray]:
    """guide_passes over runs of objs in up to `workers` Blender processes, merged in object order (a later object's
    texels over an earlier one's, as in one bake)."""
    runs = [list(r) for r in np.array_split(np.array([o.name for o in objs], dtype=object), min(workers, len(objs)))]
    work = BAKE_DIR / "guides"
    work.mkdir(parents=True, exist_ok=True)
    copy = work / f"{tag}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(copy), copy=True, compress=False, relative_remap=True)
    threads = max(1, bpy.context.scene.render.threads // len(runs))
    procs = []
    for k, names in enumerate(runs):
        spec = work / f"{tag}_{k}.json"
        spec.write_text(json.dumps({"objects": names, "size": size, "margin": margin, "positions": positions,
                                    "threads": threads, "gpu": bpy.context.scene.cycles.device == "GPU",
                                    "out": str(work / f"{tag}_{k}")}))
        log = open(work / f"{tag}_{k}.log", "w")
        procs.append((subprocess.Popen([bpy.app.binary_path, "-b", str(copy), "-t", str(threads), "--python-exit-code",
                                        "1", "-P", __file__, "--", "--guide-worker", str(spec)],
                                       stdout=log, stderr=subprocess.STDOUT), log))
    failed = []
    for k, (proc, log) in enumerate(procs):
        if proc.wait() != 0:
            failed.append(k)
        log.close()
    if failed:
        raise SystemExit(f"bake: guide workers {failed} failed (logs in {work})")
    merged = {}
    for k in range(len(runs)):
        for key in ("albedo", "normal", "position") if positions else ("albedo", "normal"):
            part = np.load(work / f"{tag}_{k}_{key}.npz")
            flat = merged.setdefault(key, np.zeros((size * size, 4), dtype=np.float32))
            flat[part["index"]] = part["value"]
    merged = {key: flat.reshape(size, size, 4) for key, flat in merged.items()}
    for f in work.glob(f"{tag}*"):
        f.unlink()
    return merged


def guide_worker(spec_path: str):
    """One process of the guide pool: bake the guide passes of the objects in the spec and save them as .npy."""
    spec = json.loads(Path(spec_path).read_text())
    scene = bpy.context.scene
    scene.render.threads_mode, scene.render.threads = "FIXED", spec["threads"]
    if spec.get("gpu"):
        use_gpu()
    objs = [bpy.data.objects[n] for n in spec["objects"]]
    for key, px in guide_passes(objs, spec["size"], spec["margin"], spec["positions"]).items():
        flat = px.reshape(-1, 4)
        index = np.flatnonzero(flat[:, 3] > 0)  # only the texels this run baked: a fifth of the bytes of the image
        np.savez(f"{spec['out']}_{key}.npz", index=index, value=flat[index])


def image_from(name: str, px: np.ndarray) -> bpy.types.Image:
    image = float_image(name, px.shape[0])
    image.pixels.foreach_set(px.ravel())
    return image


def denoise_and_save(image, path: Path, albedo=None, normal=None, exr: Path | None = None, denoise=True):
    """OIDN-denoise a float bake through the compositor (guided by its albedo and normal bakes when given) and write
    it with the scene's view transform (and, when asked, the same denoised result as linear half-float EXR).
    denoise=False only applies the view transform (a re-grade of light already denoised)."""
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
    for guide, socket_name in ((albedo, "Albedo"), (normal, "Normal")):
        if guide is not None:
            node = tree.nodes.new("CompositorNodeImage")
            node.image = guide
            tree.links.new(node.outputs["Image"], denoise.inputs[socket_name])
    tree.links.new((denoise if denoise else src).outputs["Image"], out.inputs[0])
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


def apply_void_fade(path: Path, fade: np.ndarray):
    """Blend the saved display-ready PNG toward the void colour by fade (both in display values), with a triangular
    dither of one 8-bit step so the long dark ramps do not band once shipped at 8 bits."""
    image = bpy.data.images.load(str(path), check_existing=False)
    px = pixels(image)
    void = np.array([int(room_lib.VOID_HEX[i:i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)
    f = fade.astype(np.float32)[..., None]
    rng = np.random.default_rng(20261017)
    dither = (rng.random(px.shape[:2] + (1,), dtype=np.float32) - rng.random(px.shape[:2] + (1,), dtype=np.float32))
    ramp = (f > 0.002) & (f < 0.998)
    rgb = px[..., :3] * (1 - f) + void * f + np.where(ramp, dither / 255.0, 0.0)
    px[..., :3] = np.clip(rgb, 0.0, 1.0)
    image.pixels.foreach_set(px.ravel())
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def bake_atlas(atlas: str, size: int, samples: int, out_name: str | None = None, make_uvs=True, exr=False):
    objs = atlas_objects(atlas)
    if not objs:
        print(f"bake: no objects for atlas {atlas}")
        return
    out_name = out_name or atlas
    started = time.monotonic()
    if make_uvs or any("bake" not in o.data.uv_layers for o in objs):
        make_bake_uvs(objs, ATLAS_SIZES[atlas], MARGIN_PX[atlas], PACK_ROTATE.get(atlas, "ANY"))
    t_uv = time.monotonic()
    scene = bpy.context.scene
    scene.cycles.use_denoising = False
    # Cycles bakes object by object and dilates each one on its own, so its margin must stay under half the gap
    # between islands or it paints over a neighbour; fill_gaps() fills the rest of the atlas afterwards.
    margin = max(1, MARGIN_PX[atlas] * size // ATLAS_SIZES[atlas] // 2)
    scene.render.bake.margin, scene.render.bake.margin_type, scene.render.bake.use_clear = margin, MARGIN_TYPE, False
    image = float_image(f"bake_{out_name}", size)
    # The set bakes its view-independent light; the window's view, seen only from in front, keeps its sheen.
    light = {"EMIT", "DIRECT", "INDIRECT", "DIFFUSE"} | ({"GLOSSY"} if atlas.startswith("window_") else set())
    bake_pass(objs, image, "COMBINED", samples, margin, pass_filter=light)
    t_bake = time.monotonic()
    positions = not atlas.startswith("window_")
    if GUIDE_WORKERS > 1 and len(objs) > 1:
        guides = pooled_guide_passes(objs, size, margin, positions, GUIDE_WORKERS, out_name)
    else:
        guides = guide_passes(objs, size, margin, positions)
    albedo = image_from(f"bake_{out_name}_albedo", filled(guides["albedo"]))
    n = filled(guides["normal"])
    n[..., :3] = n[..., :3] * 2.0 - 1.0  # the bake stores (n + 1) / 2; OIDN wants n
    normal = image_from(f"bake_{out_name}_normal", n)
    fade = void_fade_map(filled(guides["position"])[..., :3].astype(np.float64)) if positions else None
    del guides, n
    t_guides = time.monotonic()
    BAKE_DIR.mkdir(parents=True, exist_ok=True)
    out = BAKE_DIR / f"{out_name}.png"
    linear = BAKE_DIR / (f"{out_name}.exr" if exr else f"{out_name}_linear.exr")
    denoise_and_save(image, out, albedo, normal, linear)
    if fade is not None:
        np.save(BAKE_DIR / f"{out_name}_fade.npy", fade.astype(np.float16))
        apply_void_fade(out, fade)
    for img in (image, albedo, normal):
        bpy.data.images.remove(img)
    # Point the materials at the saved, display-ready PNG so room.blend references the file.
    saved_image = bpy.data.images.load(str(out), check_existing=False)
    saved_image.name = f"bake_{out_name}"
    attach_target(objs, saved_image)
    print(f"bake: {out_name} {size}px {samples} spp {len(objs)} objects in {time.monotonic() - started:.0f} s "
          f"(uv {t_uv - started:.0f} s, bake {t_bake - t_uv:.0f} s, guides and fade {t_guides - t_bake:.0f} s) -> {out}")


@contextmanager
def view_independent():
    """While the set bakes, every Principled BSDF is a dielectric without transmission (Metallic and Transmission
    Weight unlinked and 0), so metal and glass bake their colour as diffuse light; restored afterwards."""
    saved = []
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.bl_idname != "ShaderNodeBsdfPrincipled":
                continue
            for name in ("Metallic", "Transmission Weight"):
                sock = node.inputs[name]
                saved.append((mat, sock, sock.default_value, [link.from_socket for link in sock.links]))
                for link in list(sock.links):
                    mat.node_tree.links.remove(link)
                sock.default_value = 0.0
    try:
        yield
    finally:
        for mat, sock, value, sources in saved:
            sock.default_value = value
            for src in sources:
                mat.node_tree.links.new(src, sock)


def is_view(obj) -> bool:
    return str(obj.get("atlas", "")).startswith("window_")


def set_light_probes(value: float):
    """Poster and photo prints carry a light_probe switch: 1 turns their art into white paper, so the bake records
    only the light falling on them (the site draws the art over it)."""
    for mat in bpy.data.materials:
        if mat.node_tree and "light_probe" in mat.node_tree.nodes:
            mat.node_tree.nodes["light_probe"].outputs[0].default_value = value


SAVE_AS = [BLEND]  # main() points this at --save-as for a parallel lane


def save_blend():
    """Write the blend with the bake UVs and images so far (after every atlas: a long bake keeps what it finished)."""
    target = SAVE_AS[0]
    for img in bpy.data.images:
        if img.filepath and not img.packed_file:
            img.filepath = bpy.path.relpath(img.filepath, start=str(target.parent))
    bpy.ops.wm.save_as_mainfile(filepath=str(target), compress=True, relative_remap=True)
    print(f"bake: saved {target}")


def bake_room(atlases, scale, samples, save=True):
    hidden = [o for o in bpy.context.scene.objects if is_view(o) and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    set_light_probes(1.0)
    try:
        for atlas in atlases:
            with view_independent():
                bake_atlas(atlas, max(256, int(ATLAS_SIZES[atlas] * scale)), samples)
            if save:
                save_blend()
    finally:
        set_light_probes(0.0)
        for o in hidden:
            o.hide_render = False


def bake_view(atlases, scale, samples):
    """Bake the window view alone, by day: everything else and every room light hidden, the view's day lights on."""
    scene = bpy.context.scene
    view_lights = set(bpy.data.collections["window_lights"].objects)
    others = [o for o in scene.objects if not is_view(o) and o not in view_lights and not o.hide_render]
    bg = scene.world.node_tree.nodes["Background"]
    saved_bg = (tuple(bg.inputs["Color"].default_value), bg.inputs["Strength"].default_value)
    for o in others:
        o.hide_render = True
    try:
        window_view.set_night(0.0)
        for light in view_lights:
            light.hide_render = light["window_mode"] != "day"
        bg.inputs["Color"].default_value, bg.inputs["Strength"].default_value = VIEW_WORLD
        for atlas in atlases:
            bake_atlas(atlas, max(128, int(ATLAS_SIZES[atlas] * scale)), samples, out_name=f"{atlas}_day", exr=True)
    finally:
        for light in view_lights:
            light.hide_render = True
        bg.inputs["Color"].default_value, bg.inputs["Strength"].default_value = saved_bg
        for o in others:
            o.hide_render = False


def regrade(atlas: str):
    """Redo an atlas's PNG from its saved denoised light and void fade with the scene's current view transform."""
    linear = bpy.data.images.load(str(BAKE_DIR / f"{atlas}_linear.exr"), check_existing=False)
    linear.colorspace_settings.name = "Linear Rec.709"
    out = BAKE_DIR / f"{atlas}.png"
    denoise_and_save(linear, out, denoise=False)
    apply_void_fade(out, np.load(BAKE_DIR / f"{atlas}_fade.npy").astype(np.float32))
    bpy.data.images.remove(linear)
    image = bpy.data.images.get(f"bake_{atlas}")
    if image is not None:
        image.reload()
    print(f"bake: regraded {atlas} -> {out}")


def main():
    global GUIDE_WORKERS
    args = parse_args()
    if args.guide_worker:
        guide_worker(args.guide_worker)
        return
    GUIDE_WORKERS = args.guide_workers
    if args.save_as:
        SAVE_AS[0] = Path(args.save_as).resolve()
    if args.regrade:
        for atlas in args.regrade.split(","):
            regrade(atlas)
        return
    scene = bpy.context.scene
    saved = (scene.cycles.samples, scene.cycles.use_denoising, scene.render.threads)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = min(args.threads, MAX_THREADS)
    if args.gpu:
        use_gpu()
    atlases = args.atlas.split(",")
    room = [a for a in atlases if not a.startswith("window_")]
    view = [a for a in atlases if a.startswith("window_")]
    if room:
        bake_room(room, args.scale, args.samples, save=not args.no_save)
    if view:
        bake_view(view, args.scale, args.samples)
    scene.cycles.samples, scene.cycles.use_denoising, scene.render.threads = saved
    if not args.no_save:
        save_blend()


if __name__ == "__main__":
    main()
