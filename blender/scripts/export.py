"""Export public/room/room.glb from the baked room and render the stills.

    blender -b blender/room.blend -P blender/scripts/export.py               # glb + stills
    blender -b blender/room.blend -P blender/scripts/export.py -- --no-stills

The glb follows the node contract in the site plan: unlit materials whose base colour is the baked atlas on
TEXCOORD_0, env_* / desk_* / props_* meshes, invisible hit_* proxies, the runtime meshes (crt_glow, lamp_bulb,
nas_led_*) with their own materials, and the monitor, projector and camera empties. gltf-transform then encodes the
atlases as KTX2 (ETC1S) and the geometry with meshopt. Stills (room_idle/desk/shelf and the cam_idle poster) are
Cycles renders of the same scene, composited on the site's ink colour.
"""

import argparse
import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / "blender" / ".cache"
BAKE_DIR = CACHE / "bake"
OUT_DIR = REPO / "public" / "room"
RENDERS = REPO / "blender" / "renders"

ATLASES = ("env", "desk", "props", "posters")
RUNTIME_MESHES = {"crt_glow": "crt_glow", "lamp_bulb": "lamp_bulb"}  # mesh name -> material name
GLTF_TRANSFORM = ["npx", "--yes", "-p", "@gltf-transform/cli@4.5.1", "gltf-transform"]
MAX_GLB_BYTES = 4_500_000
INK = "0x14110F"
STILLS = {
    # file stem: (camera framing, width, height)
    "room_idle": ("cam_idle", 1600, 1000),
    "room_desk": ("cam_desk", 1600, 1000),
    "room_shelf": ("cam_shelf", 1600, 1000),
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="export.py")
    parser.add_argument("--no-stills", action="store_true")
    parser.add_argument("--no-glb", action="store_true")
    parser.add_argument("--samples", type=int, default=256, help="Cycles samples for the stills")
    parser.add_argument("--threads", type=int, default=24)
    return parser.parse_args(argv)


def unlit_material(name: str, image: bpy.types.Image | None) -> bpy.types.Material:
    """Background shader on the atlas image: Blender's exporter writes it as KHR_materials_unlit."""
    mat = bpy.data.materials.new(name)
    mat.use_backface_culling = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bg = nt.nodes.new("ShaderNodeBackground")
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return mat


def atlas_image(atlas: str) -> bpy.types.Image:
    path = BAKE_DIR / f"{atlas}.png"
    if not path.exists():
        raise SystemExit(f"export: missing {path}; run bake.py first")
    image = bpy.data.images.load(str(path), check_existing=False)
    image.name = f"room_{atlas}"
    return image


def prepare_meshes() -> list[bpy.types.Object]:
    images = {atlas: atlas_image(atlas) for atlas in ATLASES}
    materials = {atlas: unlit_material(f"room_{atlas}", images[atlas]) for atlas in ATLASES}
    runtime = {}
    proxy = unlit_material("proxy", None)
    exported = []
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        atlas = obj.get("atlas")
        if obj.name.startswith("hit_"):
            obj.data = obj.data.copy()
            obj.data.materials.clear()
            obj.data.materials.append(proxy)
            for uv in list(obj.data.uv_layers):
                obj.data.uv_layers.remove(uv)
        elif atlas in ATLASES and not obj.hide_render:
            if "bake" not in obj.data.uv_layers:
                raise SystemExit(f"export: {obj.name} has no 'bake' UV map; run bake.py first")
            obj.data = obj.data.copy()
            for uv in [uv for uv in obj.data.uv_layers if uv.name != "bake"]:
                obj.data.uv_layers.remove(uv)
            if obj.name in RUNTIME_MESHES or obj.name.startswith("nas_led_"):
                mat_name = RUNTIME_MESHES.get(obj.name, "nas_led")
                if mat_name not in runtime:
                    runtime[mat_name] = unlit_material(mat_name, images[atlas])
                mat = runtime[mat_name]
            else:
                mat = materials[atlas]
            obj.data.materials.clear()
            obj.data.materials.append(mat)
        else:
            continue
        obj.data.name = obj.name
        for key in ("atlas",):
            if key in obj:
                del obj[key]
        exported.append(obj)
    return exported


def export_glb():
    meshes = prepare_meshes()
    empties = [o for o in bpy.context.scene.objects if o.type == "EMPTY"
               and any(c.name in ("markers", "cameras") for c in o.users_collection)]
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in meshes + empties:
        obj.hide_set(False)
        obj.select_set(True)
    raw = CACHE / "export" / "room_raw.glb"
    raw.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(raw), export_format="GLB", use_selection=True, export_extras=True, export_yup=True,
        export_apply=True, export_texcoords=True, export_normals=False, export_tangents=False,
        export_materials="EXPORT", export_image_format="AUTO", export_cameras=False, export_lights=False,
        export_animations=False, export_skins=False, export_morph=False, export_vertex_color="NONE",
    )
    print(f"export: raw {raw} {raw.stat().st_size:,} bytes, {len(meshes)} meshes, {len(empties)} empties")
    optimise(raw, OUT_DIR / "room.glb")


def run(*args):
    print("export: $", " ".join(map(str, args)))
    subprocess.run([str(a) for a in args], check=True, cwd=REPO)


def optimise(raw: Path, final: Path):
    work = CACHE / "export"
    steps = work / "step1.glb", work / "step2.glb", work / "step3.glb"
    run(*GLTF_TRANSFORM, "dedup", raw, steps[0])
    run(*GLTF_TRANSFORM, "prune", steps[0], steps[1], "--keep-leaves", "true")
    run(*GLTF_TRANSFORM, "etc1s", steps[1], steps[2], "--quality", "255", "--compression", "5",
        "--rdo-threshold", "1.0", "--jobs", "4")
    final.parent.mkdir(parents=True, exist_ok=True)
    run(*GLTF_TRANSFORM, "meshopt", steps[2], final, "--level", "medium", "--quantize-texcoord", "16",
        "--quantize-position", "16")
    size = final.stat().st_size
    print(f"export: {final} {size:,} bytes")
    if size > MAX_GLB_BYTES:
        raise SystemExit(f"export: room.glb is {size:,} bytes, over the {MAX_GLB_BYTES:,} budget")
    check_contract(final)


REQUIRED_NODES = (
    ["hit_fujifilm_a", "hit_fujifilm_b", "hit_fujifilm_c", "hit_super8", "hit_projector", "hit_nas", "hit_mango"]
    + [f"hit_poster_{p}" for p in ("the-odyssey-2026", "la-la-land", "chungking-express", "marty-supreme")]
    + [f"nas_led_{i}" for i in range(4)]
    + ["crt_glow", "lamp_bulb", "monitor_screen", "projector_lens", "projector_screen_center"]
    + [f"{c}{s}" for c in ("cam_loading", "cam_idle", "cam_desk", "cam_monitor") for s in ("", "_target")]
)


def check_contract(path: Path):
    data = path.read_bytes()
    length = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + length])
    names = {n.get("name") for n in gltf["nodes"]}
    missing = [n for n in REQUIRED_NODES if n not in names]
    used = set(gltf.get("extensionsUsed", []))
    needed = {"KHR_materials_unlit", "KHR_texture_basisu", "EXT_meshopt_compression"}
    if missing or not needed <= used or len(gltf.get("images", [])) > 4:
        raise SystemExit(f"export: contract broken: missing={missing} extensions={sorted(used)} "
                         f"images={len(gltf.get('images', []))}")
    print(f"export: contract ok ({len(names)} nodes, {len(gltf['images'])} atlases, {sorted(used)})")


# ---- Stills ----

def render_stills(samples: int, threads: int):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_room

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.threads_mode, scene.render.threads = "FIXED", min(threads, 24)
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    RENDERS.mkdir(parents=True, exist_ok=True)
    work = CACHE / "stills"
    work.mkdir(parents=True, exist_ok=True)
    jobs = dict(STILLS, poster=("cam_idle", 1600, 1000))
    for stem, (framing, width, height) in jobs.items():
        build_room.aim_camera(framing)
        scene.render.resolution_x, scene.render.resolution_y = width, height
        rgba = work / f"{stem}_rgba.png"
        scene.render.filepath = str(rgba)
        bpy.ops.render.render(write_still=True)
        flat = (RENDERS / f"{stem}.png") if stem != "poster" else work / "poster.png"
        ffmpeg("-f", "lavfi", "-i", f"color=c={INK}:s={width}x{height}", "-i", rgba,
               "-filter_complex", "[0][1]overlay=format=auto", "-frames:v", "1", flat)
        if stem == "poster":
            OUT_DIR.mkdir(parents=True, exist_ok=True)
            ffmpeg("-i", flat, "-c:v", "libaom-av1", "-still-picture", "1", "-crf", "30", "-cpu-used", "4",
                   "-pix_fmt", "yuv420p", OUT_DIR / "poster.avif")
            ffmpeg("-i", flat, "-q:v", "3", OUT_DIR / "poster.jpg")
        print(f"export: still {stem} from {framing}")


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True)


def main():
    args = parse_args()
    if shutil.which("npx") is None or shutil.which("ktx") is None:
        raise SystemExit("export: needs npx (Node) and ktx (KTX-Software 4.x) on PATH")
    if not args.no_stills:
        render_stills(args.samples, args.threads)
    if not args.no_glb:
        export_glb()


if __name__ == "__main__":
    main()
