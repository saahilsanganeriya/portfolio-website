"""Build blender/room.blend from scratch: Henry's desk, the corner set, materials, lights, props, posters and empties.

    blender -b --factory-startup -P blender/scripts/build_room.py

Every object that gets baked carries a custom property "atlas" (desk, art, props, env, or window_sf / window_delhi for
the view); bake.py and export.py read it. Props come from blender/props/<name>.blend (a missing file gets a
placeholder block of the same size); room_dressing.py adds the lived-in layer and window_view.py the view.
"""

import math
import os
import subprocess
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.dont_write_bytecode = True  # keep __pycache__ out of blender/scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_henry  # noqa: E402
from import_henry import CACHE, REPO, fetch_cached  # noqa: E402
import room_dressing  # noqa: E402
import room_lib  # noqa: E402
import window_view  # noqa: E402
from room_lib import (BACK_X1, DADO_Z, FLOOR_AXES, FLOOR_CENTRE, FLOOR_EDGE, FLOOR_POWER, FLOOR_SOLID,  # noqa: E402
                      LEFT_Y0, WALL_H, WALL_T, WIN_X0, WIN_X1, WIN_Z0, WIN_Z1, X_LEFT, Y_BACK, Mat, add_box,
                      add_cylinder, collection, new_object, smooth_by_angle, socket, srgb)

BLEND = Path(os.environ.get("ROOM_BLEND", REPO / "blender" / "room.blend"))
# ROOM_QUICK=1 skips the window view (the slowest part) for layout work; never for a build that gets baked.
QUICK = os.environ.get("ROOM_QUICK") == "1"
# ROOM_PROPS_DIR points at another checkout's props while they are on an unmerged branch.
PROPS_DIR = Path(os.environ.get("ROOM_PROPS_DIR", REPO / "blender" / "props"))
POSTERS_DIR = REPO / "blender" / "posters"

POLYHAVEN = "https://dl.polyhaven.org/file/ph-assets"
TEXTURES = {
    # name: (real-world tile size in metres, {map: sha256})
    "black_walnut_veneer_02": (1.0, {
        "diff": "ac4cd64753a55684efe4ccaf6f81b465e237a8a885fffb95377cc371924c0f88",
        "rough": "172832f6fa42e539e35b04f321c067b61962da7aebe106fcd7934b84aa5dc204"}),
    "old_wooden_floor_03": (1.2, {
        "diff": "ac22acdda58999a150b6053794e017a943f1cbaf92e9840650b02fde1fa61151",
        "rough": "8bd31321d891f0eb7c73adfb2c0c7b4b0256af002ea204c32accd2c09da2451b"}),
    "plastered_wall_04": (3.2, {
        "diff": "aaf0e693291d51d13531480625a942f950fed23f6b1d1008ee0e91f2a23a7b1e",
        "rough": "37302048eb2e60be2a73a7f803965097681e652b80b93d6d701cfc7fabc1e0a7"}),
    "poly_wool_herringbone": (0.27, {
        "diff": "ca21de8e2e7f43178f8290361bfb2271eb264af0d2887c7c93e76a113ff3cc64",
        "rough": "8678dfb7f474440c12a5f317fe01802dd1aabbb205a6c947bb044ade72294fa7"}),
}

# ---- Layout (plan view; the camera looks into the corner from the open front) ----
#
#   back wall:  credenza + lava lamp under the posters | desk; above it the Voyager record, the Pale Blue Dot and
#               the pennant | the window (one pane), the mango on the sill
#   left wall:  the darkroom lines (prints drying on strings) | the kitchen nook at its front end
#   the floor toward the open side: the bookcase, the armchair and its lantern, the record cabinet
KITCHEN_TOP = 0.90  # counter height of the kitchen nook (room_dressing builds it)
CREDENZA_TOP = 0.60  # the low walnut credenza under the posters that carries the lava lamp

# Props from blender/props/<name>.blend (each faces -Y with its origin at the base): placement in metres,
# z-rotation in degrees or the name of the prop its front should face, and a placeholder size for a missing file.
PROPS = {
    "fujifilm_x100": ((-0.60, -0.29, 0.7345), 18, (0.128, 0.055, 0.075)),
    "nas_4bay": ((0.545, 0.135, 0.7325), 30, (0.27, 0.31, 0.23)),
    # x 1.37: the leaves clear the Painted Ladies in the window framing; the canopy stays inside the opening
    "mango_plant": ((1.37, 0.345, WIN_Z0), 0, (0.45, 0.40, 0.45)),
    # Kitchen nook on the counter at the left wall's front end, fronts turned to the room (+X).
    "espresso_machine": ((X_LEFT + 0.28, -2.43, KITCHEN_TOP), 90, (0.23, 0.38, 0.55)),
    "countertop_oven": ((X_LEFT + 0.30, -3.02, KITCHEN_TOP), 90, (0.40, 0.33, 0.23)),
    # Alone on the credenza under the posters, where its glow lights the frames and the wall.
    "lava_lamp": ((-2.10, 0.25, CREDENZA_TOP), 0, (0.15, 0.15, 0.41)),
    # The reading chair beside the record cabinet, turned toward the desk and the room.
    "lounge_chair": ((2.02, -1.87, 0.0), -122, (0.80, 0.94, 0.92)),
}
PROP_SCALE = {"nas_4bay": 1.35}  # owner round 2: bigger, so it reads from cam_idle
# Nodes named in the room contract keep their own names; every other prop mesh gets the props_ prefix.
CONTRACT_NAMES = {"lava_lamp", "lava_lamp_glass", "espresso_machine", "espresso_cup", "espresso_coffee",
                  "countertop_oven", "oven_door", "oven_glow", "croissant", "mango_fruit"}
# Poster click proxies keep their T3 names; slot i is the i-th frame from the left as seen from the room.
POSTER_IDS = ["the-odyssey-2026", "la-la-land", "chungking-express", "marty-supreme"]
POSTER_SIZE = (0.40, 0.60)  # visible art, 2:3
POSTER_X = [-2.82, -2.34, -1.86, -1.38]  # on the back wall, over the credenza, left of the desk
POSTER_Z = 1.70
# Art shown in the stills only (the site draws poster_art_<slot> from src/content/favorites.json at runtime).
STILL_POSTERS = ["la-la-land", "yi-yi", "normal-people-2020", "black-swan"]

CAMERAS = {
    # name: (position, target) in metres; vertical field of view is 35 degrees for every framing.
    "cam_loading": ((2.77, -11.30, 3.90), (-0.20, -1.30, 1.00)),
    # 12 % further back on round 8's line, so the paper lantern stays whole in a 1512x982 (1.54:1) frame
    "cam_idle": ((2.096, -9.028, 3.24), (-0.20, -1.30, 1.00)),
    "cam_desk": ((0.0, -1.59, 1.38), (0.0, 0.0, 1.01)),
    "cam_monitor": ((0.0, -0.58, 1.137), (0.0, 0.0, 1.137)),
    "cam_window": ((1.85, -1.75, 1.55), (1.85, 1.40, 1.50)),
    # Beside the lounge chair (not over it) and short of the lantern: the six spines and the print on top, unblocked.
    "cam_shelf": ((2.60, -2.68, 1.32), (2.85, -0.80, 0.94)),
    "cam_photos": ((-0.75, -0.95, 1.62), (-3.15, -0.95, 1.58)),
    "cam_record_player": ((2.05, -3.35, 1.45), (2.72, -2.18, 0.62)),
    # The lever machine in the middle (the roll rack stands on its drip tray), its cup below the rack.
    "cam_espresso": ((-1.78, -2.06, 1.44), (-2.82, -2.40, 1.21)),
    "cam_oven": ((-2.26, -2.94, 1.26), (-3.08, -3.02, 0.98)),
    # Arrival: from the loading framing past the window and the mango plant onto the desk (the site glides
    # cam_loading -> arrival_0..2 -> cam_desk).
    "cam_arrival_0": ((2.55, -2.60, 1.90), (1.85, 0.42, 1.45)),
    "cam_arrival_1": ((1.30, -1.10, 1.45), (1.44, 0.35, 1.10)),
    "cam_arrival_2": ((0.40, -1.80, 1.42), (0.0, 0.0, 1.05)),
    # The tour: one framing per stop, the professional stops first (desk, window, space prints, books and armchair),
    # then the rest.
    "cam_tour_0": ((0.05, -2.35, 1.62), (-0.10, 0.10, 1.05)),
    "cam_tour_1": ((1.85, -1.75, 1.55), (1.85, 1.40, 1.50)),
    "cam_tour_2": ((-0.10, -1.55, 1.70), (-0.12, Y_BACK, 1.86)),
    "cam_tour_3": ((0.80, -3.30, 1.62), (2.55, -1.45, 0.72)),
    "cam_tour_4": ((-1.50, -2.22, 1.88), (-3.05, -2.84, 1.30)),
    "cam_tour_5": ((-0.75, -0.95, 1.62), (-3.15, -0.95, 1.58)),
    "cam_tour_6": ((-2.10, -1.95, 1.45), (-2.10, Y_BACK, 1.25)),
    "cam_tour_7": ((2.05, -3.35, 1.45), (2.72, -2.18, 0.62)),
}
# The tour's stops in order: (id, label, camera, the plan-view point the map marks).
TOUR_STOPS = [
    ("desk", "Desk", "cam_tour_0", (-0.16, -0.10)),
    ("window", "Window", "cam_tour_1", (1.85, 0.20)),
    ("space", "Space prints", "cam_tour_2", (-0.16, 0.30)),
    ("books", "Books and armchair", "cam_tour_3", (2.40, -1.40)),
    ("kitchen", "Kitchen nook", "cam_tour_4", (-2.88, -2.70)),
    ("darkroom", "Darkroom prints", "cam_tour_5", (-3.00, -0.95)),
    ("posters", "Posters and lava lamp", "cam_tour_6", (-2.10, 0.25)),
    ("records", "Record player", "cam_tour_7", (2.72, -2.31)),
]
CAMERA_FOV_DEG = 35.0
# The 360-degree orbit (T74) turns about orbit_center: distances and polar angles (from straight up) chosen so every
# angle frames the set from above the floor and inside the fades.
ORBIT = {"center": (-0.05, -1.15, 0.95), "minDist": 2.4, "maxDist": 9.0, "minPolarDeg": 38.0, "maxPolarDeg": 80.0}
EXPOSURE = 2.8  # round 8: the bake holds no glossy light any more (the floor's sheen is gone), so a stop brighter
LAVA_GLOW = 0.45


def texture_path(name: str, kind: str) -> Path:
    size, hashes = TEXTURES[name]
    filename = f"{name}_{kind}_2k.jpg"
    return fetch_cached(f"{POLYHAVEN}/Textures/jpg/2k/{name}/{filename}", CACHE / "polyhaven" / filename,
                        hashes[kind])


def wood_material(name, texture, tint, value=1.0, rough=(0.35, 0.6), coat=0.0, bump=0.15):
    size = TEXTURES[texture][0]
    m = Mat(name)
    diff = m.image(texture_path(texture, "diff"), scale=size, loc=(-900, 100))
    rough_tex = m.image(texture_path(texture, "rough"), non_color=True, scale=size, loc=(-900, -300))
    hsv = m.node("ShaderNodeHueSaturation", (-600, 100))
    hsv.inputs["Value"].default_value = value
    m.link(diff.outputs["Color"], hsv.inputs["Color"])
    colour = m.mix(hsv.outputs["Color"], tint, "MULTIPLY", 1.0, (-400, 100))
    colour = m.grime(colour, (0.01, 0.007, 0.005, 1), distance=0.02, amount=0.5)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.link(m.remap(rough_tex.outputs["Color"], *rough), m.bsdf.inputs["Roughness"])
    m.bump(diff.outputs["Color"], strength=bump, distance=0.001)
    m.set(coat=coat, coat_rough=0.25)
    return m.mat


def build_materials() -> dict[str, bpy.types.Material]:
    mats = {}
    mats["walnut"] = wood_material("walnut", "black_walnut_veneer_02", (0.34, 0.21, 0.13, 1), value=0.62,
                                   rough=(0.32, 0.55), coat=0.25)
    mats["floor"] = wood_material("floor", "old_wooden_floor_03", (0.42, 0.34, 0.29, 1), value=0.4,
                                  rough=(0.45, 0.8), bump=0.25)

    m = Mat("wall_paint")
    size = TEXTURES["plastered_wall_04"][0]
    plaster = m.image(texture_path("plastered_wall_04", "diff"), non_color=True, scale=size)
    ramp = m.node("ShaderNodeValToRGB", (-400, 0))
    m.link(plaster.outputs["Color"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.25, srgb("#203D3A")
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.75, srgb("#30544F")
    geo = m.node("ShaderNodeNewGeometry", (-700, 300))
    sep = m.node("ShaderNodeSeparateXYZ", (-550, 300))
    m.link(geo.outputs["Position"], sep.inputs["Vector"])
    below = m.node("ShaderNodeMath", (-400, 300), operation="LESS_THAN")
    m.link(sep.outputs["Z"], below.inputs[0])
    below.inputs[1].default_value = DADO_Z
    two_tone = m.node("ShaderNodeMix", (-250, 100), data_type="RGBA", blend_type="MULTIPLY")
    m.link(below.outputs["Value"], socket(two_tone, "Factor", "VALUE"))
    m.link(ramp.outputs["Color"], socket(two_tone, "A", "RGBA"))
    socket(two_tone, "B", "RGBA").default_value = (0.62, 0.66, 0.68, 1)
    colour = m.grime(socket(two_tone, "Result", "RGBA", output=True), srgb("#0E1A19"), distance=0.12, amount=0.55)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.set(rough=0.82, spec=0.3)
    m.bump(plaster.outputs["Color"], strength=0.25, distance=0.002)
    mats["wall_paint"] = m.mat

    mats["section"] = Mat("section").set(base=srgb("#14110F"), rough=0.95).mat

    # Aged ABS: one even ivory with a faint mottle and grime only deep in the crevices; the old wide ramp and strong
    # cavity grime read as blotchy brown under the warm lamp.
    m = Mat("cream_plastic")
    n = m.noise(scale=6.0, detail=2.0)
    ramp = m.node("ShaderNodeValToRGB", (-400, 0))
    m.link(n.outputs["Fac"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.35, srgb("#D5CAB0")
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.65, srgb("#DCD2BA")
    colour = m.grime(ramp.outputs["Color"], srgb("#A49880"), distance=0.006, amount=0.3)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.set(rough=0.52, spec=0.4)
    fine = m.noise(scale=400.0, detail=2.0, loc=(-700, -800))
    m.bump(fine.outputs["Fac"], strength=0.04, distance=0.0005)
    mats["cream_plastic"] = m.mat

    m = Mat("cream_paint")
    colour = m.grime(m.mix(srgb("#D6CBB6"), srgb("#D6CBB6"), "MIX", 0.0), srgb("#7A6F5E"), 0.02, 0.6)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.set(rough=0.5)
    mats["cream_paint"] = m.mat

    m = Mat("brass")
    n = m.noise(scale=40.0, detail=6.0)
    m.link(m.remap(n.outputs["Fac"], 0.22, 0.42), m.bsdf.inputs["Roughness"])
    colour = m.grime(m.mix(srgb("#B8945C"), srgb("#B8945C"), "MIX", 0.0), srgb("#4A3A22"), 0.015, 0.7)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.set(metal=1.0)
    mats["brass"] = m.mat

    mats["rubber"] = Mat("rubber").set(base=srgb("#3A352E"), rough=0.7).mat
    mats["paper"] = Mat("paper").set(base=srgb("#E6DECD"), rough=0.85).mat

    m = Mat("paper_stack")
    coords = m.node("ShaderNodeTexCoord", (-900, 0))
    wave = m.node("ShaderNodeTexWave", (-700, 0), wave_type="BANDS", bands_direction="Z")
    wave.inputs["Scale"].default_value = 260.0
    wave.inputs["Distortion"].default_value = 2.0
    wave.inputs["Detail"].default_value = 3.0
    m.link(coords.outputs["Object"], wave.inputs["Vector"])
    geo = m.node("ShaderNodeNewGeometry", (-700, -300))
    sep = m.node("ShaderNodeSeparateXYZ", (-550, -300))
    m.link(geo.outputs["Normal"], sep.inputs["Vector"])
    side = m.node("ShaderNodeMath", (-400, -300), operation="LESS_THAN")
    m.link(sep.outputs["Z"], side.inputs[0])
    side.inputs[1].default_value = 0.7
    lines = m.node("ShaderNodeMath", (-400, 0), operation="MULTIPLY")
    m.link(wave.outputs["Fac"], lines.inputs[0])
    m.link(side.outputs["Value"], lines.inputs[1])
    mix = m.node("ShaderNodeMix", (-200, 0), data_type="RGBA", blend_type="MIX")
    m.link(lines.outputs["Value"], socket(mix, "Factor", "VALUE"))
    socket(mix, "A", "RGBA").default_value = srgb("#E3DACA")
    socket(mix, "B", "RGBA").default_value = srgb("#B5AA97")
    m.link(m.grime(socket(mix, "Result", "RGBA", output=True), srgb("#6B6253"), 0.01, 0.5), m.bsdf.inputs["Base Color"])
    m.set(rough=0.85)
    mats["paper_stack"] = m.mat

    m = Mat("linen")
    n = m.noise(scale=60.0, detail=8.0)
    ramp = m.node("ShaderNodeValToRGB", (-400, 0))
    m.link(n.outputs["Fac"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = srgb("#A89C86")
    ramp.color_ramp.elements[1].color = srgb("#C2B6A0")
    m.link(ramp.outputs["Color"], m.bsdf.inputs["Base Color"])
    m.set(rough=0.9, sheen=0.5)
    mats["linen"] = m.mat
    mats["ceramic"] = Mat("ceramic").set(base=srgb("#E3DACA"), rough=0.22, spec=0.6).mat
    mats["placeholder"] = Mat("placeholder").set(base=srgb("#8A8378"), rough=0.6).mat

    mats["rug"] = rug_material("rug", (2.5, 1.8), "#2C1612", "#6A3329")
    mats["rug_corner"] = rug_material("rug_corner", (1.7, 1.25), "#3A2A14", "#8A6A32")

    m = Mat("crt_glass")
    coords = m.node("ShaderNodeTexCoord", (-900, 0))
    grad = m.node("ShaderNodeTexGradient", (-700, 0), gradient_type="SPHERICAL")
    shift = m.node("ShaderNodeMapping", (-800, 0))
    shift.inputs["Location"].default_value = (-0.5, -0.5, 0)
    shift.inputs["Scale"].default_value = (1.6, 2.0, 1)
    m.link(coords.outputs["UV"], shift.inputs["Vector"])
    m.link(shift.outputs["Vector"], grad.inputs["Vector"])
    glow = m.remap(grad.outputs["Fac"], 0.05, 0.28, loc=(-500, 0))
    m.link(glow, m.bsdf.inputs["Emission Strength"])
    m.set(base=srgb("#0D1110"), rough=0.12, emit=srgb("#9DB4C0"), spec=0.6)
    mats["crt_glass"] = m.mat

    m = Mat("lamp_bulb")
    m.set(base=(1, 0.9, 0.7, 1), emit=(1.0, 0.45, 0.14, 1), emit_strength=40.0, rough=0.3)
    mats["lamp_bulb"] = m.mat

    m = Mat("nas_led")
    m.set(base=(0.2, 0.25, 0.27, 1), emit=srgb("#B8D4E0"), emit_strength=6.0)
    mats["nas_led"] = m.mat

    glass = Mat("glass").set(base=(0.9, 0.93, 0.95, 1), rough=0.05)
    glass.mat.diffuse_color = (0.9, 0.93, 0.95, 0.1)
    mats["glass"] = glass.mat

    proxy = Mat("proxy").set(base=(1, 0, 1, 1))
    proxy.mat.diffuse_color = (1, 0, 1, 0.2)
    mats["proxy"] = proxy.mat

    mats["sky"] = sky_material()
    return mats


def rug_material(name, size, dark, light, border=0.105) -> bpy.types.Material:
    """Wool herringbone recoloured between two tones, with a plain border band in dust a little in from the edge
    (from the rug's generated coordinates, so `size` must match the rug's size in metres)."""
    m = Mat(name)
    tile = TEXTURES["poly_wool_herringbone"][0]
    wool = m.image(texture_path("poly_wool_herringbone", "diff"), non_color=True, scale=tile)
    ramp = m.node("ShaderNodeValToRGB", (-400, 0))
    m.link(wool.outputs["Color"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = srgb(dark)
    ramp.color_ramp.elements[1].color = srgb(light)
    coords = m.node("ShaderNodeTexCoord", (-900, -400))
    sep = m.node("ShaderNodeSeparateXYZ", (-700, -400))
    m.link(coords.outputs["Generated"], sep.inputs["Vector"])
    bands = []
    for axis, length in (("X", size[0]), ("Y", size[1])):
        edge = m.node("ShaderNodeMath", (-500, -400), operation="PINGPONG")
        m.link(sep.outputs[axis], edge.inputs[0])
        edge.inputs[1].default_value = 0.5
        dist = m.node("ShaderNodeMath", (-350, -400), operation="MULTIPLY")
        m.link(edge.outputs["Value"], dist.inputs[0])
        dist.inputs[1].default_value = length
        inside = m.node("ShaderNodeMath", (-200, -400), operation="COMPARE")
        m.link(dist.outputs["Value"], inside.inputs[0])
        inside.inputs[1].default_value = border
        inside.inputs[2].default_value = 0.015
        bands.append(inside)
    band = m.node("ShaderNodeMath", (-50, -400), operation="MAXIMUM")
    m.link(bands[0].outputs["Value"], band.inputs[0])
    m.link(bands[1].outputs["Value"], band.inputs[1])
    mixed = m.node("ShaderNodeMix", (0, 0), data_type="RGBA", blend_type="MULTIPLY")
    m.link(band.outputs["Value"], socket(mixed, "Factor", "VALUE"))
    m.link(ramp.outputs["Color"], socket(mixed, "A", "RGBA"))
    socket(mixed, "B", "RGBA").default_value = (2.2, 1.9, 1.6, 1)
    m.link(socket(mixed, "Result", "RGBA", output=True), m.bsdf.inputs["Base Color"])
    m.set(rough=0.95, sheen=0.4)
    m.bump(wool.outputs["Color"], strength=0.35, distance=0.002)
    return m.mat


def sky_material() -> bpy.types.Material:
    """Daylight behind the window: a camera-invisible emitter, brighter and bluer toward the top, that lights the room
    through the opening in the room bake (both cities are by day)."""
    m = Mat("sky")
    m.nt.nodes.remove(m.bsdf)
    emission = m.node("ShaderNodeEmission", (300, 0))
    m.link(emission.outputs["Emission"], m.out.inputs["Surface"])
    geo = m.node("ShaderNodeNewGeometry", (-900, 0))
    sep = m.node("ShaderNodeSeparateXYZ", (-700, 0))
    m.link(geo.outputs["Position"], sep.inputs["Vector"])
    up = m.remap(sep.outputs["Z"], 0.0, 1.0, loc=(-500, 0))
    rng = up.node
    rng.inputs["From Min"].default_value, rng.inputs["From Max"].default_value = WIN_Z0 - 0.3, WIN_Z1 + 0.3
    colour = m.node("ShaderNodeMix", (-200, 0), data_type="RGBA", blend_type="MIX")
    m.link(up, socket(colour, "Factor", "VALUE"))
    socket(colour, "A", "RGBA").default_value = (0.86, 0.85, 0.82, 1.0)
    socket(colour, "B", "RGBA").default_value = (0.62, 0.74, 0.95, 1.0)
    m.link(socket(colour, "Result", "RGBA", output=True), emission.inputs["Color"])
    emission.inputs["Strength"].default_value = 1.1
    return m.mat


# ---- Henry's layout, re-materialled ----

HENRY_MATERIALS = {
    "desk_desk": ["walnut"],
    "desk_keyboard": ["cream_plastic"],
    "desk_mouse": ["cream_plastic"],
    "desk_cables": ["rubber"],
    "desk_mug": ["ceramic"],
    "desk_paper": ["paper"],
    "desk_tray_bottom": ["walnut"],
    "desk_tray_top": ["walnut"],
    "desk_papers_a": ["paper_stack"],
    "desk_papers_b": ["paper_stack"],
}


# Henry's hero props take the contract's names until T72's own keyboard, mouse and mug replace them.
HERO_NAMES = {"desk_keyboard": "keyboard", "desk_mouse": "mouse", "desk_mug": "coffee_mug"}


def place_henry(mats):
    for obj in import_henry.import_layout():
        for coll in obj.users_collection:
            coll.objects.unlink(obj)
        collection("desk").objects.link(obj)
        for name in HENRY_MATERIALS[obj.name]:
            obj.data.materials.append(mats[name])
        if obj.name in ("desk_tray_bottom", "desk_tray_top", "desk_papers_b"):
            obj.data.transform(Matrix.Translation((0.0, -0.05, 0.0)))
        smooth_by_angle(obj, 40)
        if obj.name in HERO_NAMES:
            obj.name = obj.data.name = HERO_NAMES[obj.name]


# The CRT's case, the computer under it and the desk chair are prop files in place of Henry's: the CRT stands on the
# computer as desk_crt, placed before the glass, the sticky notes and the badge are fitted to its face; the chair takes
# his chair's spot and turn. name: (name in the room, location, z turn in degrees).
DESK_PROPS = {
    "crt_shell": ("desk_crt", (0.0, 0.040, 0.865), 0.0),
    "desk_chair": ("desk_chair", (0.199, -0.681, 0.0), -130.0),
    "computer_case": ("desk_computer", (0.0058, 0.0170, 0.7316), 0.0),
}
DESK_PROP_ANCHORS: dict[str, Vector] = {}  # the empties they bring (crt_screen, crt_badge_seat), in world space


def place_desk_props(mats):
    for name, (room_name, loc, turn) in DESK_PROPS.items():
        if not (PROPS_DIR / f"{name}.blend").exists():
            raise SystemExit(f"build_room: no prop file {name}.blend")
        root = Matrix.Translation(loc) @ Matrix.Rotation(math.radians(turn), 4, "Z")
        meshes, anchors = place_one(name, root, "desk", "desk", mats)
        for obj in meshes:
            if obj.name.split(".")[0] == name:
                obj.name = obj.data.name = room_name
        DESK_PROP_ANCHORS.update(anchors)


# ---- The corner: two walls and the floor ----

def build_shell(mats):
    """The two walls (each its own mesh and material, wall_back with the window cut) and the floor, a rounded disc
    whose solid middle (floor) carries the set and whose ring (floor_fade) fades into the void; skirting and the dado
    rail run along both walls (one mesh per wall). The walls' outer faces and bottoms are dropped (never seen from the front; from behind
    the site fades the walls out)."""
    section, walnut = mats["section"], mats["walnut"]
    for name, size, centre, outward in (
        ("wall_back", (BACK_X1 - X_LEFT + WALL_T, WALL_T, WALL_H),
         ((X_LEFT - WALL_T + BACK_X1) / 2, Y_BACK + WALL_T / 2, WALL_H / 2), Vector((0, 1, 0))),
        ("wall_left", (WALL_T, Y_BACK + WALL_T - LEFT_Y0, WALL_H),
         (X_LEFT - WALL_T / 2, (LEFT_Y0 + Y_BACK + WALL_T) / 2, WALL_H / 2), Vector((-1, 0, 0))),
    ):
        bm = bmesh.new()
        add_box(bm, size, centre)
        wall = new_object(name, bm, "env", "env", [wall_material(mats, name), section])
        if name == "wall_back":
            cut_opening(wall, (WIN_X1 - WIN_X0, 1.0, WIN_Z1 - WIN_Z0), ((WIN_X0 + WIN_X1) / 2, Y_BACK, (WIN_Z0 + WIN_Z1) / 2))
        tidy_wall(wall, outward)
    build_floor(mats)

    # Skirting and the dado rail along both walls, broken by the window's sill and the kitchen nook's tiles; runs are
    # (axis, fixed coordinate, inward sign, start, end). They run out into the walls' faded ends.
    skirting = [("x", Y_BACK, -1, X_LEFT, BACK_X1), ("y", X_LEFT, 1, LEFT_Y0, Y_BACK)]
    dado = [("x", Y_BACK, -1, X_LEFT, WIN_X0 - 0.12), ("x", Y_BACK, -1, WIN_X1 + 0.12, BACK_X1),
            ("y", X_LEFT, 1, LEFT_Y0, -3.36), ("y", X_LEFT, 1, -2.04, Y_BACK)]
    for wall_axis, name in (("x", "env_skirting_back"), ("y", "env_skirting_left")):
        bm = bmesh.new()
        for runs, depth, height, z0, bevel in ((skirting, 0.016, 0.095, 0.0, 0.004),
                                               (dado, 0.02, 0.04, DADO_Z - 0.01, 0.006)):
            for axis, fixed, inward, a, b in runs:
                if axis != wall_axis:
                    continue
                mid = (a + b) / 2
                if axis == "x":
                    add_box(bm, (b - a, depth, height), (mid, fixed + inward * depth / 2, z0 + height / 2), bevel=bevel)
                else:
                    add_box(bm, (depth, b - a, height), (fixed + inward * depth / 2, mid, z0 + height / 2), bevel=bevel)
        smooth_by_angle(new_object(name, bm, "env", "env", [walnut]))


def wall_material(mats, name):
    """Each wall has its own material (the site fades one wall at a time); both are the same teal paint."""
    mat = mats["wall_paint"].copy()
    mat.name = f"{name}_paint"
    return mat


def floor_ring(t: float, segments: int):
    """Points on the floor's superellipse at FLOOR_AXES scaled by t (FLOOR_CENTRE outward)."""
    (cx, cy), (ax, ay) = FLOOR_CENTRE, FLOOR_AXES
    pts = []
    for k in range(segments):
        a = 2 * math.pi * k / segments
        c, s_ = math.cos(a), math.sin(a)
        r = 1.0 / (abs(c) ** FLOOR_POWER + abs(s_) ** FLOOR_POWER) ** (1 / FLOOR_POWER)
        pts.append(Vector((cx + t * ax * r * c, cy + t * ay * r * s_, 0.0)))
    return pts


def build_floor(mats, segments=128):
    """floor: the solid disc under the set, out to FLOOR_SOLID; floor_fade: the ring from there to FLOOR_EDGE, in
    eight sectors (they pack into the atlas better than one ring), baked at a lower density because it only carries
    the light fading into the void."""
    floor_mat = mats["floor"]
    bm = bmesh.new()
    rings = [0.0, 0.25, 0.5, 0.75, FLOOR_SOLID]
    centre = bm.verts.new((*FLOOR_CENTRE, 0.0))
    loops = [[bm.verts.new(p) for p in floor_ring(t, segments)] for t in rings[1:]]
    for k in range(segments):
        bm.faces.new((centre, loops[0][k], loops[0][(k + 1) % segments]))
    for inner, outer in zip(loops, loops[1:]):
        for k in range(segments):
            k1 = (k + 1) % segments
            bm.faces.new((inner[k], outer[k], outer[k1], inner[k1]))
    bm.normal_update()
    new_object("floor", bm, "env", "env", [floor_mat])

    bm = bmesh.new()
    steps = [FLOOR_SOLID, 1.0, 1.1, 1.2, FLOOR_EDGE]
    per = segments // 8
    for sector in range(8):
        ks = range(sector * per, sector * per + per + 1)
        grid = [[bm.verts.new(floor_ring(t, segments)[k % segments]) for k in ks] for t in steps]
        for i in range(len(steps) - 1):
            for j in range(per):
                bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    new_object("floor_fade", bm, "env", "env", [floor_mat])


def cut_opening(wall, size, centre):
    cutter_bm = bmesh.new()
    add_box(cutter_bm, size, centre)
    cutter = new_object("cutter", cutter_bm, "env", None)
    mod = wall.modifiers.new("opening", "BOOLEAN")
    mod.operation, mod.solver, mod.object = "DIFFERENCE", "EXACT", cutter
    bpy.context.view_layer.objects.active = wall
    with bpy.context.temp_override(object=wall, active_object=wall):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def tidy_wall(obj, outward: Vector):
    """Drop the faces nobody sees from the front (outside, bottom); the top and the free end keep the section colour
    (the bake fades both into the void anyway)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for f in list(bm.faces):
        n = f.normal
        c = f.calc_center_median()
        if n.dot(outward) > 0.9 or n.z < -0.9 and c.z < 0.01:
            bm.faces.remove(f)
            continue
        is_top = n.z > 0.9 and c.z > WALL_H - 0.01
        is_end = (abs(n.y) > 0.9 and c.y < LEFT_Y0 + 0.01) or (abs(n.x) > 0.9 and c.x > BACK_X1 - 0.01)
        f.material_index = 1 if (is_top or is_end) else 0
    bm.to_mesh(obj.data)
    bm.free()


# ---- Window, sill, sky ----

def build_window(mats):
    """The window: a painted frame in the reveal around one pane of glass (no mullion, transom or glazing bars, so
    the view's two cities meet behind clear glass), the curtains, the walnut sill, and the daylight card behind it."""
    paint, walnut = mats["cream_paint"], mats["walnut"]
    bm = bmesh.new()
    depth_mid = Y_BACK + WALL_T * 0.55
    w, h = WIN_X1 - WIN_X0, WIN_Z1 - WIN_Z0
    cx, cz = (WIN_X0 + WIN_X1) / 2, (WIN_Z0 + WIN_Z1) / 2
    t, a = 0.022, 0.08
    add_box(bm, (w + 2 * a, t, a), (cx, Y_BACK - t / 2, WIN_Z1 + a / 2), bevel=0.005)
    for x in (WIN_X0 - a / 2, WIN_X1 + a / 2):
        add_box(bm, (a, t, h), (x, Y_BACK - t / 2, cz), bevel=0.005)
    f = 0.055
    add_box(bm, (w, 0.06, f), (cx, depth_mid, WIN_Z1 - f / 2), bevel=0.004)
    add_box(bm, (w, 0.06, f), (cx, depth_mid, WIN_Z0 + f / 2), bevel=0.004)
    for x in (WIN_X0 + f / 2, WIN_X1 - f / 2):
        add_box(bm, (f, 0.06, h), (x, depth_mid, cz), bevel=0.004)
    frame = new_object("env_window_frame", bm, "art", "art", [paint])
    smooth_by_angle(frame)

    # The pane: one quad in the frame's rebate; the site gives it its look (export.py: its own material, clear).
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    y = depth_mid + 0.012
    quad = [bm.verts.new((x, y, z)) for x, z in ((WIN_X0 + f, WIN_Z0 + f), (WIN_X1 - f, WIN_Z0 + f),
                                                 (WIN_X1 - f, WIN_Z1 - f), (WIN_X0 + f, WIN_Z1 - f))]
    face = bm.faces.new(quad)
    for loop, coord in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = coord
    bm.normal_update()
    if face.normal.y > 0:
        face.normal_flip()
    glass = new_object("window_glass", bm, "markers", None, [mats["glass"]])
    glass.hide_render = True
    glass["width_m"], glass["height_m"] = round(w - 2 * f, 4), round(h - 2 * f, 4)

    build_curtains(mats, cx, w)

    # Interior sill: a walnut board resting on the reveal, 17 cm proud of the wall so the mango pot fits.
    bm = bmesh.new()
    sill_front, sill_back = Y_BACK - 0.17, Y_BACK + WALL_T * 0.55
    add_box(bm, (w + 0.18, sill_back - sill_front, 0.03), (cx, (sill_front + sill_back) / 2, WIN_Z0 - 0.015),
            bevel=0.006)
    smooth_by_angle(new_object("env_window_sill", bm, "art", "art", [walnut]))

    # Daylight card: a flat emitter 15 cm outside the wall that lights the room through the window in the room bake;
    # camera-invisible and without an atlas, so never baked or exported (the view is the window_view_* diorama).
    bm = bmesh.new()
    y = Y_BACK + WALL_T + 0.15
    quad = [bm.verts.new((x, y, z)) for x, z in ((WIN_X0 - 0.4, WIN_Z0 - 0.3), (WIN_X1 + 0.4, WIN_Z0 - 0.3),
                                                 (WIN_X1 + 0.4, WIN_Z1 + 0.3), (WIN_X0 - 0.4, WIN_Z1 + 0.3))]
    bm.faces.new(quad)
    bm.normal_update()
    for face in bm.faces:
        if face.normal.y > 0:
            face.normal_flip()
    sky = new_object("env_sky", bm, "env", None, [mats["sky"]])
    sky.visible_shadow = False
    sky.visible_camera = False
    sky["room_light_only"] = True


def build_curtains(mats, cx, w):
    """A brass rod over the window and two pleated linen panels drawn to the sides."""
    bm = bmesh.new()
    rod_z, rod_y = WIN_Z1 + 0.16, Y_BACK - 0.09
    add_cylinder(bm, 0.011, w + 0.50, (cx, rod_y, rod_z), segments=16, axis="X")
    for side in (-1, 1):
        add_cylinder(bm, 0.02, 0.03, (cx + side * (w / 2 + 0.25), rod_y, rod_z), segments=16, axis="X")
        add_box(bm, (0.014, 0.09, 0.014), (cx + side * (w / 2 + 0.18), Y_BACK - 0.045, rod_z), mat=0)
    smooth_by_angle(new_object("env_curtain_rod", bm, "art", "art", [mats["brass"]]), 50)

    bm = bmesh.new()
    pleats, width, top, bottom = 6, 0.22, rod_z - 0.03, WIN_Z0 - 0.12
    for side in (-1, 1):
        x_outer = cx + side * (w / 2 + 0.24)
        cols = pleats * 4 + 1
        grid = []
        for i in range(cols):
            t = i / (cols - 1)
            x = x_outer - side * t * width
            depth = 0.035 * math.sin(t * pleats * 2 * math.pi)
            column = []
            for k in range(9):
                z = top - (top - bottom) * k / 8
                sway = 0.012 * math.sin(k * 0.9 + side) * t
                column.append(bm.verts.new((x, rod_y + depth + sway, z)))
            grid.append(column)
        for i in range(cols - 1):
            for k in range(8):
                quad = (grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k])
                bm.faces.new(quad if side > 0 else tuple(reversed(quad)))
    bm.normal_update()
    for face in bm.faces:
        if face.normal.y > 0:
            face.normal_flip()
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.004)
    curtain = new_object("env_curtains", bm, "art", "art", [mats["linen"]])
    smooth_by_angle(curtain, 60)


PICTURE_LIGHT = Vector((sum(POSTER_X) / len(POSTER_X), Y_BACK - 0.13, POSTER_Z + POSTER_SIZE[1] / 2 + 0.16))
# The picture light over the desk wall (the pennant and the two space prints): (x0, x1) and its height.
SPACE_LIGHT = ((-0.74, 0.40), 2.43)


def build_fixtures(mats):
    """The brass picture light over the posters."""
    brass = mats["brass"]
    bm = bmesh.new()
    p = PICTURE_LIGHT
    span = POSTER_X[-1] - POSTER_X[0] + 0.25
    add_cylinder(bm, 0.022, span, p, segments=24, axis="X")
    add_box(bm, (span - 0.02, 0.012, 0.012), p + Vector((0, 0.01, -0.022)))
    for dx in (-span * 0.3, span * 0.3):
        add_box(bm, (0.012, 0.13, 0.012), Vector((p.x + dx, Y_BACK - 0.065, p.z + 0.03)), bevel=0.003)
        add_cylinder(bm, 0.03, 0.012, Vector((p.x + dx, Y_BACK - 0.006, p.z + 0.03)), segments=24, axis="Y")
    smooth_by_angle(new_object("env_picture_light", bm, "art", "art", [brass]), 50)

    (x0, x1), z = SPACE_LIGHT
    q = Vector(((x0 + x1) / 2, Y_BACK - 0.11, z))
    bm = bmesh.new()
    add_cylinder(bm, 0.018, x1 - x0, q, segments=24, axis="X")
    add_box(bm, (x1 - x0 - 0.02, 0.012, 0.010), q + Vector((0, 0.01, -0.019)))
    for dx in (-(x1 - x0) * 0.32, (x1 - x0) * 0.32):
        add_box(bm, (0.010, 0.11, 0.010), Vector((q.x + dx, Y_BACK - 0.055, q.z + 0.025)), bevel=0.003)
        add_cylinder(bm, 0.026, 0.010, Vector((q.x + dx, Y_BACK - 0.005, q.z + 0.025)), segments=24, axis="Y")
    smooth_by_angle(new_object("env_space_light", bm, "art", "art", [brass]), 50)


RUGS = {
    # name: (size, centre, material)
    "env_rug": ((2.5, 1.8), (-0.15, -0.68), "rug"),
    "env_rug_corner": ((1.7, 1.25), (2.15, -1.80), "rug_corner"),
}


def build_rug(mats):
    for name, (size, (x, y), mat) in RUGS.items():
        bm = bmesh.new()
        add_box(bm, (size[0], size[1], 0.008), (x, y, 0.004), bevel=0.003)
        smooth_by_angle(new_object(name, bm, "props", "props", [mats[mat]]))


# ---- Desk lamp ----

LAMP_BASE = Vector((-0.90, 0.25, 0.732))
LAMP_BULB = Vector((-0.64, -0.06, 1.13))
LAMP_AIM = Vector((-0.34, -0.38, 0.732))  # between the keyboard and the camera on the desk


def build_lamp(mats):
    brass, bulb_mat = mats["brass"], mats["lamp_bulb"]
    bm = bmesh.new()
    b = LAMP_BASE
    add_cylinder(bm, 0.075, 0.022, b + Vector((0, 0, 0.011)), segments=48)
    add_cylinder(bm, 0.06, 0.012, b + Vector((0, 0, 0.028)), segments=48, radius_top=0.05)
    add_cylinder(bm, 0.009, 0.26, b + Vector((0, 0, 0.16)), segments=16)
    obj = new_object("desk_lamp", bm, "desk", "desk", [brass])

    # Gooseneck from the stem top to the shade, as a curve converted to a mesh.
    curve = bpy.data.curves.new("lamp_neck", "CURVE")
    curve.dimensions, curve.bevel_depth, curve.bevel_resolution = "3D", 0.008, 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(1)
    p0, p1 = spline.bezier_points
    p0.co = b + Vector((0, 0, 0.29))
    p0.handle_left = p0.co - Vector((0, 0, 0.1))
    p0.handle_right = p0.co + Vector((0, 0, 0.16))
    p1.co = LAMP_BULB + Vector((-0.06, 0.06, 0.09))
    p1.handle_left = p1.co + Vector((-0.10, 0.10, 0.06))
    p1.handle_right = p1.co + Vector((0.05, -0.05, -0.03))
    neck = bpy.data.objects.new("lamp_neck", curve)
    collection("desk").objects.link(neck)

    # Shade: an open brass cone aimed at the front-left of the desk, with the bulb inside.
    aim = (LAMP_AIM - LAMP_BULB).normalized()
    rot = aim.to_track_quat("Z", "Y").to_matrix()
    sbm = bmesh.new()
    bmesh.ops.create_cone(sbm, cap_ends=False, segments=48, radius1=0.035, radius2=0.085, depth=0.15)
    bmesh.ops.solidify(sbm, geom=list(sbm.faces), thickness=0.0025)
    cap = bmesh.ops.create_cone(sbm, cap_ends=True, segments=48, radius1=0.04, radius2=0.03, depth=0.04)
    for v in cap["verts"]:
        v.co.z -= 0.09
    for v in sbm.verts:
        v.co = rot @ (v.co + Vector((0, 0, 0.03))) + LAMP_BULB
    shade = new_object("desk_lamp_shade", sbm, "desk", "desk", [brass])
    smooth_by_angle(shade, 50)

    bbm = bmesh.new()
    bmesh.ops.create_uvsphere(bbm, u_segments=24, v_segments=12, radius=0.024)
    for v in bbm.verts:
        v.co += LAMP_BULB
    bulb = new_object("lamp_bulb", bbm, "desk", "desk", [bulb_mat])
    smooth_by_angle(bulb, 180)

    bpy.context.view_layer.update()
    neck_mesh = bpy.data.meshes.new_from_object(neck.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(neck, do_unlink=True)
    neck_obj = bpy.data.objects.new("desk_lamp_neck", neck_mesh)
    neck_obj.data.materials.append(brass)
    neck_obj["atlas"] = "desk"
    collection("desk").objects.link(neck_obj)
    smooth_by_angle(neck_obj, 60)
    return obj


# ---- CRT screen ----

def crt_opening():
    """Measure the CRT bezel opening by casting rays into the screen hole; returns (centre, width, height).

    A ray is inside the opening when it passes the bezel and hits the tube interior; the opening is the run of
    inside rays connected to the screen centre along each axis (so the gap under the chin is not counted).
    """
    crt = bpy.data.objects["desk_crt"]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    step, cz = 0.002, 1.137
    to_local = crt.matrix_world.inverted()  # Object.ray_cast works in the object's own space

    def inside(x, z):
        hit, loc, *_ = crt.ray_cast(to_local @ Vector((x, -1.0, z)), to_local.to_3x3() @ Vector((0, 1, 0)),
                                    depsgraph=depsgraph)
        return hit and (crt.matrix_world @ loc).y > -0.09

    def run(axis):
        ends = []
        for sign in (-1, 1):
            k = 0
            while inside(*((sign * (k + 1) * step, cz) if axis == "x" else (0.0, cz + sign * (k + 1) * step))):
                k += 1
            ends.append(sign * k * step)
        return ends

    (x0, x1), (z0, z1) = run("x"), run("z")
    return Vector(((x0 + x1) / 2, -0.085, cz + (z0 + z1) / 2)), x1 - x0, z1 - z0


# The site sizes and places SaahilOS's hole from monitor_screen, so the screen stays where round eight put it whatever
# CRT case stands round it; a case whose opening no longer matches (to the 2 mm the measurement steps) stops the build.
MONITOR_SCREEN = (Vector((0.0, -0.085, 1.14)), 0.344, 0.27)


def build_crt_glass(mats):
    measured, width_seen, height_seen = crt_opening()
    centre, width, height = MONITOR_SCREEN
    off = max((measured - centre).length, abs(width_seen - width), abs(height_seen - height))
    if off > 0.003:
        raise SystemExit(f"build_room: the CRT opening measures {width_seen:.4f} x {height_seen:.4f} m at "
                         f"{tuple(round(v, 4) for v in measured)}, {off * 1000:.1f} mm from monitor_screen")
    tilt = Matrix.Rotation(math.radians(-3), 4, "X")
    bm = bmesh.new()
    nx, nz = 16, 12
    gw, gh = width + 0.02, height + 0.02
    uv_layer = bm.loops.layers.uv.new("UVMap")
    grid = [[None] * (nz + 1) for _ in range(nx + 1)]
    for i in range(nx + 1):
        for j in range(nz + 1):
            u, v = i / nx, j / nz
            x, z = (u - 0.5) * gw, (v - 0.5) * gh
            bulge = 0.008 * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
            grid[i][j] = bm.verts.new(Vector((x, -bulge, z)))
    for i in range(nx):
        for j in range(nz):
            face = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            for loop, (di, dj) in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                loop[uv_layer].uv = ((i + di) / nx, (j + dj) / nz)
    bm.transform(Matrix.Translation(centre) @ tilt)
    bm.normal_update()
    glass = new_object("crt_glow", bm, "desk", "desk", [mats["crt_glass"]])
    smooth_by_angle(glass, 180)

    screen = bpy.data.objects.new("monitor_screen", None)
    screen.empty_display_type, screen.empty_display_size = "ARROWS", 0.1
    screen.location = centre
    screen.rotation_euler = Euler((math.radians(-3), 0, 0))
    screen["width_m"] = round(width, 4)
    screen["height_m"] = round(height, 4)
    collection("markers").objects.link(screen)
    return glass


# ---- Props and posters ----

def append_prop(name: str) -> list[bpy.types.Object]:
    path = PROPS_DIR / f"{name}.blend"
    with bpy.data.libraries.load(str(path), link=False) as (src, dst):
        if name not in src.collections:
            raise RuntimeError(f"{path} has no root collection '{name}'")
        dst.collections = [name]
    coll = dst.collections[0]
    objs = list(coll.all_objects)
    for obj in objs:
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
    bpy.data.collections.remove(coll)
    return objs


def prop_rotation(name: str) -> float:
    """Z rotation in radians: a fixed angle, or the angle that turns the prop's front (-Y) toward another prop."""
    loc, facing, _ = PROPS[name]
    if not isinstance(facing, str):
        return math.radians(facing)
    d = Vector(PROPS[facing][0]) - Vector(loc)
    return math.atan2(d.x, -d.y)


def flatten(objs):
    """Clear parents, keeping world transforms, so every node is a direct child of the scene in the glb."""
    bpy.context.view_layer.update()
    for obj in objs:
        if obj.parent is not None:
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = world


def place_one(name, root, coll, atlas, mats, empty_props=None):
    """Append a prop (or a placeholder block) at root; returns its objects and the world position of each empty
    (and fills empty_props with each empty's custom properties, when given)."""
    _, _, size = PROPS.get(name, (None, None, None))
    if (PROPS_DIR / f"{name}.blend").exists():
        objs = append_prop(name)
        for obj in objs:
            collection(coll).objects.link(obj)
            if obj.parent is None:
                obj.matrix_world = root @ obj.matrix_world
        flatten(objs)
    else:
        bm = bmesh.new()
        add_box(bm, size, (0, 0, size[2] / 2), bevel=min(size) * 0.08)
        obj = new_object(name, bm, coll, None, [mats["placeholder"]])
        obj.matrix_world = root
        objs = [obj]
        if name == "nas_4bay":
            for i in range(4):
                lbm = bmesh.new()
                add_box(lbm, (0.008, 0.003, 0.004), (-0.05 + i * 0.022, -size[1] / 2 - 0.0015, 0.14))
                led = new_object(f"nas_led_{i}", lbm, coll, None, [mats["nas_led"]])
                led.matrix_world = root
                objs.append(led)
    anchors = {o.name.split(".")[0]: o.matrix_world.translation.copy() for o in objs if o.type == "EMPTY"}
    if empty_props is not None:
        empty_props.update({o.name.split(".")[0]: dict(o.items()) for o in objs if o.type == "EMPTY"})
    meshes = [o for o in objs if o.type == "MESH"]
    for empty in [o for o in objs if o.type == "EMPTY"]:
        bpy.data.objects.remove(empty, do_unlink=True)
    for obj in meshes:
        obj["atlas"] = atlas
        obj["prop"] = name
    return meshes, anchors


def place_props(mats):
    placed, anchors = {}, {}
    for name, (loc, _, _) in PROPS.items():
        scale = PROP_SCALE.get(name, 1.0)
        root = (Matrix.Translation(loc) @ Matrix.Rotation(prop_rotation(name), 4, "Z")
                @ Matrix.Diagonal((scale, scale, scale, 1.0)))
        meshes, found = place_one(name, root, "props", "props", mats)
        for obj in meshes:
            base = obj.name.split(".")[0]
            if base in CONTRACT_NAMES:
                obj.name = base
            elif not obj.name.startswith(("nas_led_", "props_")):
                obj.name = f"props_{base}"
            if obj.name == "props_mango_plant_leaves":
                obj["double_sided"] = True  # single-layer leaves; export gives them a double-sided material
        placed[name] = meshes
        anchors[name] = {"root": root, **found}
    return placed, anchors


# ---- The window view's mask ----

def build_view_mask():
    """window_view_mask: an open-fronted box of void-coloured panels round the city diorama behind the window (left,
    right, top and back), so that from the sides and from above the orbit sees only the void where the diorama would
    show past the wall's corner, free end or top. Invisible to every ray in Blender (it changes no bake); the site draws
    it in the void colour, and it fades with the back wall's group."""
    parts = [o for o in bpy.data.collections["window_view"].objects if o.type == "MESH" and o.name != "window_view_mask"]
    lo, hi = world_bounds(parts)
    x0, x1 = min(X_LEFT - WALL_T, lo.x - 0.02), max(BACK_X1, hi.x + 0.02)
    y0, y1 = Y_BACK + WALL_T, hi.y + 0.05
    z0, z1 = lo.z - 0.05, WALL_H
    bm = bmesh.new()
    corners = {(i, j, k): bm.verts.new((x, y, z)) for i, x in enumerate((x0, x1)) for j, y in enumerate((y0, y1))
               for k, z in enumerate((z0, z1))}
    for quad in (((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)), ((1, 0, 0), (1, 0, 1), (1, 1, 1), (1, 1, 0)),
                 ((0, 0, 1), (0, 1, 1), (1, 1, 1), (1, 0, 1)), ((0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1))):
        bm.faces.new([corners[c] for c in quad])
    if x1 > BACK_X1 + 1e-4:  # where the box reaches past the wall's free end, close its front too
        strip = [bm.verts.new((x, y0, z)) for x, z in ((BACK_X1, z0), (x1, z0), (x1, z1), (BACK_X1, z1))]
        bm.faces.new(strip)
    bm.normal_update()
    centre = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    for f in bm.faces:
        if f.normal.dot(f.calc_center_median() - centre) < 0:
            f.normal_flip()  # facing out: seen by a camera beside or above it, culled through the window
    mask = new_object("window_view_mask", bm, "window_view", None, [Mat("void").set(base=srgb(room_lib.VOID_HEX)).mat])
    for attr in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_shadow",
                 "visible_volume_scatter"):
        setattr(mask, attr, False)
    return mask


# ---- T72's hero props ----
# Each prop file (blender/props/<name>.blend, origin at its base, front -Y) replaces its stand-in where the stand-in
# stood, when the file exists: the keyboard, mouse and mug take Henry's footprints on the desk, the croissant the oven's
# and the bakery board's (scaled to each), the pennant hangs over the space prints, the badge sits on the CRT's chin.
HERO_ON_DESK = ("keyboard", "mouse", "coffee_mug")
PENNANT_AT = (-0.16, Y_BACK, 2.06)  # bottom centre of T72's pennant, over the Voyager record and the Pale Blue Dot
HERO_ANCHORS: dict[str, dict] = {}  # the empties T72's props bring (coffee_steam), with their positions and extras


def footprint_centre(objs):
    lo, hi = world_bounds(objs)
    return Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)), lo, hi


def swap_in(name, old, place, new_name, coll, atlas, mats):
    """Append prop `name`, transform it by place(new_objs) and delete `old`; returns the new main mesh."""
    props = {}
    meshes, anchors = place_one(name, Matrix.Identity(4), coll, atlas, mats, empty_props=props)
    main = next(o for o in meshes if o.name.split(".")[0] == name)
    m = place(meshes)
    for obj in meshes:
        obj.matrix_world = m @ obj.matrix_world
    for key, pos in anchors.items():
        HERO_ANCHORS[key] = {"position": m @ pos, **props.get(key, {})}
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)  # first, so the new mesh can take the name
    for obj in meshes:
        base = obj.name.split(".")[0]
        obj.name = obj.data.name = new_name if obj is main else (f"props_{base}" if base.endswith("_cable") else base)
    return main


def place_hero_props(mats, dressing):
    """Swap in T72's prop files over their stand-ins (see above); a missing file keeps the stand-in."""
    bpy.context.view_layer.update()
    have = lambda n: (PROPS_DIR / f"{n}.blend").exists()
    for name in HERO_ON_DESK:
        if not have(name):
            continue
        old = bpy.data.objects[name]
        centre, _, _ = footprint_centre([old])

        def on_desk(objs, centre=centre, name=name):
            mine, _, _ = footprint_centre([o for o in objs if o.name.split(".")[0] == name])
            return Matrix.Translation((centre.x - mine.x, centre.y - mine.y, centre.z - mine.z))
        swap_in(name, old, on_desk, name, "desk", "desk", mats)
    if have("croissant"):
        for old_name in ("croissant", "props_board_croissant_0", "props_board_croissant_1"):
            old = bpy.data.objects.get(old_name)
            if old is None:
                continue
            centre, lo, hi = footprint_centre([old])
            along_y = (hi.y - lo.y) > (hi.x - lo.x)

            def in_place(objs, centre=centre, lo=lo, hi=hi, along_y=along_y):
                mine_c, mlo, mhi = footprint_centre(objs)
                scale = max(hi.x - lo.x, hi.y - lo.y) / max(mhi.x - mlo.x, mhi.y - mlo.y)
                turn = Matrix.Rotation(math.pi / 2 if along_y else 0.0, 4, "Z")
                return (Matrix.Translation(centre) @ turn @ Matrix.Diagonal((scale, scale, scale, 1.0))
                        @ Matrix.Translation(-mine_c))
            swap_in("croissant", old, in_place, old_name, "props", "props", mats)
    if have("pennant_gatech"):
        dressing["pennant"] = swap_in("pennant_gatech", dressing["pennant"], lambda objs: Matrix.Translation(PENNANT_AT),
                                      "pennant_gatech", "props", "art", mats)
        dressing["pennant"]["texel"] = 1.4
    if have("crt_badge"):
        old = dressing["crt_badge"]
        at = old.matrix_world.copy()
        h = old["height_m"]
        dressing["crt_badge"] = swap_in("crt_badge", old, lambda objs: at @ Matrix.Translation((0, 0, -h / 2)),
                                        "crt_badge", "desk", "desk", mats)


def still_poster_image(slug: str) -> bpy.types.Image | None:
    """T34's poster for a favourite (public/room/posters/<slug>.avif), converted once to PNG for Cycles."""
    src = REPO / "public" / "room" / "posters" / f"{slug}.avif"
    if not src.exists():
        return None
    png = CACHE / "posters" / f"{slug}.png"
    if not png.exists() or png.stat().st_mtime < src.stat().st_mtime:
        png.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), str(png)], check=True)
    return bpy.data.images.load(str(png), check_existing=True)


def poster_art_material(slot: int, template: bpy.types.Material | None) -> bpy.types.Material:
    """The art on poster_art_<slot>: T34's poster for the stills, switched to white paper (light_probe = 1) while
    bake.py bakes the light that falls on it; the site draws its own art over that light at runtime."""
    mat = template.copy() if template is not None else Mat(f"poster_art_{slot}").mat
    mat.name = f"poster_art_{slot}"
    nt = mat.node_tree
    image = still_poster_image(STILL_POSTERS[slot])
    node = nt.nodes.get("poster_image")
    if image is not None and node is not None:
        node.image = image
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    art = out.inputs["Surface"].links[0].from_socket
    white = nt.nodes.new("ShaderNodeBsdfPrincipled")
    white.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1.0)
    white.inputs["Roughness"].default_value = 0.9
    probe = nt.nodes.new("ShaderNodeValue")
    probe.name = probe.label = "light_probe"
    probe.outputs[0].default_value = 0.0
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(probe.outputs[0], mix.inputs["Fac"])
    nt.links.new(art, mix.inputs[1])
    nt.links.new(white.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return mat


def build_posters(mats):
    """Four framed posters on the back wall left of the desk, facing the room (-Y). The frames are baked; each
    picture is its own mesh, poster_art_<slot> (slot 0 is the leftmost seen from the room), which the site textures
    at runtime."""
    frame_materials = None
    order = sorted(POSTER_X)
    for poster_id, x in zip(POSTER_IDS, POSTER_X):
        slot = order.index(x)
        # The frame's front is -Y already: the room, seen from the back wall.
        root = Matrix.Translation((x, Y_BACK, POSTER_Z - 0.319))
        meshes, _ = place_one("poster_frame", root, "props", "props", mats)
        for obj in meshes:
            base = obj.name.split(".")[0]
            if base == "poster_frame_glass":
                bpy.data.objects.remove(obj, do_unlink=True)
                continue
            if base == "poster_frame_art":
                obj.name = f"poster_art_{slot}"
                obj.data = obj.data.copy()
                obj.data.materials[0] = poster_art_material(slot, obj.data.materials[0])
                # The print sits 0.3 mm off the backing board, which z-fights in the browser from afar.
                obj.matrix_world = Matrix.Translation((0, -0.002, 0)) @ obj.matrix_world
                obj["runtime_art"] = "poster"
                w, h = POSTER_SIZE
                obj["width_m"], obj["height_m"] = w, h
            else:
                obj.name = f"props_poster_frame_{slot}"
                drop_faces_behind_print(obj)
                if frame_materials is None:
                    frame_materials = list(obj.data.materials)
                else:
                    for i, mat in enumerate(frame_materials):
                        obj.data.materials[i] = mat
            obj["poster"] = poster_id
            obj["poster_slot"] = slot


def drop_faces_behind_print(frame):
    """Remove the backing board's front faces, which the poster print covers completely."""
    bm = bmesh.new()
    bm.from_mesh(frame.data)
    world = frame.matrix_world
    normal_matrix = world.to_3x3().inverted().transposed()
    hidden = [f for f in bm.faces if (normal_matrix @ f.normal).normalized().y < -0.95
              and frame.data.materials[f.material_index].name.startswith("hardboard")]
    bmesh.ops.delete(bm, geom=hidden, context="FACES")
    bm.to_mesh(frame.data)
    bm.free()


# ---- Proxies, markers, cameras ----

# The shelf cameras have no hotspot (round 7: there, not featured); the camera on the desk keeps its own.
HOTSPOTS = {
    "hit_fujifilm_a": "fujifilm_x100",
    "hit_nas": "nas_4bay",
    "hit_mango": "mango_plant",
}


def world_bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def add_proxy(name, lo, hi, mats, pad=0.02):
    bm = bmesh.new()
    size = (hi - lo) + Vector((2 * pad,) * 3)
    add_box(bm, size, (lo + hi) / 2)
    obj = new_object(name, bm, "proxies", None, [mats["proxy"]])
    obj.hide_render = True
    obj.display_type = "WIRE"
    return obj


def build_proxies(placed, dressing, mats):
    bpy.context.view_layer.update()
    for hit, prop in HOTSPOTS.items():
        add_proxy(hit, *world_bounds(placed[prop]), mats)
    for poster_id in POSTER_IDS:
        objs = [o for o in bpy.data.objects if o.get("poster") == poster_id]
        hit = add_proxy(f"hit_poster_{poster_id}", *world_bounds(objs), mats, pad=0.01)
        hit["poster_slot"] = objs[0]["poster_slot"]
    add_proxy("hit_lava_lamp", *world_bounds(placed["lava_lamp"]), mats)
    machine = [o for o in placed["espresso_machine"] if o.name in ("espresso_machine", "espresso_cup")]
    add_proxy("hit_espresso", *world_bounds(machine), mats)
    oven = [bpy.data.objects[n] for n in ("countertop_oven", "oven_door")]
    add_proxy("hit_oven", *world_bounds(oven), mats)
    add_proxy("hit_croissant", *world_bounds([bpy.data.objects["croissant"]]), mats, pad=0.008)
    add_proxy("hit_window", Vector((WIN_X0, Y_BACK - 0.02, WIN_Z0)), Vector((WIN_X1, Y_BACK + WALL_T, WIN_Z1)), mats,
              pad=0.0)
    add_proxy("hit_plaque", *world_bounds([dressing["plaque"]]), mats, pad=0.01)
    turntable = [dressing["record_player"], dressing["platter"], dressing["tonearm"]]
    add_proxy("hit_record_player", *world_bounds(turntable), mats, pad=0.015)
    add_proxy("hit_books", *world_bounds([dressing["bookshelf"], *dressing["books"]]), mats, pad=0.01)
    add_proxy("hit_voyager", *world_bounds([dressing["voyager_record"]]), mats, pad=0.01)
    add_proxy("hit_pale_blue_dot", *world_bounds([dressing["pale_blue_dot_frame"]]), mats, pad=0.01)
    add_proxy("hit_print_japanese_lit", *world_bounds([dressing["print_japanese_lit"]]), mats, pad=0.01)
    add_proxy("hit_pennant", *world_bounds([dressing["pennant"]]), mats, pad=0.015)
    add_proxy("hit_crt_badge", *world_bounds([dressing["crt_badge"]]), mats, pad=0.006)
    # The darkroom: one box over the strings and the space the prints hang in; T75 adds a box per print in front.
    lo, hi = dressing["darkroom_bounds"]
    add_proxy("hit_darkroom", lo, hi, mats, pad=0.0)


def add_empty(name, location, rotation=None, coll="markers", **props):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type, empty.empty_display_size = "PLAIN_AXES", 0.08
    empty.location = location
    if rotation is not None:
        empty.rotation_mode = "QUATERNION"
        empty.rotation_quaternion = rotation
    for k, v in props.items():
        empty[k] = v
    collection(coll).objects.link(empty)
    return empty


def build_markers(placed, anchors, dressing):
    """Empties the site reads: the lava lamp's light, the espresso machine's spout and steam, the coffee mug's steam,
    the sky's motif in the window, the orbit's centre and limits, and every camera framing (the darkroom's clips come
    from room_dressing)."""
    bpy.context.view_layer.update()
    add_empty("lava_lamp_light", anchors["lava_lamp"]["lava_lamp_light"])
    add_empty("espresso_spout", anchors["espresso_machine"]["espresso_spout"])
    add_empty("espresso_steam", anchors["espresso_machine"]["espresso_steam"])
    # The steam starts just over the coffee's surface: the mug's rim centre, a little down into it.
    if "coffee_steam" in HERO_ANCHORS:
        steam = dict(HERO_ANCHORS["coffee_steam"])
        add_empty("coffee_steam", steam.pop("position"), **steam)
    else:
        mug = bpy.data.objects["coffee_mug"]
        lo, hi = world_bounds([mug])
        rim = [mug.matrix_world @ v.co for v in mug.data.vertices if (mug.matrix_world @ v.co).z > hi.z - 0.004]
        rim_centre = sum(rim, Vector()) / len(rim)
        add_empty("coffee_steam", (rim_centre.x, rim_centre.y, hi.z - 0.01), width_m=0.07, height_m=0.16)
    # The window's motif (a small plane on a dotted arc from Delhi, right, to San Francisco, left) spans the sky just
    # behind the glass; local +Z (glTF) faces the room.
    add_empty("window_motif", ((WIN_X0 + WIN_X1) / 2, Y_BACK + WALL_T + 0.04, 1.96), width_m=1.24, height_m=0.48,
              from_city="delhi", to_city="sf")
    add_empty("orbit_center", ORBIT["center"], **{k: v for k, v in ORBIT.items() if k != "center"})
    for name, (pos, target) in CAMERAS.items():
        add_empty(name, pos, coll="cameras", fov_deg=CAMERA_FOV_DEG)
        add_empty(f"{name}_target", target, coll="cameras")


# ---- Lights, world, render settings ----

def build_lights(mats):
    lights = collection("lights")

    # Desk lamp: a spot inside the shade throws the warm pool; a faint point light fills the shade itself.
    lamp = bpy.data.lights.new("lamp_tungsten", "SPOT")
    lamp.color = (1.0, 0.56, 0.24)  # ~2700 K blackbody
    lamp.energy = 260.0
    lamp.spot_size = math.radians(62)
    lamp.spot_blend = 0.55
    lamp.shadow_soft_size = 0.05  # the shade's mouth: a soft edge on every shadow under the lamp
    obj = bpy.data.objects.new("light_lamp", lamp)
    obj.location = LAMP_BULB
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = (LAMP_AIM - LAMP_BULB).normalized().to_track_quat("-Z", "Y")
    lights.objects.link(obj)
    glow = bpy.data.lights.new("lamp_glow", "POINT")
    glow.color, glow.energy, glow.shadow_soft_size = (1.0, 0.56, 0.24), 10.0, 0.02
    obj = bpy.data.objects.new("light_lamp_glow", glow)
    obj.location = LAMP_BULB
    lights.objects.link(obj)

    span = POSTER_X[-1] - POSTER_X[0] + 0.25
    (sx0, sx1), sz = SPACE_LIGHT
    for name, loc, size, tilt, energy, spread in (
        ("picture_light", PICTURE_LIGHT + Vector((0, 0, -0.03)), (span, 0.04), Euler((math.radians(38), 0, 0)), 30.0,
         120),
        ("space_light", Vector(((sx0 + sx1) / 2, Y_BACK - 0.11, sz - 0.025)), (sx1 - sx0, 0.04),
         Euler((math.radians(30), 0, 0)), 20.0, 120),
    ):
        light = bpy.data.lights.new(name, "AREA")
        light.shape, light.size, light.size_y = "RECTANGLE", *size
        light.color = (1.0, 0.62, 0.32)  # ~2900 K
        light.energy = energy
        light.spread = math.radians(spread)
        obj = bpy.data.objects.new(f"light_{name}", light)
        obj.location = loc
        obj.rotation_euler = tilt
        lights.objects.link(obj)

    # Daylight through the window (both cities are by day): the card behind it is emissive; this large soft area
    # light, the size of the pane, carries the same cool light into the room.
    win = bpy.data.lights.new("window_day", "AREA")
    win.shape, win.size, win.size_y = "RECTANGLE", WIN_X1 - WIN_X0, WIN_Z1 - WIN_Z0
    win.color = (0.84, 0.89, 1.0)
    win.energy = 160.0
    win.spread = math.radians(140)
    obj = bpy.data.objects.new("light_window", win)
    obj.location = ((WIN_X0 + WIN_X1) / 2, Y_BACK + WALL_T + 0.01, (WIN_Z0 + WIN_Z1) / 2)
    obj.rotation_euler = Euler((math.radians(-90), 0, 0))
    lights.objects.link(obj)


# The darkroom lines' lights (room_dressing places the fixtures): each picture light's watts and how far below it it
# aims on the wall; the fill's watts, height, distance from the wall and aim height. Measured from cam_photos the way
# the site lights a print (the wall's bake there over the bake under the lamps): every print at 0.82-0.96, where round
# eight's one strip gave 0.28-0.87, and the brightest point as bright as round eight's.
DARKROOM_LAMP_W, DARKROOM_AIM_DROP = 3.0, 1.6
DARKROOM_FILL_W, DARKROOM_FILL_Z, DARKROOM_FILL_OUT, DARKROOM_FILL_AIM_Z = 4.8, 0.95, 0.55, 1.4
DARKROOM_FILL_EXTRA, DARKROOM_FILL_SPREAD = 0.6, 120


def along_wall(aim: Vector):
    """An area light's rotation that aims it along `aim` with its long side (local X) along the left wall: tracking
    with local X as the up axis stood round eight's strip on end, so it lit a narrow upright band of the prints."""
    return aim.normalized().to_track_quat("-Z", "Y")


def build_practical_lights(dressing):
    """The lights that come with the room's things, each with its source in view or just out of it."""
    lights = collection("lights")

    def add(name, kind, loc, color, energy, size=0.02, rot=None, **extra):
        data = bpy.data.lights.new(name, kind)
        data.color, data.energy = color, energy
        if kind == "AREA":
            data.shape = "RECTANGLE"
            data.size, data.size_y = size
            data.spread = math.radians(extra.get("spread", 120))
        else:
            data.shadow_soft_size = size
        if kind == "SPOT":
            data.spot_size = math.radians(extra.get("cone", 80))
            data.spot_blend = extra.get("blend", 0.6)
        obj = bpy.data.objects.new(f"light_{name}", data)
        obj.location = loc
        if rot is not None:
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = rot
        lights.objects.link(obj)
        return obj

    down = Vector((0, 0, -1)).to_track_quat("-Z", "Y")
    # Lava lamp: alone on the credenza, its red-orange glow washes up the posters and the plaque.
    lava = bpy.data.objects["lava_lamp_light"].location
    add("lava_lamp", "POINT", lava + Vector((0, -0.03, 0)), (1.0, 0.32, 0.10), 11.0, size=0.045)
    # Oven: the elements' glow spills from the door window onto the counter.
    oven = bpy.data.objects["oven_glow"]
    lo, hi = world_bounds([oven])
    add("oven_glow", "POINT", Vector((hi.x + 0.04, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2)), (1.0, 0.42, 0.12), 2.5,
        size=0.05)
    # The darkroom lines' picture lights on the left wall, each washing down over the prints below it, and a soft
    # fill from below (the floor's bounce, strengthened) so the lowest string reads like the top one.
    for k, p in enumerate(dressing["darkroom_lamps"]):
        aim = Vector((X_LEFT, p.y, p.z - DARKROOM_AIM_DROP)) - p
        add(f"darkroom_light_{k}", "AREA", p + Vector((0.0, 0.0, -0.02)), (1.0, 0.64, 0.36), DARKROOM_LAMP_W,
            size=(room_dressing.DARKROOM_LAMP_LEN, 0.04), rot=along_wall(aim), spread=130)
    u0, u1 = dressing["darkroom_span"]
    fill = Vector((X_LEFT + DARKROOM_FILL_OUT, (u0 + u1) / 2, DARKROOM_FILL_Z))
    aim = Vector((X_LEFT, fill.y, DARKROOM_FILL_AIM_Z)) - fill
    add("darkroom_fill", "AREA", fill, (1.0, 0.80, 0.62), DARKROOM_FILL_W, size=(u1 - u0 + DARKROOM_FILL_EXTRA, 0.30),
        rot=along_wall(aim), spread=DARKROOM_FILL_SPREAD)
    # Paper lantern between the armchair and the record cabinet: a warm bulb inside the globe, kept below the desk
    # lamp and the CRT so the eye goes to the desk first.
    add("floor_lamp", "POINT", dressing["floor_lamp"], (1.0, 0.58, 0.26), 2.2, size=0.12)
    # The light bar under the kitchen shelf: a warm wash down the tiles onto the counter.
    add("under_shelf", "AREA", dressing["under_shelf"], (1.0, 0.60, 0.30), 9.0, size=(0.016, 0.98), rot=down, spread=140)
    # Kitchen pendant: a warm cone onto the counter, and the bulb's glow inside the shade.
    pendant = dressing["pendant"]
    add("pendant", "SPOT", pendant, (1.0, 0.56, 0.24), 40.0, size=0.09, rot=down, cone=95, blend=0.7)
    add("pendant_glow", "POINT", pendant + Vector((0, 0, 0.02)), (1.0, 0.56, 0.24), 3.0, size=0.03)


def setup_world_and_render():
    scene = bpy.context.scene
    world = bpy.data.worlds.new("ink")
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = srgb("#14110F")
    bg.inputs["Strength"].default_value = 0.6
    scene.world = world

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 5
    scene.cycles.glossy_bounces = 3
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.blur_glossy = 1.0
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 16
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = EXPOSURE

    cam = bpy.data.objects.new("render_cam", bpy.data.cameras.new("render_cam"))
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle = math.radians(CAMERA_FOV_DEG)
    cam.data.clip_start = 0.02
    collection("cameras").objects.link(cam)
    scene.camera = cam
    aim_camera("cam_idle")


def aim_camera(name: str):
    cam = bpy.context.scene.camera
    pos = bpy.data.objects[name].location
    target = bpy.data.objects[f"{name}_target"].location
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()


# Room-only triangle reduction (the prop files keep their full detail): the share of triangles each dense mesh keeps,
# so the glb's geometry stays near 100k vertices with the round-two dressing (PLAN 11.3, room.glb <= 4.3 MB).
DECIMATE = {
    "props_nas_4bay": 0.5, "espresso_machine": 0.6, "countertop_oven": 0.75,
    "props_haworthia": 0.5, "props_tea_tin": 0.6, "props_pen_cup": 0.7, "lava_lamp": 0.7,
    "props_mango_plant": 0.6, "props_board_croissant_0": 0.45, "props_board_croissant_1": 0.45,
}


def tone_room_emitters():
    """The lava lamp's glass was tuned in the prop studio; at the room's exposure it washes to pale pink, so the
    room dims its glow (the site draws the glass with its own shader anyway)."""
    mat = bpy.data.materials.get("lava_lamp_glass")
    emit = next((n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeEmission"), None) if mat else None
    if emit is None or not emit.inputs["Strength"].links:
        return
    src = emit.inputs["Strength"].links[0].from_socket
    dim = mat.node_tree.nodes.new("ShaderNodeMath")
    dim.operation = "MULTIPLY"
    dim.inputs[1].default_value = LAVA_GLOW
    mat.node_tree.links.new(src, dim.inputs[0])
    mat.node_tree.links.new(dim.outputs[0], emit.inputs["Strength"])


# The computer case's power and disk lights, (emission colour, strength): at the room's exposure (+2.8 stops, AgX) the
# prop studio's 3.0 and 1.5 bake to pale cream; these keep them green and amber. Baked, not a bloom practical.
CASE_LIGHTS = {"case_power_led": ((0.10, 1.0, 0.22), 0.09), "case_hdd_led": ((1.0, 0.42, 0.04), 0.07)}


def tone_case_lights():
    for name, (colour, strength) in CASE_LIGHTS.items():
        mat = bpy.data.materials[name]
        bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
        if bsdf.inputs["Emission Color"].is_linked or bsdf.inputs["Emission Strength"].is_linked:
            raise SystemExit(f"build_room: {name}'s emission is driven by nodes; tone_case_lights expects plain values")
        bsdf.inputs["Emission Color"].default_value = (*colour, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength


def reduce_geometry():
    for name, ratio in DECIMATE.items():
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        with bpy.context.temp_override(object=obj, active_object=obj):
            bpy.ops.object.modifier_apply(modifier=mod.name)


# Atlases by importance (CRAFT-R8 4): desk (the hero surfaces of the desk view), bezel (the CRT bezel the landing view
# shows), art (the wall art, the window and the space prints), props (everything else that stands in the set) and env
# (the walls, the floor and what lies on them). An object goes to the first atlas whose name prefixes claim it; the rest keep the atlas they were built
# with. split_desk_heroes() first cuts the desk, the CRT and the computer into the faces the desk view sees (desk
# atlas) and the rest (props).
ATLAS_BY_NAME = [
    ("desk", ("desk_desk_top", "desk_crt_front", "desk_computer_front", "keyboard", "mouse", "coffee_mug", "crt_glow",
              "crt_badge", "sticky_note_", "props_fujifilm_x100")),
    ("bezel", ("desk_crt_bezel",)),
    ("art", ("env_window", "env_curtain_rod", "env_picture_light", "env_space_light", "props_poster_frame_", "poster_art_", "poster_plaque",
             "voyager_record", "props_frame_pale_blue_dot", "print_pale_blue_dot", "pennant_gatech",
             "print_japanese_lit", "darkroom_", "env_darkroom_light")),
    ("env", ("wall_back", "wall_left", "floor", "env_skirting", "env_rug", "env_curtains")),
]
# Share of its atlas per object relative to its surface area (1 = by area), within its atlas: the hero props of the
# desk view and the type on the books and prints get more texels, the big smooth surfaces fewer.
TEXEL_WEIGHTS = {
    # desk: the desk top by what the views see of it (split_desk_top_by_view); the small things on it carry the detail
    "desk_desk_top": 1.2, "desk_desk_top_mid": 0.44, "desk_desk_top_rest": 0.02, "keyboard": 1.3, "mouse": 1.0,
    "coffee_mug": 1.0, "desk_crt_front": 1.0, "crt_badge": 1.4, "coffee_mug_coffee": 0.8, "props_keyboard_cable": 0.3,
    "props_mouse_cable": 0.3, "desk_computer_front": 1.2, "crt_glow": 0.3, "props_fujifilm_x100": 1.0,
    # the rest of the desk sits in the props atlas, a little above its average: the desk view sees it
    "desk_notebook": 1.8, "desk_lamp_shade": 1.6, "desk_lamp": 1.4, "desk_lamp_neck": 1.4,
    "desk_tray_bottom": 1.2, "desk_tray_top": 1.2, "desk_cables": 0.8, "desk_papers_a": 1.4,
    "desk_papers_b": 1.4, "desk_paper": 1.4, "props_pen_cup": 1.4, "lamp_bulb": 1.0,
    # art: frames and the window frame by area; the engraved and printed type sharper
    "env_window_frame": 0.8, "env_window_sill": 0.8, "poster_plaque": 3.0, "voyager_record": 1.6, "pennant_gatech": 1.4,
    "print_japanese_lit": 1.4, "props_frame_pale_blue_dot": 1.0, "env_curtain_rod": 0.6,
    # env: the floor's faded ring and the rugs need little; the walls and the solid floor share the rest
    "floor_fade": 0.3, "env_rug": 0.8, "env_rug_corner": 0.8, "env_curtains": 0.7, "env_skirting": 1.0,
    # props: what the tour stops at
    "kitchen_counter": 1.0, "env_kitchen_top": 1.2, "env_kitchen_tiles": 1.2, "env_kitchen_shelf": 1.0,
    "env_credenza": 0.8, "env_record_cabinet": 0.9, "bookshelf": 0.9, "record_player": 3.0, "platter": 3.3,
    "tonearm": 4.4, "record_crate": 1.0, "props_kitchen_spices": 1.6, "props_kitchen_mugs": 1.4,
    "props_pour_over": 1.6, "props_bakery_board": 2.0, "props_cinnamon_rolls": 2.0, "props_under_shelf_light": 1.0,
    "props_bookcase_books": 1.0, "props_bookend": 1.0, "props_kitchen_jars": 1.4, "props_kitchen_pendant": 1.2,
    "props_chopping_board": 1.0, "props_lounge_chair": 0.8, "props_lantern": 0.8,
    "props_reading_mug": 1.4, "props_floor_books": 0.9, "espresso_machine": 1.6, "espresso_cup": 2.2,
    "espresso_coffee": 1.0, "countertop_oven": 1.6, "oven_door": 1.8, "croissant": 3.0, "lava_lamp": 1.6,
    "lava_lamp_glass": 1.8, "oven_glow": 1.6, "desk_desk": 0.6,
    "desk_crt": 2.0, "desk_computer": 1.5, "props_mango_plant_leaves": 1.4,
    # its object card frames it at half the view's height (~2,300 texels/m for 1 per device pixel); 24 gives ~1,500
    "props_nas_4bay": 24.0,
    # the desk chair is seen from behind at the wide view: ~355 texels/m there is 1 per device pixel
    "desk_chair": 1.33, "desk_chair_base": 1.33,
}
# Heights things rest on (their bottoms there are hidden): floor, desk, record cabinet, credenza, sill, counter,
# bookcase levels.
SUPPORT_Z = (0.0, 0.732, 0.56, 0.60, 0.86, 0.90, 0.075, 0.415, 0.755, 1.06)


def split_by_faces(obj, keep, name):
    """Move the faces of obj for which keep(world centre, world normal, material name) holds into a new object called
    name (same materials, same collection); returns it, or None if no face qualifies or every face does."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mw = obj.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    mats = [m.name if m else "" for m in obj.data.materials]
    bm.faces.index_update()
    chosen = [f for f in bm.faces if keep(mw @ f.calc_center_median(), (nm @ f.normal).normalized(),
                                          mats[f.material_index] if f.material_index < len(mats) else "")]
    if not chosen or len(chosen) == len(bm.faces):
        bm.free()
        return None
    chosen_idx = {f.index for f in chosen}
    rest = bm.copy()
    rest.faces.ensure_lookup_table()
    bmesh.ops.delete(rest, geom=[rest.faces[i] for i in chosen_idx], context="FACES")
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in chosen_idx], context="FACES")
    part = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    bm.to_mesh(part.data)
    rest.to_mesh(obj.data)
    bm.free()
    rest.free()
    for mat in obj.data.materials:
        part.data.materials.append(mat)
    part.matrix_world = mw.copy()
    for coll in obj.users_collection:
        coll.objects.link(part)
    for key in obj.keys():
        part[key] = obj[key]
    part.data.shade_smooth()
    return part


CRT_PARTING_Y = -0.0715  # the CRT case's parting groove (props_crt_shell.py: y -0.072), just behind it


def split_desk_heroes():
    """The desk view sees the desk's top, the CRT's and the computer's fronts and tops: those faces get the desk
    atlas's density, the rest of each (legs, sides, backs) the props atlas's."""
    desk = bpy.data.objects["desk_desk"]
    top_z = max((desk.matrix_world @ v.co).z for v in desk.data.vertices)
    split_by_faces(desk, lambda c, n, m: n.z > 0.7 and c.z > top_z - 0.01, "desk_desk_top")
    # The CRT's case parts at its parting groove: the whole bezel in front of it (face, lip, rolled edge) in the desk
    # atlas, the rear cover in props. A cut by facing cut across the rounded bevels, which then showed both atlases'
    # densities side by side and a dotted seam along the cut. One smart projection keeps the bezel one island.
    front = split_by_faces(bpy.data.objects["desk_crt"], lambda c, n, m: c.y < CRT_PARTING_Y, "desk_crt_front")
    front["bake_uv"] = "project"
    split_crt_bezel_by_landing(front)
    split_computer_front()
    split_desk_top_by_view()


def split_computer_front():
    """The computer's front panel and the strip of its lid in front of the CRT's foot go to the desk atlas; the rest of
    the lid (under the CRT, out of sight from the desk), the sides and the back to props."""
    comp, crt = bpy.data.objects["desk_computer"], bpy.data.objects["desk_crt"]
    foot_y = min((crt.matrix_world @ v.co).y for v in crt.data.vertices if (crt.matrix_world @ v.co).z < 0.88)
    bm = bmesh.new()
    bm.from_mesh(comp.data)
    to_world = comp.matrix_world
    bm.transform(to_world)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, foot_y, 0), plane_no=(0, 1, 0))
    bm.transform(to_world.inverted())
    bm.to_mesh(comp.data)
    bm.free()
    split_by_faces(comp, lambda c, n, m: n.y < -0.3 or (n.z > 0.7 and c.y < foot_y), "desk_computer_front")


# The landing view (the monitor framing every visit ends in) fills about a quarter of its frame with the bezel round
# the glass and asks ~5,800 texels/m of it at 1512x982 @2, 2.5x what the rest of the case gets. The faces it shows bake
# as desk_crt_bezel into an atlas of their own (bake.ATLAS_SIZES "bezel").
MONITOR_MARGIN = 1.3  # src/scene/Camera/RoomCamera.ts: how far back from a glass-filled frame the monitor framing sits
LANDING_ASPECTS = (1512 / 982, 16 / 9, 4 / 3)


def landing_views():
    screen = bpy.data.objects["monitor_screen"]
    centre = screen.matrix_world.translation.copy()
    back = (bpy.data.objects["cam_monitor"].location - bpy.data.objects["cam_monitor_target"].location).normalized()
    half = math.tan(math.radians(CAMERA_FOV_DEG) / 2)
    for aspect in LANDING_ASPECTS:
        distance = max(screen["height_m"] / 2 / half, screen["width_m"] / 2 / (half * aspect)) * MONITOR_MARGIN
        yield centre + back * distance, centre, aspect


def split_crt_bezel_by_landing(front):
    shown = landing_shown()
    bezel = split_by_faces(front, lambda c, n, m: shown(c, n), "desk_crt_bezel")
    if bezel is None:
        return
    mark_bezel_sides(bezel)


def landing_shown():
    """Whether a face (world centre, normal) shows in a landing view. The sticky notes do not hide it: faces under a
    note left in the desk atlas showed a seam where they reached past the note's edge."""
    bpy.context.view_layer.update()
    scene, depsgraph = bpy.context.scene, bpy.context.evaluated_depsgraph_get()
    half_v = math.tan(math.radians(CAMERA_FOV_DEG) / 2)
    views = []
    for eye, target, aspect in landing_views():
        forward = (target - eye).normalized()
        right = forward.cross(Vector((0, 0, 1))).normalized()
        views.append((eye, forward, right, right.cross(forward), half_v * aspect))

    def shown(centre, normal):
        p = centre + normal * 0.001
        for eye, forward, right, up, half_h in views:
            v = p - eye
            depth = v.dot(forward)
            if (depth > 0.05 and abs(v.dot(right)) <= half_h * depth and abs(v.dot(up)) <= half_v * depth
                    and normal.dot(eye - p) > 0 and seen_from(p, eye, scene, depsgraph, ("sticky_note_",))):
                return True
        return False

    return shown


def mark_bezel_sides(bezel):
    """One ring round the glass packs like a frame with nothing inside, so the bezel unwraps as its top, bottom, left
    and right sides, parted by UV seams along the screen's diagonals and nowhere else. Seams, not a split: a split
    mesh smooths each side's normals on its own (up to 44 degrees apart across the cut), which baked a lit seam, and
    smart projection broke the lip into islands whose borders ran along its highlight."""
    bezel["bake_uv"] = "unwrap"
    screen = bpy.data.objects["monitor_screen"]
    centre, half_w, half_h = screen.matrix_world.translation, screen["width_m"] / 2, screen["height_m"] / 2
    bm = bmesh.new()
    bm.from_mesh(bezel.data)
    mw = bezel.matrix_world

    def side(face):
        c = mw @ face.calc_center_median()
        dx, dz = (c.x - centre.x) / half_w, (c.z - centre.z) / half_h
        return ("top" if dz > 0 else "bottom") if abs(dz) > abs(dx) else ("right" if dx > 0 else "left")

    sides = {f.index: side(f) for f in bm.faces}
    for e in bm.edges:
        e.seam = len(e.link_faces) == 2 and sides[e.link_faces[0].index] != sides[e.link_faces[1].index]
    bm.to_mesh(bezel.data)
    bm.free()


# The desk top's density follows what the framings see of it: only about half of its 1.4 m2 shows from the desk
# view (the CRT, the computer and the keyboard cover the rest), so a uniform density spent most texels where no one
# looks. The top is cut into DESK_TOP_CELL squares and each goes to the first tier whose need it reaches: the texels
# per metre its most demanding view asks for 1 texel per device pixel across the pixel's short side, in a frame
# DESK_TOP_FRAME_PX tall (2560x1440 CSS at DPR 2). Views: every cam_* framing and the orbit at DESK_TOP_ORBIT_DIST
# (nearer is a zoom past the default). The parts bake as their own objects; export.py joins them back into one
# desk_desk_top (one node, one shine).
DESK_TOP_CELL = 0.03
DESK_TOP_FRAME_PX = 2880
DESK_TOP_ORBIT_DIST = 4.5
DESK_TOP_TIERS = (("desk_desk_top", 2200.0), ("desk_desk_top_mid", 900.0), ("desk_desk_top_rest", 0.0))


def desk_top_views():
    views = [(bpy.data.objects[o.name].location.copy(), bpy.data.objects[f"{o.name}_target"].location.copy())
             for o in bpy.data.objects if o.name.startswith("cam_") and not o.name.endswith("_target")]
    centre = bpy.data.objects["orbit_center"].location.copy()
    for polar in (40, 55, 70, 80):
        for azimuth in range(0, 360, 15):
            p, a = math.radians(polar), math.radians(azimuth)
            offset = Vector((math.sin(p) * math.sin(a), -math.sin(p) * math.cos(a), math.cos(p)))
            views.append((centre + DESK_TOP_ORBIT_DIST * offset, centre.copy()))
    return views


def seen_from(point, eye, scene, depsgraph, see_through=()):
    """No surface a camera renders lies between point and eye (proxies, ghosts, glass and names starting with one of
    see_through let the ray through)."""
    ray = eye - point
    left = ray.length
    ray.normalize()
    origin = point + ray * 0.003
    for _ in range(16):
        hit, loc, _n, _i, obj, _m = scene.ray_cast(depsgraph, origin, ray, distance=left)
        if not hit:
            return True
        if not (obj.hide_render or not obj.visible_camera or obj.name.startswith(("hit_", "ghost_", "env_sky"))
                or obj.name in ("window_glass", "crt_glow") or obj.name.startswith(tuple(see_through))):
            return False
        left -= (loc - origin).length + 0.001
        origin = loc + ray * 0.001
        if left <= 0:
            return True
    return True


def desk_top_need(points, views) -> float:
    half_v = math.tan(math.radians(CAMERA_FOV_DEG) / 2)
    half_h = half_v * 16 / 9
    scene, depsgraph = bpy.context.scene, bpy.context.evaluated_depsgraph_get()
    best = 0.0
    for eye, target in views:
        forward = (target - eye).normalized()
        right = forward.cross(Vector((0, 0, 1))).normalized()
        up = right.cross(forward)
        for p in points:
            v = p - eye
            depth = v.dot(forward)
            if depth <= 0.05 or abs(v.dot(right)) > half_h * depth or abs(v.dot(up)) > half_v * depth:
                continue
            need = DESK_TOP_FRAME_PX / (2 * half_v * depth)
            if need > best and seen_from(p, eye, scene, depsgraph):
                best = need
    return best


DESK_TOP_RECT_CELLS = 20  # a rectangle's longest side in cells (0.6 m, ~1,800 px at 3,000 texels/m)


def desk_top_rectangles(tiers, nx, ny) -> dict:
    """Cover each tier's cells with rectangles, greedily: from each free cell, run along x, then down y while the run
    stays in the tier. Returns cell -> rectangle id."""
    rect, next_id = {}, 0
    for j in range(ny):
        for i in range(nx):
            if (i, j) in rect:
                continue
            tier = tiers[i, j]
            i1 = i
            while i1 + 1 < nx and i1 + 1 - i < DESK_TOP_RECT_CELLS and tiers[i1 + 1, j] == tier and (i1 + 1, j) not in rect:
                i1 += 1
            j1 = j
            while (j1 + 1 < ny and j1 + 1 - j < DESK_TOP_RECT_CELLS
                   and all(tiers[k, j1 + 1] == tier and (k, j1 + 1) not in rect for k in range(i, i1 + 1))):
                j1 += 1
            for jj in range(j, j1 + 1):
                for ii in range(i, i1 + 1):
                    rect[ii, jj] = next_id
            next_id += 1
    return rect


def split_desk_top_by_view():
    top = bpy.data.objects["desk_desk_top"]
    bpy.context.view_layer.update()
    mw = top.matrix_world
    world = [mw @ v.co for v in top.data.vertices]
    lo = Vector((min(p.x for p in world), min(p.y for p in world)))
    hi = Vector((max(p.x for p in world), max(p.y for p in world)))
    z = max(p.z for p in world) + 0.0005
    nx, ny = math.ceil((hi.x - lo.x) / DESK_TOP_CELL), math.ceil((hi.y - lo.y) / DESK_TOP_CELL)
    bm = bmesh.new()
    bm.from_mesh(top.data)
    bm.transform(mw)
    for axis, count, start in ((Vector((1, 0, 0)), nx, lo.x), (Vector((0, 1, 0)), ny, lo.y)):
        for k in range(1, count):
            co = axis * (start + k * DESK_TOP_CELL)
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=axis)
    bm.transform(mw.inverted())
    bm.to_mesh(top.data)
    bm.free()
    views = desk_top_views()
    tiers = {}
    for j in range(ny):
        for i in range(nx):
            x, y = lo.x + i * DESK_TOP_CELL, lo.y + j * DESK_TOP_CELL
            pts = [Vector((x + fx * DESK_TOP_CELL, y + fy * DESK_TOP_CELL, z))
                   for fx, fy in ((0.5, 0.5), (0.15, 0.15), (0.85, 0.15), (0.15, 0.85), (0.85, 0.85))]
            need = desk_top_need(pts, views)
            tiers[i, j] = next(name for name, floor in DESK_TOP_TIERS if need >= floor)

    def cell_of(centre):
        return (min(max(int((centre.x - lo.x) / DESK_TOP_CELL), 0), nx - 1),
                min(max(int((centre.y - lo.y) / DESK_TOP_CELL), 0), ny - 1))

    def tier_of(centre):
        return tiers[cell_of(centre)]

    # Each tier's cells as rectangles, each its own UV island: one island per tier, full of holes where the CRT and
    # the keyboard stand, left the desk atlas 40 % full; rectangles pack like any other island.
    rect = desk_top_rectangles(tiers, nx, ny)
    bm = bmesh.new()
    bm.from_mesh(top.data)
    bm.faces.ensure_lookup_table()
    face_rect = {f.index: rect[cell_of(mw @ f.calc_center_median())] for f in bm.faces}
    cut = [e for e in bm.edges if len(e.link_faces) == 2
           and face_rect[e.link_faces[0].index] != face_rect[e.link_faces[1].index]]
    bmesh.ops.split_edges(bm, edges=cut)
    bm.to_mesh(top.data)
    bm.free()
    for name, _ in DESK_TOP_TIERS[1:]:
        part = split_by_faces(top, lambda c, n, m, name=name: tier_of(c) == name, name)
        if part is not None:
            part["join_into"] = "desk_desk_top"
    counts = {name: sum(1 for t in tiers.values() if t == name) for name, _ in DESK_TOP_TIERS}
    print("desk top tiers: " + ", ".join(f"{name} {n * DESK_TOP_CELL ** 2:.3f} m2" for name, n in counts.items()))


# The plants' leaves for the site's wind: (source object, the materials that sway, how the sway weight runs). "leaf":
# each leaf from 0 where it joins its stem to 1 at its tip; "vine": from 0 at the pot to 1 at the end of each vine.
# The haworthia, a stiff succulent, does not sway.
PLANT_SWAY = [
    ("props_mango_plant_leaves", ("mango_leaf", "mango_leaf_young", "mango_leaf_dry"), "leaf"),
    ("props_syngonium", ("potted_plant_02_leaves",), "leaf"),
    ("props_pothos", ("pothos_leaf", "pothos_stem"), "vine"),
]


def build_plant_sway():
    """plant_sway_<n>: the swaying leaves of each plant as their own mesh, with a colour attribute 'sway' whose R is
    the sway weight (0 still, 1 the most), for the site's wind. G and B are 1, so a loader that multiplies the base
    colour by the vertex colour (glTF's rule) changes only the leaves' red, which green leaves barely have."""
    for n, (source, materials, kind) in enumerate(PLANT_SWAY):
        obj = bpy.data.objects.get(source)
        if obj is None:
            raise SystemExit(f"build_room: no plant {source} to make plant_sway_{n}")
        lo, hi = world_bounds([obj])
        anchor = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        leaves = split_by_faces(obj, lambda c, nrm, m: m.split(".")[0] in materials, f"plant_sway_{n}")
        if leaves is None:
            raise SystemExit(f"build_room: {source} has no faces in {materials}")
        leaves["double_sided"] = True
        leaves["texel"] = TEXEL_WEIGHTS.get(source, 1.4)
        sway_weights(leaves, anchor, kind)


def sway_weights(obj, anchor, kind):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    mw = obj.matrix_world
    world = [mw @ v.co for v in bm.verts]
    weight = [0.0] * len(world)
    if kind == "vine":
        far = max((p - anchor).length for p in world) or 1.0
        weight = [(p - anchor).length / far for p in world]
    else:
        seen = [False] * len(world)
        for start in bm.verts:
            if seen[start.index]:
                continue
            part, stack = [], [start]
            seen[start.index] = True
            while stack:
                v = stack.pop()
                part.append(v.index)
                for e in v.link_edges:
                    o = e.other_vert(v)
                    if not seen[o.index]:
                        seen[o.index] = True
                        stack.append(o)
            base = min(part, key=lambda i: (world[i] - anchor).xy.length + 0.25 * abs(world[i].z - anchor.z))
            reach = max((world[i] - world[base]).length for i in part) or 1.0
            for i in part:
                weight[i] = (world[i] - world[base]).length / reach
    bm.free()
    attr = obj.data.color_attributes.new("sway", "BYTE_COLOR", "POINT")
    for i, w in enumerate(weight):
        attr.data[i].color = (min(max(w, 0.0), 1.0), 1.0, 1.0, 1.0)
    obj.data.color_attributes.active_color = attr


# The glossy surfaces whose shine the site draws live (the bake holds only view-independent light): gloss = roughness.
GLOSS = {"crt_glow": 0.12, "coffee_mug": 0.22, "desk_desk_top": 0.3, "window_glass": 0.05, "lava_lamp_glass": 0.15,
         "desk_lamp_shade": 0.3, "espresso_machine": 0.2, "voyager_record": 0.22, "platter": 0.22}


def tag_gloss():
    for name, roughness in GLOSS.items():
        bpy.data.objects[name]["gloss"] = roughness


def assign_atlases():
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "atlas" not in obj or str(obj["atlas"]).startswith("window_"):
            continue
        atlas = next((a for a, names in ATLAS_BY_NAME if obj.name.startswith(names)), None)
        if atlas is None and obj["atlas"] in ("desk", "env"):
            atlas = "props"  # whatever the four lists do not claim stands in the set
        if atlas:
            obj["atlas"] = atlas


def tune_atlas_objects():
    """Set texel weights, and drop faces no framing can see: downward faces below 0.8 m (every camera, and the orbit
    at its lowest, is above 1.0 m) and bottoms resting on the floor, desk, cabinets, sill or shelves."""
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "atlas" not in obj or obj["atlas"].startswith("window_"):
            continue
        name = obj.name
        weight = TEXEL_WEIGHTS.get(name)
        if weight is None and name.startswith("props_poster_frame_"):
            weight = 1.0
        elif obj.get("runtime_art"):
            # Only the light on the picture is baked (the site draws the art), and light is smooth.
            weight = 0.45
            obj["bake_uv"] = "project"  # the art UV is a unit square; project for the true aspect
        if weight is not None:
            obj["texel"] = weight
        if name in ("lamp_bulb", "crt_glow", "lava_lamp_glass", "oven_glow", "oven_door", "croissant") or \
                name.startswith("nas_led_"):
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        world = obj.matrix_world
        normal_matrix = world.to_3x3().inverted().transposed()
        doomed = []
        for face in bm.faces:
            n = (normal_matrix @ face.normal).normalized()
            if n.z > -0.95:
                continue
            z = (world @ face.calc_center_median()).z
            if z < 0.8 or any(abs(z - s) < 0.004 for s in SUPPORT_Z):
                doomed.append(face)
        if doomed and len(doomed) < len(bm.faces):
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bm.to_mesh(obj.data)
        bm.free()


# The wall groups: each wall with its art and fixtures hangs under an empty at the origin (identity, so world positions
# are unchanged), wall_back_group or wall_left_group, so the site can fade a whole wall when the camera is behind it.
# The window's view hangs under the back wall too: from behind or from the side it would show around the wall. Every
# other node stands on the floor and stays at the top.
WALL_GROUPS = {
    "wall_back_group": ("wall_back", "env_skirting_back", "env_window", "window_", "env_curtain", "env_picture_light",
                        "env_space_light",
                        "props_poster_frame_", "poster_art_", "poster_plaque", "hit_poster_", "hit_plaque", "hit_window",
                        "voyager_record", "hit_voyager", "props_frame_pale_blue_dot", "print_pale_blue_dot",
                        "hit_pale_blue_dot", "pennant_gatech", "hit_pennant", "props_mango", "mango_", "hit_mango",
                        "props_haworthia", "plant_sway_0"),
    "wall_left_group": ("wall_left", "env_skirting_left", "env_kitchen_tiles", "env_kitchen_shelf", "props_kitchen_jars",
                        "props_kitchen_spices", "props_kitchen_mugs", "props_under_shelf_light", "props_tea_tin",
                        "darkroom_", "env_darkroom_light", "hit_darkroom"),
}


def assign_wall_groups():
    bpy.context.view_layer.update()
    groups = {name: add_empty(name, (0.0, 0.0, 0.0), coll="groups") for name in WALL_GROUPS}
    for obj in list(bpy.context.scene.objects):
        if obj.parent is not None or obj.name in groups or obj.type not in ("MESH", "EMPTY"):
            continue
        group = next((g for g, names in WALL_GROUPS.items() if obj.name.startswith(names)), None)
        if group:
            world = obj.matrix_world.copy()
            obj.parent = groups[group]
            obj.matrix_parent_inverse = Matrix.Identity(4)
            obj.matrix_world = world


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    subprocess.run(["node", str(REPO / "blender" / "scripts" / "room_art.mjs"), str(CACHE / "art")], check=True)
    mats = build_materials()
    place_henry(mats)
    place_desk_props(mats)
    build_shell(mats)
    build_window(mats)
    if not QUICK:
        window_view.build_window_view(CAMERAS)
        build_view_mask()
    build_fixtures(mats)
    build_rug(mats)
    build_lamp(mats)
    build_crt_glass(mats)
    placed, anchors = place_props(mats)
    build_posters(mats)
    dressing = room_dressing.build_dressing(mats, placed)
    place_hero_props(mats, dressing)
    build_proxies(placed, dressing, mats)
    build_markers(placed, anchors, dressing)
    build_lights(mats)
    build_practical_lights(dressing)
    tone_room_emitters()
    tone_case_lights()
    reduce_geometry()
    split_desk_heroes()
    build_plant_sway()
    tag_gloss()
    assign_atlases()
    tune_atlas_objects()
    assign_wall_groups()
    setup_world_and_render()
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    for img in bpy.data.images:
        if img.filepath and not img.packed_file:
            img.filepath = bpy.path.relpath(img.filepath, start=str(BLEND.parent))
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True, relative_remap=True)
    print(f"saved {BLEND}")


if __name__ == "__main__":
    main()
