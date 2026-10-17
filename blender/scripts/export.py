"""Export public/room/ from the baked set: room.glb with a first-frame set of atlases, the full-quality atlases as
separate files, atlases.json, the window view's day textures, floorplan.json, and the stills.

    blender -b blender/room.blend -P blender/scripts/export.py               # glb + atlases + textures + stills
    blender -b blender/room.blend -P blender/scripts/export.py -- --no-stills
    blender -b blender/room.blend -P blender/scripts/export.py -- --low-only --no-stills   # first frame only

The glb follows the set-v4 node contract (PLAN-ROUND-8 section 4): unlit materials whose base colour is the baked
atlas on TEXCOORD_0 (the two walls each with their own material, wall_back and wall_left), invisible hit_* proxies,
the runtime meshes (crt_glow, lamp_bulb, lava_lamp_glass, oven_glow, nas_led_*) with their own materials, the art
meshes (poster_art_*, record_sleeve_*, print_pale_blue_dot, sticky_note_*: art UVs on TEXCOORD_0, the baked light on
them on TEXCOORD_1), the window (window_glass, clear; the view's two halves, window_view_sf and window_view_delhi,
whose day textures are separate files; window_sky, drawn by the site; window_motif), the darkroom's lines and clip
empties, pivots for the parts that turn (oven_door, the turntable's platter and tonearm), the wall groups
(wall_back_group, wall_left_group) and the monitor, espresso, steam, orbit, camera and anchor empties.

Each of the four atlases (desk, art, props, env) ships twice: a 1024 px first-frame copy embedded in room.glb (KTX2
ETC1S), and the full 4096 px atlas under public/room/atlas/ in the codec its A/B picked (FULL_CODEC), which the
site streams in after the first frame (public/room/atlases.json maps each atlas to its materials and files). The
export fails if the first frame or the full set is over its byte budget, a contract node is missing or a removed one
is back. Stills are Cycles renders of the same scene, the view shown from its day bakes, composited on the void.
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

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import room_lib  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / "blender" / ".cache"
BAKE_DIR = CACHE / "bake"
OUT_DIR = REPO / "public" / "room"
ATLAS_DIR = OUT_DIR / "atlas"
RENDERS = REPO / "blender" / "renders"

ATLASES = ("desk", "art", "props", "env")
LOW_PX = 1024  # the first-frame copies embedded in room.glb
FULL_PX = 4096  # the full atlases, resampled (Lanczos) from the 6144 px bakes
# The full atlases' codecs (CRAFT-R8 3, then each atlas's own A/B: bytes, SSIM and a crop; dark ramps especially).
# uastc: UASTC level 2 + RDO lambda 1 + zstd 18 in KTX2 (GPU-compressed); avif: AVIF crf 20 (decoded to RGBA8).
FULL_CODEC = {"desk": "uastc", "art": "uastc", "props": "avif", "env": "avif"}
VIEW_ATLASES = {"window_sf": "window_view_sf", "window_delhi": "window_view_delhi"}
RUNTIME_MESHES = {"crt_glow": "crt_glow", "lamp_bulb": "lamp_bulb", "lava_lamp_glass": "lava_lamp_glass",
                  "oven_glow": "oven_glow"}  # mesh name -> material name
WALL_MATERIALS = ("wall_back", "wall_left")  # each wall its own material on the env atlas, so the site fades one
# Parts that turn: an empty at the object's own origin holds the mesh; the site turns the empty about turn_axis
# (glTF axes: Blender's local +Z is glTF's +Y; +X stays +X).
PIVOTS = {
    "oven_door": {"turn_axis": "+X", "open_angle_deg": 82.0},
    "platter": {},  # turn_axis and rpm set by room_dressing.py at the spindle
    "tonearm": {},  # turn_axis and its rest, play (outer groove) and end (inner groove) angles, set at its base
}
PIVOT_KEYS = ("turn_axis", "open_angle_deg", "rpm", "rest_angle_deg", "play_angle_deg", "end_angle_deg")
GLTF_TRANSFORM = ["npx", "--yes", "-p", "@gltf-transform/cli@4.5.1", "gltf-transform"]
# Byte budgets (brief 1.3, with T71's margin): the first frame is room.glb and what the site loads before it draws
# the room (the two day halves of the window); the full set adds the full atlases and the Pale Blue Dot.
MAX_FIRST_FRAME_BYTES = 5_500_000
MAX_FULL_SET_BYTES = 23_000_000
VOID = "0x" + room_lib.VOID_HEX.lstrip("#")
PALE_DOT_SOURCE = (5230, 5175)  # PIA23645's size; the print crops it square
PALE_DOT_PX = 1024
STILLS = {
    # file stem: (camera framing, width, height); the round-seven stills (room_v3_*.png) stay beside them.
    "room_v4_idle": ("cam_idle", 1600, 1000),
    "room_v4_desk": ("cam_desk", 1600, 1000),
    "room_v4_window": ("cam_window", 1600, 1000),
    "room_v4_space": ("cam_tour_2", 1600, 1000),
    "room_v4_books": ("cam_tour_3", 1600, 1000),
    "room_v4_kitchen": ("cam_tour_4", 1600, 1000),
    "room_v4_darkroom": ("cam_tour_5", 1600, 1000),
    "room_v4_posters": ("cam_tour_6", 1600, 1000),
    "room_v4_records": ("cam_tour_7", 1600, 1000),
    "room_v4_shelf": ("cam_shelf", 1600, 1000),
    "room_v4_oven": ("cam_oven", 1600, 1000),
    "room_v4_espresso": ("cam_espresso", 1600, 1000),
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="export.py")
    parser.add_argument("--no-stills", action="store_true")
    parser.add_argument("--no-glb", action="store_true")
    parser.add_argument("--low-only", action="store_true", help="skip the full atlases (a quick first pass)")
    parser.add_argument("--no-probe", action="store_true", help="skip the room probe")
    parser.add_argument("--samples", type=int, default=256, help="Cycles samples for the stills")
    parser.add_argument("--threads", type=int, default=16)
    parser.add_argument("--only", default="", help="comma-separated still stems to render (default: all)")
    parser.add_argument("--merge-static", action="store_true",
                        help="join plain scenery per atlas material to cut draw calls (named nodes stay separate)")
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


def resized_atlas(atlas: str, size: int) -> Path:
    """The atlas's bake resampled (Lanczos) to size px, cached under .cache/export/sized_<size>/."""
    path = BAKE_DIR / f"{atlas}.png"
    if not path.exists():
        raise SystemExit(f"export: missing {path}; run bake.py first")
    resized = CACHE / "export" / f"sized_{size}" / f"{atlas}.png"
    resized.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg("-i", path, "-vf", f"scale={size}:{size}:flags=lanczos,format=rgb24", resized)
    return resized


def atlas_image(atlas: str) -> bpy.types.Image:
    """The first-frame copy of an atlas, as the glb embeds it."""
    image = bpy.data.images.load(str(resized_atlas(atlas, LOW_PX)), check_existing=False)
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
        halves.append(joined)
    return halves


def export_sky() -> list[bpy.types.Object]:
    """window_sky: the dome alone, positions only, with a plain unlit material; the site draws the sky on it."""
    sky = bpy.data.objects.get("window_sky")
    if sky is None:
        raise SystemExit("export: no window_sky")
    sky.data = private_copy(sky.data)
    for uv in list(sky.data.uv_layers):
        sky.data.uv_layers.remove(uv)
    sky.data.materials.clear()
    sky.data.materials.append(unlit_material("window_sky", None))
    sky.data.name = sky.name
    del sky["atlas"]
    return [sky]


def export_mask() -> list[bpy.types.Object]:
    """window_view_mask: positions only, a plain unlit material that void_materials() sets to the void colour."""
    mask = bpy.data.objects["window_view_mask"]
    mask.data = private_copy(mask.data)
    mask.data.materials.clear()
    mask.data.materials.append(unlit_material("window_view_mask", None))
    mask.data.name = mask.name
    mask.hide_render = False
    return [mask]


def export_glass() -> list[bpy.types.Object]:
    """window_glass: the one pane, its 0-1 UVs kept; clear_glass() makes its material transparent in the glb."""
    glass = bpy.data.objects["window_glass"]
    glass.data = private_copy(glass.data)
    glass.data.materials.clear()
    glass.data.materials.append(unlit_material("window_glass", None))
    glass.data.name = glass.name
    glass.hide_render = False
    return [glass]


def prepare_meshes() -> list[bpy.types.Object]:
    art_names = [o.name for o in bpy.context.scene.objects if o.get("runtime_art")]
    for name in ["proxy", "window_sky", "window_glass", "window_view_mask", "plant_sway", *WALL_MATERIALS, *RUNTIME_MESHES.values(), "nas_led",
                 "room_props_leaves", *(f"room_{a}" for a in ATLASES), *VIEW_ATLASES.values(), *art_names]:
        if name in bpy.data.materials:
            bpy.data.materials[name].name = f"{name}_scene"
    images = {atlas: atlas_image(atlas) for atlas in ATLASES}
    materials = {atlas: unlit_material(f"room_{atlas}", images[atlas]) for atlas in ATLASES}
    materials.update({wall: unlit_material(wall, images["env"]) for wall in WALL_MATERIALS})
    # Only open, single-layer surfaces (the mango leaves) are double-sided: on thin closed shells such as the screen
    # fabric, a double-sided material let the dark back layer z-fight through the front from afar.
    leaves = unlit_material("room_props_leaves", images["props"])
    leaves.use_backface_culling = False
    # The swaying leaves (plant_sway_<n>) share one material of their own, so the site can move them in the wind.
    sway = unlit_material("plant_sway", images["props"])
    sway.use_backface_culling = False
    runtime = {}
    proxy = unlit_material("proxy", None)
    exported = join_view_halves() + export_sky() + export_glass() + export_mask()
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
            elif obj.name.startswith("plant_sway_"):
                mat = sway
            elif obj.get("double_sided"):
                mat = leaves
            elif obj.name in WALL_MATERIALS:
                mat = materials[obj.name]
            else:
                mat = materials[atlas]
            obj.data.materials.clear()
            obj.data.materials.append(mat)
        else:
            continue
        obj.data.name = obj.name
        for attr in [a for a in obj.data.color_attributes if a.name != "sway"]:
            obj.data.color_attributes.remove(attr)
        for key in ("atlas", "texel", "bake_uv", "triangles", "double_sided", "prop", "source"):
            if key in obj:
                del obj[key]
        exported.append(obj)
    return exported


# Scenery the site reads by name stays its own node when --merge-static joins the rest.
MERGE_KEEP = {"wall_back", "wall_left", "floor", "floor_fade"}


def merge_static(meshes):
    """Join the plain env_ / desk_ / props_ scenery on each shared atlas material into one node per atlas
    (env_scenery, desk_scenery, props_scenery): fewer draw calls, at the cost of coarser frustum culling. Contract
    nodes, scenery the site names, pivots' meshes and every object with its own material stay as they are."""
    groups = {}
    for obj in meshes:
        mat = obj.data.materials[0] if obj.type == "MESH" and obj.data.materials else None
        if (mat is None or mat.name not in {f"room_{a}" for a in ATLASES} or obj.name in REQUIRED_NODES
                or obj.name in MERGE_KEEP or obj.name in PIVOTS or not obj.name.startswith(("env_", "desk_", "props_"))):
            continue
        groups.setdefault((mat.name, obj.parent.name if obj.parent else ""), []).append(obj)
    for (mat_name, group), objs in groups.items():
        if len(objs) < 2:
            continue
        with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs,
                                       object=objs[0]):
            bpy.ops.object.join()
        joined = objs[0]
        joined.name = joined.data.name = mat_name.replace("room_", "") + (f"_{group}" if group else "") + "_scenery"
        for obj in objs[1:]:
            meshes.remove(obj)
        print(f"export: merged {len(objs)} meshes into {joined.name}")
    return meshes


def add_pivots(meshes):
    """Give each turning part an empty at its own origin that holds the mesh: gltf-transform's quantization moves a
    mesh node's origin to its bounds' centre, which would put a hinge or an axle off its true axis."""
    pivots = []
    for name, extras in PIVOTS.items():
        obj = bpy.data.objects[name]
        world = obj.matrix_world.copy()
        loc, rot, _ = world.decompose()
        obj.name = obj.data.name = f"{name}_mesh"
        pivot = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(pivot)
        pivot.parent = obj.parent  # its zone, an identity empty
        pivot.matrix_world = Matrix.LocRotScale(loc, rot, None)
        for key in [k for k in PIVOT_KEYS if k in obj]:
            pivot[key] = obj[key]
            del obj[key]
        for key, value in extras.items():
            pivot[key] = value
        obj.parent = pivot
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = world
        pivots.append(pivot)
    return pivots


def export_glb(merge=False):
    meshes = prepare_meshes()
    if merge:
        meshes = merge_static(meshes)
    pivots = add_pivots(meshes)
    empties = [o for o in bpy.context.scene.objects if o.type == "EMPTY"
               and any(c.name in ("markers", "cameras", "groups") for c in o.users_collection)] + pivots
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
        export_animations=False, export_skins=False, export_morph=False, export_vertex_color="NAME",
        export_vertex_color_name="sway", export_all_vertex_colors=False,
    )
    print(f"export: raw {raw} {raw.stat().st_size:,} bytes, {len(meshes)} meshes, {len(empties)} empties")
    final = OUT_DIR / "room.glb"
    optimise(raw, final)
    add_view_textures(final)
    clear_glass(final)
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


def clear_glass(path: Path):
    """The pane's material: white at zero opacity, blended, so the view shows through it until the site gives the
    glass its look; and the view's mask in the void colour (glTF factors are linear)."""
    gltf, rest = read_glb(path)
    mat = next(m for m in gltf["materials"] if m.get("name") == "window_glass")
    mat.setdefault("pbrMetallicRoughness", {})["baseColorFactor"] = [1.0, 1.0, 1.0, 0.0]
    mat["alphaMode"] = "BLEND"
    mask = next(m for m in gltf["materials"] if m.get("name") == "window_view_mask")
    mask.setdefault("pbrMetallicRoughness", {})["baseColorFactor"] = [round(c, 6) for c in room_lib.srgb(room_lib.VOID_HEX)]
    write_glb(path, gltf, rest)


def add_view_textures(path: Path):
    """Point each view half's material at its day texture by URI (public/room/<atlas>_day.ktx2), so the texture is
    loaded next to the glb rather than packed into it."""
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


def export_view_textures() -> dict[str, int]:
    """window_{sf,delhi}_day.ktx2: ETC1S (Basis-LZ) with mipmaps, sRGB, from the view's day bakes. The night views are
    gone (both cities are by day), and so are their files."""
    sizes = {}
    for atlas in VIEW_ATLASES:
        src = BAKE_DIR / f"{atlas}_day.png"
        if not src.exists():
            raise SystemExit(f"export: missing {src}; run bake.py for the view")
        dst = OUT_DIR / f"{atlas}_day.ktx2"
        run("ktx", "create", "--format", "R8G8B8_SRGB", "--encode", "basis-lz", "--qlevel", "192", "--clevel", "4",
            "--generate-mipmap", "--threads", "8", src, dst)
        sizes[dst.name] = dst.stat().st_size
        (OUT_DIR / f"{atlas}_night.ktx2").unlink(missing_ok=True)
    print(f"export: view textures {sizes}")
    return sizes


def encode_full(atlas: str) -> Path:
    """The full atlas at FULL_PX in its codec: KTX2 UASTC (RDO, zstd) with mipmaps, or AVIF."""
    src = resized_atlas(atlas, FULL_PX)
    ATLAS_DIR.mkdir(parents=True, exist_ok=True)
    for old in ATLAS_DIR.glob(f"{atlas}.*"):
        old.unlink()
    if FULL_CODEC[atlas] == "uastc":
        dst = ATLAS_DIR / f"{atlas}.ktx2"
        run("nice", "-n", "10", "ktx", "create", "--format", "R8G8B8_SRGB", "--assign-tf", "srgb", "--encode", "uastc",
            "--uastc-quality", "2", "--uastc-rdo", "--uastc-rdo-l", "1.0", "--zstd", "18", "--generate-mipmap",
            "--threads", "8", src, dst)
    else:
        dst = ATLAS_DIR / f"{atlas}.avif"
        run("nice", "-n", "10", "ffmpeg", "-v", "error", "-y", "-i", src, "-c:v", "libaom-av1", "-still-picture", "1",
            "-crf", "20", "-cpu-used", "4", "-threads", "8", dst)
    return dst


def write_atlases_json(full: dict[str, Path] | None) -> dict:
    """public/room/atlases.json: per atlas, the glb materials that sample it, its first-frame copy (an image inside
    room.glb) and its full file (absent until the full set is exported)."""
    gltf, rest = read_glb(OUT_DIR / "room.glb")
    entries = []
    for atlas in ATLASES:
        image_index = next(i for i, im in enumerate(gltf["images"]) if im.get("name") in (atlas, f"room_{atlas}"))
        textures = {t for t, tex in enumerate(gltf["textures"])
                    if tex.get("extensions", {}).get("KHR_texture_basisu", {}).get("source", tex.get("source")) == image_index}
        materials = sorted(m["name"] for m in gltf["materials"] if any(
            ref.get("index") in textures for ref in (m.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}),
                                                     m.get("emissiveTexture", {}))))
        view = gltf["bufferViews"][gltf["images"][image_index]["bufferView"]]
        entry = {"name": atlas, "materials": materials,
                 "low": {"uri": "room.glb", "image": image_index, "px": LOW_PX, "bytes": view["byteLength"]}}
        if full and atlas in full:
            path = full[atlas]
            entry["full"] = {"uri": f"atlas/{path.name}", "px": FULL_PX, "bytes": path.stat().st_size,
                             "format": "ktx2-uastc" if path.suffix == ".ktx2" else "avif"}
        entries.append(entry)
    (OUT_DIR / "atlases.json").write_text(json.dumps(entries, indent=2) + "\n")
    return {e["name"]: e for e in entries}


def export_pale_blue_dot():
    """public/room/pale-blue-dot.ktx2: NASA/JPL's Pale Blue Dot Revisited (PIA23645, public domain), cropped square
    and sized for the print on the space wall; ETC1S with mipmaps, sRGB. The site draws it over the print's light."""
    src = CACHE / "nasa" / "PIA23645_orig.jpg"
    if not src.exists():
        raise SystemExit(f"export: missing {src}; run build_room.py first")
    square = CACHE / "export" / "pale-blue-dot.png"
    square.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg("-i", src, "-vf", f"crop={PALE_DOT_SOURCE[1]}:{PALE_DOT_SOURCE[1]},scale={PALE_DOT_PX}:{PALE_DOT_PX}:flags=lanczos",
           square)
    dst = OUT_DIR / "pale-blue-dot.ktx2"
    run("ktx", "create", "--format", "R8G8B8_SRGB", "--encode", "basis-lz", "--qlevel", "255", "--clevel", "4",
        "--generate-mipmap", "--threads", "8", square, dst)
    print(f"export: {dst.name} {dst.stat().st_size:,} bytes ({PALE_DOT_PX} px)")


PROBE = {"position": (0.0, -0.75, 1.15), "size": (512, 256), "samples": 128}
MAX_PROBE_BYTES = 400_000


def render_probe() -> dict:
    """public/room/probe/room.hdr: an equirectangular Radiance HDR of the lit set from about the desk (Cycles, the
    view from its day bake), from which the site draws the live shine on the surfaces tagged gloss."""
    import build_room
    show_view_from_bakes()
    scene = bpy.context.scene
    saved = (scene.camera, scene.render.resolution_x, scene.render.resolution_y, scene.render.film_transparent,
             scene.render.image_settings.file_format, scene.render.filepath, scene.cycles.samples)
    cam = bpy.data.objects.new("probe_cam", bpy.data.cameras.new("probe_cam"))
    scene.collection.objects.link(cam)
    cam.data.type = "PANO"
    cam.data.panorama_type = "EQUIRECTANGULAR"
    cam.location = PROBE["position"]
    cam.rotation_euler = (1.5707963, 0.0, 0.0)  # level, looking +Y (the back wall) at the panorama's centre
    out = OUT_DIR / "probe" / "room.hdr"
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        scene.camera = cam
        scene.render.engine = "CYCLES"
        scene.cycles.samples = PROBE["samples"]
        scene.cycles.use_denoising = True
        scene.render.resolution_x, scene.render.resolution_y = PROBE["size"]
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = False
        scene.render.image_settings.file_format = "HDR"
        scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
    finally:
        (scene.camera, scene.render.resolution_x, scene.render.resolution_y, scene.render.film_transparent,
         scene.render.image_settings.file_format, scene.render.filepath, scene.cycles.samples) = saved
        bpy.data.objects.remove(cam, do_unlink=True)
    size = out.stat().st_size
    print(f"export: probe {out} {size:,} bytes")
    if size > MAX_PROBE_BYTES:
        raise SystemExit(f"export: the probe is {size:,} bytes, over {MAX_PROBE_BYTES:,}")
    x, y, z = PROBE["position"]
    return {"uri": "probe/room.hdr", "format": "rgbe-equirect", "px": list(PROBE["size"]), "bytes": size,
            "position": [x, z, -y], "orientation": "glTF: the panorama's centre looks toward -z (the back wall), "
                                                   "up is +y"}


def write_floorplan(probe: dict | None = None):
    import floorplan
    floorplan.main(extra={"probe": probe} if probe else None)


# The set-v4 node contract (PLAN-ROUND-8 section 4) and what the site already reads by name.
REQUIRED_NODES = (
    ["wall_back", "wall_left", "floor", "floor_fade", "wall_back_group", "wall_left_group", "orbit_center"]
    + [f"{c}{s}" for c in ("cam_loading", "cam_idle", "cam_desk", "cam_monitor", "cam_window", "cam_shelf",
                           "cam_photos", "cam_espresso", "cam_oven", "cam_record_player", "cam_arrival_0",
                           "cam_arrival_1", "cam_arrival_2", *(f"cam_tour_{i}" for i in range(8)))
       for s in ("", "_target")]
    + ["window_glass", "window_view_sf", "window_view_delhi", "window_sky", "window_sky_centre", "window_sky_eye",
       "window_motif", "window_view_mask", "hit_window"]
    + [f"darkroom_line_{n}" for n in range(3)] + ["hit_darkroom"]
    + ["keyboard", "mouse", "coffee_mug", "coffee_steam", "croissant", "hit_croissant", "crt_badge", "hit_crt_badge",
       "pennant_gatech", "hit_pennant", "voyager_record", "hit_voyager", "print_pale_blue_dot", "hit_pale_blue_dot"]
    + ["monitor_screen", "crt_glow", "lamp_bulb", "hit_nas", *(f"nas_led_{i}" for i in range(4)), "hit_mango",
       "mango_fruit", "hit_fujifilm_a"]
    + [f"poster_art_{i}" for i in range(4)] + ["poster_plaque", "hit_plaque"]
    + [f"hit_poster_{p}" for p in ("the-odyssey-2026", "la-la-land", "chungking-express", "marty-supreme")]
    + ["bookshelf", "hit_books", "print_japanese_lit", "hit_print_japanese_lit"]
    + [f"book_spine_{slug}" for slug in ("the-wind-up-bird-chronicle", "kafka-on-the-shore", "1q84", "kitchen",
                                         "on-earth-were-briefly-gorgeous", "the-elegant-universe")]
    + ["kitchen_counter", "espresso_machine", "espresso_cup", "espresso_coffee", "espresso_spout", "espresso_steam",
       "hit_espresso", "countertop_oven", "oven_door", "oven_glow", "hit_oven"]
    + ["lava_lamp", "lava_lamp_glass", "lava_lamp_light", "hit_lava_lamp"]
    + ["record_player", "platter", "tonearm", "record_crate", "hit_record_player", *(f"record_sleeve_{i}" for i in range(6))]
    + [f"sticky_note_{i}" for i in range(3)]
)
# Names the set no longer has; the export fails if one comes back (and if a night view's file is back).
REMOVED_NODES = (
    "env_door", "env_door_frame", "env_hall", "env_hall_floor", "env_hall_trim", "env_hall_runner", "env_hall_sconce",
    "env_ceiling", "env_cornice", "env_wall_right", "env_radiator",
    "projector", "projector_reel_front", "projector_reel_rear", "projector_dial", "projector_lens",
    "projector_screen_center", "hit_projector", "hit_projector_dial", "cam_projector", "cam_projector_target",
    "env_projector_shelf", "roller_screen", "roller_screen_housing", "projection_surface",
    "photo_board", "hit_photo_board", *(f"instax_slot_{i}" for i in range(20)), "env_photo_light",
    "photo_album", "hit_album", "album_open_anchor", "ceiling_fan", "ceiling_fan_blades", "hit_fan",
    "hit_pennant_gatech", "env_window_mullion", *(f"sticky_note_{i}" for i in range(3, 6)),
)
REMOVED_PREFIXES = ("projector", "roller_screen", "instax_slot_", "ceiling_fan", "env_hall", "zone_")
REMOVED_FILES = ("window_sf_night.ktx2", "window_delhi_night.ktx2")


def check_contract(path: Path):
    gltf, _ = read_glb(path)
    names = {n.get("name") for n in gltf["nodes"]}
    missing = [n for n in REQUIRED_NODES if n not in names]
    back = sorted({n for n in names if n in REMOVED_NODES or str(n).startswith(REMOVED_PREFIXES)})
    files_back = [f for f in REMOVED_FILES if (OUT_DIR / f).exists()]
    used = set(gltf.get("extensionsUsed", []))
    needed = {"KHR_materials_unlit", "KHR_texture_basisu", "EXT_meshopt_compression"}
    embedded = [i for i in gltf.get("images", []) if "bufferView" in i]
    if missing or back or files_back or not needed <= used or len(embedded) != len(ATLASES):
        raise SystemExit(f"export: contract broken: missing={missing} removed but present={back} "
                         f"removed files present={files_back} extensions={sorted(used)} embedded images={len(embedded)}")
    print(f"export: contract ok ({len(names)} nodes, {len(embedded)} first-frame atlases + "
          f"{len(gltf['images']) - len(embedded)} by URI, {sorted(used)}, {path.stat().st_size:,} bytes); "
          f"removed names absent: {len(REMOVED_NODES)} names, prefixes {REMOVED_PREFIXES}, files {REMOVED_FILES}")


def check_budgets(view_sizes: dict[str, int], atlases: dict, full: bool):
    """First frame: room.glb and the window's two day halves. Full set: that, the full atlases and the Pale Blue Dot."""
    glb = (OUT_DIR / "room.glb").stat().st_size
    first = glb + sum(view_sizes.values())
    full_bytes = first + sum(a["full"]["bytes"] for a in atlases.values() if "full" in a) \
        + (OUT_DIR / "pale-blue-dot.ktx2").stat().st_size
    report = {"room_glb": glb, "window_day": view_sizes, "first_frame": first, "first_frame_max": MAX_FIRST_FRAME_BYTES,
              "full_atlases": {k: a["full"]["bytes"] for k, a in atlases.items() if "full" in a},
              "low_atlases": {k: a["low"]["bytes"] for k, a in atlases.items()},
              "full_set": full_bytes, "full_set_max": MAX_FULL_SET_BYTES}
    (CACHE / "export" / "bytes.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"export: first frame {first:,} B (max {MAX_FIRST_FRAME_BYTES:,}); full set {full_bytes:,} B "
          f"(max {MAX_FULL_SET_BYTES:,}){'' if full else ' [low set only]'}")
    if first > MAX_FIRST_FRAME_BYTES or full_bytes > MAX_FULL_SET_BYTES:
        raise SystemExit("export: over the byte budget")


# ---- Stills ----

def show_view_from_bakes():
    """For the stills, draw each half of the view from its day bake (linear EXR) as camera-only emission, and the sky
    as a plain day gradient, so the stills show what the site shows and the view adds no light."""
    window_lights = bpy.data.collections.get("window_lights")
    for light in (window_lights.objects if window_lights else []):
        light.hide_render = True
    for atlas in VIEW_ATLASES:
        mat = bpy.data.materials.new(f"still_{atlas}")
        nt = mat.node_tree
        nt.nodes.clear()
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "bake"
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(BAKE_DIR / f"{atlas}_day.exr"), check_existing=True)
        tex.image.colorspace_settings.name = "Linear Rec.709"
        nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
        emit = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
        for obj in [o for o in bpy.context.scene.objects if o.get("atlas") == atlas]:
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            obj.visible_diffuse = obj.visible_glossy = obj.visible_transmission = False
            obj.visible_volume_scatter = obj.visible_shadow = False
    sky = bpy.data.objects.get("window_sky")
    if sky is not None:
        for slot in sky.material_slots:
            nt = slot.material.node_tree
            emit = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeEmission")
            emit.inputs["Strength"].default_value = 1.0
        sky.visible_diffuse = sky.visible_glossy = sky.visible_shadow = False


# Stills only: the darkroom's clips hang real prints so the framings read as they will on the site (T75 draws the
# site's own set at runtime). 2022 film shots with the camera in their caption, the Chinatown bus on the hero clip.
STILL_PRINTS = [
    ["a-fable-in-six-things", "diner", "the-varsity", "purples-and-blues", "colorful-tshirts", "take-a-minute"],
    ["taiwan-cafe", "boston-in-love", "chinatown-bus", "brownstone", "green-lamps"],
    ["reading-room", "courtyard", "boyhood-1", "chinatown-2", "manhattan-bridge", "ny-over-thanksgiving"],
]
PRINT_BORDER = 0.06  # the white paper round the picture, as a share of the print's short side


def hang_still_prints() -> list[bpy.types.Object]:
    """A print under each darkroom clip for the stills: the photograph on white paper, fitted to the clip's largest
    size by its aspect, lit by the set like the rest; removed again before the glb is written."""
    src = REPO / "src" / "assets" / "photography"
    made = []
    for clip in sorted((o for o in bpy.context.scene.objects if o.name.startswith("darkroom_clip_")), key=lambda o: o.name):
        _, _, line, k = clip.name.split("_")
        slug = STILL_PRINTS[int(line)][int(k)]
        files = sorted((src / slug).glob("*.webp"), key=lambda f: int(f.stem) if f.stem.isdigit() else 0)
        png = CACHE / "photos" / f"{slug}.png"
        if not png.exists():
            png.parent.mkdir(parents=True, exist_ok=True)
            ffmpeg("-i", files[-1], png)
        image = bpy.data.images.load(str(png), check_existing=True)
        aspect = image.size[0] / image.size[1]
        border = PRINT_BORDER * min(clip["maxW_m"], clip["maxH_m"])
        w = min(clip["maxW_m"] - 2 * border, (clip["maxH_m"] - 2 * border) * aspect)
        h = w / aspect
        mat = bpy.data.materials.new(f"still_print_{slug}")
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.6
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        paper = bpy.data.materials.new("still_print_paper")
        paper.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.82, 0.80, 0.76, 1.0)
        for name, (hw, hh, depth, material, uv) in (
                ("paper", (w / 2 + border, h + 2 * border, -0.0006, paper, False)),
                ("photo", (w / 2, h, -0.0012, mat, True))):
            me = bpy.data.meshes.new(f"still_print_{name}")
            top = 0.0 if name == "paper" else -border
            verts = [(-hw, depth, top - hh), (hw, depth, top - hh), (hw, depth, top), (-hw, depth, top)]
            me.from_pydata(verts, [], [(0, 1, 2, 3)])
            if uv:
                layer = me.uv_layers.new(name="UVMap")
                for loop, coord in zip(layer.data, ((0, 0), (1, 0), (1, 1), (0, 1))):
                    loop.uv = coord
            me.materials.append(material)
            obj = bpy.data.objects.new(f"still_print_{clip.name}_{name}", me)
            obj.matrix_world = clip.matrix_world.copy()
            bpy.context.scene.collection.objects.link(obj)
            made.append(obj)
    return made


def show_current_notes():
    """Redraw the sticky notes' art from the current phrases (room_art.mjs reads src/content/sticky-notes.json) and
    give each note its material again, so the stills show what the site writes on them."""
    import room_dressing
    run("node", REPO / "blender" / "scripts" / "room_art.mjs", CACHE / "art")
    for image in [i for i in bpy.data.images if i.filepath and "sticky_note_" in i.filepath]:
        image.reload()
    for obj in bpy.context.scene.objects:
        if obj.get("runtime_art") == "sticky":
            obj.data.materials.clear()
            obj.data.materials.append(room_dressing.sticky_material(int(obj.name.rsplit("_", 1)[1])))


def render_stills(samples: int, threads: int, only: set[str]):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_room

    show_view_from_bakes()
    show_current_notes()
    prints = hang_still_prints()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.threads_mode, scene.render.threads = "FIXED", min(threads, 16)
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
        # window_view.png stays plain: SaahilOS adds its film look (src/os/assets/wallpaper/build.mjs).
        ffmpeg("-f", "lavfi", "-i", f"color=c={VOID}:s={width}x{height}", "-i", rgba,
               "-filter_complex", "[0][1]overlay=format=auto", "-frames:v", "1", flat)
        if stem == "poster":
            OUT_DIR.mkdir(parents=True, exist_ok=True)
            ffmpeg(*avif_args(flat), OUT_DIR / "poster.avif")
            ffmpeg("-i", flat, "-q:v", "3", OUT_DIR / "poster.jpg")
        print(f"export: still {stem} from {framing}")
    for obj in prints:
        bpy.data.objects.remove(obj, do_unlink=True)


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
        view_sizes = export_view_textures()
        export_pale_blue_dot()
        probe = None if args.no_probe else render_probe()  # before the glb swaps in its unlit materials
        export_glb(merge=args.merge_static)
        full = None if args.low_only else {atlas: encode_full(atlas) for atlas in ATLASES}
        atlases = write_atlases_json(full)
        check_budgets(view_sizes, atlases, full is not None)
        write_floorplan(probe)


if __name__ == "__main__":
    main()
