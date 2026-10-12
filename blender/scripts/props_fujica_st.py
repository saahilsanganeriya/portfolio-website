"""fujica_st: a 1970s 35 mm film SLR (Fujica ST701 proportions, 141.5 x 91.5 mm) with a 55 mm f/1.8 lens.

Chrome top and bottom plates and pentaprism (lettered "FUJICA" and "ST701" in a plain font, not the logo),
black leatherette, rewind knob with a fold-out crank, shutter-speed dial with the film advance lever on the same
axis, frame counter, threaded shutter release, self-timer lever, a black lens with a deep-ribbed focus grip and
aperture numbers, and a memo holder on the back door holding a film-box end tab. One object; faces -Y, origin at
the base.
"""
import math
import os
import sys

import bmesh
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_camera_parts as cp  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "fujica_st"
W, D = 0.1415, 0.0345
FRONT, BACK = -D / 2, D / 2
BOTTOM_H, TOP_Z, DECK = 0.0060, 0.0560, 0.0680
PRISM_TOP = 0.0915
LENS_Z = 0.0360


def memo_card_material():
    """A film-box end tab: cream card, a red-orange band, dark type."""
    mat, k = pl.new_material("memo_card")
    obj = k.node("ShaderNodeTexCoord").outputs["Object"]
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    band = k.math("LESS_THAN", k.math("ABSOLUTE", k.math("SUBTRACT", sep.outputs["Z"], 0.0300)), 0.0045)
    color = k.mix_color(band, (0.60, 0.54, 0.40, 1.0), (0.34, 0.09, 0.04, 1.0))
    color = k.mix_color(k.noise(obj, 300.0), color, (0.50, 0.44, 0.32, 1.0))
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.55})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs["BSDF"])
    return mat


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    m = cp.camera_materials()
    card = memo_card_material()
    b = pl.Builder(NAME)

    b.box((W, D, BOTTOM_H), loc=(0, 0, BOTTOM_H / 2), mat=m["chrome"], corner=0.0065, corner_seg=4, bevel=0.0009,
          bevel_seg=2)
    b.box((W - 0.0007, D - 0.0007, TOP_Z - BOTTOM_H), loc=(0, 0, (TOP_Z + BOTTOM_H) / 2), mat=m["leatherette"],
          corner=0.0062, corner_seg=4, bevel=0.0003, bevel_seg=1)
    b.box((W, D, DECK - TOP_Z), loc=(0, 0, (DECK + TOP_Z) / 2), mat=m["chrome"], corner=0.0065, corner_seg=4,
          bevel=0.0013, bevel_seg=2)
    prism_y0, prism_y1 = -(D - 0.002) / 2, 0.0030 - 0.0200 / 2
    b.frustum((0.0580, D - 0.002), (0.0300, 0.0200), PRISM_TOP - DECK + 0.002, loc=(0.0, 0.0, DECK - 0.002),
              top_offset=(0.0, 0.0030), mat=m["chrome"], bevel=0.0018, bevel_seg=3)
    slope = math.atan2(prism_y1 - prism_y0, PRISM_TOP - DECK)
    tz = DECK + 0.0110
    ty = prism_y0 + (prism_y1 - prism_y0) * (tz - DECK) / (PRISM_TOP - DECK) - 0.00012
    b.text("FUJICA", 0.0056, loc=(0.0, ty, tz), rot=(90 - math.degrees(slope), 0, 0), mat=m["paint_black"],
           resolution=2, spacing=1.15)
    b.text("ST701", 0.0028, loc=(-0.0450, FRONT - 0.00006, 0.0620), rot=(90, 0, 0), mat=m["paint_black"],
           resolution=2, spacing=1.1)

    # lens: chrome mount, black barrel with knurled aperture ring, DOF ring, deep-ribbed focus grip
    b.lathe([(0.0250, 0.0), (0.0250, 0.0028), (0.0240, 0.0032), (0.0215, 0.0032)], 40, loc=(0, FRONT, LENS_Z),
            rot=(90, 0, 0), mat=m["chrome"], cap_start=False, cap_end=False)
    front = FRONT - 0.0032
    cp.lens(b, 0.0, LENS_Z, front, [
        (0.0268, 0.0268, 0.0020, "black_anodised", "plain"),
        (0.0286, 0.0286, 0.0085, "black_anodised", "knurl"),
        (0.0281, 0.0281, 0.0042, "black_anodised", "plain"),
        (0.0304, 0.0304, 0.0128, "black_anodised", "ribs"),
        (0.0291, 0.0286, 0.0058, "black_anodised", "plain"),
        (0.0281, 0.0277, 0.0026, "black_anodised", "plain"),
    ], glass_r=0.0196, glass_depth=0.0062, mats=m)
    stops = ["16", "11", "8", "5.6", "4", "2.8", "1.8"]
    for k, label in enumerate(stops):
        a = math.radians(90 + (k - 3) * 13)
        r = 0.02865
        place = (Matrix.Translation((r * math.cos(a), front - 0.0062, LENS_Z + r * math.sin(a))) @
                 Matrix.Rotation(math.pi / 2 - a, 4, "Y") @ Matrix.Rotation(math.pi, 4, "Z"))
        b.text(label, 0.0020, mat=m["paint_orange"] if label == "1.8" else m["paint_white"], resolution=1,
               matrix=place)
    for k in range(9):
        a = math.radians(90 + (k - 4) * 9)
        b.box((0.00025, 0.0015, 0.0001), loc=(0.02815 * math.cos(a), front - 0.0127, LENS_Z + 0.02815 * math.sin(a)),
              rot=(0, 90 - math.degrees(a), 0), mat=m["paint_white"])

    # front controls
    b.box((0.0058, 0.0030, 0.0140), loc=(-0.0340, FRONT - 0.0012, 0.0330), rot=(0, 18, 0), mat=m["chrome"],
          bevel=0.0010, bevel_seg=2)
    b.box((0.0040, 0.0028, 0.0085), loc=(0.0290, FRONT - 0.0012, 0.0440), rot=(0, -10, 0), mat=m["chrome"],
          bevel=0.0008, bevel_seg=2)

    # top deck: rewind knob with crank (left), shutter dial with advance lever, frame counter, release (right)
    b.lathe([(0.0055, 0.0), (0.0055, 0.0030), (0.0115, 0.0034), (0.0115, 0.0098), (0.0108, 0.0106),
             (0.0, 0.0106)], 48, loc=(0.0455, 0.0020, DECK), mat=m["chrome"],
            radial=lambda i, j, r: r - 0.0004 * (i % 2) if j in (2, 3) else r)
    b.box((0.0125, 0.0036, 0.0012), loc=(0.0455 + 0.0045, 0.0020, DECK + 0.0114), mat=m["chrome"], bevel=0.0005,
          bevel_seg=1)
    b.cylinder(0.0017, 0.0042, segments=10, loc=(0.0455 + 0.0098, 0.0020, DECK + 0.0118), mat=m["black_plastic"],
               bevel=0.0005)
    speeds = ["B", "1", "2", "4", "8", "15", "30", "60", "125", "250", "500", "1000"]
    cp.dial(b, -0.0415, 0.0020, DECK, 0.0128, 0.0056, m["chrome"], m["chrome"], ridges=26, labels=speeds,
            label_mat=m["paint_black"], label_size=0.0016, label_radius=0.0094, start_deg=110, sweep_deg=320)
    b.cylinder(0.0058, 0.0020, segments=20, loc=(-0.0415, 0.0020, DECK + 0.0056), mat=m["chrome"], bevel=0.0004)
    # advance lever: flat, pivoting on the dial axis, running along the back edge with its tip curling back
    lever_pts = [(-0.0045, 0.0040), (0.0060, 0.0042), (0.0400, -0.0010), (0.0420, -0.0060), (0.0385, -0.0080),
                 (0.0050, -0.0045), (-0.0045, -0.0042)]
    lever = pl.round_polygon(list(reversed(lever_pts)), 0.0018, 3)
    lever_matrix = pl.xform(loc=(-0.0415, 0.0020, DECK + 0.0085), rot=(90, 0, 10))
    lever_faces = b.extrude(lever, 0.0017, mat=m["chrome"], bevel=0.0004, bevel_seg=1)
    bmesh.ops.transform(b.bm, matrix=lever_matrix, verts=list({v for f in lever_faces for v in f.verts}))
    tip = lever_matrix @ Vector((0.0395, 0.0, -0.0060))
    b.box((0.0090, 0.0052, 0.0040), loc=tuple(tip), rot=(0, 0, 10 - 25), mat=m["black_plastic"], bevel=0.0012,
          bevel_seg=2)
    b.cylinder(0.0042, 0.0012, segments=16, loc=(-0.0240, 0.0110, DECK), mat=m["chrome"], bevel=0.0003)
    b.cylinder(0.0030, 0.0004, segments=16, loc=(-0.0240, 0.0110, DECK + 0.0012), mat=m["glass"])
    b.lathe([(0.0062, 0.0), (0.0062, 0.0020), (0.0056, 0.0024), (0.0, 0.0024)], 24, loc=(-0.0215, FRONT + 0.0070, DECK),
            mat=m["chrome"], radial=lambda i, j, r: r - 0.0003 * (i % 2) if j == 1 else r)
    b.lathe([(0.0040, 0.0), (0.0040, 0.0042), (0.0034, 0.0047), (0.0014, 0.0047), (0.0012, 0.0040), (0.0, 0.0040)],
            20, loc=(-0.0215, FRONT + 0.0070, DECK + 0.0024), mat=m["chrome"], cap_start=False)

    # back: door, memo holder with a film-box end, eyepiece
    b.box((W - 0.020, 0.0012, 0.0480), loc=(0.0040, BACK + 0.0003, 0.0310), mat=m["leatherette"], bevel=0.0004,
          bevel_seg=1)
    mx, mz = 0.0250, 0.0300
    for sx, sz, size in ((0, 0.0152, (0.0460, 0.0016, 0.0016)), (0, -0.0152, (0.0460, 0.0016, 0.0016)),
                         (0.0222, 0, (0.0016, 0.0016, 0.0300)), (-0.0222, 0, (0.0016, 0.0016, 0.0300))):
        b.box(size, loc=(mx + sx, BACK + 0.0015, mz + sz), mat=m["chrome"], bevel=0.0004, bevel_seg=1)
    b.box((0.0430, 0.0005, 0.0285), loc=(mx, BACK + 0.0012, mz), mat=card)
    b.text("ISO 200  36 EXP", 0.0030, loc=(mx, BACK + 0.0016, mz - 0.0080), rot=(-90, 180, 0), mat=m["paint_black"],
           resolution=1)
    b.box((0.0210, 0.0070, 0.0160), loc=(0.0, BACK + 0.0030, 0.0760), mat=m["black_plastic"], bevel=0.0012,
          bevel_seg=2)
    b.box((0.0150, 0.0006, 0.0100), loc=(0.0, BACK + 0.0066, 0.0760), mat=m["glass"])

    for side in (-1, 1):
        cp.strap_lug(b, side * (W / 2 + 0.0012), 0.0030, 0.0620, side, m["chrome"])

    ob = b.finish(col, smooth_angle=32, seam_angle=48)
    ob["source"] = "made for this site"
    pl.report(NAME, col, 8000)
    pl.save_prop(NAME)


main()
