"""crt_shell: the desk monitor's case, a late-1980s 17-inch-class CRT in cream ABS, built around the room's screen.

The screen opening, the glass behind it and the site's OS hole stay where Henry Heffernan's monitor had them: the case
is lofted from rounded-rectangle rings that start at the opening as build_room.crt_opening() measures it (0.344 x
0.270 m, centred 1.140 m above the floor and 85 mm in front of the desk's centre line, square corners) and run out
over a moulded bezel (a 45-degree inner lip back to the glass, a flat face tilted 3 degrees like the tube, a 12 mm
rolled edge with a slight draft), a parting groove, the front box, a shoulder, the taper that encloses the tube's
funnel, and the neck housing with vent slots on its top and sides. A swivel stand sits under it; the chin carries the
power button, the power light and the flat where the SANGANERIYA badge sits.

Objects: crt_shell (case, stand, button), crt_power_led (its own emissive material, so the site can light it), the
empties crt_screen (the screen's pose, extras width_m / height_m) and crt_badge_seat. Origin: the centre of the
stand's foot on the computer's top, faces -Y. In the room it goes at (0, 0.040, 0.865) with no rotation or scale.
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

NAME = "crt_shell"
# Where the prop's origin goes in the room (world metres); every number below is in room coordinates.
ORIGIN = Vector((0.0, 0.040, 0.865))
TILT = math.tan(math.radians(3.0))  # the tube and the bezel lean back 3 degrees

# The opening as the room measures it (2 mm rays along +Y): half-width 0.17232 m, from z 1.0036 to 1.2751.
OPEN_CZ, OPEN_A, OPEN_B, OPEN_R = 1.13935, 0.17232, 0.13575, 0.0005
# The glass plane (build_room.build_crt_glass) and the bezel's face plane (through the badge's seat).
GLASS_Y0, GLASS_Z0 = -0.085, 1.14
FACE_Y0, FACE_Z0 = -0.1174, 0.9362
# The bezel's outline: x +-0.2225, z 0.905 .. 1.327 (Henry's footprint), a 12 mm rolled edge.
BEZEL_CZ, BEZEL_A, BEZEL_B, BEZEL_R, ROLL = 1.116, 0.2225, 0.211, 0.028, 0.012
# The ray test counts a hit as inside the opening when it lands behind y = -0.09; every lip face stays in front.
RAY_INSIDE_Y = -0.09


def glass_y(z):
    return GLASS_Y0 + (z - GLASS_Z0) * TILT


def face_y(z):
    return FACE_Y0 + (z - FACE_Z0) * TILT


def fractions(margin_steps, slots, slot_w, bar_w):
    """0..1 stops along a flat edge: evenly spaced margins either side of a block of slots (slot, bar, slot, ...)."""
    block = slots * slot_w + (slots - 1) * bar_w
    margin = (1.0 - block) / 2
    stops = [margin * i / margin_steps for i in range(margin_steps + 1)]
    x = margin
    slot_starts = []
    for i in range(slots):
        slot_starts.append(len(stops) - 1)
        x += slot_w
        stops.append(x)
        if i < slots - 1:
            x += bar_w
            stops.append(x)
    stops += [1.0 - margin * (margin_steps - i) / margin_steps for i in range(1, margin_steps + 1)]
    return stops, slot_starts


# Stops along the top and side flats, shared by every ring so the loft's columns line up: the neck housing's vents are
# cut between them (12 slots 4 mm wide on 12 mm centres across its top, 6 on 11 mm centres on each side).
TOP_STOPS, TOP_SLOTS = fractions(2, 12, 0.004 / 0.21, 0.008 / 0.21)
SIDE_STOPS, SIDE_SLOTS = fractions(3, 6, 0.004 / 0.189, 0.007 / 0.189)
BOTTOM_STOPS = [i / 8 for i in range(9)]
CORNER_SEGMENTS = 6


def ring_outline(cz, a, b, r):
    """Closed loop of (x, z) round a rounded rectangle, the same vertex count for any size; returns (points, sections)
    where sections maps a flat ('top', 'right', 'bottom', 'left') to the loop index of its first stop."""
    r = min(r, a - 1e-4, b - 1e-4)
    pts, sections = [], {}

    def flat(name, p0, p1, stops):
        sections[name] = len(pts)
        for f in stops[:-1]:
            pts.append((p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f))

    def corner(cx, cz_, a0):
        for k in range(CORNER_SEGMENTS):
            ang = a0 - (math.pi / 2) * k / CORNER_SEGMENTS
            pts.append((cx + r * math.cos(ang), cz_ + r * math.sin(ang)))

    ia, ib = a - r, b - r
    flat("top", (-ia, cz + b), (ia, cz + b), TOP_STOPS)
    corner(ia, cz + ib, math.pi / 2)
    flat("right", (a, cz + ib), (a, cz - ib), SIDE_STOPS)
    corner(ia, cz - ib, 0.0)
    flat("bottom", (ia, cz - b), (-ia, cz - b), BOTTOM_STOPS)
    corner(-ia, cz - ib, -math.pi / 2)
    flat("left", (-a, cz - ib), (-a, cz + ib), [1.0 - f for f in reversed(SIDE_STOPS)])
    corner(-ia, cz + ib, math.pi)
    return pts, sections


def lerp(a, b, t):
    return a + (b - a) * t


def rings():
    """The loft's rings from the sleeve's free end to the back: (cz, a, b, r, y(z), tag)."""
    out = []
    # The opening's lip, offset s outward and d behind the face: a sleeve back toward the glass, a filleted 45-degree
    # lip, the face. Lip faces stay in front of RAY_INSIDE_Y, so the opening still measures 0.344 x 0.270.
    sleeve_depth = (glass_y(1.0) - face_y(1.0)) - 0.002
    for s, d, tag in ((0.0, sleeve_depth, "sleeve_end"), (0.0, 0.0086, ""), (0.00045, 0.00755, ""),
                      (0.0082, 0.0008, ""), (0.0092, 0.00015, ""), (0.0102, 0.0, "face_inner")):
        out.append((OPEN_CZ, OPEN_A + s, OPEN_B + s, OPEN_R + s, (lambda z, d=d: face_y(z) + d), tag))
    # The face's outer edge, then the rolled edge round to the side walls.
    fa, fb, fr = BEZEL_A - ROLL, BEZEL_B - ROLL, BEZEL_R - ROLL
    out.append((BEZEL_CZ, fa, fb, fr, face_y, "face_outer"))
    for deg in (22.5, 45.0, 67.5, 90.0):
        s, d = ROLL * math.sin(math.radians(deg)), ROLL * (1 - math.cos(math.radians(deg)))
        out.append((BEZEL_CZ, fa + s, fb + s, fr + s, (lambda z, d=d: face_y(z) + d), ""))
    # Side walls back to the parting line (1 mm of draft), the groove, the rear cover's front box.
    for inset, y, tag in ((0.0010, -0.0720, ""), (0.0026, -0.0720, "groove"), (0.0026, -0.0702, ""),
                          (0.0015, -0.0702, "cover"), (0.0030, 0.0280, "")):
        out.append((BEZEL_CZ, BEZEL_A - inset, BEZEL_B - inset, BEZEL_R - inset, (lambda z, y=y: y), tag))
    # The shoulder and the taper round the tube's funnel, then a short round into the neck housing.
    for y, a, b, cz, r, tag in ((0.044, 0.2172, 0.2052, 1.1172, 0.026, ""), (0.060, 0.2110, 0.1975, 1.1205, 0.028, ""),
                                (0.076, 0.2030, 0.1895, 1.1250, 0.030, "taper"),
                                (0.205, 0.1320, 0.1220, 1.1500, 0.024, ""), (0.213, 0.1275, 0.1172, 1.1500, 0.022, ""),
                                (0.221, 0.1255, 0.1152, 1.1500, 0.021, ""), (0.229, 0.1250, 0.1147, 1.1500, 0.020, "neck"),
                                (0.236, 0.1250, 0.1147, 1.1500, 0.020, "vent_start"),
                                (0.278, 0.1250, 0.1147, 1.1500, 0.020, "vent_end"),
                                (0.286, 0.1250, 0.1147, 1.1500, 0.020, "")):
        out.append((cz, a, b, r, (lambda z, y=y: y), tag))
    # The back's rolled edge (14 mm) and the flat back.
    for deg in (30.0, 60.0, 90.0):
        s, d = 0.014 * (1 - math.cos(math.radians(deg))), 0.014 * math.sin(math.radians(deg))
        out.append((1.15, 0.125 - s, 0.1147 - s, 0.020 - s, (lambda z, d=d: 0.286 + d), "back" if deg == 90 else ""))
    return out


def build_case(b, plastic, vent_dark):
    bm = b.bm
    loops, tags, sections = [], [], None
    for cz, a, bb, r, yfn, tag in rings():
        pts, sections = ring_outline(cz, a, bb, r)
        loops.append([bm.verts.new((x, yfn(z), z)) for x, z in pts])
        tags.append(tag)
    n = len(loops[0])
    mi = b.slot(plastic)
    faces = []
    for k in range(len(loops) - 1):
        row = []
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((loops[k][i], loops[k][j], loops[k + 1][j], loops[k + 1][i]))
            f.material_index = mi
            row.append(f)
        faces.append(row)
    back = bm.faces.new(loops[-1])
    back.material_index = mi
    bm.normal_update()
    # One winding for the whole loft: the top of the front box must face up.
    probe = faces[tags.index("cover")][sections["top"] + len(TOP_STOPS) // 2]
    if probe.normal.z < 0:
        for row in faces:
            for f in row:
                f.normal_flip()
    if back.normal.y < 0:
        back.normal_flip()
    bm.normal_update()

    # Seams: the section boundaries, and one cut along the bottom's centre so each band unwraps flat.
    bottom_mid = sections["bottom"] + len(BOTTOM_STOPS) // 2
    for k, tag in enumerate(tags):
        if tag in ("face_inner", "face_outer", "groove", "cover", "taper", "neck", "back"):
            for i in range(n):
                e = bm.edges.get((loops[k][i], loops[k][(i + 1) % n]))
                if e:
                    e.seam = True
    face_band = (tags.index("face_inner"), tags.index("face_outer"))
    for k in range(len(loops) - 1):
        if (k, k + 1) == face_band:
            continue
        e = bm.edges.get((loops[k][bottom_mid], loops[k + 1][bottom_mid]))
        if e:
            e.seam = True

    # The neck housing's vents: each slot cell pushed 4 mm into the case, its floor dark.
    kv = tags.index("vent_start")
    cells = [faces[kv][sections["top"] + s] for s in TOP_SLOTS]
    for side in ("right", "left"):
        start = sections[side]
        count = len(SIDE_STOPS) - 1
        for s in SIDE_SLOTS:
            idx = start + s if side == "right" else start + (count - 1 - s)
            cells.append(faces[kv][idx])
    dark = b.slot(vent_dark)
    for cell in cells:
        normal = cell.normal.copy()
        res = bmesh.ops.extrude_face_region(bm, geom=[cell])
        moved = {g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)}
        bmesh.ops.translate(bm, vec=-normal * 0.004, verts=list(moved))
        bmesh.ops.delete(bm, geom=[cell], context="FACES_ONLY")
        for f in {f for v in moved for f in v.link_faces}:
            f.material_index = dark if all(v in moved for v in f.verts) else mi
    bm.normal_update()


def build_stand_and_controls(b, plastic, button):
    # Swivel stand: a round foot on the computer's top, a neck, and the tilt yoke under the case.
    b.cylinder(0.110, 0.012, segments=48, loc=(0.0, 0.040, 0.865), mat=plastic, bevel=0.003)
    b.cylinder(0.080, 0.016, segments=40, loc=(0.0, 0.040, 0.877), mat=plastic, bevel=0.002)
    b.box((0.200, 0.140, 0.016), loc=(0.0, 0.020, 0.900), mat=plastic, bevel=0.003, corner=0.020)
    # Power button on the chin's right: 16 x 9 mm, 2 mm proud of the face, square to it.
    z = 0.948
    pts = pl.round_polygon([(-0.008, -0.0045), (0.008, -0.0045), (0.008, 0.0045), (-0.008, 0.0045)], 0.002, 3)
    b.extrude(pts, 0.0035, loc=(0.172, face_y(z) - 0.00025, z), rot=(-3, 0, 0), mat=button, bevel=0.0006, bevel_seg=2)


def build_led(col):
    b = pl.Builder("crt_power_led")
    led = pl.surface("crt_power_led", (0.08, 0.25, 0.10), 0.2, emission=((0.32, 1.0, 0.42), 3.0), color_var=0.0,
                     edge_width=0.0003)
    z = 0.948
    b.lathe([(0.0, 0.0), (0.0019, 0.0), (0.0019, 0.0006), (0.0015, 0.0011), (0.0008, 0.0014), (0.0, 0.00145)],
            segments=16, mat=led)
    m = Matrix.Translation((0.146, face_y(z) + 0.0004, z)) @ Matrix.Rotation(math.radians(90 - 3.0), 4, "X")
    bmesh.ops.transform(b.bm, matrix=m, verts=b.bm.verts)
    return b.finish(col, smooth_angle=60)


def crt_opening(ob):
    """build_room.crt_opening() on this case at its room position: (centre, width, height)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    inv = ob.matrix_world.inverted()
    step, cz = 0.002, 1.137

    def inside(x, z):
        hit, loc, *_ = ob.ray_cast(inv @ Vector((x, -1.0, z)), inv.to_3x3() @ Vector((0, 1, 0)), depsgraph=depsgraph)
        return hit and (ob.matrix_world @ loc).y > RAY_INSIDE_Y

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


def surface_hit(ob, x, z):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    inv = ob.matrix_world.inverted()
    hit, loc, normal, _ = ob.ray_cast(inv @ Vector((x, -1.0, z)), inv.to_3x3() @ Vector((0, 1, 0)), depsgraph=depsgraph)
    return (ob.matrix_world @ loc, normal) if hit else (None, None)


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    # Aged ABS as the set's cream_plastic (#D5CAB0..#DCD2BA), with soft wear: grime in the groove and the vents, dust
    # on the top, a little shine worn into the edges a hand touches.
    plastic = pl.surface("crt_plastic", (0.675, 0.603, 0.452), 0.5, color_var=0.035, grime=0.35, dust=0.35,
                         edge_wear=0.18, edge_color=(0.72, 0.66, 0.52), edge_roughness=0.38, smudges=0.05,
                         micro_bump=(900.0, 0.035), specular=0.4, edge_width=0.002)
    vent_dark = pl.surface("crt_vent_dark", (0.02, 0.018, 0.016), 0.85, color_var=0.0)
    button = pl.surface("crt_button", (0.60, 0.54, 0.405), 0.42, color_var=0.02, grime=0.4, edge_wear=0.3,
                        edge_width=0.0006)

    b = pl.Builder(NAME)
    build_case(b, plastic, vent_dark)
    build_stand_and_controls(b, plastic, button)
    bmesh.ops.transform(b.bm, matrix=Matrix.Translation(-ORIGIN), verts=b.bm.verts)
    ob = b.finish(col, smooth_angle=34, seam_angle=48)
    ob["source"] = "made for this site"
    ob["room_location_m"] = list(ORIGIN)

    led = build_led(col)
    led.data.transform(Matrix.Translation(-ORIGIN))
    pl.parent_keep_transform(led, ob)

    screen = pl.empty("crt_screen", col, Vector((0.0, GLASS_Y0, GLASS_Z0)) - ORIGIN, rotation_deg=(-3, 0, 0), size=0.1,
                      parent=ob)
    screen["width_m"], screen["height_m"] = 0.344, 0.27
    seat = pl.empty("crt_badge_seat", col, Vector((0.0, face_y(0.938), 0.938)) - ORIGIN, rotation_deg=(-3, 0, 0),
                    size=0.03, parent=ob)
    seat["width_m"], seat["height_m"] = 0.072, 0.01125

    # Check the contract at the room position: the measured opening, the badge's and the notes' seats.
    bpy.context.view_layer.update()
    ob.matrix_world = Matrix.Translation(ORIGIN)
    bpy.context.view_layer.update()
    centre, width, height = crt_opening(ob)
    print(f"CRT_OPENING centre {tuple(round(c, 5) for c in centre)} width {width:.4f} height {height:.4f}")
    for label, (x, z) in (("badge", (0.0, 0.938)), ("note_0", (0.197, 1.215)), ("note_1", (0.196, 1.12)),
                          ("note_2", (-0.197, 1.19))):
        p, nrm = surface_hit(ob, x, z)
        print(f"CRT_SEAT {label} {tuple(round(c, 5) for c in p) if p else None} normal "
              f"{tuple(round(c, 4) for c in nrm) if nrm else None}")
    ob.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
