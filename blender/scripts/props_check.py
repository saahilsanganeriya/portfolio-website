"""Acceptance check for the prop files: budgets, names, UVs and origins.

    python3 blender/scripts/props_check.py

For each blender/props/<name>.blend it runs the plan's acceptance expression (polygon count) and a detail
probe (triangles, root collection, required objects, UV maps, base at z = 0). Exits non-zero on any failure.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROPS_DIR = os.path.join(os.path.dirname(HERE), "props")
BLENDER = os.environ.get("BLENDER", "blender")
CAMERA_BUDGET, PROP_BUDGET = 8000, 15000
REQUIRED = {
    "fujifilm_x100": ["fujifilm_x100"],
    "fujifilm_xt": ["fujifilm_xt"],
    "fujica_st": ["fujica_st"],
    "super8_camera": ["super8_camera"],
    "projector_8mm": ["projector_8mm", "projector_8mm_reel_front", "projector_8mm_reel_rear", "projector_lens"],
    "nas_4bay": ["nas_4bay", "nas_led_0", "nas_led_1", "nas_led_2", "nas_led_3"],
    "mango_plant": ["mango_plant", "mango_plant_leaves", "mango_fruit"],
    "film_canister": ["film_canister_a", "film_canister_b", "film_canister_c"],
    "books_stack": ["books_stack"],
    "poster_frame": ["poster_frame", "poster_frame_glass", "poster_frame_art"],
    "lava_lamp": ["lava_lamp", "lava_lamp_glass", "lava_lamp_light"],
    "espresso_machine": ["espresso_machine", "espresso_cup", "espresso_coffee", "espresso_spout", "espresso_steam"],
    "countertop_oven": ["countertop_oven", "oven_door", "oven_glow", "croissant"],
    "keyboard": ["keyboard", "keyboard_cable", "keyboard_cable_drop"],
    "mouse": ["mouse", "mouse_cable", "mouse_cable_drop"],
    "coffee_mug": ["coffee_mug", "coffee_mug_coffee", "coffee_steam"],
    "croissant": ["croissant"],
    "pennant_gatech": ["pennant_gatech"],
    "crt_badge": ["crt_badge"],
    "desk_chair": ["desk_chair", "desk_chair_base"],
    "crt_shell": ["crt_shell", "crt_power_led", "crt_screen", "crt_badge_seat"],
    "computer_case": ["computer_case", "case_power_led", "case_hdd_led"],
    "lounge_chair": ["lounge_chair"],
}
# The oven carries its door, cavity and the croissant; the chair its five twin-wheel casters; the base unit stays
# near its brief's 10k.
PROP_BUDGETS = {"countertop_oven": 18000, "desk_chair": 20000, "computer_case": 10000}
HANGING = set()  # props whose origin is a mount point on top (none since the ceiling fan left the room)
CAMERAS = {"fujifilm_x100", "fujifilm_xt", "fujica_st", "super8_camera"}
PLAN_EXPR = "import bpy; print(sum(len(o.data.polygons) for o in bpy.data.objects if o.type=='MESH'))"
PROBE = """
import bpy, json
from mathutils import Vector
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
tris = 0
for o in meshes:
    o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
roots = [c.name for c in bpy.context.scene.collection.children]
min_z = min((o.matrix_world @ v.co).z for o in meshes if not o.name.endswith('_cable') for v in o.data.vertices)
max_z = max((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
no_uv = [o.name for o in meshes if 'UVMap' not in o.data.uv_layers]
collapsed = {}
for o in meshes:
    me = o.data
    if 'UVMap' not in me.uv_layers:
        continue
    uv = me.uv_layers['UVMap'].data
    bad = 0
    for p in me.polygons:
        loops = list(p.loop_indices)
        a = uv[loops[0]].uv
        area = sum(abs((uv[loops[k]].uv - a).cross(uv[loops[k + 1]].uv - a)) for k in range(1, len(loops) - 1))
        bad += area < 1e-12 and p.area > 1e-9
    collapsed[o.name] = [bad, len(me.polygons)]
print('PROBE ' + json.dumps({'triangles': tris, 'roots': roots, 'objects': sorted(o.name for o in bpy.data.objects),
      'min_z_mm': round(min_z * 1000, 2), 'max_z_mm': round(max_z * 1000, 2), 'missing_uv': no_uv, 'uv_collapsed': collapsed, 'images_unpacked': [i.name for i in bpy.data.images
      if i.source == 'FILE' and not i.packed_file]}))
"""


def blender_expr(path, expr):
    out = subprocess.run([BLENDER, "-b", path, "--python-expr", expr], capture_output=True, text=True, check=True)
    return out.stdout


def main():
    failures = 0
    print(f"{'prop':18} {'polygons':>8} {'triangles':>9} {'budget':>6}  result")
    for name, required in REQUIRED.items():
        path = os.path.join(PROPS_DIR, f"{name}.blend")
        polys = [ln for ln in blender_expr(path, PLAN_EXPR).splitlines() if ln.strip().isdigit()][-1].strip()
        probe = next(json.loads(ln[6:]) for ln in blender_expr(path, PROBE).splitlines() if ln.startswith("PROBE "))
        budget = CAMERA_BUDGET if name in CAMERAS else PROP_BUDGETS.get(name, PROP_BUDGET)
        problems = []
        if probe["triangles"] > budget:
            problems.append("over budget")
        if probe["roots"] != [name]:
            problems.append(f"root collections {probe['roots']}")
        missing = [r for r in required if r not in probe["objects"]]
        if missing:
            problems.append(f"missing {missing}")
        anchor = "max_z_mm" if name in HANGING else "min_z_mm"
        if abs(probe[anchor]) > 1.0:
            problems.append(f"{'top' if name in HANGING else 'base'} at z={probe[anchor]} mm")
        if probe["missing_uv"]:
            problems.append(f"no UVMap on {probe['missing_uv']}")
        worst = [f"{n} {b}/{t}" for n, (b, t) in probe["uv_collapsed"].items() if b > 0.01 * t]
        if worst:
            problems.append(f"collapsed UV faces {worst}")
        if probe["images_unpacked"]:
            problems.append(f"unpacked images {probe['images_unpacked']}")
        failures += bool(problems)
        print(f"{name:18} {polys:>8} {probe['triangles']:>9} {budget:>6}  {'ok' if not problems else '; '.join(problems)}")
    sys.exit(1 if failures else 0)


main()
