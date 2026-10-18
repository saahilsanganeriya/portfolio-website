"""computer_case: the desk's base unit, a late-1990s horizontal desktop PC in the CRT's cream, under T92's crt_shell.

It keeps the footprint of the base unit it replaces (room.blend, measured read-only: x -0.2199 .. 0.2315, y -0.2156 ..
0.2495) and its height, standing on the desk top (z 0.7316) on four rubber feet, with its top at z 0.8650: the plane the
CRT's stand foot stands on (crt_shell's origin, (0, 0.040, 0.865)). A moulded plastic bezel with a 5 mm rolled edge
carries a CD-ROM drive (tray seam, eject button, busy light, headphone socket and volume wheel), a 3.5-inch floppy
drive (slot, dust flap, eject button, light), a power button in a moulded ring, the power and disk lights, a front
grille and a plinth groove. Behind it a painted steel lid (9 mm bends, side vents, pan-head screws) on a base pan; the
back panel has the power supply's fan grille and inlet, the riser's slot covers, the ports and three thumbscrews.

Objects: computer_case (case, drives, controls), case_power_led and case_hdd_led (their own emissive materials, so the
site can light them). Origin: the centre of the footprint on the desk top, faces -Y. In the room it goes at
(0.0058, 0.0170, 0.7316) with no rotation or scale.
"""
import math
import os
import sys

import bmesh
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "computer_case"
# Every number below is in room coordinates (metres); the mesh is moved to the origin at the end.
X0, X1 = -0.2199, 0.2315
CX, HALF_W = (X0 + X1) / 2, (X1 - X0) / 2
DESK_Z, TOP_Z = 0.7316, 0.8650
BODY_Z0 = DESK_Z + 0.005
LID_Z0 = 0.7408
ORIGIN = Vector((CX, 0.0170, DESK_Z))
FACE_Y = -0.2150
BEZEL_BACK_Y = -0.1745
BACK_Y, REAR_Y = 0.2455, 0.2495
TOP_R, BEZEL_BOT_R, LID_BOT_R = 0.009, 0.003, 0.0015
ROLL = 0.005
CORNER_SEGMENTS = 6
CRT_FOOT = (0.0, 0.040)

CD_BAY = (0.0435, 0.1925, 0.8085, 0.8525)
FLOPPY_BAY = (0.0680, 0.1680, 0.7700, 0.7960)
POWER_AT = (-0.1700, 0.8245)
LEDS_X, POWER_LED_Z, HDD_LED_Z = -0.1430, 0.8305, 0.8185


def outline(cx, cz, a, b, r_top, r_bot):
    """Closed (x, z) loop round a rectangle with rounded corners; the same vertex count for any size."""
    pts = []
    for ccx, ccz, r, a0 in ((cx + a - r_top, cz + b - r_top, r_top, 0.0), (cx - a + r_top, cz + b - r_top, r_top, 0.5),
                            (cx - a + r_bot, cz - b + r_bot, r_bot, 1.0), (cx + a - r_bot, cz - b + r_bot, r_bot, 1.5)):
        for k in range(CORNER_SEGMENTS + 1):
            ang = math.pi * a0 + (math.pi / 2) * k / CORNER_SEGMENTS
            pts.append((ccx + r * math.cos(ang), ccz + r * math.sin(ang)))
    return pts


def inset_outline(z0, z1, inset, r_top, r_bot):
    a, b = HALF_W - inset, (z1 - z0) / 2 - inset
    return outline(CX, (z0 + z1) / 2, a, b, max(r_top - inset, 0.0005), max(r_bot - inset, 0.0005))


def loft(b, rings, mat):
    """Skin (y, outline) rings into one closed solid, capped at both ends."""
    bm = b.bm
    before = set(bm.faces)
    loops = [[bm.verts.new((x, y, z)) for x, z in pts] for y, pts in rings]
    n = len(loops[0])
    for k in range(len(loops) - 1):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((loops[k][i], loops[k][j], loops[k + 1][j], loops[k + 1][i]))
    bm.faces.new(loops[0])
    bm.faces.new(loops[-1])
    new = [f for f in bm.faces if f not in before]
    bmesh.ops.recalc_face_normals(bm, faces=new)
    mi = b.slot(mat)
    for f in new:
        f.material_index = mi
    return new


def slot_box(b, x0, x1, z0, z1, y0, y1, mat, r=None, seg=2):
    """A box from (x0, y0, z0) to (x1, y1, z1) with its edges along Y rounded (radius r, default the half height)."""
    w, h = x1 - x0, z1 - z0
    r = min(w, h) / 2 - 1e-5 if r is None else r
    return b.box((w, y1 - y0, h), loc=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), mat=mat, corner=r,
                 corner_seg=seg, corner_axis="Y")


def obj_from(b, col):
    return b.finish(col, weighted=False, unwrap=False)


def cut(target, cutters, col, bevel=0.0, bevel_seg=1):
    """Boolean the cutters (each a Builder, its faces carrying the material the cut walls take) out of target."""
    for cb in cutters:
        cutter = obj_from(cb, col)
        mod = target.modifiers.new("cut", "BOOLEAN")
        mod.operation, mod.solver, mod.material_mode = "DIFFERENCE", "EXACT", "TRANSFER"
        mod.object = cutter
        pl.apply_modifier(target, mod)
        bpy.data.objects.remove(cutter)
    if bevel > 0:
        mod = target.modifiers.new("soften", "BEVEL")
        mod.width, mod.segments, mod.limit_method = bevel, bevel_seg, "ANGLE"
        mod.angle_limit = math.radians(40)
        mod.use_clamp_overlap = True
        pl.apply_modifier(target, mod)
    return target


def build_bezel(col, m):
    b = pl.Builder("bezel")
    rings = [(FACE_Y, inset_outline(BODY_Z0, TOP_Z, ROLL, TOP_R, BEZEL_BOT_R))]
    for deg in (22.5, 45.0, 67.5, 90.0):
        s, d = ROLL * math.sin(math.radians(deg)), ROLL * (1 - math.cos(math.radians(deg)))
        rings.append((FACE_Y + d, inset_outline(BODY_Z0, TOP_Z, ROLL - s, TOP_R, BEZEL_BOT_R)))
    rings += [(BEZEL_BACK_Y - 0.001, inset_outline(BODY_Z0, TOP_Z, 0.0, TOP_R, BEZEL_BOT_R)),
              (BEZEL_BACK_Y, inset_outline(BODY_Z0, TOP_Z, 0.001, TOP_R, BEZEL_BOT_R))]
    loft(b, rings, m["plastic"])
    bezel = obj_from(b, col)

    dark = pl.Builder("cut_dark")
    y0, y1 = FACE_Y - 0.006, FACE_Y + 0.010
    for x0, x1, z0, z1 in (CD_BAY, FLOPPY_BAY):
        slot_box(dark, x0, x1, z0, z1, y0, y1, m["dark"], r=0.0015)
    # the front grille: six slots with round ends; the plinth groove across the foot of the face
    for i in range(6):
        z = 0.7600 + 0.0065 * i
        slot_box(dark, -0.1980, -0.0200, z - 0.0015, z + 0.0015, y0, FACE_Y + 0.006, m["dark"])
    slot_box(dark, X0 + 0.012, X1 - 0.012, 0.7448, 0.7462, y0, FACE_Y + 0.0012, m["dark"])
    for z in (POWER_LED_Z, HDD_LED_Z):
        slot_box(dark, LEDS_X - 0.0034, LEDS_X + 0.0034, z - 0.0019, z + 0.0019, y0, FACE_Y + 0.0015, m["dark"],
                 r=0.0008)
    ring = pl.Builder("cut_ring")
    ring.cylinder(0.0115, 0.009, segments=28, loc=(POWER_AT[0], FACE_Y - 0.006, POWER_AT[1]), rot=(-90, 0, 0),
                  mat=m["plastic"])
    return cut(bezel, [dark, ring], col, bevel=0.0005, bevel_seg=2)


def build_lid(col, m):
    b = pl.Builder("lid")
    full = inset_outline(LID_Z0, TOP_Z, 0.0, TOP_R, LID_BOT_R)
    rings = [(BEZEL_BACK_Y - 0.0003, inset_outline(LID_Z0, TOP_Z, 0.0015, TOP_R, LID_BOT_R)),
             (BEZEL_BACK_Y + 0.0012, full), (REAR_Y - 0.0015, full),
             (REAR_Y, inset_outline(LID_Z0, TOP_Z, 0.0015, TOP_R, LID_BOT_R)),
             (REAR_Y, inset_outline(LID_Z0, TOP_Z, 0.0050, TOP_R, LID_BOT_R)),
             (BACK_Y, inset_outline(LID_Z0, TOP_Z, 0.0050, TOP_R, LID_BOT_R))]
    loft(b, rings, m["lid"])
    lid = obj_from(b, col)

    dark = pl.Builder("cut_lid")
    # side vents: two banks of 11 slots, 3 x 30 mm, beside the drive bays
    for x_face, sign in ((X0, -1), (X1, 1)):
        for i in range(11):
            y = -0.1450 + 0.0075 * i
            dark.box((0.010, 0.003, 0.030), loc=(x_face - sign * 0.002, y, 0.8030), mat=m["dark"], corner=0.00145,
                     corner_seg=1, corner_axis="X")
    # back panel: the fan grille (slots cut to a 72 mm circle), the inlet, the ports
    fx, fz, fr = 0.1600, 0.8040, 0.036
    for i in range(-3, 4):
        z = fz + i * 0.0095
        half = math.sqrt(max(fr * fr - (i * 0.0095) ** 2, 0.0)) - 0.002
        slot_box(dark, fx - half, fx + half, z - 0.0016, z + 0.0016, BACK_Y - 0.004, BACK_Y + 0.004, m["dark"], seg=1)
    slot_box(dark, 0.0740, 0.1020, 0.8180, 0.8380, BACK_Y - 0.006, BACK_Y + 0.004, m["dark"], r=0.003)
    slot_box(dark, 0.0820, 0.0940, 0.7820, 0.7900, BACK_Y - 0.003, BACK_Y + 0.004, m["dark"], r=0.0008)
    for x, w in ((-0.0090, 0.040), (0.0310, 0.018)):
        dsub = pl.round_polygon([(-w / 2, 0.0045), (w / 2, 0.0045), (w / 2 - 0.002, -0.0045),
                                 (-w / 2 + 0.002, -0.0045)], 0.0012, 2)
        dark.extrude(dsub, 0.008, loc=(x, BACK_Y, 0.8260), mat=m["dark"])
    for x in (-0.0170, 0.0030):
        dark.cylinder(0.0048, 0.008, segments=12, loc=(x, BACK_Y - 0.004, 0.7960), rot=(-90, 0, 0), mat=m["dark"])
    dsub = pl.round_polygon([(-0.0085, 0.0045), (0.0085, 0.0045), (0.0068, -0.0045), (-0.0068, -0.0045)], 0.0012, 2)
    dark.extrude(dsub, 0.008, loc=(0.0310, BACK_Y, 0.7960), mat=m["dark"])
    return cut(lid, [dark], col)


def build_cd_drive(col, m):
    x0, x1, z0, z1 = CD_BAY
    cx = (x0 + x1) / 2
    b = pl.Builder("cd")
    slot_box(b, x0 + 0.0015, x1 - 0.0015, z0 + 0.0015, z1 - 0.0015, FACE_Y + 0.0015, FACE_Y + 0.016, m["drive"],
             r=0.001)
    plate = obj_from(b, col)
    dark = pl.Builder("cut_cd")
    tray_z = z1 - 0.0145
    slot_box(dark, cx - 0.0625, cx + 0.0625, tray_z - 0.0065, tray_z + 0.0065, FACE_Y, FACE_Y + 0.0045, m["dark"],
             r=0.0008)
    slot_box(dark, x0 + 0.0130, x0 + 0.0240, z0 + 0.0085, z0 + 0.0115, FACE_Y, FACE_Y + 0.0060, m["dark"])
    dark.cylinder(0.0019, 0.008, segments=10, loc=(x0 + 0.0075, FACE_Y, z0 + 0.0100), rot=(-90, 0, 0), mat=m["dark"])
    for x, w in ((x1 - 0.0300, 0.0042), (x1 - 0.0150, 0.0150)):
        slot_box(dark, x - w / 2, x + w / 2, z0 + 0.0075, z0 + 0.0125, FACE_Y, FACE_Y + 0.0035, m["dark"],
                 r=0.0008)
    plate = cut(plate, [dark], col, bevel=0.0003)

    parts = pl.Builder("cd_parts")
    # the tray's front, flush with the drive and ringed by its seam
    slot_box(parts, cx - 0.0615, cx + 0.0615, tray_z - 0.0055, tray_z + 0.0055, FACE_Y + 0.0018, FACE_Y + 0.0050,
             m["drive"], r=0.0005)
    parts.box((0.0136, 0.003, 0.0040), loc=(x1 - 0.0150, FACE_Y + 0.0021, z0 + 0.0100), mat=m["button"],
              corner=0.0012, corner_seg=3, corner_axis="Y", bevel=0.0003)
    parts.box((0.0036, 0.002, 0.0020), loc=(x1 - 0.0300, FACE_Y + 0.0025, z0 + 0.0100), mat=m["amber_lens"],
              corner=0.0006, corner_seg=2, corner_axis="Y")
    # the volume wheel's knurled rim, showing through its slot
    parts.lathe([(0.0060, 0.0), (0.0060, 0.0026)], segments=28, loc=(x0 + 0.0185, FACE_Y + 0.0072, z0 + 0.0100),
                rot=(0, 90, 0), mat=m["wheel"], cap_start=True, cap_end=True,
                radial=lambda i, j, r: r + (0.0003 if i % 2 else 0.0))
    return [plate, obj_from(parts, col)]


def build_floppy_drive(col, m):
    x0, x1, z0, z1 = FLOPPY_BAY
    cx = (x0 + x1) / 2
    b = pl.Builder("floppy")
    slot_box(b, x0 + 0.0015, x1 - 0.0015, z0 + 0.0015, z1 - 0.0015, FACE_Y + 0.0015, FACE_Y + 0.016, m["drive"],
             r=0.001)
    plate = obj_from(b, col)
    dark = pl.Builder("cut_floppy")
    slot_z = z1 - 0.0080
    slot_box(dark, cx - 0.0450, cx + 0.0450, slot_z - 0.0022, slot_z + 0.0022, FACE_Y, FACE_Y + 0.0080, m["dark"],
             r=0.0012)
    slot_box(dark, x1 - 0.0230, x1 - 0.0100, z0 + 0.0040, z0 + 0.0095, FACE_Y, FACE_Y + 0.0040, m["dark"], r=0.001)
    slot_box(dark, x0 + 0.0090, x0 + 0.0140, z0 + 0.0055, z0 + 0.0080, FACE_Y, FACE_Y + 0.0035, m["dark"], r=0.0006)
    plate = cut(plate, [dark], col, bevel=0.0003)

    parts = pl.Builder("floppy_parts")
    parts.box((0.0880, 0.0010, 0.0038), loc=(cx, FACE_Y + 0.0040, slot_z), rot=(-8, 0, 0), mat=m["flap"])
    parts.box((0.0116, 0.0035, 0.0043), loc=(x1 - 0.0165, FACE_Y + 0.0020, z0 + 0.00675), mat=m["button"],
              corner=0.0012, corner_seg=3, corner_axis="Y", bevel=0.0003)
    parts.box((0.0042, 0.002, 0.0017), loc=(x0 + 0.0115, FACE_Y + 0.0026, z0 + 0.00675), mat=m["green_lens"],
              corner=0.0005, corner_seg=2, corner_axis="Y")
    return [plate, obj_from(parts, col)]


def build_hardware(col, m):
    b = pl.Builder("hardware")
    # the base pan under the lid, the rubber feet
    b.box((2 * HALF_W - 0.0024, REAR_Y - 0.0010 - BEZEL_BACK_Y, LID_Z0 + 0.0004 - BODY_Z0),
          loc=(CX, (REAR_Y - 0.0010 + BEZEL_BACK_Y) / 2, (LID_Z0 + 0.0004 + BODY_Z0) / 2), mat=m["lid"], bevel=0.0008)
    for x in (X0 + 0.035, X1 - 0.035):
        for y in (-0.175, 0.215):
            b.cylinder(0.010, BODY_Z0 - DESK_Z + 0.0005, segments=10, loc=(x, y, DESK_Z), mat=m["rubber"])
    # the power button in its moulded ring
    b.cylinder(0.0086, 0.0034, segments=24, loc=(POWER_AT[0], FACE_Y - 0.0004, POWER_AT[1]), rot=(-90, 0, 0),
               mat=m["button"], bevel=0.0012)
    # pan-head screws low on the lid's sides; thumbscrews on the back holding the lid
    for x_face, sign in ((X0, -1), (X1, 1)):
        for y in (-0.1580, 0.2320):
            b.cylinder(0.0032, 0.0008, segments=10, loc=(x_face - sign * 0.0004, y, 0.7480),
                       rot=(0, 90 * sign, 0), mat=m["screw"])
    for x, z in ((X0 + 0.0140, 0.8500), (CX, 0.8530), (X1 - 0.0140, 0.8500)):
        b.lathe([(0.0, 0.0), (0.0042, 0.0), (0.0045, 0.0006), (0.0045, 0.0030), (0.0038, 0.0040), (0.0, 0.0040)],
                segments=16, loc=(x, BACK_Y, z), rot=(-90, 0, 0), mat=m["screw"],
                radial=lambda i, j, r: r - (0.00035 if i % 2 and j in (2, 3) else 0.0))
    # the riser's three slot covers, each held by a screw
    for z in (0.7710, 0.7890, 0.8070):
        b.box((0.1500, 0.0012, 0.0150), loc=(-0.1150, BACK_Y + 0.0006, z), mat=m["steel"], bevel=0.0003)
        b.cylinder(0.0028, 0.0015, segments=8, loc=(-0.1960, BACK_Y, z), rot=(-90, 0, 0), mat=m["screw"])
    b.box((0.0090, 0.0030, 0.0050), loc=(0.0880, BACK_Y - 0.0005, 0.7860), mat=m["red"], bevel=0.0004)
    return obj_from(b, col)


def build_led(col, name, z, colour, strength):
    b = pl.Builder(name)
    mat = pl.surface(name, tuple(c * 0.25 for c in colour), 0.2, emission=(colour, strength), color_var=0.0,
                     edge_width=0.0003)
    b.box((0.0052, 0.0022, 0.0024), loc=(LEDS_X, FACE_Y + 0.0004, z), mat=mat, corner=0.0007, corner_seg=3,
          corner_axis="Y", bevel=0.0003)
    return b.finish(col, smooth_angle=60)


def materials():
    # the CRT's ABS recipe (crt_plastic) for the bezel, so the two read as one set; the lid is painted steel in the
    # same cream with an orange-peel finish, dust on the top and paint worn pale on the edges
    plastic = pl.surface("case_plastic", (0.675, 0.603, 0.452), 0.5, color_var=0.035, grime=0.35, dust=0.35,
                         edge_wear=0.18, edge_color=(0.72, 0.66, 0.52), edge_roughness=0.38, smudges=0.05,
                         micro_bump=(900.0, 0.035), specular=0.4, edge_width=0.002)
    lid = pl.surface("case_lid", (0.668, 0.604, 0.462), 0.46, color_var=0.03, grime=0.3, dust=0.45, edge_wear=0.2,
                     edge_color=(0.74, 0.69, 0.57), edge_roughness=0.34, smudges=0.03, scratches=0.04,
                     micro_bump=(520.0, 0.05), specular=0.45, edge_width=0.0015)
    drive = pl.surface("case_drive", (0.700, 0.645, 0.515), 0.42, color_var=0.025, grime=0.4, dust=0.2,
                       edge_wear=0.2, edge_color=(0.75, 0.70, 0.58), smudges=0.08, micro_bump=(1200.0, 0.02),
                       specular=0.45, edge_width=0.0008)
    button = pl.surface("case_button", (0.60, 0.54, 0.405), 0.42, color_var=0.02, grime=0.4, edge_wear=0.3,
                        smudges=0.12, edge_width=0.0006)
    return {
        "plastic": plastic, "lid": lid, "drive": drive, "button": button,
        "dark": pl.surface("case_dark", (0.03, 0.028, 0.025), 0.85, color_var=0.0),
        "flap": pl.surface("case_flap", (0.075, 0.073, 0.07), 0.45, color_var=0.0, edge_wear=0.3,
                           edge_color=(0.16, 0.16, 0.15), edge_width=0.0004),
        "wheel": pl.surface("case_wheel", (0.10, 0.095, 0.09), 0.55, color_var=0.0),
        "rubber": pl.surface("case_rubber", (0.035, 0.034, 0.033), 0.9, color_var=0.0),
        "screw": pl.surface("case_screw", (0.62, 0.60, 0.56), 0.32, metallic=1.0, color_var=0.04, grime=0.5,
                            edge_width=0.0004),
        "steel": pl.surface("case_slot_cover", (0.58, 0.58, 0.56), 0.38, metallic=0.85, color_var=0.05, grime=0.4,
                            scratches=0.06, edge_width=0.0004),
        "red": pl.surface("case_switch", (0.45, 0.06, 0.04), 0.4, color_var=0.0),
        "amber_lens": pl.surface("case_lens_amber", (0.22, 0.10, 0.02), 0.12, color_var=0.0, coat=0.6),
        "green_lens": pl.surface("case_lens_green", (0.05, 0.16, 0.06), 0.12, color_var=0.0, coat=0.6),
    }


def ray_down(ob, x, y):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    inv = ob.matrix_world.inverted()
    hit, loc, *_ = ob.ray_cast(inv @ Vector((x, y, 2.0)), inv.to_3x3() @ Vector((0, 0, -1)), depsgraph=depsgraph)
    return (ob.matrix_world @ loc).z if hit else None


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    m = materials()
    parts = [build_bezel(col, m), build_lid(col, m), build_hardware(col, m)]
    parts += build_cd_drive(col, m) + build_floppy_drive(col, m)
    case = pl.join(parts, NAME)
    me = case.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method="BEAUTY",
                          ngon_method="BEAUTY")
    bmesh.ops.transform(bm, matrix=Matrix.Translation(-ORIGIN), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    case.matrix_world = Matrix.Identity(4)
    pl.finish_object(case, smooth_angle=34, seam_angle=48)
    case["source"] = "made for this site"
    case["room_location_m"] = list(ORIGIN)

    for name, z, colour, strength in (("case_power_led", POWER_LED_Z, (0.32, 1.0, 0.42), 3.0),
                                      ("case_hdd_led", HDD_LED_Z, (1.0, 0.55, 0.12), 1.5)):
        led = build_led(col, name, z, colour, strength)
        led.data.transform(Matrix.Translation(-ORIGIN))
        pl.parent_keep_transform(led, case)

    # Check the contract at the room position: the top the CRT's foot stands on, and the footprint.
    case.matrix_world = Matrix.Translation(ORIGIN)
    bpy.context.view_layer.update()
    tops = [ray_down(case, CRT_FOOT[0] + dx, CRT_FOOT[1] + dy) for dx in (-0.1, 0.0, 0.1) for dy in (-0.06, 0.0, 0.1)]
    print(f"CASE_TOP at the CRT foot: min {min(tops):.5f} max {max(tops):.5f} (target {TOP_Z})")
    world = [case.matrix_world @ v.co for v in me.vertices]
    lo = [min(p[i] for p in world) for i in range(3)]
    hi = [max(p[i] for p in world) for i in range(3)]
    print(f"CASE_BOUNDS lo {tuple(round(v, 5) for v in lo)} hi {tuple(round(v, 5) for v in hi)}")
    case.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()
    pl.report(NAME, col, 12000)
    pl.save_prop(NAME)


main()
