"""super8_camera: a 1970s Super 8 cine camera standing on its pistol grip (about 22 cm long, 19 cm tall).

Black body with brushed aluminium side panels, a zoom lens with knurled zoom and ribbed focus rings and a
flared hood, a viewfinder housing ending in a rubber eyecup, a pistol grip with a run trigger, a cartridge door
lettered "SUPER 8", a power-zoom rocker, frame-rate dial and footage counter. Unbranded. One object; the lens
faces -Y, origin at the base of the grip.
"""
import math
import os
import sys

import bmesh

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_camera_parts as cp  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "super8_camera"
BW, BL, BH = 0.060, 0.150, 0.088
BODY_Z0 = 0.092
BODY_Y0 = -0.068
LENS_X, LENS_Z = -0.003, BODY_Z0 + 0.050


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    m = cp.camera_materials()
    b = pl.Builder(NAME)
    y_mid = BODY_Y0 + BL / 2

    b.box((BW, BL, BH), loc=(0, y_mid, BODY_Z0 + BH / 2), mat=m["black_paint"], corner=0.0095, corner_seg=4,
          corner_axis="Y", bevel=0.0016, bevel_seg=2)
    for side in (-1, 1):
        b.box((0.0012, BL - 0.030, BH - 0.024), loc=(side * (BW / 2 + 0.0002), y_mid + 0.004, BODY_Z0 + BH / 2 - 0.002),
              mat=m["satin_silver"], bevel=0.0004, bevel_seg=1)

    # cartridge door on the +X side with latch, window and lettering
    door_x = BW / 2 + 0.0010
    b.box((0.0016, 0.094, 0.056), loc=(door_x, y_mid + 0.010, BODY_Z0 + 0.040), mat=m["satin_silver"],
          corner=0.006, corner_seg=3, corner_axis="X", bevel=0.0006, bevel_seg=1)
    b.box((0.0016, 0.020, 0.0060), loc=(door_x + 0.0012, y_mid + 0.048, BODY_Z0 + 0.040), mat=m["black_plastic"],
          bevel=0.0006, bevel_seg=1)
    b.box((0.0008, 0.016, 0.0090), loc=(door_x + 0.0008, y_mid - 0.018, BODY_Z0 + 0.054), mat=m["glass"])
    b.text("SUPER 8", 0.0070, loc=(door_x + 0.00085, y_mid + 0.004, BODY_Z0 + 0.026), rot=(90, 0, 90),
           mat=m["paint_black"], resolution=2, spacing=1.12)

    # controls on the -X side: power zoom rocker, frame-rate dial, footage counter
    sx = -BW / 2 - 0.0008
    b.box((0.0050, 0.0200, 0.0080), loc=(sx - 0.0018, BODY_Y0 + 0.024, BODY_Z0 + BH - 0.016), mat=m["black_plastic"],
          corner=0.0035, corner_seg=3, corner_axis="X", bevel=0.0008, bevel_seg=1)
    before = set(b.bm.faces)
    cp.dial(b, 0.0, 0.0, 0.0, 0.0085, 0.0040, m["black_plastic"], m["black_plastic"], ridges=18)
    dial_faces = [f for f in b.bm.faces if f not in before]
    bmesh.ops.transform(b.bm, matrix=pl.xform(loc=(sx, y_mid + 0.020, BODY_Z0 + 0.066), rot=(0, -90, 0)),
                        verts=list({v for f in dial_faces for v in f.verts}))
    b.box((0.0010, 0.0150, 0.0085), loc=(sx - 0.0002, y_mid + 0.045, BODY_Z0 + 0.066), mat=m["glass"])
    b.text("18  24", 0.0032, loc=(sx - 0.0008, y_mid + 0.020, BODY_Z0 + 0.0565), rot=(90, 0, -90),
           mat=m["paint_white"], resolution=1)

    # viewfinder housing on top, eyecup at the back
    vf_y0, vf_y1 = BODY_Y0 + 0.030, BODY_Y0 + BL + 0.006
    b.box((0.028, vf_y1 - vf_y0, 0.018), loc=(0.010, (vf_y0 + vf_y1) / 2, BODY_Z0 + BH + 0.007), mat=m["black_paint"],
          corner=0.0070, corner_seg=3, corner_axis="Y", bevel=0.0012, bevel_seg=2)
    b.lathe([(0.0105, 0.0), (0.0110, 0.0060), (0.0145, 0.0170), (0.0155, 0.0240), (0.0140, 0.0262),
             (0.0108, 0.0250), (0.0080, 0.0150), (0.0070, 0.0040)], 24, loc=(0.010, vf_y1 - 0.002, BODY_Z0 + BH + 0.004),
            rot=(-90, 0, 0), mat=m["rubber"], cap_start=False, cap_end=False)
    b.cylinder(0.0075, 0.0010, segments=20, loc=(0.010, vf_y1 + 0.0035, BODY_Z0 + BH + 0.004), rot=(-90, 0, 0),
               mat=m["glass"])
    cp.button(b, -0.0160, BODY_Y0 + 0.030, BODY_Z0 + BH, 0.0040, 0.0030, m["chrome"])
    b.cylinder(0.0045, 0.0012, segments=16, loc=(0.0220, BODY_Y0 - 0.0001, BODY_Z0 + BH - 0.012), rot=(90, 0, 0),
               mat=m["glass"])

    # zoom lens: mount, knurled zoom ring with lever, ribbed focus ring, barrel, flared hood
    reach = cp.lens(b, LENS_X, LENS_Z, BODY_Y0, [
        (0.0262, 0.0262, 0.0040, "black_anodised", "plain"),
        (0.0276, 0.0276, 0.0200, "black_plastic", "knurl"),
        (0.0270, 0.0270, 0.0030, "black_anodised", "plain"),
        (0.0290, 0.0290, 0.0150, "black_anodised", "ribs"),
        (0.0282, 0.0282, 0.0100, "black_anodised", "plain"),
        (0.0290, 0.0322, 0.0120, "black_anodised", "plain"),
    ], glass_r=0.0215, glass_depth=0.0110, mats=m)
    b.box((0.0060, 0.0110, 0.0060), loc=(LENS_X - 0.0300, BODY_Y0 - 0.014, LENS_Z - 0.008), rot=(0, 20, 0),
          mat=m["black_plastic"], bevel=0.0015, bevel_seg=2)
    for k in range(7):
        a = math.radians(70 + k * 6.5)
        b.box((0.00025, 0.0014, 0.0001), loc=(LENS_X + 0.02825 * math.cos(a), BODY_Y0 - 0.0425,
                                             LENS_Z + 0.02825 * math.sin(a)), rot=(0, 90 - math.degrees(a), 0),
              mat=m["paint_white"])

    # pistol grip, leaning forward, with a run trigger and a flat rubber foot
    grip_tilt = 12.0
    grip_top = (0.0, BODY_Y0 + 0.052, BODY_Z0 + 0.004)
    grip_len = 0.096
    grip_centre_y = grip_top[1] + math.sin(math.radians(grip_tilt)) * grip_len / 2
    b.box((0.034, 0.044, grip_len), loc=(0.0, grip_centre_y, grip_top[2] - grip_len / 2 + 0.004), rot=(grip_tilt, 0, 0),
          mat=m["leatherette"], corner=0.012, corner_seg=4, corner_axis="Z", bevel=0.003, bevel_seg=2)
    foot_y = grip_centre_y + math.sin(math.radians(grip_tilt)) * grip_len / 2
    b.box((0.036, 0.046, 0.0060), loc=(0.0, foot_y, 0.0030), mat=m["rubber"], corner=0.012, corner_seg=4,
          bevel=0.0012, bevel_seg=2)
    b.box((0.012, 0.010, 0.022), loc=(0.0, grip_top[1] - 0.0215, grip_top[2] - 0.019), rot=(grip_tilt, 0, 0),
          mat=m["chrome"], corner=0.004, corner_seg=3, corner_axis="X", bevel=0.0012, bevel_seg=2)

    bmesh.ops.translate(b.bm, vec=(0.0, -foot_y, 0.0), verts=b.bm.verts)
    ob = b.finish(col, smooth_angle=32, seam_angle=48)
    ob["source"] = "made for this site"
    pl.report(NAME, col, 8000)
    pl.save_prop(NAME)


main()
