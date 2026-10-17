"""The lived-in layer of the set: the credenza and plaque under the posters, the mini kitchen, the darkroom lines on
the left wall, the space prints over the desk (Voyager record, Pale Blue Dot) and the Georgia Tech pennant, the CRT's
badge, the sticky notes, desk clutter, the free-standing bookcase with the six books and the Japanese-literature
print, the record corner, the reading corner and CC0 plants and objects.

build_room.py calls build_dressing() after the props are placed. Everything here is baked into an atlas; the runtime
art (record_sleeve_*, print_pale_blue_dot, sticky_note_*) keeps 0-1 art UVs and the site draws over the light baked on
it, like the posters. The darkroom's prints are drawn by the site at the clip empties (darkroom_clip_<line>_<k>).
"""

import math
import random
import subprocess
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

import props_lib as pl
from import_henry import CACHE, fetch_cached
from room_lib import X_LEFT, Y_BACK, add_box, add_cylinder, collection, new_object, smooth_by_angle

SEED = 20261012
ART = CACHE / "art"

# Newsreader (SIL OFL), the site's heading face, pinned to the Google Fonts commit that added it.
NEWSREADER = ("https://raw.githubusercontent.com/google/fonts/991ce1de6075188e6b8977a5aa9fcd3610a4e946/ofl/newsreader/"
              "Newsreader%5Bopsz,wght%5D.ttf", "8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1")
# Pale Blue Dot Revisited (NASA/JPL-Caltech, 2020, PIA23645; public domain), the print on the space wall.
PALE_BLUE_DOT = ("https://images-assets.nasa.gov/image/PIA23645/PIA23645~orig.jpg",
                 "b783a29a134377ba41ffe8f644fd1f066b591b77b316daac3d32b315cc265c34")

# The credenza under the posters on the back wall, and the kitchen nook at the left wall's front end. The kitchen is
# authored where it stood in round seven (left wall at KITCHEN_AUTHORED_X, counter from y -3.98 to -2.75) and moved
# to the corner set by KITCHEN_SHIFT as a whole.
CREDENZA = (-3.05, -1.20, Y_BACK - 0.42, Y_BACK)  # x0, x1, y0, y1
CREDENZA_TOP = 0.60
KITCHEN_AUTHORED_X = -3.30
KITCHEN_SHIFT = Vector((X_LEFT - KITCHEN_AUTHORED_X, 0.68, 0.0))
KITCHEN_Y0, KITCHEN_Y1, KITCHEN_DEPTH, KITCHEN_TOP = -3.98, -2.75, 0.62, 0.90
PENDANT = Vector((KITCHEN_AUTHORED_X + 0.34, (KITCHEN_Y0 + KITCHEN_Y1) / 2, 1.98))

PLAQUE_CENTRE = Vector((-2.10, Y_BACK - 0.006, 1.27))
PLAQUE_TEXT = "Four favourites — from Letterboxd"

# The darkroom lines on the left wall between the kitchen and the corner: three strings (wall-local u from, u to,
# height at the ends, sag at the middle, distance off the wall) with prints drying on them, each print on one wooden
# peg. Per print: where along the string (0-1), its largest width and height, its turn in degrees. The prints are
# big and irregular, a little overlapping (each string hangs a little further off the wall than the one above);
# the middle string's widest print is the hero (Chinatown).
DARKROOM_LINES = [
    (-1.96, 0.08, 2.20, 0.040, 0.034),
    (-2.02, 0.04, 1.75, 0.052, 0.056),
    (-1.92, 0.10, 1.31, 0.036, 0.078),
]
DARKROOM_PRINTS = [
    [(0.07, 0.26, 0.36, -2.5), (0.23, 0.33, 0.30, 1.5), (0.40, 0.22, 0.34, 3.0), (0.56, 0.30, 0.36, -1.0),
     (0.74, 0.26, 0.30, 2.0), (0.91, 0.24, 0.36, -3.5)],
    [(0.10, 0.24, 0.36, 2.0), (0.27, 0.30, 0.36, -1.5), (0.50, 0.45, 0.38, 0.8), (0.72, 0.26, 0.34, -2.5),
     (0.90, 0.30, 0.36, 1.0)],
    [(0.06, 0.28, 0.34, 1.5), (0.22, 0.24, 0.34, -2.0), (0.38, 0.32, 0.34, 2.5), (0.56, 0.22, 0.34, -1.0),
     (0.72, 0.30, 0.34, -3.0), (0.90, 0.26, 0.34, 2.0)],
]
DARKROOM_HERO = (1, 2)  # (line, print)
DARKROOM_LIGHT_Z = 2.34

# The space prints over the desk on the back wall (each built facing -Y, the room) and the Georgia Tech pennant
# pinned over them: the Voyager record's shadow box and the Pale Blue Dot, side by side, centred over the desk.
VOYAGER = Vector((-0.50, Y_BACK, 1.78))
PALE_DOT = Vector((0.17, Y_BACK, 1.80))
PALE_DOT_SIZE = 0.30  # the square print; the image is 5230 x 5175
PENNANT = (Vector((-0.55, Y_BACK - 0.012, 2.33)), 0.78, 0.24)  # hoist top-left corner, length, hoist height
# The CRT's badge on the bezel's chin, under the glass, and its placeholder plate's size (T72's crt_badge replaces it).
CRT_BADGE = (Vector((0.0, -1.0, 0.938)), (0.086, 0.015))

# The bookcase stands free on the floor toward the open side, turned toward the room: authored as it stood against the
# round-seven right wall (front facing -X, BOOKCASE), then turned BOOKCASE_TURN degrees about its centre and set at
# BOOKCASE_AT, with the Japanese-literature print on its top and the pothos trailing over its front edge.
BOOKCASE = (2.78, 3.10, -1.24, -0.28)  # x0, x1, y0, y1 as authored
BOOKCASE_LEVELS = (0.075, 0.415, 0.755, 1.06)  # shelf tops: bottom, middle, upper, the top
BOOKCASE_TURN, BOOKCASE_AT = 65.0, Vector((2.92, -0.80, 0.0))
JP_PRINT = (Vector((2.995, -1.02, 1.06)), (0.30, 0.42), 9.0)  # base on the bookcase top (as authored), size, lean

READING_CHAIR = (Vector((2.02, -1.87, 0.0)), -122.0)  # turned toward the desk and the room
FLOOR_LAMP = Vector((3.02, -2.70, 0.0))
LANTERN = (0.19, 1.16, 0.40)  # globe radius, centre height, height
# The record corner beside the armchair, free-standing toward the open side: a low cabinet (x0, x1, y0, y1, top)
# facing the chair, the turntable on it, a small crate of records on the floor in front of it (position, turn).
RECORD_CABINET = (2.50, 2.92, -2.57, -1.95, 0.56)
RECORD_CRATE = (Vector((2.25, -2.75, 0.0)), -30.0)

DESK_TOP = 0.7325

CC0 = {
    # name: (Poly Haven id, location, z rotation in degrees, height in metres, triangle budget)
    "props_syngonium": ("potted_plant_02", (-2.88, -0.62, 0.0), 160, 0.66, 2400),
    "props_haworthia": ("potted_plant_04", (2.34, 0.345, 0.86), 30, 0.17, 3000),
    "props_tea_tin": ("oil_tin", (X_LEFT + 0.12, -3.80 + KITCHEN_SHIFT.y, 1.645), 80, 0.11, 2000),
    "props_pen_cup": ("stationery_supplies", (-0.30, 0.16, DESK_TOP), 0, None, 2500),
    "props_lounge_chair": ("mid_century_lounge_chair", (*READING_CHAIR[0].xy, 0.0), READING_CHAIR[1], 0.92, 2600),
}


def build_dressing(mats, placed):
    """Add every dressing item; returns the objects the click proxies and markers need."""
    rng = random.Random(SEED)
    found = {}
    found["credenza"] = build_credenza(mats)
    found["plaque"] = build_plaque(mats)
    before = set(bpy.data.objects)
    kitchen = build_kitchen_nook(mats)
    for obj in set(bpy.data.objects) - before:
        obj.matrix_world = Matrix.Translation(KITCHEN_SHIFT) @ obj.matrix_world
    found.update({k: (v + KITCHEN_SHIFT if isinstance(v, Vector) else v) for k, v in kitchen.items()})
    found.update(build_darkroom(mats))
    found.update(build_record_corner(mats, rng))
    found["sticky_notes"] = build_desk_clutter(rng)
    found["crt_badge"] = build_crt_badge()
    before = set(bpy.data.objects)
    found.update(build_bookcase(mats, rng))
    found["print_japanese_lit"] = build_print_japanese_lit(mats)
    build_pothos(Matrix.Translation((2.86, -0.70, BOOKCASE_LEVELS[-1])) @ Matrix.Rotation(math.radians(-90), 4, "Z"))
    turn = (Matrix.Translation(BOOKCASE_AT) @ Matrix.Rotation(math.radians(BOOKCASE_TURN), 4, "Z")
            @ Matrix.Translation(-Vector(((BOOKCASE[0] + BOOKCASE[1]) / 2, (BOOKCASE[2] + BOOKCASE[3]) / 2, 0.0))))
    for obj in set(bpy.data.objects) - before:
        obj.matrix_world = turn @ obj.matrix_world
    found.update(build_space_wall(mats))
    found["pennant"] = build_pennant()
    found["cc0"] = {name: import_cc0(name, *spec) for name, spec in CC0.items()}
    build_jacket()
    build_floor_books(rng)
    found["floor_lamp"] = build_reading_corner(mats)
    return found


# ---- helpers ----

def newsreader():
    path = fetch_cached(NEWSREADER[0], CACHE / "fonts" / "Newsreader.ttf", NEWSREADER[1])
    return bpy.data.fonts.load(str(path), check_existing=True)


def finish(builder, name, atlas="props", smooth=36.0, **extra):
    obj = builder.finish(collection("props"), smooth_angle=smooth)
    obj.name = obj.data.name = name
    obj["atlas"] = atlas
    obj["source"] = "made for this site"
    for k, v in extra.items():
        obj[k] = v
    return obj


def raycast(obj, origin, direction):
    """World-space hit on obj along a ray: (location, normal) or None."""
    inv = obj.matrix_world.inverted()
    hit, loc, normal, _ = obj.ray_cast(inv @ Vector(origin), (inv.to_3x3() @ Vector(direction)).normalized())
    if not hit:
        return None
    return obj.matrix_world @ loc, (obj.matrix_world.to_3x3().inverted().transposed() @ normal).normalized()


def place(obj, loc, rot_z_deg=0.0, rot=None):
    m = Matrix.Translation(loc) @ Matrix.Rotation(math.radians(rot_z_deg), 4, "Z")
    if rot is not None:
        m = m @ rot
    obj.matrix_world = m
    return obj


# ---- credenza and kitchen nook ----

def mid_century_cabinet(bm, x0, x1, y0, y1, top_z, leg_h, front, doors=2):
    """A walnut cabinet in bm: slab top, carcass, sliding doors with brass pulls on the `front` side (-Y, +X or -X),
    tapered splayed legs. Material slots: 0 walnut, 1 brass."""
    top_t = 0.028
    add_box(bm, (x1 - x0, y1 - y0, top_t), ((x0 + x1) / 2, (y0 + y1) / 2, top_z - top_t / 2), bevel=0.006, segments=3)
    inset = 0.02
    bx0, bx1, by0, by1 = x0 + inset, x1 - inset, y0 + inset, y1 - inset
    body_h = top_z - top_t - leg_h
    add_box(bm, (bx1 - bx0, by1 - by0, body_h), ((bx0 + bx1) / 2, (by0 + by1) / 2, leg_h + body_h / 2), bevel=0.004)
    door_h = body_h - 0.03
    if front == "-Y":
        span, base = bx1 - bx0 - 0.02, bx0 + 0.01
        for k in range(doors):
            w = span / doors
            cx = base + w * (k + 0.5)
            add_box(bm, (w - 0.004, 0.014, door_h), (cx, by0 - 0.007 - 0.008 * (k % 2), leg_h + 0.015 + door_h / 2),
                    bevel=0.003)
            px = cx + (w / 2 - 0.05) * (1 if k % 2 == 0 else -1)
            add_box(bm, (0.012, 0.006, 0.10), (px, by0 - 0.018 - 0.008 * (k % 2), leg_h + 0.015 + door_h * 0.55),
                    bevel=0.002, mat=1)
    else:
        side, face = (1, bx1) if front == "+X" else (-1, bx0)
        span, base = by1 - by0 - 0.02, by0 + 0.01
        for k in range(doors):
            w = span / doors
            cy = base + w * (k + 0.5)
            add_box(bm, (0.014, w - 0.004, door_h),
                    (face + side * (0.007 + 0.008 * (k % 2)), cy, leg_h + 0.015 + door_h / 2), bevel=0.003)
            py = cy + (w / 2 - 0.05) * (1 if k % 2 == 0 else -1)
            add_box(bm, (0.006, 0.012, 0.10), (face + side * (0.018 + 0.008 * (k % 2)), py, leg_h + 0.015 + door_h * 0.55),
                    bevel=0.002, mat=1)
    for lx in (bx0 + 0.05, bx1 - 0.05):
        for ly in (by0 + 0.05, by1 - 0.05):
            out = Vector((-0.02 if lx < (x0 + x1) / 2 else 0.02, -0.02 if ly < (y0 + y1) / 2 else 0.02, 0.0))
            foot = Vector((lx, ly, 0.0)) + out
            head = Vector((lx, ly, leg_h + 0.005))
            leg = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.011, radius2=0.017,
                                        depth=(head - foot).length)
            rot = (head - foot).to_track_quat("Z", "Y").to_matrix()
            for v in leg["verts"]:
                v.co = rot @ v.co + (head + foot) / 2
            add_cylinder(bm, 0.0115, 0.012, foot + Vector((0, 0, 0.006)), segments=10, mat=1)


def build_credenza(mats):
    """A low mid-century walnut credenza under the posters; the lava lamp stands on it alone."""
    x0, x1, y0, y1 = CREDENZA
    bm = bmesh.new()
    mid_century_cabinet(bm, x0, x1, y0, y1, CREDENZA_TOP, 0.17, "-Y", doors=3)
    obj = new_object("env_credenza", bm, "env", "env", [mats["walnut"], mats["brass"]])
    smooth_by_angle(obj, 40)
    return obj


def build_kitchen_nook(mats):
    """A short counter at the left wall's front end: walnut base cabinets with a cream stone top, a panel of glazed
    green tiles behind it, an open walnut shelf with jars and cups on brass brackets, and an enamel pendant over it.
    The espresso machine and the oven stand on the counter (build_room places them)."""
    x0, x1 = KITCHEN_AUTHORED_X, KITCHEN_AUTHORED_X + KITCHEN_DEPTH
    y0, y1 = KITCHEN_Y0, KITCHEN_Y1
    bm = bmesh.new()
    mid_century_cabinet(bm, x0, x1, y0, y1, KITCHEN_TOP - 0.03, 0.10, "+X", doors=2)
    obj = new_object("env_kitchen_counter", bm, "env", "env", [mats["walnut"], mats["brass"]])
    smooth_by_angle(obj, 40)
    obj.name = obj.data.name = "kitchen_counter"

    stone = pl.surface("counter_stone", (0.50, 0.46, 0.40), 0.35, micro_bump=(400, 0.05), grime=0.4, smudges=0.2,
                       color_var=0.08, coat=0.3)
    b = pl.Builder("env_kitchen_top")
    b.box((x1 - x0 + 0.02, y1 - y0 + 0.02, 0.03), loc=((x0 + x1) / 2 + 0.01, (y0 + y1) / 2, KITCHEN_TOP - 0.015),
          mat=stone, bevel=0.004)
    finish(b, "env_kitchen_top", atlas="env", smooth=30)

    tiles = tile_material()
    b = pl.Builder("env_kitchen_tiles")
    b.box((0.008, y1 - y0, 0.52), loc=(KITCHEN_AUTHORED_X + 0.004, (y0 + y1) / 2, KITCHEN_TOP + 0.26), mat=tiles)
    finish(b, "env_kitchen_tiles", atlas="env", smooth=20)

    walnut = mats["walnut"]
    brass = mats["brass"]
    bm = bmesh.new()
    shelf_z = 1.62
    add_box(bm, (0.22, y1 - y0 - 0.04, 0.026), (KITCHEN_AUTHORED_X + 0.11, (y0 + y1) / 2, shelf_z + 0.013), bevel=0.004)
    for y in (y0 + 0.14, y1 - 0.14):
        add_box(bm, (0.006, 0.018, 0.16), (KITCHEN_AUTHORED_X + 0.003, y, shelf_z - 0.08), mat=1)
        add_box(bm, (0.18, 0.018, 0.006), (KITCHEN_AUTHORED_X + 0.09, y, shelf_z - 0.003), mat=1)
    smooth_by_angle(new_object("env_kitchen_shelf", bm, "env", "env", [walnut, brass]), 40)

    glass = pl.surface("jar_glass", (0.62, 0.66, 0.62), 0.08, coat=0.6, color_var=0.0)
    lids = pl.surface("jar_lid", (0.55, 0.39, 0.17), 0.3, metallic=1.0, grime=0.4, color_var=0.05)
    fills = [pl.surface(f"jar_fill_{k}", rgb, 0.8, micro_bump=(900, 0.3), color_var=0.12)
             for k, rgb in enumerate([(0.12, 0.06, 0.03), (0.80, 0.77, 0.70), (0.55, 0.36, 0.14)])]
    cup = pl.surface("kitchen_cup", (0.80, 0.78, 0.72), 0.15, coat=0.5, grime=0.3, color_var=0.03)
    b = pl.Builder("props_kitchen_jars")
    top = shelf_z + 0.026
    for k, (y, h) in enumerate(((-3.20, 0.16), (-3.32, 0.13), (-3.44, 0.15))):
        loc = Vector((KITCHEN_AUTHORED_X + 0.11, y, top))
        b.lathe([(0.0, 0.0), (0.045, 0.0), (0.047, 0.006), (0.047, h - 0.01), (0.040, h), (0.0, h)], segments=20,
                loc=tuple(loc), mat=glass)
        b.lathe([(0.0, 0.0), (0.043, 0.0), (0.043, h * 0.72), (0.0, h * 0.72)], segments=16, loc=tuple(loc + Vector((0, 0, 0.004))),
                mat=fills[k])
        b.cylinder(0.042, 0.016, segments=20, loc=tuple(loc + Vector((0, 0, h + 0.008))), mat=lids, bevel=0.002)
    for k, y in enumerate((-3.62, -3.70)):
        loc = Vector((KITCHEN_AUTHORED_X + 0.10, y, top))
        b.lathe([(0.0, 0.0), (0.028, 0.0), (0.034, 0.012), (0.038, 0.075), (0.034, 0.075), (0.031, 0.012), (0.0, 0.006)],
                segments=20, loc=tuple(loc), mat=cup, cap_start=False, cap_end=False)
        b.torus(0.016, 0.004, segments=12, sides=6, loc=tuple(loc + Vector((0.0, 0.040, 0.042))), rot=(0, 90, 0), mat=cup,
                arc=math.radians(220))
    finish(b, "props_kitchen_jars", smooth=40)

    # A walnut chopping board leaning on the tiles behind the bakery board.
    wood = pl.ambientcg("Wood051")
    board = pl.surface("chopping_board", (0.40, 0.26, 0.15), 0.6, color_tex=wood["Color"], tint=(0.85, 0.62, 0.45),
                       tile=0.3, edge_wear=0.4, grime=0.5, color_var=0.08)
    b = pl.Builder("props_chopping_board")
    b.box((0.022, 0.26, 0.38), loc=(0, 0, 0.19), mat=board, corner=0.03, corner_seg=4, corner_axis="X", bevel=0.003)
    b.cylinder(0.014, 0.03, segments=12, loc=(0, 0, 0.335), rot=(0, 90, 0), mat=board)
    cb = finish(b, "props_chopping_board", smooth=30)
    place(cb, Vector((KITCHEN_AUTHORED_X + 0.07, -3.37, KITCHEN_TOP)), 0.0, rot=Matrix.Rotation(math.radians(-10), 4, "Y"))

    # The pendant: a cord from the ceiling band to a cream enamel dome with a brass cap and a bulb inside.
    enamel = pl.surface("pendant_enamel", (0.74, 0.68, 0.55), 0.3, edge_wear=0.3, edge_color=(0.2, 0.15, 0.1),
                        grime=0.4, color_var=0.04)
    cord = pl.surface("pendant_cord", (0.03, 0.025, 0.02), 0.6, color_var=0.0)
    bulb = pl.surface("pendant_bulb", (0.9, 0.8, 0.6), 0.2, emission=((1.0, 0.62, 0.30), 18.0), color_var=0.0)
    b = pl.Builder("props_kitchen_pendant")
    p = PENDANT
    b.tube([p + Vector((0, 0, 0.20)), p + Vector((0, 0, 0.73))], 0.004, sides=6, mat=cord)
    b.cylinder(0.022, 0.04, segments=16, loc=tuple(p + Vector((0, 0, 0.20))), mat=lids)
    b.lathe([(0.025, 0.19), (0.06, 0.17), (0.11, 0.11), (0.135, 0.02), (0.138, 0.0), (0.133, 0.0), (0.13, 0.02),
             (0.105, 0.105), (0.055, 0.162), (0.02, 0.18)], segments=32, loc=tuple(p), mat=enamel, cap_start=False,
            cap_end=False)
    b.lathe([(0.0, 0.07), (0.022, 0.08), (0.03, 0.11), (0.018, 0.14), (0.0, 0.145)], segments=16, loc=tuple(p), mat=bulb)
    finish(b, "props_kitchen_pendant", smooth=50)
    under_shelf = build_kitchen_detail(mats, shelf_z, glass, lids)
    return {"kitchen_counter": obj, "pendant": p + Vector((0, 0, 0.10)), "under_shelf": under_shelf}


def build_kitchen_detail(mats, shelf_z, glass, lids):
    """The mini kitchen's lived-in layer: a row of spice jars and three mugs on hooks under the shelf, a warm light
    bar under it, a pour-over and a gooseneck kettle at the counter's back end, a board of bagels and croissants
    beside the espresso machine, and a rack of cinnamon rolls cooling on the oven. Returns the light bar's centre."""
    rng = random.Random(SEED + 23)
    spices = [pl.surface(f"spice_{k}", rgb, 0.85, micro_bump=(1400, 0.4), color_var=0.10)
              for k, rgb in enumerate([(0.80, 0.50, 0.04), (0.52, 0.07, 0.03), (0.40, 0.25, 0.12), (0.36, 0.45, 0.20),
                                       (0.07, 0.06, 0.05)])]
    b = pl.Builder("props_kitchen_spices")
    top = shelf_z + 0.026
    for k in range(5):
        loc = Vector((KITCHEN_AUTHORED_X + 0.10 + rng.uniform(-0.01, 0.01), -2.86 - 0.052 * k, top))
        b.lathe([(0.0, 0.0), (0.021, 0.0), (0.022, 0.004), (0.022, 0.068), (0.018, 0.074), (0.0, 0.074)], segments=16,
                loc=tuple(loc), mat=glass)
        b.cylinder(0.0195, 0.052 - 0.006 * (k % 2), segments=14, loc=tuple(loc + Vector((0, 0, 0.004))),
                   mat=spices[k])
        b.cylinder(0.019, 0.012, segments=16, loc=tuple(loc + Vector((0, 0, 0.074))), mat=lids, bevel=0.0015)
    finish(b, "props_kitchen_spices", smooth=40)

    # Mugs on brass hooks under the shelf's front edge, hanging by their handles, mouths to the room.
    brass = mats["brass"]
    glazes = [pl.surface(f"mug_glaze_{k}", rgb, 0.18, coat=0.5, edge_wear=0.3, edge_color=(0.75, 0.70, 0.62),
                         grime=0.3, color_var=0.05)
              for k, rgb in enumerate([(0.10, 0.22, 0.30), (0.70, 0.62, 0.48), (0.42, 0.14, 0.08)])]
    b = pl.Builder("props_kitchen_mugs")
    for k, y in enumerate((-3.56, -3.68, -3.80)):
        hook = Vector((KITCHEN_AUTHORED_X + 0.19, y, shelf_z))
        b.tube([hook, hook + Vector((0, 0, -0.035)), hook + Vector((0.008, 0, -0.045)), hook + Vector((0.016, 0, -0.038))],
               0.0018, sides=6, mat=brass)
        r, mh = 0.038, 0.090
        mug = pl.Builder("probe_mug")
        mug.lathe([(0.0, 0.0), (r - 0.004, 0.0), (r, 0.006), (r, mh), (r - 0.004, mh), (r - 0.005, 0.008), (0.0, 0.008)],
                  segments=22, mat=glazes[k], cap_start=False, cap_end=False)
        mug.torus(0.022, 0.0055, segments=14, sides=6, loc=(r + 0.004, 0, mh / 2), rot=(90, 0, 0), mat=glazes[k],
                  arc=math.radians(200), )
        hang = (Matrix.Translation(hook + Vector((0.004, 0, -0.045 - (r + 0.026))))
                @ Matrix.Rotation(math.radians(-90 + rng.uniform(-6, 6)), 4, "Y")
                @ Matrix.Translation((-(r + 0.004), 0, -mh / 2)))
        verts = mug.bm.verts[:]
        bmesh.ops.transform(mug.bm, matrix=hang, verts=verts)
        me = bpy.data.meshes.new("probe_mug")
        mug.bm.to_mesh(me)
        mug.bm.free()
        b.append_mesh(me, mat=glazes[k])
        bpy.data.meshes.remove(me)
    finish(b, "props_kitchen_mugs", smooth=40)

    # The light bar under the shelf: a slim brass channel with a warm diffuser.
    diffuser = pl.surface("under_shelf_diffuser", (0.9, 0.82, 0.68), 0.4, emission=((1.0, 0.64, 0.34), 6.0),
                          color_var=0.0)
    b = pl.Builder("props_under_shelf_light")
    bar_y0, bar_y1 = -2.84, -3.86
    centre = Vector((KITCHEN_AUTHORED_X + 0.07, (bar_y0 + bar_y1) / 2, shelf_z - 0.008))
    b.box((0.026, bar_y0 - bar_y1, 0.012), loc=tuple(centre), mat=brass, bevel=0.002)
    b.box((0.018, bar_y0 - bar_y1 - 0.01, 0.002), loc=tuple(centre + Vector((0, 0, -0.0065))), mat=diffuser)
    finish(b, "props_under_shelf_light", smooth=30)

    # Pour-over at the back end: a gooseneck kettle and an hourglass carafe with a wooden collar and leather tie.
    kettle_mat = pl.surface("kettle_black", (0.03, 0.03, 0.03), 0.45, metallic=0.4, edge_wear=0.4,
                            edge_color=(0.35, 0.33, 0.30), smudges=0.3, color_var=0.02)
    oak = pl.surface("pourover_oak", (0.55, 0.40, 0.24), 0.55, color_tex=pl.ambientcg("Wood051")["Color"],
                     tint=(1.0, 0.85, 0.65), tile=0.2, color_var=0.06)
    leather = pl.surface("pourover_tie", (0.30, 0.16, 0.08), 0.7, color_var=0.05)
    coffee = pl.surface("pourover_coffee", (0.10, 0.045, 0.02), 0.15, color_var=0.0)
    b = pl.Builder("props_pour_over")
    k_at = Vector((-3.12, -2.88, KITCHEN_TOP))
    b.lathe([(0.0, 0.0), (0.072, 0.0), (0.078, 0.01), (0.076, 0.07), (0.062, 0.115), (0.03, 0.135), (0.0, 0.138)],
            segments=32, loc=tuple(k_at), mat=kettle_mat)
    b.cylinder(0.012, 0.02, segments=14, loc=tuple(k_at + Vector((0, 0, 0.135))), mat=oak)
    spout = [k_at + Vector((0.07 * math.cos(math.radians(30)), -0.07 * math.sin(math.radians(30)), 0.02))]
    for t in (0.25, 0.5, 0.75, 1.0):
        spout.append(k_at + Vector((0.08 + 0.09 * t, -0.04 - 0.02 * t, 0.02 + 0.13 * t ** 0.6)))
    b.tube(spout, 0.006, sides=10, mat=kettle_mat, radius_fn=lambda t: 0.006 * (1.0 - 0.6 * t))
    b.tube([k_at + Vector((-0.06, 0.03, 0.11)), k_at + Vector((-0.11, 0.05, 0.11)), k_at + Vector((-0.12, 0.05, 0.05)),
            k_at + Vector((-0.07, 0.03, 0.03))], 0.008, sides=8, mat=oak)
    c_at = Vector((-2.86, -2.86, KITCHEN_TOP))
    b.lathe([(0.0, 0.0), (0.060, 0.0), (0.070, 0.02), (0.068, 0.075), (0.030, 0.125), (0.026, 0.14), (0.05, 0.19),
             (0.056, 0.215), (0.052, 0.215), (0.046, 0.192), (0.022, 0.142), (0.024, 0.124), (0.062, 0.075),
             (0.064, 0.022), (0.054, 0.006), (0.0, 0.006)], segments=36, loc=tuple(c_at), mat=glass,
            cap_start=False, cap_end=False)
    b.lathe([(0.0, 0.006), (0.062, 0.006), (0.064, 0.022), (0.060, 0.050), (0.0, 0.050)], segments=28,
            loc=tuple(c_at), mat=coffee)
    b.lathe([(0.028, 0.105), (0.040, 0.112), (0.044, 0.140), (0.040, 0.165), (0.032, 0.172)], segments=24,
            loc=tuple(c_at), mat=oak, cap_start=False, cap_end=False)
    b.torus(0.042, 0.0025, segments=28, sides=5, loc=tuple(c_at + Vector((0, 0, 0.138))), mat=leather)
    finish(b, "props_pour_over", smooth=40)

    build_bakery_board(mats)
    build_cinnamon_rolls()
    return centre + Vector((0, 0, -0.012))


def bagel_material():
    """A baked bagel: glossy deep-golden crust darker on top, paler underneath, scattered sesame on the top half."""
    mat, k = pl.new_material("bagel_crust")
    normal = k.node("ShaderNodeNewGeometry").outputs["Normal"]
    up = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": normal}).outputs["Z"]
    top = k.map_range(up, -0.1, 0.7)
    obj = k.coords("Object", 1.0)
    mottle = k.noise(obj, 160.0, detail=3.0)
    crust = k.mix_color(top, (0.50, 0.30, 0.12, 1.0), (0.30, 0.13, 0.035, 1.0))
    crust = k.mix_color(k.map_range(mottle, 0.4, 0.65, 0.0, 0.35), crust, (0.28, 0.12, 0.04, 1.0))
    seeds = k.node("ShaderNodeTexVoronoi", inputs={"Vector": obj, "Scale": 260.0})
    seed = k.math("MULTIPLY", k.math("LESS_THAN", seeds.outputs["Distance"], 0.16), k.math("GREATER_THAN", up, 0.35))
    color = k.mix_color(seed, crust, (0.86, 0.76, 0.56, 1.0))
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.3, "Distance": 0.0006,
                                            "Height": k.math("ADD", mottle, k.math("MULTIPLY", seed, 0.6))})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.42, "Coat Weight": 0.3,
                                                      "Coat Roughness": 0.3, "Normal": bump.outputs[0]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs[0])
    return mat


def build_bakery_board(mats):
    """A walnut serving board flat on the counter between the espresso machine and the oven: two bagels and two
    croissants from the morning's bake."""
    wood = pl.ambientcg("Wood051")
    board_mat = pl.surface("bakery_board", (0.40, 0.26, 0.15), 0.55, color_tex=wood["Color"], tint=(0.80, 0.58, 0.42),
                           tile=0.25, edge_wear=0.4, grime=0.4, smudges=0.2, color_var=0.08)
    at = Vector((-2.92, -3.37, KITCHEN_TOP))
    b = pl.Builder("props_bakery_board")
    b.box((0.34, 0.22, 0.018), loc=(0, 0, 0.009), mat=board_mat, corner=0.02, corner_seg=4, bevel=0.003)
    crust = bagel_material()
    for (x, y), tilt in (((-0.10, 0.045), 4), ((-0.025, -0.050), -6)):
        b.torus(0.029, 0.020, segments=24, sides=10, loc=(x, y, 0.018 + 0.016), rot=(tilt, 0, 0), mat=crust)
    board = finish(b, "props_bakery_board", smooth=50)
    place(board, at, 0.0)
    props = collection("props")
    for k, ((x, y), turn) in enumerate((((0.075, 0.045), 30), ((0.095, -0.055), -150))):
        c = pl.croissant(f"props_board_croissant_{k}", props, at + Vector((x, y, 0.018)), scale=0.92)
        c.rotation_euler = (0, 0, math.radians(turn))
        c["atlas"] = "props"


def build_cinnamon_rolls():
    """Six cinnamon rolls cooling on a wire rack on top of the oven, the spiral of cinnamon showing and a little
    glaze drizzled across."""
    oven = bpy.data.objects["countertop_oven"]
    pts = [oven.matrix_world @ Vector(c) for c in oven.bound_box]
    top = max(p.z for p in pts)
    cx, cy = sum(p.x for p in pts) / 8, sum(p.y for p in pts) / 8
    steel = pl.surface("rack_steel", (0.62, 0.62, 0.60), 0.3, metallic=1.0, grime=0.4, color_var=0.0)
    dough = pl.surface("roll_dough", (0.48, 0.26, 0.09), 0.55, micro_bump=(500, 0.3), coat=0.2, subsurface=0.05,
                       color_var=0.10)
    cinnamon = pl.surface("roll_cinnamon", (0.12, 0.045, 0.015), 0.6, color_var=0.08)
    glaze = pl.surface("roll_glaze", (0.86, 0.83, 0.76), 0.25, coat=0.4, color_var=0.02)
    b = pl.Builder("props_cinnamon_rolls")
    w, d, lift = 0.28, 0.20, 0.012
    rim = [Vector((sx * w / 2, sy * d / 2, lift)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1))]
    b.tube(rim, 0.0022, sides=6, mat=steel, cap=False)
    for k in range(1, 10):
        x = -w / 2 + w * k / 10
        b.tube([Vector((x, -d / 2, lift)), Vector((x, d / 2, lift))], 0.0011, sides=5, mat=steel)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.tube([Vector((sx * (w / 2 - 0.01), sy * (d / 2 - 0.01), 0.0)), Vector((sx * (w / 2 - 0.01), sy * (d / 2 - 0.01), lift))],
                   0.0016, sides=5, mat=steel)
    rng = random.Random(SEED + 29)
    r, rh = 0.036, 0.032
    for i in range(3):
        for j in range(2):
            c = Vector((-0.085 + 0.085 * i + rng.uniform(-0.004, 0.004), -0.045 + 0.09 * j + rng.uniform(-0.004, 0.004),
                        lift + 0.002))
            b.lathe([(0.0, 0.0), (r - 0.004, 0.0), (r, 0.008), (r, 0.022), (r - 0.006, rh - 0.002), (0.0, rh)],
                    segments=20, loc=tuple(c), mat=dough)
            spiral = []
            phase = rng.uniform(0, 2 * math.pi)
            for t in range(0, 37):
                a = phase + 2 * math.pi * 2.6 * t / 36
                rr = 0.004 + (r - 0.008) * t / 36
                z = rh - 0.006 * (rr / r) ** 2 + 0.0008
                spiral.append(c + Vector((rr * math.cos(a), rr * math.sin(a), z)))
            b.tube(spiral, 0.0030, sides=5, mat=cinnamon, cap=True)
    for k in range(2):
        y = -d / 2 + 0.06 + k * 0.08
        zig = [Vector((-w / 2 + 0.03 + (w - 0.06) * t / 8, y + (0.012 if t % 2 else -0.012), lift + rh + 0.004))
               for t in range(9)]
        b.tube(zig, 0.0011, sides=5, mat=glaze)
    rolls = finish(b, "props_cinnamon_rolls", smooth=40)
    place(rolls, Vector((cx, cy, top)), 90.0 + rng.uniform(-6, 6))


def tile_material():
    """Glazed green zellige-like tiles, 7.5 cm square with cream grout, each tile a slightly different tone."""
    mat, k = pl.new_material("kitchen_tiles")
    obj = k.coords("Object")
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    on_wall = k.node("ShaderNodeCombineXYZ", inputs={"X": sep.outputs["Y"], "Y": sep.outputs["Z"]}).outputs[0]
    brick = k.node("ShaderNodeTexBrick", inputs={"Vector": on_wall, "Scale": 1.0, "Brick Width": 0.075,
                                                 "Row Height": 0.075, "Mortar Size": 0.0025, "Bias": 0.0,
                                                 "Color1": (0.12, 0.26, 0.20, 1.0), "Color2": (0.17, 0.34, 0.26, 1.0),
                                                 "Mortar": (0.70, 0.66, 0.58, 1.0)},
                   offset=0.0, squash=1.0)
    var = k.noise(on_wall, 30.0, detail=2.0)
    color = k.mix_color(k.map_range(var, 0.4, 0.6, 0.0, 0.25), brick.outputs["Color"], (0.08, 0.18, 0.14, 1.0))
    rough = k.map_range(brick.outputs["Fac"], 0.0, 1.0, 0.12, 0.8)
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.4, "Distance": 0.0015, "Height": brick.outputs["Fac"]})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": rough, "Normal": bump.outputs[0],
                                                      "Coat Weight": 0.4})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs[0])
    return mat


def build_plaque(mats):
    """'Four favourites - from Letterboxd': a brass plate engraved in Newsreader on a walnut board under the posters."""
    font = newsreader()
    brass = pl.surface("plaque_brass", (0.55, 0.39, 0.17), 0.24, metallic=1.0, edge_wear=0.4,
                       edge_color=(0.85, 0.66, 0.38), grime=0.7, smudges=0.2, scratches=0.15, color_var=0.06)
    ink = pl.surface("plaque_engraving", (0.03, 0.022, 0.014), 0.6, metallic=0.3, color_var=0.0, edge_width=0.0002)
    b = pl.Builder("poster_plaque")
    size = 0.0175
    probe = pl.Builder("probe")
    probe.text(PLAQUE_TEXT, size, mat=ink, font=font)
    xs = [v.co.x for v in probe.bm.verts]
    text_w = max(xs) - min(xs)
    probe.bm.free()
    plate_w, plate_h = text_w + 0.05, 0.05
    walnut_mat = mats["walnut"]
    # Built facing -Y (the props convention), which is the room from the back wall.
    b.box((plate_w + 0.03, 0.012, plate_h + 0.026), loc=(0, 0.006, 0), mat=walnut_mat, bevel=0.003)
    b.box((plate_w, 0.002, plate_h), loc=(0, -0.001, 0), mat=brass, bevel=0.0008, bevel_seg=1)
    for sx in (-1, 1):
        b.cylinder(0.0028, 0.0012, segments=12, loc=(sx * (plate_w / 2 - 0.009), -0.0021, 0), rot=(90, 0, 0), mat=brass)
    b.text(PLAQUE_TEXT, size, loc=(0, -0.00215, -0.002), rot=(90, 0, 0), mat=ink, font=font, resolution=2)
    obj = finish(b, "poster_plaque", smooth=30)
    place(obj, PLAQUE_CENTRE, 0.0)
    return obj


# ---- the darkroom lines ----

def left_wall(u, z, depth=0.0):
    """Wall-local (u along the left wall, positive toward the back; depth out of the wall) to world."""
    return Vector((X_LEFT + depth, u, z))


# Built facing -Y at the origin, a +90 degree turn about Z faces the room from the left wall; u then runs along +Y.
LEFT_WALL_TURN = Matrix.Rotation(math.pi / 2, 4, "Z")
PEG = (0.011, 0.009, 0.058)  # a wooden clothes peg: width, thickness, length
PEG_GRIP = 0.014  # how far the peg's jaws reach down over the print's top edge


def string_point(line, t):
    """The point at t (0-1) along a darkroom string, sagging as a parabola between its two screw eyes."""
    u0, u1, z, sag, depth = line
    return left_wall(u0 + (u1 - u0) * t, z - 4 * sag * t * (1 - t), depth)


def build_darkroom(mats):
    """The darkroom lines: three cotton strings on brass screw eyes along the left wall with a wooden peg per print
    (darkroom_line_<n>, baked), a brass strip light over them (env_darkroom_light) and an empty per peg,
    darkroom_clip_<line>_<k>, at the middle of the print's top edge where the peg grips it. Each empty faces the room
    (glTF local +Z out of the wall, +Y up) and carries the print's largest size (maxW_m, maxH_m) and its turn about
    the wall's normal (tiltDeg); the site draws each print hanging below its empty."""
    twine = pl.surface("darkroom_twine", (0.62, 0.55, 0.43), 0.9, micro_bump=(900, 0.2), color_var=0.06)
    pine = pl.surface("darkroom_peg", (0.70, 0.56, 0.38), 0.6, color_tex=pl.ambientcg("Wood051")["Color"],
                      tint=(1.0, 0.88, 0.70), tile=0.08, edge_wear=0.3, edge_color=(0.82, 0.70, 0.52), grime=0.3,
                      color_var=0.08)
    steel = pl.surface("darkroom_spring", (0.55, 0.55, 0.55), 0.35, metallic=1.0, color_var=0.0)
    brass = mats["brass"]
    lines, clips = [], []
    for n, line in enumerate(DARKROOM_LINES):
        b = pl.Builder(f"darkroom_line_{n}")
        pts = [string_point(line, k / 24) for k in range(25)]
        b.tube(pts, 0.0011, sides=5, mat=twine)
        for end in (pts[0], pts[-1]):
            b.cylinder(0.0016, abs(end.x - X_LEFT), segments=8, loc=((end.x + X_LEFT) / 2, end.y, end.z),
                       rot=(0, 90, 0), mat=brass)
            b.torus(0.005, 0.0012, segments=12, sides=5, loc=tuple(end), rot=(0, 90, 0), mat=brass)
        for k, (t, max_w, max_h, tilt) in enumerate(DARKROOM_PRINTS[n]):
            at = string_point(line, t)
            # Neighbours on one string overlap a little, so every other print hangs 3 mm further out.
            out = 0.003 * (k % 2)
            grip = at + Vector((out + 0.004, 0.0, -PEG[2] * 0.62 + PEG_GRIP))
            peg_centre = at + Vector((out + 0.006, 0.0, -PEG[2] * 0.12))
            turn = (0, 0, 90)
            b.box((PEG[0] * 0.48, PEG[1], PEG[2]), loc=tuple(peg_centre + Vector((0.0, -PEG[0] * 0.26, 0))), rot=turn,
                  mat=pine, bevel=0.0012, bevel_seg=1)
            b.box((PEG[0] * 0.48, PEG[1], PEG[2]), loc=tuple(peg_centre + Vector((0.0, PEG[0] * 0.26, 0))), rot=turn,
                  mat=pine, bevel=0.0012, bevel_seg=1)
            b.torus(0.0042, 0.0008, segments=10, sides=4, loc=tuple(peg_centre + Vector((0, 0, 0.004))), rot=(90, 0, 0),
                    mat=steel)
            hero = (n, k) == DARKROOM_HERO
            empty = bpy.data.objects.new(f"darkroom_clip_{n}_{k}", None)
            empty.empty_display_type, empty.empty_display_size = "ARROWS", 0.05
            empty.matrix_world = Matrix.Translation(grip) @ LEFT_WALL_TURN @ Matrix.Rotation(math.radians(tilt), 4, "Y")
            empty["maxW_m"], empty["maxH_m"], empty["tiltDeg"] = max_w, max_h, tilt
            if hero:
                empty["hero"] = True
            collection("markers").objects.link(empty)
            clips.append(empty)
        obj = finish(b, f"darkroom_line_{n}", atlas="art", smooth=50)
        obj["texel"] = 1.5
        lines.append(obj)

    # The strip light over the top string: a slim brass bar on two arms, lighting the prints from above.
    u0 = min(l[0] for l in DARKROOM_LINES) + 0.06
    u1 = max(l[1] for l in DARKROOM_LINES) - 0.06
    p = left_wall((u0 + u1) / 2, DARKROOM_LIGHT_Z, 0.12)
    bm = bmesh.new()
    add_cylinder(bm, 0.018, u1 - u0, p, segments=20, axis="Y")
    add_box(bm, (0.012, u1 - u0 - 0.02, 0.012), p + Vector((-0.01, 0, -0.022)))
    for du in (-(u1 - u0) * 0.3, (u1 - u0) * 0.3):
        add_box(bm, (0.12, 0.012, 0.012), Vector((X_LEFT + 0.06, p.y + du, p.z + 0.03)), bevel=0.003)
        add_cylinder(bm, 0.03, 0.012, Vector((X_LEFT + 0.006, p.y + du, p.z + 0.03)), segments=24, axis="X")
    light = new_object("env_darkroom_light", bm, "env", "art", [brass])
    smooth_by_angle(light, 50)

    bpy.context.view_layer.update()
    lo = Vector((X_LEFT, min(l[0] for l in DARKROOM_LINES) - 0.08, 0.86))
    hi = Vector((X_LEFT + 0.12, max(l[1] for l in DARKROOM_LINES) + 0.08, max(l[2] for l in DARKROOM_LINES) + 0.03))
    return {"darkroom_lines": lines, "darkroom_clips": clips, "darkroom_light": p, "darkroom_light_len": u1 - u0,
            "darkroom_bounds": (lo, hi)}


def mat_boards():
    """The mat board and its bevelled core that the framed prints share (made once)."""
    board = bpy.data.materials.get("photo_mat_board") or pl.surface("photo_mat_board", (0.78, 0.75, 0.68), 0.85,
                                                                     grime=0.3, dust=0.3, color_var=0.03)
    core = bpy.data.materials.get("photo_mat_bevel") or pl.surface("photo_mat_bevel", (0.88, 0.85, 0.77), 0.8,
                                                                    color_var=0.0)
    return board, core


def framed_picture(frame_name, art_name, size, frame_mat, mat_board, mat_core, art_material, matte=0.034,
                   moulding=0.016, depth=0.022):
    """A frame (moulding, mat with a bevelled core, backing) around a picture at the origin, facing -Y with its back
    at y = 0; returns (frame, picture). The picture is a quad with UVs 0-1, 0.5 mm in front of the mat."""
    pw, ph = size
    ow, oh = pw + 2 * (matte + moulding), ph + 2 * (matte + moulding)
    b = pl.Builder(frame_name)
    y = -depth / 2
    for (w, h), (x, z) in (((ow, moulding), (0, oh / 2 - moulding / 2)), ((ow, moulding), (0, -oh / 2 + moulding / 2)),
                           ((moulding, oh - 2 * moulding), (-ow / 2 + moulding / 2, 0)),
                           ((moulding, oh - 2 * moulding), (ow / 2 - moulding / 2, 0))):
        b.box((w, depth, h), loc=(x, y, z), mat=frame_mat, bevel=0.0015, bevel_seg=2)
    mw, mh = ow - 2 * moulding, oh - 2 * moulding
    my = -0.012
    if matte > 0:
        for (w, h), (x, z) in (((mw, matte), (0, mh / 2 - matte / 2)), ((mw, matte), (0, -mh / 2 + matte / 2)),
                               ((matte, ph), (-mw / 2 + matte / 2, 0)), ((matte, ph), (mw / 2 - matte / 2, 0))):
            b.box((w, 0.003, h), loc=(x, my, z), mat=mat_board)
        for (w, h), (x, z) in (((pw + 0.004, 0.002), (0, ph / 2 + 0.001)), ((pw + 0.004, 0.002), (0, -ph / 2 - 0.001)),
                               ((0.002, ph), (-pw / 2 - 0.001, 0)), ((0.002, ph), (pw / 2 + 0.001, 0))):
            b.box((w, 0.0032, h), loc=(x, my + 0.0002, z), mat=mat_core)
    b.box((mw, 0.002, mh), loc=(0, -0.004, 0), mat=mat_board)
    frame = finish(b, frame_name, smooth=30)

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    yp = my - 0.0005 - 0.0015
    corners = [(-pw / 2, -ph / 2), (pw / 2, -ph / 2), (pw / 2, ph / 2), (-pw / 2, ph / 2)]
    face = bm.faces.new([bm.verts.new((x, yp, z)) for x, z in corners])
    for loop, coord in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = coord
    bm.normal_update()
    if face.normal.y > 0:
        face.normal_flip()
        for loop, coord in zip(face.loops, ((0, 0), (0, 1), (1, 1), (1, 0))):
            loop[uv].uv = coord
    art = new_object(art_name, bm, "props", "props", [art_material])
    return frame, art


# ---- shelves ----

BOOK_CLOTH = ["#5B1F1B", "#22304A", "#2E3B2A", "#8A6A2E", "#C9BC9C", "#201C1A", "#7A3A22", "#5E6E7A", "#3E2A3C",
              "#A2875A", "#6B2E2A", "#2F4A48"]


def book_materials():
    mats = []
    for i, hexc in enumerate(BOOK_CLOTH):
        h = hexc.lstrip("#")
        rgb = tuple(((int(h[j:j + 2], 16) / 255) ** 2.2) for j in (0, 2, 4))
        mats.append(pl.surface(f"book_cloth_{i}", rgb, 0.7, color_tex=pl.ambientcg("Fabric036")["Color"], tint=rgb,
                               tile=0.06, edge_wear=0.6, edge_color=tuple(min(1, c * 1.6 + 0.05) for c in rgb),
                               dust=0.8, grime=0.5, color_var=0.06))
    return mats


def add_book(b, mats, pages, gilt, rng, x, y_front, z, thick, height, depth, lean_deg=0.0, flat=False):
    """A standing hardback: cloth case, the page block showing at the top, two gilt bands on half of the spines."""
    mat = rng.choice(mats)
    rot = (0, lean_deg, 0) if not flat else (0, 90, rng.uniform(-6, 6))
    pivot = Vector((x, y_front + depth / 2, z))
    local = Matrix.Translation(pivot) @ pl.xform(rot=rot)
    faces = b.box((thick, depth, height), loc=(0, 0, height / 2), mat=mat, bevel=0.0012, bevel_seg=1)
    faces += b.box((thick - 0.004, depth - 0.006, 0.003), loc=(0, 0.002, height - 0.0005), mat=pages)
    if rng.random() < 0.5:
        for zb in (0.18, 0.86):
            faces += b.box((thick + 0.0004, 0.0006, 0.004), loc=(0, -depth / 2 - 0.0002, height * zb), mat=gilt)
    verts = list({v for f in faces for v in f.verts})
    bmesh.ops.transform(b.bm, matrix=local, verts=verts)


# ---- record corner ----

SLEEVES = ["#D8CDB5", "#1C1A18", "#7E2F24", "#B9A27A", "#2A3B4C", "#556B4E"]
# The turntable in its own frame (front -Y, origin at the plinth's base centre): plinth, the spindle, the tonearm's
# pivot, the arm's length to the stylus and the record's outer and inner grooves (radii).
DECK = (0.44, 0.34, 0.096)
SPINDLE = Vector((-0.065, 0.0))
ARM_PIVOT = Vector((0.152, 0.092))
ARM_LENGTH, ARM_HEIGHT = 0.222, 0.138
GROOVES = (0.146, 0.060)
SLEEVE = 0.312


def build_record_corner(mats, rng):
    """The record corner beside the armchair: a low walnut cabinet facing the chair, a walnut
    turntable on it (record_player, baked) with its platter and record (platter, turns about the spindle) and its
    tonearm (tonearm, swings about its base), and a small pine crate of records on the floor whose six sleeve fronts
    are runtime art (record_sleeve_<i>, like the posters)."""
    x0, x1, y0, y1, top = RECORD_CABINET
    bm = bmesh.new()
    mid_century_cabinet(bm, x0, x1, y0, y1, top, 0.16, "-X", doors=2)
    cabinet = new_object("env_record_cabinet", bm, "env", "env", [mats["walnut"], mats["brass"]])
    smooth_by_angle(cabinet, 40)

    walnut = mats["walnut"]
    deck = pl.surface("turntable_deck", (0.035, 0.033, 0.03), 0.42, edge_wear=0.25, edge_color=(0.25, 0.24, 0.22),
                      dust=0.35, smudges=0.3, color_var=0.02)
    alu = pl.surface("turntable_alu", (0.70, 0.70, 0.68), 0.28, metallic=1.0, scratches=0.3, smudges=0.2, color_var=0.0)
    rubber = pl.surface("turntable_rubber", (0.02, 0.02, 0.02), 0.85, dust=0.4, color_var=0.0)
    w, d, h = DECK
    b = pl.Builder("record_player")
    b.box((w, d, h - 0.026), loc=(0, 0, 0.022 + (h - 0.026) / 2), mat=walnut, bevel=0.005)
    b.box((w - 0.012, d - 0.012, 0.006), loc=(0, 0, h - 0.004), mat=deck, bevel=0.0015)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cylinder(0.024, 0.022, segments=20, loc=(sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), 0.0), mat=rubber,
                       bevel=0.002)
    base = ARM_PIVOT
    b.cylinder(0.030, 0.012, segments=28, loc=(base.x, base.y, h), mat=alu, bevel=0.0015)
    b.cylinder(0.011, ARM_HEIGHT - h - 0.012, segments=16, loc=(base.x, base.y, h + 0.006), mat=alu)
    rest = base + Vector((0.0, -0.170))
    b.cylinder(0.005, ARM_HEIGHT - h - 0.008, segments=10, loc=(rest.x, rest.y, h), mat=alu)
    b.box((0.022, 0.010, 0.006), loc=(rest.x, rest.y, ARM_HEIGHT - 0.008), mat=rubber, bevel=0.0015)
    b.cylinder(0.005, 0.03, segments=10, loc=(base.x + 0.045, base.y - 0.04, h), mat=alu)
    b.cylinder(0.016, 0.014, segments=24, loc=(-w / 2 + 0.045, -d / 2 + 0.045, h), mat=alu, bevel=0.002)
    b.cylinder(0.009, 0.006, segments=16, loc=(0.060, -d / 2 + 0.028, h), mat=alu, bevel=0.0015)
    b.cylinder(0.009, 0.006, segments=16, loc=(0.085, -d / 2 + 0.028, h), mat=deck, bevel=0.0015)
    player = finish(b, "record_player", smooth=34)
    at = Vector(((x0 + x1) / 2 + 0.01, (y0 + y1) / 2 + 0.06, top))
    turn = Matrix.Translation(at) @ RIGHT_WALL_TURN
    player.matrix_world = turn
    player["texel"] = 2.4

    platter_mat = pl.surface("turntable_platter", (0.66, 0.66, 0.64), 0.22, metallic=1.0, scratches=0.25,
                             color_var=0.0)
    mat_felt = pl.surface("turntable_mat", (0.06, 0.055, 0.05), 0.95, micro_bump=(700, 0.1), dust=0.3, color_var=0.02)
    vinyl = vinyl_material()
    label = pl.surface("record_label", (0.62, 0.16, 0.08), 0.6, color_tex=pl.ambientcg("Paper001")["Color"],
                       tint=(0.75, 0.25, 0.14), tile=0.15, color_var=0.04)
    b = pl.Builder("platter")
    b.cylinder(0.150, 0.020, segments=48, loc=(0, 0, 0.0), mat=platter_mat, bevel=0.002)
    b.cylinder(0.146, 0.003, segments=48, loc=(0, 0, 0.020), mat=mat_felt)
    b.lathe([(0.0035, 0.023), (0.1515, 0.023), (0.1520, 0.0242), (0.1515, 0.025), (0.0035, 0.025)], segments=48,
            mat=vinyl, cap_start=False, cap_end=False)
    b.cylinder(0.050, 0.0006, segments=32, loc=(0, 0, 0.025), mat=label)
    b.cylinder(0.0036, 0.016, segments=12, loc=(0, 0, 0.022), mat=alu)
    platter = finish(b, "platter", smooth=40)
    platter.matrix_world = turn @ Matrix.Translation((SPINDLE.x, SPINDLE.y, h))
    platter["turn_axis"] = "+Y"
    platter["rpm"] = 33.333

    b = pl.Builder("tonearm")
    tube_end = Vector((0.0, -ARM_LENGTH + 0.040))
    b.tube([Vector((0, 0.020, 0)), Vector((0, tube_end.y, 0))], 0.0042, sides=12, mat=alu)
    b.cylinder(0.009, 0.026, segments=16, loc=(-0.013, 0, 0), rot=(0, 90, 0), mat=alu)
    b.cylinder(0.017, 0.030, segments=24, loc=(0, 0.063, 0), rot=(90, 0, 0), mat=alu, bevel=0.002)
    head_dir = Vector((-math.sin(math.radians(22)), -math.cos(math.radians(22)), 0))
    head_c = tube_end.to_3d() + head_dir * 0.022
    b.box((0.017, 0.044, 0.004), loc=tuple(head_c), rot=(0, 0, -22), mat=deck, bevel=0.001)
    b.box((0.010, 0.018, 0.010), loc=tuple(head_c + head_dir * 0.006 + Vector((0, 0, -0.007))), rot=(0, 0, -22),
          mat=rubber, bevel=0.001)
    b.box((0.006, 0.012, 0.002), loc=tuple(head_c + head_dir * 0.028 + Vector((0.004, 0, 0.0))), rot=(0, 0, -22),
          mat=alu)
    arm = finish(b, "tonearm", smooth=40)
    arm.matrix_world = turn @ Matrix.Translation((base.x, base.y, ARM_HEIGHT))
    stylus = (head_c + head_dir * 0.006).xy
    arm["turn_axis"] = "+Y"
    arm["rest_angle_deg"] = 0.0
    arm["play_angle_deg"] = round(arm_angle_for(stylus, GROOVES[0]), 2)
    arm["end_angle_deg"] = round(arm_angle_for(stylus, GROOVES[1]), 2)

    crate, sleeves = build_record_crate(rng)
    return {"record_player": player, "platter": platter, "tonearm": arm, "record_crate": crate,
            "record_sleeves": sleeves, "record_cabinet": cabinet}


def arm_angle_for(stylus: Vector, radius: float) -> float:
    """The tonearm's turn (degrees about up, counterclockwise from above) that first puts the stylus on the groove at
    `radius` from the spindle as the arm swings in from its rest; swinging in is clockwise here, so it is negative."""
    centre = SPINDLE - ARM_PIVOT
    for k in range(0, 9001):
        ang = -math.radians(k / 100.0)
        tip = Vector((stylus.x * math.cos(ang) - stylus.y * math.sin(ang),
                      stylus.x * math.sin(ang) + stylus.y * math.cos(ang)))
        if (tip - centre).length <= radius:
            return math.degrees(ang)
    raise ValueError(f"tonearm cannot reach the groove at {radius} m")


def vinyl_material():
    """Black vinyl: fine concentric grooves catching the light in rings, a glossier run-out near the label."""
    mat, k = pl.new_material("record_vinyl")
    obj = k.coords("Object")
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    r = k.math("SQRT", k.math("ADD", k.math("MULTIPLY", sep.outputs["X"], sep.outputs["X"]),
                              k.math("MULTIPLY", sep.outputs["Y"], sep.outputs["Y"])))
    grooves = k.math("SINE", k.math("MULTIPLY", r, 2 * math.pi * 1200))
    bands = k.map_range(k.noise(k.node("ShaderNodeCombineXYZ", inputs={"X": k.math("MULTIPLY", r, 40.0)}).outputs[0],
                                3.0, detail=1.0), 0.45, 0.55, 0.25, 0.5)
    rough = k.math("ADD", bands, k.math("MULTIPLY", grooves, 0.05))
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.15, "Distance": 0.0002, "Height": grooves})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": (0.012, 0.012, 0.013, 1.0), "Roughness": rough,
                                                      "Normal": bump.outputs[0], "Coat Weight": 0.2})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs[0])
    return mat


def build_record_crate(rng):
    """A slatted pine crate of six LPs on the floor in front of the cabinet, sleeves leaning back in steps: the crate
    and the records' edges are baked; each sleeve's front is its own quad (record_sleeve_<i>, UVs 0-1 over the cover,
    the light baked on white paper) for the site to draw a cover on."""
    wood = pl.ambientcg("Wood051")
    pine = pl.surface("crate_pine", (0.42, 0.30, 0.18), 0.7, color_tex=wood["Color"], tint=(0.95, 0.75, 0.55),
                      tile=0.35, edge_wear=0.5, edge_color=(0.55, 0.42, 0.28), dust=0.7, grime=0.6, color_var=0.12)
    card = pl.surface("lp_sleeve_card", (0.72, 0.68, 0.60), 0.8, color_tex=pl.ambientcg("Paper001")["Color"],
                      tint=(0.92, 0.88, 0.80), tile=0.25, edge_wear=0.8, edge_color=(0.80, 0.76, 0.68), dust=0.6,
                      color_var=0.08)
    w, d, h = 0.36, 0.30, 0.25
    b = pl.Builder("record_crate")
    for sx in (-1, 1):
        for k in range(3):
            b.box((0.014, d, 0.064), loc=(sx * (w / 2 - 0.007), 0, 0.02 + 0.042 + k * 0.080), mat=pine, bevel=0.002)
    for sy in (-1, 1):
        for k in range(3):
            b.box((w - 0.028, 0.014, 0.064), loc=(0, sy * (d / 2 - 0.007), 0.02 + 0.042 + k * 0.080), mat=pine,
                  bevel=0.002)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.03, 0.03, h), loc=(sx * (w / 2 - 0.03), sy * (d / 2 - 0.03), h / 2), mat=pine, bevel=0.002)
    b.box((w - 0.03, d - 0.03, 0.012), loc=(0, 0, 0.026), mat=pine)
    poses = []
    for i in range(len(SLEEVES)):
        y = -d / 2 + 0.045 + i * 0.036
        lean = 14 - i * 1.2 + rng.uniform(-1.5, 1.5)
        lift = 0.036 + 0.004 * i
        spin = rng.uniform(-1.5, 1.5)
        m = Matrix.Translation((rng.uniform(-0.006, 0.006), y, lift)) @ pl.xform(rot=(-lean, 0, spin))
        faces = b.box((SLEEVE, 0.0035, SLEEVE), loc=(0, 0, SLEEVE / 2), mat=card, bevel=0.0008, bevel_seg=1)
        bmesh.ops.transform(b.bm, matrix=m, verts=list({v for f in faces for v in f.verts}))
        poses.append(m)
    crate = finish(b, "record_crate", smooth=30)
    at, turn_deg = RECORD_CRATE
    place(crate, at, turn_deg)
    crate["texel"] = 1.6

    sleeves = []
    for i, m in enumerate(poses):
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        s2 = SLEEVE / 2
        y_front = -0.0018 - 0.0004
        face = bm.faces.new([bm.verts.new((x, y_front, z)) for x, z in ((-s2, 0), (s2, 0), (s2, SLEEVE), (-s2, SLEEVE))])
        for loop, coord in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = coord
        bm.normal_update()
        if face.normal.y > 0:
            face.normal_flip()
            for loop, coord in zip(face.loops, ((0, 0), (0, 1), (1, 1), (1, 0))):
                loop[uv].uv = coord
        obj = new_object(f"record_sleeve_{i}", bm, "props", "props", [sleeve_material(i)])
        obj.matrix_world = crate.matrix_world @ m
        obj["runtime_art"] = "sleeve"
        obj["sleeve_slot"] = i
        obj["width_m"] = obj["height_m"] = SLEEVE
        obj["aspect"] = 1.0
        sleeves.append(obj)
    return crate, sleeves


def sleeve_material(i):
    """A sleeve's front for the stills (a plain coloured card), white paper while bake.py bakes the light on it."""
    mat, k = pl.new_material(f"record_sleeve_{i}")
    hexc = SLEEVES[i].lstrip("#")
    rgb = tuple((int(hexc[j:j + 2], 16) / 255) ** 2.2 for j in (0, 2, 4))
    paper = k.image(pl.ambientcg("Paper001")["Color"], k.coords("Object", 4.0))
    color = k.mix_color(1.0, paper.outputs["Color"], rgb + (1.0,), blend="MULTIPLY")
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.7})
    white = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": (0.8, 0.8, 0.8, 1.0), "Roughness": 0.9})
    probe = k.node("ShaderNodeValue", name="light_probe", label="light_probe")
    probe.outputs[0].default_value = 0.0
    mix = k.node("ShaderNodeMixShader", inputs={"Fac": probe.outputs[0], "Shader": bsdf.outputs[0],
                                                "Shader_001": white.outputs[0]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", mix.outputs[0])
    return mat


# ---- desk clutter ----

def build_desk_clutter(rng):
    paper = pl.surface("notebook_paper", (0.70, 0.66, 0.56), 0.85, grime=0.3, color_var=0.03)
    ink_pages = notebook_page_material()
    cover = pl.surface("notebook_cover", (0.02, 0.018, 0.016), 0.6, edge_wear=0.6, edge_color=(0.12, 0.10, 0.08),
                       color_var=0.03)
    pen_body = pl.surface("pen_body", (0.015, 0.014, 0.013), 0.25, smudges=0.4, color_var=0.0)
    pen_metal = pl.surface("pen_metal", (0.62, 0.45, 0.18), 0.25, metallic=1.0, color_var=0.0)

    # An open notebook in the lamp's pool, a fountain pen across it.
    b = pl.Builder("desk_notebook")
    pw, ph = 0.105, 0.150
    for side in (-1, 1):
        b.box((pw, ph, 0.004), loc=(side * (pw / 2 + 0.002), 0, 0.002), mat=cover, bevel=0.001, bevel_seg=1)
        prof = []
        for k in range(7):
            t = k / 6
            prof.append(t)
        bm_faces = b.box((pw - 0.004, ph - 0.006, 0.006), loc=(side * (pw / 2 + 0.001), 0, 0.007), mat=paper)
        top = [f for f in bm_faces if f.normal.z > 0.9]
        for f in top:
            f.material_index = b.slot(ink_pages)
        for v in {v for f in bm_faces for v in f.verts}:
            gutter = 1.0 - min(abs(v.co.x) / pw, 1.0)
            v.co.z += 0.004 * gutter ** 2 if v.co.z > 0.006 else 0.0
    b.cylinder(0.0045, 0.135, segments=12, loc=(-0.06, -0.02, 0.016), rot=(0, 90, 18), mat=pen_body)
    b.box((0.04, 0.0025, 0.0018), loc=(0.0, -0.0275, 0.0205), rot=(0, 0, 18), mat=pen_metal)
    notebook = finish(b, "desk_notebook", atlas="desk", smooth=40)
    place(notebook, Vector((-0.40, -0.30, DESK_TOP + 0.0005)), -9.0)
    build_headphones()
    return build_sticky_notes()


# Where the three notes go on the CRT bezel (raycast from the front).
STICKY_BEZEL = [((0.197, 1.215), -6.0), ((0.196, 1.12), 4.0), ((-0.197, 1.19), 3.0)]
STICKY_SIZE = 0.064
STICKY_PAPER = ["#E8C547", "#E8C547", "#E3A6A0"]


def build_sticky_notes():
    """sticky_note_0..2 on the CRT's bezel: square paper notes with a slight curl at the free end, UVs 0-1 over the
    note, unbaked like the art (the light on them is baked on white paper; the site draws the paper and the note).
    Extras give the paper colour the stills use."""
    crt = bpy.data.objects.get("desk_crt")
    spots = []
    for (x, z), tilt in STICKY_BEZEL:
        hit = raycast(crt, (x, -1.0, z), (0, 1, 0)) if crt else None
        point, normal = hit if hit else (Vector((x, -0.16, z)), Vector((0, -1, 0)))
        spots.append((point, normal, tilt))
    notes = []
    for i, (point, normal, tilt) in enumerate(spots):
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        n, s_ = 4, STICKY_SIZE
        grid = [[bm.verts.new(((u / n - 0.5) * s_, (v / n - 0.5) * s_, 0.0012 + 0.006 * max(0.0, 0.5 - v / n) ** 2 * 4))
                 for v in range(n + 1)] for u in range(n + 1)]
        for u in range(n):
            for v in range(n):
                face = bm.faces.new((grid[u][v], grid[u + 1][v], grid[u + 1][v + 1], grid[u][v + 1]))
                for loop, (du, dv) in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                    loop[uv].uv = ((u + du) / n, (v + dv) / n)
        orient = normal.to_track_quat("Z", "Y").to_matrix().to_4x4()
        bm.transform(Matrix.Translation(point) @ orient @ pl.xform(rot=(0, 0, tilt)))
        bm.normal_update()
        obj = new_object(f"sticky_note_{i}", bm, "desk", "desk", [sticky_material(i)])
        obj["runtime_art"] = "sticky"
        obj["width_m"] = obj["height_m"] = STICKY_SIZE
        obj["aspect"] = 1.0
        obj["paper"] = STICKY_PAPER[i]
        obj["where"] = "monitor bezel"
        notes.append(obj)
    return notes


def build_crt_badge():
    """crt_badge: a thin plate on the CRT bezel's chin, under the glass, where Henry's monitor has its maker's name.
    A plain ivory plate with a brass rim stands in until T72's badge (the wordmark and the spool mark) replaces it."""
    crt = bpy.data.objects.get("desk_crt")
    (origin, (w, h)) = CRT_BADGE
    hit = raycast(crt, origin, (0, 1, 0)) if crt else None
    point, normal = hit if hit else (Vector((origin.x, -0.155, origin.z)), Vector((0, -1, 0)))
    plate = pl.surface("crt_badge_plate", (0.70, 0.66, 0.57), 0.35, edge_wear=0.3, color_var=0.02)
    rim = pl.surface("crt_badge_rim", (0.55, 0.39, 0.17), 0.3, metallic=1.0, color_var=0.0)
    b = pl.Builder("crt_badge")
    b.box((w + 0.003, 0.0012, h + 0.003), loc=(0, -0.0006, 0), mat=rim, bevel=0.0005, bevel_seg=1)
    b.box((w, 0.0014, h), loc=(0, -0.0010, 0), mat=plate, bevel=0.0004, bevel_seg=1)
    obj = finish(b, "crt_badge", atlas="desk", smooth=30)
    obj.matrix_world = Matrix.Translation(point + normal * 0.0008) @ (-normal).to_track_quat("Y", "Z").to_matrix().to_4x4()
    obj["width_m"], obj["height_m"] = w, h
    return obj


def hex_linear(hexc):
    h = hexc.lstrip("#")
    return tuple(((int(h[j:j + 2], 16) / 255) ** 2.2) for j in (0, 2, 4))


def sticky_material(i):
    """Paper in the note's colour (the stills write the brief's two phrases on notes 0 and 1), switched to white
    paper while bake.py bakes the light on it."""
    mat, k = pl.new_material(f"sticky_note_{i}")
    paper = hex_linear(STICKY_PAPER[i]) + (1.0,)
    image = ART / f"sticky_note_{i}.png"
    if image.exists():
        tex = k.node("ShaderNodeTexImage", image=pl.load_image(str(image)), interpolation="Linear")
        k.set(tex, "Vector", k.node("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"])
        color = k.mix_color(1.0, paper, tex.outputs["Color"], blend="MULTIPLY")
    else:
        color = paper
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.8})
    white = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": (0.8, 0.8, 0.8, 1.0), "Roughness": 0.9})
    probe = k.node("ShaderNodeValue", name="light_probe", label="light_probe")
    probe.outputs[0].default_value = 0.0
    mix = k.node("ShaderNodeMixShader", inputs={"Fac": probe.outputs[0], "Shader": bsdf.outputs[0],
                                                "Shader_001": white.outputs[0]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", mix.outputs[0])
    return mat


def scribble_lines(b, mat, rng, w, h, lift):
    """Three handwritten-looking strokes: thin wavy strips just above a note."""
    faces = []
    for row in range(3):
        y = h / 2 - (row + 1) * h / 4
        length = w * rng.uniform(0.55, 0.9)
        pts = []
        for k in range(12):
            t = k / 11
            pts.append(Vector((-w / 2 + 0.006 + length * t, y + 0.0015 * math.sin(t * 19 + row), lift)))
        bm = b.bm
        before = set(bm.faces)
        verts = [(bm.verts.new(p + Vector((0, -0.0006, 0))), bm.verts.new(p + Vector((0, 0.0006, 0)))) for p in pts]
        for (a0, a1), (b0, b1) in zip(verts, verts[1:]):
            bm.faces.new((a0, b0, b1, a1))
        faces += b._wrap(before, None, mat)
    return faces


def notebook_page_material():
    """Ruled cream paper with lines of handwriting: wavy dark strokes along the rules, broken into words."""
    mat, k = pl.new_material("notebook_page")
    obj = k.coords("Object")
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    rule = k.math("FRACT", k.math("DIVIDE", sep.outputs["Y"], 0.0065))
    rules = k.map_range(k.math("ABSOLUTE", k.math("SUBTRACT", rule, 0.5)), 0.47, 0.5)
    wobble = k.math("MULTIPLY", k.noise(k.coords("Object", 220.0), 1.0, detail=2.0), 0.9)
    stroke_band = k.map_range(k.math("ABSOLUTE", k.math("SUBTRACT", k.math("ADD", rule, k.math("SUBTRACT", wobble, 0.45)), 0.35)),
                              0.10, 0.03)
    words = k.map_range(k.noise(k.node("ShaderNodeMapping", inputs={"Vector": obj, "Scale": (60.0, 300.0, 60.0)}).outputs[0],
                                1.0, detail=0.0), 0.42, 0.50)
    written = k.math("MULTIPLY", stroke_band, words)
    margin = k.map_range(k.math("ABSOLUTE", sep.outputs["X"]), 0.012, 0.016)
    written = k.math("MULTIPLY", written, margin)
    color = k.mix_color(k.math("MULTIPLY", rules, 0.35), (0.72, 0.68, 0.58, 1.0), (0.42, 0.52, 0.62, 1.0))
    color = k.mix_color(written, color, (0.05, 0.06, 0.12, 1.0))
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.85})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs[0])
    return mat


def build_headphones():
    """Closed-back headphones put down on the desk: padded band, two cups on swivel yokes, a coiled cable."""
    shell = pl.surface("headphone_shell", (0.02, 0.019, 0.018), 0.38, smudges=0.4, edge_wear=0.4,
                       edge_color=(0.10, 0.09, 0.08), dust=0.4, color_var=0.03)
    pad = pl.surface("headphone_pad", (0.03, 0.025, 0.022), 0.65, micro_bump=(900, 0.4), color_var=0.04)
    metal = pl.surface("headphone_metal", (0.55, 0.55, 0.54), 0.3, metallic=1.0, scratches=0.3, color_var=0.02)
    b = pl.Builder("desk_headphones")
    r_band = 0.085
    band = []
    for k in range(17):
        a = math.radians(-80 + 160 * k / 16)
        band.append(Vector((r_band * math.sin(a), -r_band * math.cos(a) + 0.02, 0.012)))
    b.tube(band, 0.011, sides=8, mat=pad)
    b.tube([p + Vector((0, 0.004, 0.008)) for p in band], 0.004, sides=6, mat=metal)
    for side in (-1, 1):
        end = band[0] if side < 0 else band[-1]
        cup = end + Vector((side * 0.012, 0.035, 0.0))
        b.cylinder(0.046, 0.032, segments=28, loc=tuple(cup + Vector((0, 0, -0.004))), mat=shell, bevel=0.006)
        b.torus(0.033, 0.011, segments=24, sides=8, loc=tuple(cup + Vector((0, 0, 0.033))), mat=pad)
        b.box((0.006, 0.05, 0.012), loc=tuple(cup + Vector((-side * 0.045, -0.02, 0.016))), mat=metal, bevel=0.002)
    cable = [band[-1] + Vector((0.02, 0.06, -0.006))]
    for k in range(1, 30):
        t = k / 29
        cable.append(cable[0] + Vector((0.11 * t + 0.008 * math.cos(t * 40), 0.06 * t * t + 0.008 * math.sin(t * 40),
                                        -0.002)))
    b.tube(cable, 0.0022, sides=5, mat=shell)
    obj = finish(b, "desk_headphones", atlas="desk", smooth=40)
    place(obj, Vector((0.37, -0.14, DESK_TOP)), -28.0)
    return obj


# ---- the research corner: bookcase, space wall, Japanese-literature print; the pennant ----

# Built facing -Y at the origin, a -90 degree turn about Z faces the room from the right return wall; local +X then
# runs along -Y, the viewer's right.
RIGHT_WALL_TURN = Matrix.Rotation(-math.pi / 2, 4, "Z")


def build_bookcase(mats, rng):
    """A low walnut bookcase against the right return wall: the six books of the brief stand together on the middle
    shelf (each its own node, book_spine_<slug>, typographic spine and cover baked), other books and a flat stack fill
    the rest, a brass bookend holds the six."""
    x0, x1, y0, y1 = BOOKCASE
    walnut = mats["walnut"]
    t = 0.022
    height = BOOKCASE_LEVELS[-1]
    bm = bmesh.new()
    for y in (y0 + t / 2, y1 - t / 2):
        add_box(bm, (x1 - x0, t, height - t), ((x0 + x1) / 2, y, (height - t) / 2), bevel=0.002)
    add_box(bm, (x1 - x0 + 0.012, y1 - y0 + 0.012, t), ((x0 + x1) / 2 - 0.006, (y0 + y1) / 2, height - t / 2),
            bevel=0.004)
    for z in BOOKCASE_LEVELS[:-1]:
        add_box(bm, (x1 - x0 - 0.012, y1 - y0 - 2 * t, 0.02), ((x0 + x1) / 2 + 0.006, (y0 + y1) / 2, z - 0.01))
    add_box(bm, (0.018, y1 - y0 - 2 * t, BOOKCASE_LEVELS[0] - 0.02), (x0 + 0.03, (y0 + y1) / 2, (BOOKCASE_LEVELS[0] - 0.02) / 2))
    add_box(bm, (0.006, y1 - y0 - 2 * t, height - t), (x1 - 0.003, (y0 + y1) / 2, (height - t) / 2))
    obj = new_object("bookshelf", bm, "props", "props", [walnut])
    smooth_by_angle(obj, 40)

    featured = build_featured_books(Vector((x0 + 0.006, y1 - t - 0.03, BOOKCASE_LEVELS[1])))
    # Brass bookend after the six, then filler on the other shelves.
    brass = pl.surface("bookend_brass", (0.55, 0.39, 0.17), 0.25, metallic=1.0, grime=0.5, edge_wear=0.3,
                       edge_color=(0.85, 0.66, 0.38), color_var=0.05)
    end_y = min(o.matrix_world.translation.y for o in featured) - 0.05
    b = pl.Builder("props_bookend")
    b.box((0.13, 0.004, 0.15), loc=(0, 0, 0.075), mat=brass, bevel=0.001)
    b.box((0.13, 0.08, 0.004), loc=(0, 0.04, 0.002), mat=brass, bevel=0.001)
    bookend = finish(b, "props_bookend", smooth=30)
    place(bookend, Vector((x0 + 0.09, end_y, BOOKCASE_LEVELS[1])), 0.0)

    mats_cloth = book_materials()
    pages = pl.surface("bookcase_pages", (0.62, 0.57, 0.46), 0.85, grime=0.5, dust=0.6, color_var=0.06)
    gilt = bpy.data.materials.get("book_gilt") or pl.surface("book_gilt", (0.62, 0.45, 0.18), 0.3, metallic=1.0,
                                                               color_var=0.05)
    b = pl.Builder("props_bookcase_books")
    # Lower shelf: a full row standing; upper shelf: a shorter row and a flat stack; middle shelf: a flat stack
    # beyond the bookend.
    for level, (ya, yb) in ((0, (y1 - t - 0.01, y0 + t + 0.30)), (2, (y1 - t - 0.01, y0 + t + 0.36))):
        y = ya
        while y > yb:
            thick = rng.uniform(0.018, 0.04)
            add_book_x(b, mats_cloth, pages, gilt, rng, x0 + 0.02, y - thick / 2, BOOKCASE_LEVELS[level], thick,
                       rng.uniform(0.19, 0.27), rng.uniform(0.15, 0.2))
            y -= thick + 0.0015
    for level, yc in ((0, y0 + t + 0.16), (1, end_y - 0.16), (2, y0 + t + 0.17)):
        z = BOOKCASE_LEVELS[level]
        for k in range(rng.randint(2, 4)):
            thick = rng.uniform(0.022, 0.04)
            add_book_x(b, mats_cloth, pages, gilt, rng, x0 + 0.03, yc, z, thick, rng.uniform(0.2, 0.26),
                       rng.uniform(0.15, 0.19), flat=True)
            z += thick
    finish(b, "props_bookcase_books", smooth=30)
    return {"bookshelf": obj, "books": featured}


def add_book_x(b, mats, pages, gilt, rng, x_front, y, z, thick, height, depth, flat=False):
    """A filler book in the bookcase, spine facing the room (-X)."""
    mat = rng.choice(mats)
    faces = b.box((depth, thick, height), loc=(depth / 2, 0, height / 2), mat=mat, bevel=0.0012, bevel_seg=1)
    faces += b.box((depth - 0.006, thick - 0.004, 0.003), loc=(depth / 2 + 0.002, 0, height - 0.0005), mat=pages)
    if rng.random() < 0.4:
        for zb in (0.16, 0.86):
            faces += b.box((0.0006, thick + 0.0004, 0.004), loc=(-0.0002, 0, height * zb), mat=gilt)
    m = Matrix.Translation((x_front, y, z))
    if flat:
        m = m @ Matrix.Translation((0, 0, thick / 2)) @ Matrix.Rotation(math.radians(rng.uniform(-5, 5)), 4, "Z") \
            @ Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Translation((0, 0, -height / 2))
    bmesh.ops.transform(b.bm, matrix=m, verts=list({v for f in faces for v in f.verts}))


def build_featured_books(start: Vector):
    """The six books standing side by side from `start` toward -Y, spines out: a case per book with its spine image
    on the -X face, its front cover on the -Y face and the page block on top, each book its own node."""
    import json
    books = json.loads((ART / "books.json").read_text())
    order = ["the-elegant-universe", "1q84", "kafka-on-the-shore", "the-wind-up-bird-chronicle", "kitchen",
             "on-earth-were-briefly-gorgeous"]
    by_slug = {bk["slug"]: bk for bk in books}
    pages = pl.surface("featured_pages", (0.70, 0.65, 0.54), 0.85, grime=0.4, dust=0.4, color_var=0.04)
    y = start.y
    objs = []
    for k, slug in enumerate(order):
        bk = by_slug[slug]
        thick, height = bk["thick_mm"] / 1000, bk["height_mm"] / 1000
        depth = 0.152 if thick > 0.03 else 0.135
        lean = 0.0
        cloth = pl.surface(f"featured_cloth_{slug}", hex_linear(bk["cloth"]), 0.7, color_var=0.03, dust=0.3,
                           edge_wear=0.4, edge_color=tuple(min(1, c * 1.5 + 0.06) for c in hex_linear(bk["cloth"])))
        spine = image_material(f"spine_{slug}", ART / f"spine_{slug}.png", 0.6)
        cover = image_material(f"cover_{slug}", ART / f"cover_{slug}.png", 0.6)
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        geom = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector((depth, thick, height)), verts=geom["verts"])
        bmesh.ops.translate(bm, vec=Vector((depth / 2, 0, height / 2)), verts=geom["verts"])
        for f in list(bm.faces):
            n = f.normal
            if n.z < -0.9:
                bm.faces.remove(f)
                continue
            for loop in f.loops:
                c = loop.vert.co
                if n.x < -0.9:      # spine: u from +y (viewer's left) to -y, v up
                    loop[uv].uv = (0.5 - c.y / thick, c.z / height)
                elif n.y < -0.9:    # front cover: spine edge on the left
                    loop[uv].uv = (c.x / depth, c.z / height)
                else:
                    loop[uv].uv = (c.x / depth, c.y / thick + 0.5)
            f.material_index = 1 if n.x < -0.9 else 2 if n.y < -0.9 else 3 if n.z > 0.9 or n.x > 0.9 else 0
        obj = new_object(f"book_spine_{slug}", bm, "props", "props", [cloth, spine, cover, pages])
        bmesh_bevel_object(obj, 0.0012)
        obj.matrix_world = Matrix.Translation((start.x, y - thick / 2, start.z)) @ pl.xform(rot=(lean, 0, 0))
        obj["title"], obj["author"], obj["year"] = bk["title"], bk["author"], bk["year"]
        obj["texel"] = 9.0 if thick > 0.02 else 12.0
        objs.append(obj)
        y -= thick + 0.002
    return objs


def bmesh_bevel_object(obj, width):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    edges = [e for e in bm.edges if e.is_manifold]
    bmesh.ops.bevel(bm, geom=edges, offset=width, segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
    bm.to_mesh(obj.data)
    bm.free()


def image_material(name, path: Path, roughness, metallic=0.0, uv_map="UVMap"):
    """A Principled material showing an image through a UV map (art drawn by room_art.mjs), for the bake."""
    mat, k = pl.new_material(name)
    tex = k.node("ShaderNodeTexImage", image=pl.load_image(str(path)), interpolation="Linear")
    k.set(tex, "Vector", k.node("ShaderNodeUVMap", uv_map=uv_map).outputs["UV"])
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": tex.outputs["Color"], "Roughness": roughness,
                                                      "Metallic": metallic})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs[0])
    return mat


def build_space_wall(mats):
    """The Voyager Golden Record in a black shadow box (the gold disc engraved with its cover's diagrams, a plate
    beneath) and the Pale Blue Dot as a square print, side by side on the back wall over the desk."""
    lacquer = pl.surface("shadowbox_black", (0.02, 0.018, 0.017), 0.3, edge_wear=0.25, edge_color=(0.12, 0.1, 0.08),
                         dust=0.3, color_var=0.03, coat=0.4)
    velvet = pl.surface("shadowbox_velvet", (0.012, 0.016, 0.03), 0.95, sheen=0.6, color_var=0.04)
    brass = pl.surface("shadowbox_brass", (0.55, 0.39, 0.17), 0.25, metallic=1.0, grime=0.5, color_var=0.04)
    size, depth, rim = 0.46, 0.05, 0.022
    b = pl.Builder("voyager_frame")
    for (w, h), (x, z) in (((size, rim), (0, size / 2 - rim / 2)), ((size, rim), (0, -size / 2 + rim / 2)),
                           ((rim, size - 2 * rim), (-size / 2 + rim / 2, 0)), ((rim, size - 2 * rim), (size / 2 - rim / 2, 0))):
        b.box((w, depth, h), loc=(x, -depth / 2, z), mat=lacquer, bevel=0.002)
    inner = size - 2 * rim
    b.box((inner, 0.004, inner), loc=(0, -0.003, 0), mat=velvet)
    for (w, h), (x, z) in (((inner, 0.004), (0, inner / 2 - 0.002)), ((inner, 0.004), (0, -inner / 2 + 0.002)),
                           ((0.004, inner), (-inner / 2 + 0.002, 0)), ((0.004, inner), (inner / 2 - 0.002, 0))):
        b.box((w, 0.006, h), loc=(x, -depth + 0.004, z), mat=brass)
    frame = finish(b, "voyager_frame", smooth=30)

    gold = engraved_gold("voyager_gold", ART / "voyager_cover.png")
    plate_mat = engraved_gold("voyager_plate", ART / "voyager_plate.png", rough=0.32)
    r = 0.152
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    disc = bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=r, radius2=r, depth=0.004)
    rot = Matrix.Rotation(math.pi / 2, 4, "X")
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, -0.012, 0.025)) @ rot, verts=disc["verts"])
    for f in bm.faces:
        for loop in f.loops:
            c = loop.vert.co
            loop[uv].uv = (0.5 + c.x / (2 * r), 0.5 + (c.z - 0.025) / (2 * r))
    pb = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((0.17, 0.003, 0.032)), verts=pb["verts"])
    bmesh.ops.translate(bm, vec=Vector((0, -0.0075, -0.168)), verts=pb["verts"])
    plate_faces = {f for v in pb["verts"] for f in v.link_faces}
    for f in plate_faces:
        f.material_index = 1
        for loop in f.loops:
            c = loop.vert.co
            loop[uv].uv = (0.5 + c.x / 0.17, 0.5 + (c.z + 0.168) / 0.032)
    disc_obj = new_object("voyager_disc", bm, "props", "props", [gold, plate_mat])
    smooth_by_angle(disc_obj, 30)
    record = pl.join([frame, disc_obj], "voyager_record")
    record.name = record.data.name = "voyager_record"
    record.matrix_world = Matrix.Translation(VOYAGER)
    record["atlas"] = "props"
    record["texel"] = 5.0
    record["source"] = "made for this site; engraving redrawn from the record cover (NASA, public domain)"

    black = pl.surface("pale_dot_frame", (0.015, 0.014, 0.013), 0.4, edge_wear=0.2, edge_color=(0.1, 0.09, 0.08),
                       dust=0.3, color_var=0.03)
    mat_board, mat_core = mat_boards()
    frame, art = framed_picture("props_frame_pale_blue_dot", "print_pale_blue_dot", (PALE_DOT_SIZE, PALE_DOT_SIZE),
                                black, mat_board, mat_core, pale_blue_dot_material(), matte=0.05, moulding=0.018)
    for obj in (frame, art):
        obj.matrix_world = Matrix.Translation(PALE_DOT)
    art["runtime_art"] = "pale_blue_dot"
    art["texture"] = "pale-blue-dot.ktx2"
    art["width_m"] = art["height_m"] = PALE_DOT_SIZE
    art["aspect"] = 1.0
    return {"voyager_record": record, "print_pale_blue_dot": art, "pale_blue_dot_frame": frame}


def engraved_gold(name, mask: Path, rough=0.22):
    """Gold metal whose engraved lines (white in the mask) are darker, rougher and cut in by a bump."""
    mat, k = pl.new_material(name)
    tex = k.node("ShaderNodeTexImage", image=pl.load_image(str(mask), non_color=True), interpolation="Linear")
    k.set(tex, "Vector", k.node("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"])
    line = tex.outputs["Color"]
    color = k.mix_color(k.node("ShaderNodeRGBToBW", inputs={"Color": line}).outputs[0], (0.80, 0.58, 0.24, 1.0),
                        (0.30, 0.19, 0.07, 1.0))
    wear = k.noise(k.coords("Object"), 40.0, detail=3.0)
    rough_v = k.math("ADD", k.map_range(wear, 0.3, 0.7, rough - 0.06, rough + 0.06),
                     k.math("MULTIPLY", k.node("ShaderNodeRGBToBW", inputs={"Color": line}).outputs[0], 0.35))
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.5, "Distance": 0.0004, "Height": line}, invert=True)
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Metallic": 1.0, "Roughness": rough_v,
                                                      "Normal": bump.outputs[0]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs[0])
    return mat


def pale_blue_dot_material():
    """NASA/JPL's Pale Blue Dot Revisited for the stills (cropped square), white paper while the light bakes; the
    site draws public/room/pale-blue-dot.ktx2 over that light."""
    path = fetch_cached(PALE_BLUE_DOT[0], CACHE / "nasa" / "PIA23645_orig.jpg", PALE_BLUE_DOT[1])
    mat, k = pl.new_material("print_pale_blue_dot")
    uvn = k.node("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"]
    crop = k.node("ShaderNodeMapping", inputs={"Vector": uvn, "Scale": (5175 / 5230, 1.0, 1.0),
                                               "Location": ((1 - 5175 / 5230) / 2, 0.0, 0.0)})
    tex = k.node("ShaderNodeTexImage", image=pl.load_image(str(path)), interpolation="Linear")
    k.set(tex, "Vector", crop.outputs[0])
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": tex.outputs["Color"], "Roughness": 0.4})
    white = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": (0.8, 0.8, 0.8, 1.0), "Roughness": 0.9})
    probe = k.node("ShaderNodeValue", name="light_probe", label="light_probe")
    probe.outputs[0].default_value = 0.0
    mix = k.node("ShaderNodeMixShader", inputs={"Fac": probe.outputs[0], "Shader": bsdf.outputs[0],
                                                "Shader_001": white.outputs[0]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", mix.outputs[0])
    return mat


def build_print_japanese_lit(mats):
    """The Japanese-literature print in a pale oak frame, standing on the bookcase top on an easel strut (baked)."""
    base, (w, h), lean = JP_PRINT
    oak = pl.surface("oak_frame", (0.55, 0.42, 0.28), 0.5, color_tex=pl.ambientcg("Wood051")["Color"],
                     tint=(1.0, 0.86, 0.68), tile=0.25, edge_wear=0.3, color_var=0.06)
    mat_board, mat_core = mat_boards()
    frame, art = framed_picture("props_frame_japanese_lit", "print_japanese_lit_art", (w - 0.07, h - 0.07), oak,
                                mat_board, mat_core, image_material("print_japanese_lit", ART / "print_japanese_lit.png", 0.8),
                                matte=0.0, moulding=0.035, depth=0.025)
    strut = pl.Builder("print_japanese_lit_strut")
    strut.box((0.03, 0.012, h * 0.62), loc=(0, 0.04, h * 0.3), rot=(-22, 0, 0), mat=oak, bevel=0.002)
    printed = pl.join([frame, art, finish(strut, "print_japanese_lit_strut")], "print_japanese_lit")
    printed.name = printed.data.name = "print_japanese_lit"
    # Stand it on its bottom edge, then tip it back toward the wall.
    printed.matrix_world = (Matrix.Translation(base) @ RIGHT_WALL_TURN @ Matrix.Rotation(math.radians(-lean), 4, "X")
                            @ Matrix.Translation((0, 0, h / 2)))
    printed["atlas"] = "props"
    printed["texel"] = 4.0
    printed["source"] = "made for this site"
    return printed


def build_pennant():
    """A Georgia Tech felt pennant pinned to the back wall above the desk shelf: a gently sagging triangle (hoist at
    the left) whose UVs map the texture's triangle, two brass pins at the hoist."""
    corner, length, hoist = PENNANT
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    nu, nv = 12, 4
    rows = []
    for i in range(nu + 1):
        t = i / nu
        col = []
        for j in range(nv + 1):
            v = j / nv
            vv = 0.5 + (v - 0.5) * (1 - t)  # the triangle narrows to the point at t = 1
            x = length * t
            z = -hoist * (1 - vv) - 0.035 * t * t
            y = -0.004 * math.sin(t * math.pi) - 0.002 * math.sin(t * 9 + v * 2)
            col.append(bm.verts.new(corner + Vector((x, y, z))))
        rows.append(col)
    for i in range(nu):
        for j in range(nv):
            face = bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
            for loop, (di, dj) in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                ti, vj = (i + di) / nu, (j + dj) / nv
                loop[uv].uv = (ti, 0.5 + (vj - 0.5) * (1 - ti))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.y > 0:
            f.normal_flip()
    felt = image_material("pennant_felt", ART / "pennant_gatech.png", 0.92)
    pin = pl.surface("pennant_pin", (0.55, 0.39, 0.17), 0.25, metallic=1.0, color_var=0.0)
    obj = new_object("pennant_gatech", bm, "props", "props", [felt, pin])
    pins = bmesh.new()
    for z in (-0.02, -hoist + 0.02):
        add_cylinder(pins, 0.006, 0.006, corner + Vector((0.03, -0.006, z)), segments=10, axis="Y", mat=1)
    me = bpy.data.meshes.new("pins")
    pins.to_mesh(me)
    pins.free()
    bm2 = bmesh.new()
    bm2.from_mesh(obj.data)
    bm2.from_mesh(me)
    bm2.to_mesh(obj.data)
    bm2.free()
    bpy.data.meshes.remove(me)
    smooth_by_angle(obj, 50)
    obj["texel"] = 3.0
    obj["source"] = "made for this site"
    return obj


# ---- CC0 models ----

def import_cc0(name, asset_id, loc, rot_deg, height, target_tris):
    """Import a Poly Haven model (CC0, 1k textures), decimate it to its budget, set its base on the floor of its
    bounds, scale it to `height` and place it."""
    path = pl.polyhaven_gltf(asset_id, "1k")
    coll = collection("props")
    new = pl.import_gltf(path, coll)
    meshes = [o for o in new if o.type == "MESH"]
    bpy.context.view_layer.update()
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.data = obj.data.copy()
        obj.data.transform(world)
        obj.matrix_world = Matrix.Identity(4)
    for obj in new:
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    if asset_id == "stationery_supplies":
        meshes = pen_cup_from_supplies(meshes)
    obj = pl.join(meshes, name) if len(meshes) > 1 else meshes[0]
    obj.name = obj.data.name = name
    obj.data.calc_loop_triangles()
    tris = len(obj.data.loop_triangles)
    if tris > target_tris:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = target_tris / tris
        mod.use_collapse_triangulate = True
        pl.apply_modifier(obj, mod)
    pl.set_origin_base(obj)
    xs = [v.co for v in obj.data.vertices]
    size = max(v.z for v in xs) - min(v.z for v in xs)
    scale = (height / size) if height else 1.0
    obj.matrix_world = (Matrix.Translation(loc) @ Matrix.Rotation(math.radians(rot_deg), 4, "Z")
                        @ Matrix.Diagonal((scale, scale, scale, 1.0)))
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj["atlas"] = "props"
    obj["prop"] = name
    obj["source"] = f"Poly Haven {asset_id} (CC0)"
    smooth_by_angle(obj, 50)
    return obj


def pen_cup_from_supplies(meshes):
    """From the stationery set keep the metal cup and stand three pens and pencils in it, leaning."""
    def width(o):
        pts = [v.co for v in o.data.vertices]
        return max(p.x for p in pts) - min(p.x for p in pts), max(p.z for p in pts) - min(p.z for p in pts)

    cup = max(meshes, key=lambda o: width(o)[1] / max(width(o)[0], 1e-6))
    pens = sorted((o for o in meshes if o is not cup and width(o)[0] > 0.1), key=lambda o: -width(o)[0])[:3]
    for o in meshes:
        if o is not cup and o not in pens:
            bpy.data.objects.remove(o, do_unlink=True)
    cpts = [v.co for v in cup.data.vertices]
    centre = Vector(((min(p.x for p in cpts) + max(p.x for p in cpts)) / 2, (min(p.y for p in cpts) + max(p.y for p in cpts)) / 2,
                     min(p.z for p in cpts)))
    for k, pen in enumerate(pens):
        pts = [v.co for v in pen.data.vertices]
        mid = Vector(((min(p.x for p in pts) + max(p.x for p in pts)) / 2, (min(p.y for p in pts) + max(p.y for p in pts)) / 2,
                      (min(p.z for p in pts) + max(p.z for p in pts)) / 2))
        length = max(p.x for p in pts) - min(p.x for p in pts)
        a = math.radians(120 * k)
        stand = (Matrix.Translation(centre + Vector((0.01 * math.cos(a), 0.01 * math.sin(a), length / 2 + 0.005)))
                 @ Matrix.Rotation(math.radians(8), 4, Vector((math.cos(a + 1.2), math.sin(a + 1.2), 0)))
                 @ Matrix.Rotation(math.radians(90), 4, "Y") @ Matrix.Translation(-mid))
        pen.data.transform(stand)
    return [cup, *pens]


# ---- round six: a jacket, a pothos, floor books and a reading corner ----

def build_jacket():
    """A mustard corduroy jacket thrown over the desk chair's back: the torso folded over the top edge, longer on
    the side toward the room, sleeves hanging down the back, the collar turned up. Shaped procedurally over the
    backrest Henry's chair already has."""
    chair = bpy.data.objects.get("desk_chair_seat")
    if chair is None:
        return None
    pts = [chair.matrix_world @ v.co for v in chair.data.vertices]
    top = [p for p in pts if p.z > max(q.z for q in pts) - 0.03]
    a, b = min(top, key=lambda p: p.x), max(top, key=lambda p: p.x)
    centre = (a + b) / 2
    u = (b - a).normalized()
    u.z = 0
    u.normalize()
    n = Vector((u.y, -u.x, 0.0))
    room = Vector((3.75, -4.95, 0.0)) - centre
    if n.dot(room) < 0:
        n = -n
    half_t, width, front, back = 0.042, 0.50, 0.40, 0.56
    cord = pl.surface("jacket_corduroy", (0.26, 0.15, 0.045), 0.85, color_tex=pl.ambientcg("Fabric036")["Color"],
                      tint=(0.50, 0.32, 0.11), tile=0.05, micro_bump=(900, 0.3), edge_wear=0.4,
                      edge_color=(0.46, 0.31, 0.12), grime=0.4, color_var=0.06, sheen=0.4)
    lining = pl.surface("jacket_lining", (0.15, 0.06, 0.04), 0.6, color_var=0.04)
    b_ = pl.Builder("props_jacket")
    bm = b_.bm
    before = set(bm.faces)

    def drape(aa, ss):
        fold = 0.010 * math.sin(aa * 28 + ss * 7) * min(abs(ss) / 0.2, 1.0)
        if abs(ss) <= half_t:
            p = centre + u * aa + n * ss + Vector((0, 0, 0.012 * math.cos(math.pi * ss / (2 * half_t)) + 0.006))
        else:
            side = 1 if ss > 0 else -1
            drop = abs(ss) - half_t
            flare = 0.018 + 0.05 * drop + fold
            p = centre + u * (aa * (1 + 0.12 * drop)) + n * side * (half_t + flare) - Vector((0, 0, drop))
        return p

    na, ns = 14, 34
    grid = []
    for i in range(na + 1):
        aa = -width / 2 + width * i / na
        col = []
        for j in range(ns + 1):
            ss = -front + (front + back) * j / ns
            col.append(bm.verts.new(drape(aa, ss)))
        grid.append(col)
    for i in range(na):
        for j in range(ns):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    torso = b_._wrap(before, None, cord)
    bmesh.ops.solidify(bm, geom=torso, thickness=0.004)
    # Sleeves hang from the shoulder ends down the room side.
    for side in (-1, 1):
        start = drape(side * width / 2, half_t + 0.02)
        path = [start + u * side * 0.02]
        for k in range(1, 10):
            t = k / 9
            path.append(start + u * side * (0.035 + 0.02 * math.sin(t * 2)) + n * (0.03 + 0.04 * t)
                        - Vector((0, 0, 0.50 * t)))
        b_.tube(path, 0.05, sides=8, mat=cord, radius_fn=lambda t: 0.052 - 0.012 * t)
    # The collar: a turned-up band along the top edge, a little proud on the room side.
    before = set(bm.faces)
    band = []
    for i in range(9):
        aa = -0.13 + 0.26 * i / 8
        base = drape(aa, half_t + 0.01)
        band.append((bm.verts.new(base + n * 0.012), bm.verts.new(base + n * 0.02 + Vector((0, 0, 0.055)))))
    for (p0, p1), (q0, q1) in zip(band, band[1:]):
        bm.faces.new((p0, q0, q1, p1))
    b_._wrap(before, None, lining)
    return finish(b_, "props_jacket", atlas="desk", smooth=70)


def build_pothos(placement: Matrix):
    """A golden pothos in a small glazed pot, trailing over the edge in front of it (local -Y) and down; placement
    puts the pot's base."""
    rng = random.Random(SEED + 7)
    pot_mat = pl.surface("pothos_pot", (0.62, 0.58, 0.50), 0.25, coat=0.5, edge_wear=0.4,
                         edge_color=(0.36, 0.28, 0.20), grime=0.5, dust=0.6, color_var=0.05)
    soil = pl.surface("pothos_soil", (0.03, 0.022, 0.015), 0.95, color_var=0.1)
    stem = pl.surface("pothos_stem", (0.08, 0.14, 0.04), 0.6, color_var=0.15)
    leaf = pl.surface("pothos_leaf", (0.07, 0.16, 0.035), 0.42, coat=0.2, color_var=0.25, translucency=0.15,
                      dust=0.3)
    b = pl.Builder("props_pothos")
    base = Vector((0.0, 0.0, 0.0))
    b.lathe([(0.0, 0.0), (0.040, 0.0), (0.047, 0.012), (0.052, 0.072), (0.056, 0.078), (0.050, 0.080)], segments=20,
            loc=tuple(base), mat=pot_mat, cap_end=False)
    b.cylinder(0.049, 0.002, segments=20, loc=tuple(base + Vector((0, 0, 0.070))), mat=soil)
    vines = [(-20, 0.55), (15, 0.42), (60, 0.30), (-60, 0.22), (110, 0.18)]
    for az_deg, length in vines:
        az = math.radians(az_deg)
        start = base + Vector((0.02 * math.cos(az), 0.02 * math.sin(az) - 0.01, 0.074))
        path = [start]
        lip = base + Vector((0.07 * math.cos(az) * 0.6, -0.12, 0.085))
        for k in range(1, 15):
            t = k / 14
            if t < 0.25:
                p = start.lerp(lip, t / 0.25)
            else:
                drop = (t - 0.25) / 0.75 * length
                p = lip + Vector((0.025 * math.sin(t * 5 + az), -0.03 - 0.02 * math.sin(t * 3), -drop))
            path.append(p)
        b.tube(path, 0.0022, sides=4, mat=stem)
        for k, p in enumerate(path[2::2]):
            side = 1 if k % 2 else -1
            size = rng.uniform(0.017, 0.027) * (1.0 - 0.3 * k / len(path))
            heart_leaf(b, p, side, size, leaf, rng)
    for k, p in enumerate([base + Vector((0.0, -0.01, 0.09)), base + Vector((0.03, 0.02, 0.10))]):
        heart_leaf(b, p, 1 if k else -1, 0.026, leaf, rng, upright=True)
    obj = finish(b, "props_pothos", smooth=60)
    obj.matrix_world = placement
    return obj


def heart_leaf(b, at, side, size, mat, rng, upright=False):
    """One heart-shaped leaf on a short petiole: a cupped fan of quads, tip down unless upright."""
    bm = b.bm
    before = set(bm.faces)
    rot = Matrix.Rotation(rng.uniform(-0.6, 0.6), 4, "Z") @ Matrix.Rotation(math.radians(side * 35), 4, "Y")
    if upright:
        rot = Matrix.Rotation(rng.uniform(0, 6.28), 4, "Z") @ Matrix.Rotation(math.radians(40), 4, "X")
    ring = []
    n = 10
    for k in range(n + 1):
        t = k / n
        a = -math.pi + 2 * math.pi * t
        r = size * (0.62 + 0.38 * math.sin(abs(a) / 2) ** 0.6) * (1 - 0.45 * max(0.0, math.cos(a)) ** 6)
        x, y = r * math.sin(a), -r * math.cos(a) * 1.15 - size * 0.35
        if upright:
            y = -y
        ring.append(Vector((x, -0.004 * (1 - (x / size) ** 2), y)))
    centre = bm.verts.new(at + (rot @ Vector((0, -0.002, -size * 0.4 if not upright else size * 0.4))))
    verts = [bm.verts.new(at + (rot @ p)) for p in ring]
    for v0, v1 in zip(verts, verts[1:]):
        bm.faces.new((centre, v0, v1))
    return b._wrap(before, None, mat)


def build_floor_books(rng):
    """A stack of big books on the floor by the desk's left leg, the top one open-spined and askew."""
    mats = book_materials()
    pages = bpy.data.materials.get("book_pages") or pl.surface("book_pages", (0.62, 0.57, 0.46), 0.85, grime=0.5,
                                                              dust=0.6, color_var=0.06)
    b = pl.Builder("props_floor_books")
    z = 0.0
    for k in range(5):
        thick = rng.uniform(0.025, 0.05)
        w, d = rng.uniform(0.22, 0.31), rng.uniform(0.17, 0.24)
        faces = b.box((w, d, thick), loc=(0, 0, thick / 2), mat=rng.choice(mats), bevel=0.0015, bevel_seg=1)
        faces += b.box((w - 0.008, d - 0.006, thick - 0.006), loc=(0.006, 0, thick / 2), mat=pages)
        m = Matrix.Translation((rng.uniform(-0.015, 0.015), rng.uniform(-0.015, 0.015), z)) @ pl.xform(
            rot=(0, 0, rng.uniform(-14, 14)))
        bmesh.ops.transform(b.bm, matrix=m, verts=list({v for f in faces for v in f.verts}))
        z += thick
    obj = finish(b, "props_floor_books", smooth=30)
    place(obj, Vector((-1.17, -0.02, 0.0)), 18.0)
    return obj


def build_reading_corner(mats):
    """The armchair corner: a tall paper lantern on a wooden tripod beyond the record cabinet, glowing warm over the
    turntable, and a mug left on the cabinet beside it."""
    paper = pl.surface("lantern_paper", (0.86, 0.80, 0.68), 0.9, color_tex=pl.ambientcg("Paper001")["Color"],
                       tint=(1.0, 0.94, 0.82), tile=0.3, translucency=0.35, emission=((1.0, 0.66, 0.36), 0.08),
                       color_var=0.04)
    rib = pl.surface("lantern_rib", (0.52, 0.42, 0.28), 0.7, color_var=0.05)
    oak = pl.surface("lantern_oak", (0.50, 0.36, 0.22), 0.55, color_tex=pl.ambientcg("Wood051")["Color"],
                     tint=(0.95, 0.80, 0.62), tile=0.2, edge_wear=0.3, color_var=0.06)
    b = pl.Builder("props_lantern")
    r, cz, h = LANTERN
    prof = [(0.0, cz - h / 2)]
    for k in range(1, 12):
        t = k / 12
        prof.append((r * math.sin(math.pi * t) ** 0.8, cz - h / 2 + h * t))
    prof.append((0.0, cz + h / 2))
    b.lathe(prof, segments=24, mat=paper)
    for k in range(1, 12, 2):
        t = k / 12
        rr = r * math.sin(math.pi * t) ** 0.8 + 0.0015
        b.torus(rr, 0.0012, segments=24, sides=4, loc=(0, 0, cz - h / 2 + h * t), mat=rib)
    b.tube([Vector((0, 0, cz - h / 2 - 0.30)), Vector((0, 0, cz - h / 2 + 0.02))], 0.006, sides=8, mat=oak)
    for k in range(3):
        a_ = math.radians(90 + 120 * k)
        foot = Vector((0.22 * math.cos(a_), 0.22 * math.sin(a_), 0.0))
        b.tube([foot, Vector((0.012 * math.cos(a_), 0.012 * math.sin(a_), cz - h / 2 - 0.28))], 0.010, sides=8, mat=oak,
               radius_fn=lambda t: 0.010 * (1.0 - 0.35 * t))
    obj = finish(b, "props_lantern", smooth=40)
    place(obj, FLOOR_LAMP, 0.0)

    mug = pl.surface("reading_mug", (0.55, 0.30, 0.18), 0.25, coat=0.5, grime=0.3, color_var=0.04)
    tea = pl.surface("reading_tea", (0.18, 0.08, 0.03), 0.2, color_var=0.05)
    b = pl.Builder("props_reading_mug")
    x0, x1, y0, y1, top_z = RECORD_CABINET
    top = Vector((x0 + 0.13, y0 + 0.09, top_z))
    b.lathe([(0.0, 0.0), (0.036, 0.0), (0.040, 0.006), (0.040, 0.092), (0.036, 0.092), (0.035, 0.008), (0.0, 0.008)],
            segments=24, loc=tuple(top), mat=mug, cap_start=False, cap_end=False)
    b.cylinder(0.035, 0.002, segments=24, loc=tuple(top + Vector((0, 0, 0.075))), mat=tea)
    b.torus(0.022, 0.006, segments=14, sides=6, loc=tuple(top + Vector((-0.032, -0.030, 0.048))), rot=(90, 0, 45),
            mat=mug, arc=math.radians(220))
    finish(b, "props_reading_mug", smooth=40)
    return FLOOR_LAMP + Vector((0, 0, cz))

