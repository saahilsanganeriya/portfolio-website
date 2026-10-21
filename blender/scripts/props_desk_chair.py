"""desk_chair: a swivel desk chair, unbranded, after the Danish 1955 type: one bent walnut rail that is the arms and
the back, twisting from flat armrests into an upright blade behind the sitter (a propeller's twist), floating on satin
steel posts over a cognac leather seat with piped edges, on five steel tube legs with twin casters.

The bake keeps metal as diffuse in its own colour, so the steel is a satin grey (bright chrome bakes as white plastic);
the walnut is the desk's veneer a step lighter than the desk, so the two read as one wood.

Real proportions: seat 0.47 m at the front, 0.42 m deep, 0.49 m wide; arms 0.64 m (below the desk top); the blade's
top 0.77 m; 0.67 m over the arms; base 0.62 m across. Objects: desk_chair (rail, posts, seat) and desk_chair_base
(column, legs, casters). Origin: the column's axis on the floor; faces -Y.
"""
import math
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_lib as pl  # noqa: E402

NAME = "desk_chair"
ARM_X, ARM_FRONT, ARC_Y, BACK_RY = 0.335, -0.165, 0.020, 0.250
ARM_Z, BACK_Z = 0.640, 0.700
SEAT_FRONT, SEAT_BACK, SEAT_HW_FRONT, SEAT_HW_BACK = -0.235, 0.180, 0.245, 0.205
LEATHER, WOOD = "fabric_leather_02", "black_walnut_veneer_02"


def rail_path(n=150):
    """Plan points along the rail, left arm front -> back -> right arm front, with how much each is 'back' (0 on the
    straight arms, 1 at the middle of the back)."""
    raw = []
    for k in range(20):
        raw.append((Vector((-ARM_X, ARM_FRONT + (ARC_Y - ARM_FRONT) * k / 20)), 0.0))
    for k in range(61):
        a = math.pi - math.pi * k / 60
        raw.append((Vector((ARM_X * math.cos(a), ARC_Y + BACK_RY * math.sin(a))), math.sin(a) ** 2))
    for k in range(1, 21):
        raw.append((Vector((ARM_X, ARC_Y + (ARM_FRONT - ARC_Y) * k / 20)), 0.0))
    lengths = [0.0]
    for (p, _), (q, _) in zip(raw, raw[1:]):
        lengths.append(lengths[-1] + (q - p).length)
    out = []
    for k in range(n + 1):
        s = lengths[-1] * k / n
        i = max(1, next(j for j, L in enumerate(lengths) if L >= s - 1e-9))
        t = (s - lengths[i - 1]) / max(1e-9, lengths[i] - lengths[i - 1])
        (p0, b0), (p1, b1) = raw[i - 1], raw[i]
        out.append((p0.lerp(p1, t), b0 + (b1 - b0) * t, k / n))
    return out


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def build_rail(b, walnut):
    path = rail_path()
    rings = []
    for k, (p, back, u) in enumerate(path):
        q0 = path[max(0, k - 1)][0]
        q1 = path[min(len(path) - 1, k + 1)][0]
        tan = (q1 - q0).normalized()
        out = Vector((tan.y, -tan.x))  # outward: the path runs clockwise seen from above
        if out.dot(p - Vector((0, ARC_Y))) < 0:
            out = -out
        twist = smooth(back * 1.15)
        phi = math.radians(80) * twist
        long_axis, short_axis = 0.068 + 0.084 * twist, 0.027 + 0.006 * twist
        end = min(u, 1 - u)  # the arm ends round off
        tip = math.sqrt(max(0.0, 1 - (1 - min(end, 0.02) / 0.02) ** 2))
        long_axis *= 0.75 + 0.25 * tip
        short_axis *= 0.55 + 0.45 * tip
        z = ARM_Z + (BACK_Z - ARM_Z) * twist + 0.012 * smooth(1 - abs(u - 0.5) * 2)
        la = Vector((out.x * math.cos(phi), out.y * math.cos(phi), math.sin(phi)))
        sa = Vector((-out.x * math.sin(phi), -out.y * math.sin(phi), math.cos(phi)))
        centre = Vector((p.x + out.x * 0.010 * twist, p.y + out.y * 0.010 * twist, z))
        sec = pl.round_polygon([(-long_axis / 2, -short_axis / 2), (long_axis / 2, -short_axis / 2),
                                (long_axis / 2, short_axis / 2), (-long_axis / 2, short_axis / 2)],
                               short_axis * 0.48, 3)
        rings.append([centre + la * x + sa * y for x, y in sec])
    faces, _ = pl.loft_rings(b, rings, walnut)
    # outward: each side face away from its own ring's centre (the rail bends too much for one centre)
    b.bm.normal_update()
    n = len(rings[0])
    centres = [sum(r, Vector()) / len(r) for r in rings]
    out = sum(f.normal.dot(f.calc_center_median() - centres[k // n]) for k, f in enumerate(faces[:-2]))
    if out < 0:
        for f in faces:
            f.normal_flip()
    return path


def seat_outline(n=64):
    """Plan of the seat: a rounded trapezoid, wider at the front."""
    corners = [(-SEAT_HW_FRONT, SEAT_FRONT), (SEAT_HW_FRONT, SEAT_FRONT), (SEAT_HW_BACK, SEAT_BACK),
               (-SEAT_HW_BACK, SEAT_BACK)]
    pts = [Vector(p) for p in pl.round_polygon(corners, 0.085, 8)]
    return pts


def offset(pts, d):
    c = sum(pts, Vector((0, 0))) / len(pts)
    out = []
    n = len(pts)
    for i in range(n):
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        nrm = Vector((t.y, -t.x))
        if nrm.dot(pts[i] - c) < 0:
            nrm = -nrm
        out.append(pts[i] - nrm * d)
    return out


def build_seat(b, leather, walnut, steel):
    outline = seat_outline()
    profile = [(0.010, 0.398), (0.002, 0.402), (0.0, 0.410), (0.0, 0.428), (0.003, 0.438), (0.012, 0.446),
               (0.030, 0.452), (0.060, 0.456)]
    rings = [[Vector((p.x, p.y, z)) for p in offset(outline, d)] for d, z in profile]
    faces, _ = pl.loft_rings(b, rings, leather)
    pl.orient_outward(b.bm, faces, Vector((0, -0.03, 0.44)))
    # piping round the top edge, in the same leather
    pipe = [Vector((p.x, p.y, 0.4400)) for p in offset(outline, 0.001)]
    b.tube(pipe + [pipe[0]], 0.0042, sides=6, mat=leather, cap=False)
    pan = offset(outline, -0.006)
    profile = [(0.008, 0.382), (0.001, 0.384), (0.0, 0.389), (0.001, 0.394), (0.010, 0.397)]
    rings = [[Vector((p.x, p.y, z)) for p in offset(pan, d)] for d, z in profile]
    faces, _ = pl.loft_rings(b, rings, walnut)
    pl.orient_outward(b.bm, faces, Vector((0, -0.03, 0.385)))
    # the steel swivel plate under the pan
    b.box((0.22, 0.24, 0.008), loc=(0.0, -0.01, 0.367), mat=steel, bevel=0.002, corner=0.02)
    b.cylinder(0.030, 0.022, segments=24, loc=(0.0, 0.0, 0.344), mat=steel, bevel=0.003)


def bent_tube(b, pts, r, mat, sides=10):
    dense = []
    for p, q in zip(pts, pts[1:]):
        dense += [p.lerp(q, k / 5) for k in range(5)]
    dense.append(pts[-1])
    b.tube(dense, r, sides=sides, mat=mat)


def build_posts(b, steel, walnut):
    for side in (-1, 1):
        # the back posts: from the seat's rear corners up into the blade's underside
        bent_tube(b, [Vector((side * 0.150, 0.150, 0.372)), Vector((side * 0.165, 0.205, 0.470)),
                      Vector((side * 0.172, 0.236, 0.560)), Vector((side * 0.176, 0.252, 0.655))], 0.0085, steel)
        # the arm posts: from under the seat's sides out to the arms
        bent_tube(b, [Vector((side * 0.200, -0.050, 0.368)), Vector((side * 0.262, -0.055, 0.420)),
                      Vector((side * 0.318, -0.058, 0.520)), Vector((side * ARM_X, -0.060, 0.628))], 0.0085, steel)
        # a small walnut boss where each post meets the rail
        b.cylinder(0.014, 0.010, segments=14, loc=(side * ARM_X, -0.060, 0.619), mat=walnut, bevel=0.003)


def build_base(b, steel, black):
    b.cylinder(0.024, 0.230, segments=24, loc=(0, 0, 0.110), mat=steel, bevel=0.002)
    b.cylinder(0.048, 0.040, segments=28, loc=(0, 0, 0.085), mat=steel, bevel=0.006)
    for k in range(5):
        ang = math.radians(90 + 72 * k)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        pts = [d * 0.035 + Vector((0, 0, 0.105)), d * 0.120 + Vector((0, 0, 0.098)), d * 0.220 + Vector((0, 0, 0.082)),
               d * 0.285 + Vector((0, 0, 0.068)), d * 0.300 + Vector((0, 0, 0.062))]
        bent_tube(b, pts, 0.0125, steel, sides=12)
        b.cylinder(0.016, 0.018, segments=14, loc=tuple(d * 0.300 + Vector((0, 0, 0.048))), mat=steel, bevel=0.003)
        pl.twin_caster(b, d * 0.300, math.degrees(ang) + 90 + (25 - 17 * k), black, black, steel)


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    # the desk's walnut is this veneer x 0.62 x (0.34, 0.21, 0.13) (build_room.build_materials): the rail a step lighter
    walnut = pl.surface("chair_walnut", (0.27, 0.17, 0.10), 0.40, color_tex=pl.polyhaven_texture(WOOD, "Diffuse"),
                        tint=(0.27, 0.17, 0.105), rough_tex=pl.polyhaven_texture(WOOD, "Rough"), rough_amount=0.2,
                        tile=0.6, coat=0.45, coat_roughness=0.22, edge_wear=0.25, edge_color=(0.30, 0.19, 0.11),
                        edge_width=0.002, smudges=0.05, color_var=0.04)
    leather = pl.surface("chair_leather", (0.44, 0.25, 0.13), 0.46, color_tex=pl.polyhaven_texture(LEATHER, "Diffuse"),
                         tint=(0.76, 0.50, 0.33), rough_tex=pl.polyhaven_texture(LEATHER, "Rough"), rough_amount=0.3,
                         height_tex=pl.polyhaven_texture(LEATHER, "Diffuse"), height_strength=0.12, tile=0.5,
                         edge_wear=0.35, edge_color=(0.50, 0.31, 0.18), edge_roughness=0.35, edge_width=0.004,
                         grime=0.35, coat=0.15, coat_roughness=0.3, color_var=0.05)
    steel = pl.surface("chair_steel", (0.07, 0.07, 0.068), 0.25, metallic=1.0, smudges=0.05, scratches=0.08,
                       color_var=0.0)
    black = pl.surface("chair_black", (0.03, 0.028, 0.026), 0.5, edge_wear=0.25, edge_color=(0.10, 0.10, 0.095),
                       color_var=0.02, dust=0.25, edge_width=0.0015)
    body = pl.Builder("desk_chair")
    build_rail(body, walnut)
    build_posts(body, steel, walnut)
    build_seat(body, leather, walnut, steel)
    chair = body.finish(col, smooth_angle=40, seam_angle=50)
    chair["source"] = "made for this site"
    chair["gloss"] = 0.35  # oiled walnut and leather
    base_b = pl.Builder("desk_chair_base")
    build_base(base_b, steel, black)
    base = base_b.finish(col, smooth_angle=40, seam_angle=50)
    base["source"] = "made for this site"
    base["gloss"] = 0.25  # satin steel
    pl.parent_keep_transform(base, chair)
    pl.report(NAME, col, 20000)
    pl.save_prop(NAME)


main()
