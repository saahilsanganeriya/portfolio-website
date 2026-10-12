"""Export public/room/room.glb and the window view's textures from the baked room, and render the stills.

    blender -b blender/room.blend -P blender/scripts/export.py               # glb + window textures + stills
    blender -b blender/room.blend -P blender/scripts/export.py -- --no-stills

The glb follows the node contract in the site plan: unlit materials whose base colour is the baked atlas on
TEXCOORD_0, env_* / desk_* / props_* meshes, invisible hit_* proxies, the runtime meshes (crt_glow, lamp_bulb,
lava_lamp_glass, oven_glow, nas_led_*) with their own materials, the art meshes (poster_art_*, photo_print_*: art
UVs on TEXCOORD_0, the baked light on them on TEXCOORD_1), the two halves of the window view (window_view_sf,
window_view_delhi) whose textures are separate files, pivots for the parts that turn (ceiling_fan_blades,
projector_dial), and the monitor, projector, camera and anchor empties. gltf-transform then encodes the atlases as
KTX2 (ETC1S) and the geometry with meshopt; the view's day textures are referenced by URI, so the site loads them
next to the glb and blends in the night pair by local time. Stills are Cycles renders of the same scene, with the
view shown from its bakes, composited on the site's ink colour.
"""

import argparse
import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / "blender" / ".cache"
BAKE_DIR = CACHE / "bake"
OUT_DIR = REPO / "public" / "room"
RENDERS = REPO / "blender" / "renders"

ATLASES = ("env", "desk", "props")
VIEW_ATLASES = {"window_sf": "window_view_sf", "window_delhi": "window_view_delhi"}
RUNTIME_MESHES = {"crt_glow": "crt_glow", "lamp_bulb": "lamp_bulb", "lava_lamp_glass": "lava_lamp_glass",
                  "oven_glow": "oven_glow"}  # mesh name -> material name
PIVOTS = ("ceiling_fan_blades", "projector_dial")  # turn about their own local +Y (Blender +Z)
GLTF_TRANSFORM = ["npx", "--yes", "-p", "@gltf-transform/cli@4.5.1", "gltf-transform"]
MAX_GLB_BYTES = 4_300_000  # PLAN 11.3: glb plus the two day textures keep the initial 3D payload under 6 MB
MAX_VIEW_DAY_BYTES = 400_000
INK = "0x14110F"
# The stills show San Francisco at dusk and Delhi by day: the view's night share per half.
STILL_NIGHT = {"window_sf": 0.5, "window_delhi": 0.0}
STILLS = {
    # file stem: (camera framing, width, height)
    "room_idle": ("cam_idle", 1600, 1000),
    "room_desk": ("cam_desk", 1600, 1000),
    "room_shelf": ("cam_shelf", 1600, 1000),
    "room_window": ("cam_window", 1600, 1000),
    "room_projector": ("cam_projector", 1600, 1000),
    "room_photos": ("cam_photos", 1600, 1000),
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="export.py")
    parser.add_argument("--no-stills", action="store_true")
    parser.add_argument("--no-glb", action="store_true")
    parser.add_argument("--samples", type=int, default=256, help="Cycles samples for the stills")
    parser.add_argument("--threads", type=int, default=24)
    parser.add_argument("--only", default="", help="comma-separated still stems to render (default: all)")
    return parser.parse_args(argv)


def unlit_material(name: str, image: bpy.types.Image | None, uv_map: str | None = None) -> bpy.types.Material:
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
        if uv_map:
            uv = nt.nodes.new("ShaderNodeUVMap")
            uv.uv_map = uv_map
            nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
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


def private_copy(mesh: bpy.types.Mesh) -> bpy.types.Mesh:
    """Copy a mesh for export, moving the original aside so the copy can take the object's exact name."""
    mesh.name = f"{mesh.name}_scene"
    return mesh.copy()


def join_view_halves() -> list[bpy.types.Object]:
    """Join each half's parts into one mesh, named for the contract, with an untextured placeholder material (its
    texture is added to the glb by URI after gltf-transform, see add_view_textures)."""
    halves = []
    for atlas, name in VIEW_ATLASES.items():
        parts = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.get("atlas") == atlas]
        if not parts:
            raise SystemExit(f"export: no parts for {atlas}")
        for o in parts:
            o.data = private_copy(o.data)
            for uv in [uv for uv in o.data.uv_layers if uv.name != "bake"]:
                o.data.uv_layers.remove(uv)
            o.data.materials.clear()
        with bpy.context.temp_override(active_object=parts[0], selected_editable_objects=parts,
                                       selected_objects=parts, object=parts[0]):
            bpy.ops.object.join()
        joined = parts[0]
        joined.name = joined.data.name = name
        joined.data.materials.append(unlit_material(name, None))
        for key in ("atlas", "texel", "view_side"):
            if key in joined:
                del joined[key]
        joined["texture_day"] = f"{atlas}_day.ktx2"
        joined["texture_night"] = f"{atlas}_night.ktx2"
        halves.append(joined)
    return halves


def prepare_meshes() -> list[bpy.types.Object]:
    for name in ["proxy", *RUNTIME_MESHES.values(), "nas_led", "room_props_leaves", *(f"room_{a}" for a in ATLASES)]:
        if name in bpy.data.materials:
            bpy.data.materials[name].name = f"{name}_scene"
    images = {atlas: atlas_image(atlas) for atlas in ATLASES}
    materials = {atlas: unlit_material(f"room_{atlas}", images[atlas]) for atlas in ATLASES}
    # Only open, single-layer surfaces (the mango leaves) are double-sided: on thin closed shells such as the screen
    # fabric, a double-sided material let the dark back layer z-fight through the front from afar.
    leaves = unlit_material("room_props_leaves", images["props"])
    leaves.use_backface_culling = False
    runtime = {}
    proxy = unlit_material("proxy", None)
    exported = join_view_halves()
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH" or obj in exported:
            continue
        atlas = obj.get("atlas")
        if obj.name.startswith("hit_"):
            obj.data = private_copy(obj.data)
            obj.data.materials.clear()
            obj.data.materials.append(proxy)
            for uv in list(obj.data.uv_layers):
                obj.data.uv_layers.remove(uv)
        elif atlas in ATLASES and not obj.hide_render:
            if "bake" not in obj.data.uv_layers:
                raise SystemExit(f"export: {obj.name} has no 'bake' UV map; run bake.py first")
            obj.data = private_copy(obj.data)
            art = obj.get("runtime_art")
            # Art meshes keep their 0-1 art UVs first (TEXCOORD_0); the baked light is TEXCOORD_1.
            keep = ("UVMap", "bake") if art else ("bake",)
            for uv in [uv for uv in obj.data.uv_layers if uv.name not in keep]:
                obj.data.uv_layers.remove(uv)
            if art and [uv.name for uv in obj.data.uv_layers] != ["UVMap", "bake"]:
                raise SystemExit(f"export: {obj.name} needs UV maps UVMap then bake")
            if art:
                mat = unlit_material(obj.name, images[atlas], uv_map="bake")
            elif obj.name in RUNTIME_MESHES or obj.name.startswith("nas_led_"):
                mat_name = RUNTIME_MESHES.get(obj.name, "nas_led")
                if mat_name not in runtime:
                    runtime[mat_name] = unlit_material(mat_name, images[atlas])
                mat = runtime[mat_name]
            elif obj.get("double_sided"):
                mat = leaves
            else:
                mat = materials[atlas]
            obj.data.materials.clear()
            obj.data.materials.append(mat)
        else:
            continue
        obj.data.name = obj.name
        for key in ("atlas", "texel", "bake_uv", "triangles"):
            if key in obj:
                del obj[key]
        exported.append(obj)
    return exported


def add_pivots(meshes):
    """Give each turning part an empty at its own origin that holds the mesh: gltf-transform's quantization moves a
    mesh node's origin to its bounds' centre, which would put the fan's axis 5 cm off its hub."""
    pivots = []
    for name in PIVOTS:
        obj = bpy.data.objects[name]
        world = obj.matrix_world.copy()
        loc, rot, _ = world.decompose()
        obj.name = obj.data.name = f"{name}_mesh"
        pivot = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(pivot)
        pivot.matrix_world = Matrix.LocRotScale(loc, rot, None)
        pivot["turn_axis"] = "+Y"
        obj.parent = pivot
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = world
        pivots.append(pivot)
    return pivots


def export_glb():
    meshes = prepare_meshes()
    pivots = add_pivots(meshes)
    empties = [o for o in bpy.context.scene.objects if o.type == "EMPTY"
               and any(c.name in ("markers", "cameras") for c in o.users_collection)] + pivots
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
    final = OUT_DIR / "room.glb"
    optimise(raw, final)
    add_view_textures(final)
    check_contract(final)


def run(*args):
    print("export: $", " ".join(map(str, args)))
    subprocess.run([str(a) for a in args], check=True, cwd=REPO)


def optimise(raw: Path, final: Path):
    work = CACHE / "export"
    steps = work / "step1.glb", work / "step2.glb", work / "step3.glb"
    run(*GLTF_TRANSFORM, "dedup", raw, steps[0], "--materials", "false")
    # Attributes stay: the view halves have no texture until add_view_textures, but need their TEXCOORD_0.
    run(*GLTF_TRANSFORM, "prune", steps[0], steps[1], "--keep-leaves", "true", "--keep-attributes", "true")
    run(*GLTF_TRANSFORM, "etc1s", steps[1], steps[2], "--quality", "255", "--compression", "5",
        "--rdo-threshold", "1.25", "--jobs", "4")
    final.parent.mkdir(parents=True, exist_ok=True)
    run(*GLTF_TRANSFORM, "meshopt", steps[2], final, "--level", "medium", "--quantize-texcoord", "14",
        "--quantize-position", "14")
    print(f"export: {final} {final.stat().st_size:,} bytes")


def read_glb(path: Path):
    data = path.read_bytes()
    length = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + length]), data[20 + length:]


def write_glb(path: Path, gltf, rest: bytes):
    """Rewrite the JSON chunk (padded with spaces to 4 bytes) and keep the binary chunk as it was."""
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    body = struct.pack("<I", len(js)) + b"JSON" + js + rest
    path.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body)


def add_view_textures(path: Path):
    """Point each view half's material at its day texture by URI (public/room/<atlas>_day.ktx2), so the texture is
    loaded next to the glb rather than packed into it, and shared with the site's day/night blend."""
    gltf, rest = read_glb(path)
    images, textures = gltf.setdefault("images", []), gltf.setdefault("textures", [])
    samplers = gltf.setdefault("samplers", [])
    samplers.append({"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})
    sampler = len(samplers) - 1
    for atlas, name in VIEW_ATLASES.items():
        mat = next(m for m in gltf["materials"] if m.get("name") == name)
        images.append({"name": f"{atlas}_day", "uri": f"{atlas}_day.ktx2", "mimeType": "image/ktx2"})
        textures.append({"sampler": sampler, "extensions": {"KHR_texture_basisu": {"source": len(images) - 1}}})
        mat.setdefault("pbrMetallicRoughness", {})["baseColorTexture"] = {"index": len(textures) - 1}
        mat["pbrMetallicRoughness"]["metallicFactor"] = 0.0
    write_glb(path, gltf, rest)


def export_view_textures():
    """window_{sf,delhi}_{day,night}.ktx2: ETC1S (Basis-LZ) with mipmaps, sRGB, from the view's bakes."""
    sizes = {}
    for atlas in VIEW_ATLASES:
        for state in ("day", "night"):
            src = BAKE_DIR / f"{atlas}_{state}.png"
            if not src.exists():
                raise SystemExit(f"export: missing {src}; run bake.py for the view")
            dst = OUT_DIR / f"{atlas}_{state}.ktx2"
            run("ktx", "create", "--format", "R8G8B8_SRGB", "--encode", "basis-lz", "--qlevel", "192", "--clevel", "4",
                "--generate-mipmap", "--threads", "8", src, dst)
            sizes[dst.name] = dst.stat().st_size
    day = sum(v for k, v in sizes.items() if k.endswith("_day.ktx2"))
    print(f"export: view textures {sizes}; day pair {day:,} bytes")
    if day > MAX_VIEW_DAY_BYTES:
        raise SystemExit(f"export: the day textures are {day:,} bytes, over the {MAX_VIEW_DAY_BYTES:,} budget")


REQUIRED_NODES = (
    ["hit_fujifilm_a", "hit_fujifilm_b", "hit_fujifilm_c", "hit_super8", "hit_projector", "hit_nas", "hit_mango"]
    + [f"hit_poster_{p}" for p in ("the-odyssey-2026", "la-la-land", "chungking-express", "marty-supreme")]
    + [f"nas_led_{i}" for i in range(4)]
    + ["crt_glow", "lamp_bulb", "monitor_screen", "projector_lens", "projector_screen_center"]
    + [f"{c}{s}" for c in ("cam_loading", "cam_idle", "cam_desk", "cam_monitor", "cam_shelf", "cam_projector",
                           "cam_window", "cam_photos") for s in ("", "_target")]
    # PLAN 11.1 (round 2)
    + ["window_view_sf", "window_view_delhi", "lava_lamp", "lava_lamp_glass", "lava_lamp_light",
       "ceiling_fan_blades", "espresso_machine", "espresso_steam", "countertop_oven", "oven_glow", "mango_fruit",
       "poster_plaque", "hit_window", "hit_projector_screen", "hit_lava_lamp", "hit_fan", "hit_espresso", "hit_oven",
       "hit_plaque"]
    + [f"poster_art_{i}" for i in range(4)]
    # PLAN 12.1 (rounds 3-5)
    + [f"photo_print_{i}" for i in range(5)]
    + ["hit_photo_wall", "photo_album", "hit_album", "album_open_anchor", "projector_dial", "hit_projector_dial"]
)


def check_contract(path: Path):
    gltf, _ = read_glb(path)
    names = {n.get("name") for n in gltf["nodes"]}
    missing = [n for n in REQUIRED_NODES if n not in names]
    used = set(gltf.get("extensionsUsed", []))
    needed = {"KHR_materials_unlit", "KHR_texture_basisu", "EXT_meshopt_compression"}
    embedded = [i for i in gltf.get("images", []) if "bufferView" in i]
    size = path.stat().st_size
    if missing or not needed <= used or len(embedded) > len(ATLASES) or size > MAX_GLB_BYTES:
        raise SystemExit(f"export: contract broken: missing={missing} extensions={sorted(used)} "
                         f"embedded images={len(embedded)} size={size:,} (max {MAX_GLB_BYTES:,})")
    print(f"export: contract ok ({len(names)} nodes, {len(embedded)} atlases + {len(gltf['images']) - len(embedded)} "
          f"by URI, {sorted(used)}, {size:,} bytes)")


# ---- Stills ----

def show_view_from_bakes():
    """For the stills, draw each half of the view from its own bakes (linear EXR, day and night mixed by
    STILL_NIGHT) as camera-only emission, so the stills show what the site shows and the view adds no light."""
    window_lights = bpy.data.collections.get("window_lights")
    for light in (window_lights.objects if window_lights else []):
        light.hide_render = True
    for atlas, night in STILL_NIGHT.items():
        mat = bpy.data.materials.new(f"still_{atlas}")
        nt = mat.node_tree
        nt.nodes.clear()
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "bake"
        texs = []
        for state in ("day", "night"):
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(str(BAKE_DIR / f"{atlas}_{state}.exr"), check_existing=True)
            tex.image.colorspace_settings.name = "Linear Rec.709"
            nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
            texs.append(tex)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["Factor"].default_value = night
        nt.links.new(texs[0].outputs["Color"], mix.inputs["A"])
        nt.links.new(texs[1].outputs["Color"], mix.inputs["B"])
        emit = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(mix.outputs["Result"], emit.inputs["Color"])
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
        for obj in [o for o in bpy.context.scene.objects if o.get("atlas") == atlas]:
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            obj.visible_diffuse = obj.visible_glossy = obj.visible_transmission = False
            obj.visible_volume_scatter = obj.visible_shadow = False


def render_stills(samples: int, threads: int, only: set[str]):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_room

    show_view_from_bakes()
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
    jobs = dict(STILLS, poster=("cam_idle", 1600, 1000), window_view=("cam_window", 1600, 1000))
    for stem, (framing, width, height) in jobs.items():
        if only and stem not in only:
            continue
        build_room.aim_camera(framing)
        scene.render.resolution_x, scene.render.resolution_y = width, height
        rgba = work / f"{stem}_rgba.png"
        scene.render.filepath = str(rgba)
        bpy.ops.render.render(write_still=True)
        flat = (RENDERS / f"{stem}.png") if stem != "poster" else work / "poster.png"
        look = []
        if stem == "window_view":
            # SaahilOS wallpaper: a film look, fine grain and a soft vignette over the plain render.
            look = [",noise=alls=7:allf=t,vignette=angle=PI/5"]
        ffmpeg("-f", "lavfi", "-i", f"color=c={INK}:s={width}x{height}", "-i", rgba,
               "-filter_complex", f"[0][1]overlay=format=auto{''.join(look)}", "-frames:v", "1", flat)
        if stem == "poster":
            OUT_DIR.mkdir(parents=True, exist_ok=True)
            ffmpeg(*avif_args(flat), OUT_DIR / "poster.avif")
            ffmpeg("-i", flat, "-q:v", "3", OUT_DIR / "poster.jpg")
        print(f"export: still {stem} from {framing}")


def avif_args(src):
    """Full-range BT.709 4:4:4 tagged as sRGB, so browsers show the same colours as the PNG (about 44.7 dB)."""
    return ("-i", src, "-vf", "scale=out_color_matrix=bt709:out_range=full,format=yuv444p", "-c:v", "libaom-av1",
            "-still-picture", "1", "-crf", "24", "-cpu-used", "4", "-color_primaries", "bt709",
            "-color_trc", "iec61966-2-1", "-colorspace", "bt709", "-color_range", "pc")


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True)


def main():
    args = parse_args()
    if shutil.which("npx") is None or shutil.which("ktx") is None:
        raise SystemExit("export: needs npx (Node) and ktx (KTX-Software 4.x) on PATH")
    if not args.no_stills:
        render_stills(args.samples, args.threads, set(filter(None, args.only.split(","))))
    if not args.no_glb:
        export_view_textures()
        export_glb()


if __name__ == "__main__":
    main()
