"""fujifilm_x100: a silver-and-black fixed-lens rangefinder-style digital camera (X100V proportions,
128.0 x 74.8 x 53.3 mm with the lens).

Satin silver top and bottom plates, black leatherette body, a 23 mm lens with knurled aperture and ribbed focus
rings, shutter-speed and exposure dials with engraved numbers, optical viewfinder window, hot shoe, rear screen.
"FUJIFILM" is set in a plain sans font (not the logo). One object; faces -Y, origin at the base.
"""
import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_camera_parts as cp  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "fujifilm_x100"
W, D, H = 0.128, 0.0335, 0.0748
FRONT, BACK = -D / 2, D / 2
BOTTOM_H, TOP_Z = 0.0075, 0.0505
LENS_X, LENS_Z = -0.0065, 0.0315


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    m = cp.camera_materials()
    b = pl.Builder(NAME)

    b.box((W, D, BOTTOM_H), loc=(0, 0, BOTTOM_H / 2), mat=m["satin_silver"], corner=0.0095, corner_seg=5,
          bevel=0.0009, bevel_seg=2)
    b.box((W - 0.0007, D - 0.0007, TOP_Z - BOTTOM_H), loc=(0, 0, (TOP_Z + BOTTOM_H) / 2), mat=m["leatherette"],
          corner=0.0092, corner_seg=5, bevel=0.0003, bevel_seg=1)
    b.box((W, D, H - TOP_Z), loc=(0, 0, (H + TOP_Z) / 2), mat=m["satin_silver"], corner=0.0095, corner_seg=5,
          bevel=0.0013, bevel_seg=2)

    # lens: mount ring, knurled aperture ring, ribbed focus ring, black front ring, coated glass
    cp.lens(b, LENS_X, LENS_Z, FRONT, [
        (0.0262, 0.0262, 0.0020, "satin_silver", "plain"),
        (0.0256, 0.0256, 0.0068, "satin_silver", "knurl"),
        (0.0249, 0.0249, 0.0010, "satin_silver", "plain"),
        (0.0251, 0.0251, 0.0058, "satin_silver", "ribs"),
        (0.0241, 0.0237, 0.0032, "satin_silver", "plain"),
    ], glass_r=0.0168, glass_depth=0.0042, mats=m)
    for k in range(7):
        a = 70 + k * 7.5
        px = LENS_X + 0.02565 * math.cos(math.radians(a))
        pz = LENS_Z + 0.02565 * math.sin(math.radians(a))
        b.box((0.00025, 0.0012, 0.0001), loc=(px, FRONT - 0.0055, pz), rot=(0, 90 - a, 0), mat=m["paint_black"])

    # front: viewfinder window, AF lamp, viewfinder lever, lettering
    b.box((0.0215, 0.0014, 0.0152), loc=(0.0405, FRONT - 0.0003, 0.0612), mat=m["black_plastic"], bevel=0.0006,
          bevel_seg=2)
    b.box((0.0182, 0.0008, 0.0122), loc=(0.0405, FRONT - 0.0008, 0.0612), mat=m["glass"])
    cp.button(b, 0.0262, FRONT + 0.0002, 0.0641, 0.0019, 0.0007, m["black_plastic"], axis="-Y", dome=0.1)
    b.box((0.0062, 0.0024, 0.0028), loc=(-0.0470, FRONT - 0.0010, 0.0590), mat=m["satin_silver"], bevel=0.0007,
          bevel_seg=2)
    b.text("FUJIFILM", 0.0046, loc=(-0.0215, FRONT - 0.00006, 0.0662), rot=(90, 0, 0), mat=m["paint_black"],
           resolution=2, spacing=1.08)

    # top deck
    speeds = ["A", "4000", "2000", "1000", "500", "250", "125", "60", "30", "15", "8", "4", "2", "1", "T", "B"]
    cp.dial(b, -0.0245, 0.0025, H, 0.0125, 0.0086, m["satin_silver"], m["satin_silver"], ridges=30,
            labels=speeds, label_mat=m["paint_black"], label_size=0.0017, label_radius=0.0089, start_deg=95,
            sweep_deg=330)
    cp.dial(b, -0.0525, 0.0072, H, 0.0104, 0.0086, m["satin_silver"], m["satin_silver"], ridges=26,
            labels=["C", "+3", "2", "1", "0", "1", "2", "-3"], label_mat=m["paint_black"], label_size=0.0017,
            label_radius=0.0072, start_deg=100, sweep_deg=290)
    b.lathe([(0.0064, 0.0), (0.0064, 0.0021), (0.0058, 0.0024), (0.0, 0.0024)], 28, loc=(-0.0405, FRONT + 0.0083, H),
            mat=m["satin_silver"], radial=lambda i, j, r: r - 0.00025 * (i % 2) if j == 1 else r)
    b.box((0.0042, 0.0022, 0.0016), loc=(-0.0405 + 0.0072, FRONT + 0.0060, H + 0.0012), rot=(0, 0, 25),
          mat=m["satin_silver"], bevel=0.0005, bevel_seg=1)
    b.lathe([(0.0042, 0.0), (0.0042, 0.0034), (0.0036, 0.0038), (0.0016, 0.0038), (0.0013, 0.0031), (0.0, 0.0031)],
            24, loc=(-0.0405, FRONT + 0.0083, H + 0.0024), mat=m["chrome"], cap_start=False)
    cp.button(b, -0.0368, 0.0105, H, 0.0029, 0.0012, m["black_plastic"])
    b.box((0.0186, 0.0186, 0.0011), loc=(0.0105, 0.0002, H + 0.00055), mat=m["chrome"], bevel=0.0003, bevel_seg=1)
    for sy in (-1, 1):
        b.box((0.0186, 0.0024, 0.0019), loc=(0.0105, sy * 0.0081, H + 0.0018), mat=m["chrome"], bevel=0.0003,
              bevel_seg=1)
        b.box((0.0186, 0.0028, 0.0004), loc=(0.0105, sy * 0.0068, H + 0.0026), mat=m["chrome"])
    b.box((0.0100, 0.0090, 0.0006), loc=(0.0105, 0.0002, H + 0.0012), mat=m["black_plastic"])

    # back: screen, viewfinder eyepiece, buttons, focus lever, rear dial, thumb rest
    b.box((0.0690, 0.0016, 0.0500), loc=(0.0115, BACK + 0.0005, 0.0300), mat=m["black_plastic"], bevel=0.0008,
          bevel_seg=2)
    b.box((0.0640, 0.0006, 0.0460), loc=(0.0115, BACK + 0.0013, 0.0300), mat=m["screen"])
    b.box((0.0225, 0.0042, 0.0165), loc=(0.0455, BACK + 0.0017, 0.0640), mat=m["rubber"], bevel=0.0015, bevel_seg=2)
    b.box((0.0150, 0.0006, 0.0100), loc=(0.0455, BACK + 0.0039, 0.0640), mat=m["glass"])
    for bx, bz in ((-0.0335, 0.0170), (-0.0335, 0.0270), (-0.0335, 0.0370), (-0.0495, 0.0230), (-0.0495, 0.0330)):
        cp.button(b, bx, BACK + 0.0001, bz, 0.0027, 0.0011, m["black_plastic"], axis="Y")
    cp.button(b, -0.0420, BACK + 0.0001, 0.0455, 0.0021, 0.0030, m["rubber"], axis="Y", dome=0.6)
    b.cylinder(0.0072, 0.0052, segments=28, loc=(-0.0515, BACK - 0.0030, TOP_Z + 0.0168), mat=m["black_plastic"],
               bevel=0.0004)
    for k in range(4):
        b.box((0.0090, 0.0010, 0.0011), loc=(-0.0485, BACK + 0.0003, 0.0585 - k * 0.0022), mat=m["rubber"],
              bevel=0.0003, bevel_seg=1)

    for side in (-1, 1):
        cp.strap_lug(b, side * (W / 2 + 0.0012), 0.0040, 0.0610, side, m["chrome"])

    ob = b.finish(col, smooth_angle=32, seam_angle=48)
    ob["source"] = "made for this site"
    pl.report(NAME, col, 8000)
    pl.save_prop(NAME)


main()
