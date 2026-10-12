"""Render review stills of one prop: a 1024² three-quarter view and a 2x2 turntable sheet.

    blender -b -t 16 -P blender/scripts/props_render.py -- <prop_name> [--samples N]

Writes blender/renders/props/<name>.png and <name>_turntable.png. The studio (sweep, lights, HDRI) is built
in memory and never saved into the prop file.
"""
import math
import os
import sys
import time

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_lib as pl  # noqa: E402

# Per-prop view tweaks: azimuth of the hero view (degrees from the front, +X side positive) and elevation.
HERO_VIEW = {
    "default": (32, 18),
    "poster_frame": (24, 8),
    "projector_screen": (28, 10),
    "nas_4bay": (36, 20),
    "books_stack": (30, 28),
    "film_canister": (28, 26),
    "mango_plant": (30, 12),
}
STUDIO_HDRI = "studio_small_09"


def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    corners = []
    for ob in objs:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            corners.append(w)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi, corners


def build_studio(scene, lo, hi):
    size = max((hi - lo).length, 0.05)
    center = (lo + hi) / 2
    world = bpy.data.worlds.new("studio")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    k = pl.NodeKit(nt)
    env = k.node("ShaderNodeTexEnvironment", image=bpy.data.images.load(pl.polyhaven_hdri(STUDIO_HDRI)))
    mp = k.node("ShaderNodeMapping", inputs={"Rotation": (0, 0, math.radians(140))})
    k.set(mp, "Vector", k.node("ShaderNodeTexCoord").outputs["Generated"])
    k.set(env, "Vector", mp.outputs[0])
    bg = k.node("ShaderNodeBackground", inputs={"Color": env.outputs["Color"], "Strength": 0.1})
    k.set(k.node("ShaderNodeOutputWorld"), "Surface", bg.outputs[0])

    floor_mat = pl.surface("studio_sweep", (0.16, 0.152, 0.142), 0.7, color_var=0.0)
    b = pl.Builder("studio_sweep")
    span = size * 6
    radius = size * 1.2
    prof = [(-span, 0.0)]
    for i in range(9):
        a = math.pi / 2 * i / 8
        prof.append((span * 0.35 + radius * math.sin(a), radius * (1 - math.cos(a))))
    prof.append((span * 0.35 + radius, span))
    verts_l = [b.bm.verts.new((-span, y + center.y, z + lo.z)) for (y, z) in prof]
    verts_r = [b.bm.verts.new((span, y + center.y, z + lo.z)) for (y, z) in prof]
    for i in range(len(prof) - 1):
        b.bm.faces.new((verts_l[i], verts_r[i], verts_r[i + 1], verts_l[i + 1]))
    b.materials.append(floor_mat)
    me = bpy.data.meshes.new("studio_sweep")
    b.bm.to_mesh(me)
    b.bm.free()
    me.materials.append(floor_mat)
    me.shade_smooth()
    sweep = bpy.data.objects.new("studio_sweep", me)
    scene.collection.objects.link(sweep)
    rig = bpy.data.objects.new("studio_rig", None)
    rig.location = (center.x, center.y, lo.z)
    scene.collection.objects.link(rig)
    pl.parent_keep_transform(sweep, rig)

    def area(name, az, el, dist, power, color, sz):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = power
        light.color = color
        light.size = sz
        ob = bpy.data.objects.new(name, light)
        d = Vector((math.sin(math.radians(az)) * math.cos(math.radians(el)),
                    -math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el))))
        ob.location = center + d * dist
        ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)
        pl.parent_keep_transform(ob, rig)

    dist = size * 2.2
    scale = dist * dist
    area("key", -45, 48, dist, 17 * scale, (1.0, 0.93, 0.84), size * 0.7)
    area("fill", 70, 18, dist, 4 * scale, (0.88, 0.93, 1.0), size * 1.6)
    area("rim", 165, 40, dist, 12 * scale, (1.0, 0.97, 0.92), size * 0.8)
    return rig


def place_camera(scene, cam_ob, lo, hi, corners, az, el, res, margin=0.86):
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    center = (lo + hi) / 2
    d = Vector((math.sin(math.radians(az)) * math.cos(math.radians(el)),
                -math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el))))
    dist = (hi - lo).length * 1.6
    for _ in range(4):
        cam_ob.location = center + d * dist
        cam_ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
        ext = 0.0
        for c in corners:
            p = world_to_camera_view(scene, cam_ob, c)
            ext = max(ext, abs(p.x - 0.5) * 2, abs(p.y - 0.5) * 2)
        dist *= ext / margin
    cam_ob.location = center + d * dist
    bpy.context.view_layer.update()


def render(scene, path, res, samples):
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.cycles.samples = samples
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def composite(paths, out, tile):
    canvas = np.zeros((tile * 2, tile * 2, 4), dtype=np.float32)
    for idx, p in enumerate(paths):
        img = bpy.data.images.load(p)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(tile, tile, 4)
        r, c = idx // 2, idx % 2
        y0 = (1 - r) * tile
        canvas[y0:y0 + tile, c * tile:(c + 1) * tile] = px
        bpy.data.images.remove(img)
    out_img = bpy.data.images.new("turntable", tile * 2, tile * 2)
    out_img.pixels[:] = canvas.ravel()
    out_img.filepath_raw = out
    out_img.file_format = "PNG"
    out_img.save()


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    name = argv[0]
    samples = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 192
    bpy.ops.wm.open_mainfile(filepath=os.path.join(pl.PROPS_DIR, f"{name}.blend"))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.015
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 16
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False

    objs = [o for o in scene.objects if o.type == "MESH" and o.visible_get()]
    lo, hi, corners = bounds(objs)
    rig = build_studio(scene, lo, hi)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 80
    cam.clip_start = 0.005
    cam_ob = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(cam_ob)
    scene.camera = cam_ob

    os.makedirs(pl.RENDERS_DIR, exist_ok=True)
    az, el = HERO_VIEW.get(name, HERO_VIEW["default"])
    t0 = time.time()
    rig.rotation_euler.z = math.radians(az)
    place_camera(scene, cam_ob, lo, hi, corners, az, el, 1024)
    hero = os.path.join(pl.RENDERS_DIR, f"{name}.png")
    render(scene, hero, 1024, samples)
    tiles = []
    tmp_dir = os.path.join(pl.CACHE_DIR, "turntable")
    os.makedirs(tmp_dir, exist_ok=True)
    for i, a in enumerate((az, az + 90, az + 180, az + 270)):
        rig.rotation_euler.z = math.radians(a)
        place_camera(scene, cam_ob, lo, hi, corners, a, 16, 512)
        p = os.path.join(tmp_dir, f"{name}_{i}.png")
        render(scene, p, 512, max(64, samples // 2))
        tiles.append(p)
    composite(tiles, os.path.join(pl.RENDERS_DIR, f"{name}_turntable.png"), 512)
    print(f"RENDER_DONE {name} {time.time() - t0:.1f}s")


main()
