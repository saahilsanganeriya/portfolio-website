"""Bake the room's lighting (Cycles, CPU) into the four atlases and save room.blend with the bake UVs.

    blender -b blender/room.blend -P blender/scripts/bake.py                     # final: full size, 512 samples
    blender -b blender/room.blend -P blender/scripts/bake.py -- --scale 0.25 --samples 32 --atlas desk   # test

Each atlas gets a second UV map "bake" (smart project, islands scaled by area and packed together with a
16 px margin at the final size), one Combined bake (diffuse and glossy direct + indirect, emission; AO comes from
the global illumination), then OIDN denoising and the scene's AgX view transform, so the PNG in
blender/.cache/bake/<atlas>.png already looks like the Cycles render and is shown unlit on the site.
"""

import argparse
import math
import sys
import time
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parents[2]
BAKE_DIR = REPO / "blender" / ".cache" / "bake"
BLEND = REPO / "blender" / "room.blend"

ATLAS_SIZES = {"env": 4096, "desk": 4096, "props": 2048, "posters": 2048}
MARGIN_PX = 16
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


def make_bake_uvs(objs, size: int):
    """Smart-project every object into its own 'bake' UV map, then pack all islands into one atlas.

    The margin is a fraction of the final atlas size, so test bakes at a smaller scale use the same layout.
    """
    for obj in objs:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        render_uv = next((uv for uv in obj.data.uv_layers if uv.active_render), None)
        bake_uv = obj.data.uv_layers.get("bake") or obj.data.uv_layers.new(name="bake")
        obj.data.uv_layers.active = bake_uv
        if render_uv is not None and render_uv != bake_uv:
            render_uv.active_render = True
    select_only(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                             correct_aspect=False, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                            merge_overlap=False, margin_method="FRACTION", margin=MARGIN_PX / size,
                            pin=False, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


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
    make_bake_uvs(objs, ATLAS_SIZES[atlas])
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
    bake.margin, bake.margin_type = MARGIN_PX * size // ATLAS_SIZES[atlas], "EXTEND"
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
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = min(args.threads, MAX_THREADS)
    for atlas in args.atlas.split(","):
        size = max(256, int(ATLAS_SIZES[atlas] * args.scale))
        bake_atlas(atlas, size, args.samples)
    if not args.no_save:
        for img in bpy.data.images:
            if img.filepath and not img.packed_file:
                img.filepath = bpy.path.relpath(img.filepath, start=str(BLEND.parent))
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True, relative_remap=True)
        print(f"bake: saved {BLEND}")


if __name__ == "__main__":
    main()
