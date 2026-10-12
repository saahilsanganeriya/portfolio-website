"""fujifilm_xt: a black SLR-style mirrorless camera (X-T5 proportions, 129.5 x 91.0 mm) with a 23 mm f/2 lens.

Painted black shoulders and viewfinder hump with worn edges, leatherette body and grip, ISO, shutter-speed and
exposure dials with engraved numbers, a tapered lens with knurled aperture and ribbed focus rings, rear
screen and eyecup. "FUJIFILM" is set in a plain sans font (not the logo). One object; faces -Y, origin at the base.
"""
import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_camera_parts as cp  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "fujifilm_xt"
W, D = 0.1295, 0.0340
FRONT, BACK = -D / 2, D / 2
DECK = 0.0700
HUMP_TOP = 0.0910
MOUNT_X, MOUNT_Z = 0.0060, 0.0370


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    m = cp.camera_materials()
    b = pl.Builder(NAME)

    b.box((W, D, 0.0045), loc=(0, 0, 0.00225), mat=m["black_paint"], corner=0.0075, corner_seg=4, bevel=0.0008,
          bevel_seg=2)
    b.box((W - 0.0006, D - 0.0006, 0.0560 - 0.0045), loc=(0, 0, (0.0560 + 0.0045) / 2), mat=m["leatherette"],
          corner=0.0072, corner_seg=4, bevel=0.0003, bevel_seg=1)
    b.box((W, D, DECK - 0.0560), loc=(0, 0, (DECK + 0.0560) / 2), mat=m["black_paint"], corner=0.0075,
          corner_seg=4, bevel=0.0014, bevel_seg=2)
    b.frustum((0.0600, D - 0.0010), (0.0360, 0.0250), HUMP_TOP - DECK + 0.002, loc=(MOUNT_X, 0.0, DECK - 0.002),
              top_offset=(0.0, 0.0020), mat=m["black_paint"], bevel=0.0022, bevel_seg=3)
    b.box((0.0240, 0.0130, 0.0500), loc=(-0.0455, FRONT - 0.0050, 0.0315), mat=m["leatherette"], corner=0.0058,
          corner_seg=4, bevel=0.0018, bevel_seg=2)

    cp.lens(b, MOUNT_X, MOUNT_Z, FRONT, [
        (0.0272, 0.0272, 0.0030, "black_anodised", "plain"),
        (0.0296, 0.0296, 0.0088, "black_anodised", "knurl"),
        (0.0291, 0.0285, 0.0062, "black_anodised", "plain"),
        (0.0283, 0.0280, 0.0160, "black_anodised", "ribs"),
        (0.0276, 0.0247, 0.0140, "black_anodised", "plain"),
        (0.0245, 0.0241, 0.0030, "black_anodised", "plain"),
    ], glass_r=0.0168, glass_depth=0.0060, mats=m)
    b.cylinder(0.0021, 0.0012, segments=12, loc=(MOUNT_X - 0.0300, FRONT - 0.0002, MOUNT_Z + 0.0120),
               rot=(90, 0, 0), mat=m["black_plastic"], bevel=0.0004)
    b.box((0.0048, 0.0022, 0.0030), loc=(MOUNT_X + 0.0335, FRONT - 0.0010, 0.0160), mat=m["black_paint"],
          bevel=0.0007, bevel_seg=2)
    b.cylinder(0.0028, 0.0008, segments=14, loc=(-0.0455, FRONT - 0.0112, 0.0520), rot=(90, 0, 0),
               mat=m["paint_orange"], bevel=0.0003)
    b.cylinder(0.0078, 0.0050, segments=24, loc=(-0.0440, FRONT - 0.0032, 0.0530), mat=m["black_plastic"],
               bevel=0.0005)
    # lettering on the hump's sloped front face
    hump_y0, hump_z0 = -(D - 0.0010) / 2, DECK - 0.002
    hump_y1, hump_z1 = 0.0020 - 0.0250 / 2, HUMP_TOP
    slope = math.atan2(hump_y1 - hump_y0, hump_z1 - hump_z0)
    text_z = DECK + 0.0105
    text_y = hump_y0 + (hump_y1 - hump_y0) * (text_z - hump_z0) / (hump_z1 - hump_z0) - 0.00012
    b.text("FUJIFILM", 0.0044, loc=(MOUNT_X, text_y, text_z), rot=(90 - math.degrees(slope), 0, 0),
           mat=m["paint_white"], resolution=2, spacing=1.08)

    # top deck: ISO dial with drive collar (left), shutter dial with metering collar, release, exposure dial
    iso = ["L", "200", "400", "800", "1600", "3200", "6400", "H", "A"]
    speeds = ["A", "1", "4", "15", "60", "250", "1000", "4000", "B", "T"]
    for x, labels in ((0.0450, iso), (-0.0300, speeds)):
        b.lathe([(0.0148, 0.0), (0.0148, 0.0034), (0.0141, 0.0038), (0.0, 0.0038)], 32, loc=(x, 0.0005, DECK),
                mat=m["black_paint"], radial=lambda i, j, r: r - 0.0004 * (i % 2) if j == 1 else r)
        b.box((0.0060, 0.0030, 0.0022), loc=(x + (0.0160 if x > 0 else -0.0160), -0.0080, DECK + 0.0017),
              rot=(0, 0, 30 if x > 0 else -30), mat=m["black_paint"], bevel=0.0006, bevel_seg=1)
        cp.dial(b, x, 0.0005, DECK + 0.0038, 0.0130, 0.0078, m["black_paint"], m["black_paint"], ridges=26,
                labels=labels, label_mat=m["paint_white"], label_size=0.0016, label_radius=0.0092,
                start_deg=95, sweep_deg=320)
    cp.dial(b, -0.0570, 0.0085, DECK, 0.0100, 0.0082, m["black_paint"], m["black_paint"], ridges=24,
            labels=["C", "+3", "2", "1", "0", "1", "2", "-3"], label_mat=m["paint_white"], label_size=0.0016,
            label_radius=0.0068, start_deg=100, sweep_deg=290)
    b.lathe([(0.0062, 0.0), (0.0062, 0.0022), (0.0056, 0.0025), (0.0, 0.0025)], 28, loc=(-0.0505, FRONT + 0.0060, DECK),
            mat=m["black_paint"], radial=lambda i, j, r: r - 0.00025 * (i % 2) if j == 1 else r)
    b.lathe([(0.0041, 0.0), (0.0041, 0.0033), (0.0035, 0.0037), (0.0015, 0.0037), (0.0012, 0.0030), (0.0, 0.0030)],
            24, loc=(-0.0505, FRONT + 0.0060, DECK + 0.0025), mat=m["chrome"], cap_start=False)
    shoe_z = HUMP_TOP
    b.box((0.0186, 0.0186, 0.0011), loc=(MOUNT_X, 0.0018, shoe_z + 0.00055), mat=m["chrome"], bevel=0.0003,
          bevel_seg=1)
    for sy in (-1, 1):
        b.box((0.0186, 0.0024, 0.0019), loc=(MOUNT_X, 0.0018 + sy * 0.0081, shoe_z + 0.0018), mat=m["chrome"],
              bevel=0.0003, bevel_seg=1)

    # back: tilting screen, eyecup, buttons, joystick, rear dial
    b.box((0.0760, 0.0050, 0.0540), loc=(0.0040, BACK + 0.0022, 0.0335), mat=m["black_plastic"], bevel=0.0012,
          bevel_seg=2)
    b.box((0.0700, 0.0006, 0.0480), loc=(0.0040, BACK + 0.0049, 0.0335), mat=m["screen"])
    b.box((0.0300, 0.0170, 0.0230), loc=(MOUNT_X, BACK + 0.0070, 0.0780), mat=m["rubber"], corner=0.0050,
          corner_seg=3, corner_axis="Y", bevel=0.0018, bevel_seg=2)
    b.box((0.0170, 0.0006, 0.0130), loc=(MOUNT_X, BACK + 0.0156, 0.0780), mat=m["glass"])
    for bx, bz in ((-0.0420, 0.0230), (-0.0420, 0.0330), (-0.0530, 0.0280), (0.0400, 0.0700), (-0.0330, 0.0650)):
        cp.button(b, bx, BACK + 0.0001, bz, 0.0028, 0.0012, m["black_plastic"], axis="Y")
    cp.button(b, -0.0470, BACK + 0.0001, 0.0450, 0.0022, 0.0034, m["rubber"], axis="Y", dome=0.6)
    b.cylinder(0.0078, 0.0055, segments=24, loc=(-0.0520, BACK - 0.0030, DECK - 0.0090), mat=m["black_plastic"],
               bevel=0.0004)

    for side in (-1, 1):
        cp.strap_lug(b, side * (W / 2 + 0.0012), 0.0030, 0.0620, side, m["black_paint"])

    ob = b.finish(col, smooth_angle=32, seam_angle=48)
    ob["source"] = "made for this site"
    pl.report(NAME, col, 8000)
    pl.save_prop(NAME)


main()
