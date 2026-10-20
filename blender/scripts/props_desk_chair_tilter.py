"""desk_chair_tilter: a swivel tilting desk chair, unbranded, after the 1930s-50s 'banker's chair' of newsrooms and
studio writers' rooms: a walnut seat with a button-tufted oxblood leather pad, nine turned spindles under one bent
walnut rail that sweeps from the crest down into the arms, a cast-iron tilt with its coil spring and tension crank in
view, on four splayed walnut legs with brass ball casters.

Real proportions: seat 0.47 m at the pad's crown, 0.45 m deep, 0.50 m wide at the front; arms 0.665 m (below the desk
top); crest 0.86 m; base 0.60 m across. Objects: desk_chair (seat, pad, spindles, rail, tilt) and desk_chair_base
(stem, legs, casters). Origin: the stem's axis on the floor; faces -Y.
"""
import math
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_lib as pl  # noqa: E402

NAME = "desk_chair_tilter"
SEAT_Z0, SEAT_Z1 = 0.405, 0.440
SEAT_FRONT, SEAT_BACK, HW_FRONT, HW_BACK = -0.235, 0.205, 0.250, 0.215
RAIL_X, RAIL_FRONT, RAIL_ARC_Y, RAIL_RY = 0.300, -0.150, 0.040, 0.215
CREST_Z, ARM_Z = 0.800, 0.665
BUTTONS = [(-0.115, -0.085), (0.115, -0.085), (0.0, -0.005), (-0.115, 0.075), (0.115, 0.075)]
LEATHER, WOOD = "leather_red_02", "black_walnut_veneer_02"


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def seat_outline():
    corners = [(-HW_FRONT, SEAT_FRONT), (HW_FRONT, SEAT_FRONT), (HW_BACK, SEAT_BACK), (-HW_BACK, SEAT_BACK)]
    return [Vector(p) for p in pl.round_polygon(corners, [0.11, 0.11, 0.06, 0.06], 10)]


def offset(pts, d):
    c = sum(pts, Vector((0, 0))) / len(pts)
    n = len(pts)
    out = []
    for i in range(n):
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        nrm = Vector((t.y, -t.x))
        if nrm.dot(pts[i] - c) < 0:
            nrm = -nrm
        out.append(pts[i] - nrm * d)
    return out


def tuft(x, y):
    """How far the pad's top is pulled down at (x, y): a dimple at each button and a crease between neighbours."""
    depth = 0.0
    for bx, by in BUTTONS:
        depth += 0.020 * math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * 0.020 ** 2))
    for i, (ax, ay) in enumerate(BUTTONS):
        for bx, by in BUTTONS[i + 1:]:
            if math.hypot(bx - ax, by - ay) > 0.15:
                continue
            ab = Vector((bx - ax, by - ay))
            t = max(0.0, min(1.0, Vector((x - ax, y - ay)).dot(ab) / ab.length_squared))
            d = (Vector((x, y)) - Vector((ax, ay)) - ab * t).length
            depth += 0.006 * math.exp(-d * d / (2 * 0.006 ** 2))
    return min(depth, 0.022)


def build_seat(b, walnut, leather):
    outline = seat_outline()
    prof = [(0.006, SEAT_Z0), (0.0, SEAT_Z0 + 0.006), (0.0, SEAT_Z1 - 0.010), (0.004, SEAT_Z1 - 0.002),
            (0.012, SEAT_Z1)]
    rings = [[Vector((p.x, p.y, z)) for p in offset(outline, d)] for d, z in prof]
    faces, _ = pl.loft_rings(b, rings, walnut)
    pl.orient_outward(b.bm, faces, Vector((0, 0, (SEAT_Z0 + SEAT_Z1) / 2)))
    pad = offset(outline, 0.018)
    pad = [pad[i] for i in range(len(pad))]
    dense = []
    for p, q in zip(pad, pad[1:] + pad[:1]):
        dense += [p.lerp(q, k / 2) for k in range(2)]
    rings = []
    for d, h in [(0.0, 0.000), (0.002, 0.012), (0.006, 0.024), (0.012, 0.031), (0.020, 0.035), (0.032, 0.038),
                 (0.046, 0.040), (0.062, 0.041), (0.080, 0.042), (0.098, 0.042), (0.116, 0.042), (0.134, 0.042),
                 (0.150, 0.042)]:
        ring = []
        centre = sum(dense, Vector((0, 0))) / len(dense)
        # past the rounded edge the rings shrink toward the middle (an offset would fold over the corners)
        pts = offset(dense, d) if d <= 0.02 else [centre + (p - centre) * max(0.15, 1 - (d - 0.02) / max(1e-6, (p - centre).length) * 1.6) for p in offset(dense, 0.02)]
        for p in pts:
            z = SEAT_Z1 + h - (tuft(p.x, p.y) if h > 0.03 else 0.0)
            ring.append(Vector((p.x, p.y, z)))
        rings.append(ring)
    faces, _ = pl.loft_rings(b, rings, leather)
    pl.orient_outward(b.bm, faces, Vector((0, 0, SEAT_Z1 + 0.01)))
    for bx, by in BUTTONS:
        z = SEAT_Z1 + 0.042 - tuft(bx, by)
        b.lathe([(0.0, 0.0), (0.0075, 0.0005), (0.0070, 0.0030), (0.0040, 0.0050), (0.0, 0.0056)], segments=12,
                loc=(bx, by, z - 0.001), mat=leather)


def rail_path(n=150):
    raw = []
    for k in range(18):
        raw.append((Vector((-RAIL_X, RAIL_FRONT + (RAIL_ARC_Y - RAIL_FRONT) * k / 18)), 0.0))
    for k in range(61):
        a = math.pi - math.pi * k / 60
        raw.append((Vector((RAIL_X * math.cos(a), RAIL_ARC_Y + RAIL_RY * math.sin(a))), math.sin(a)))
    for k in range(1, 19):
        raw.append((Vector((RAIL_X, RAIL_ARC_Y + (RAIL_FRONT - RAIL_ARC_Y) * k / 18)), 0.0))
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


def rail_frame(path, k):
    p, back, u = path[k]
    q0 = path[max(0, k - 1)][0]
    q1 = path[min(len(path) - 1, k + 1)][0]
    tan = (q1 - q0).normalized()
    out = Vector((tan.y, -tan.x))
    if out.dot(p - Vector((0, RAIL_ARC_Y))) < 0:
        out = -out
    crest = smooth((back - 0.35) / 0.65)
    z = ARM_Z + (CREST_Z - ARM_Z) * crest
    return p, out, crest, z, u


def build_rail(b, walnut):
    path = rail_path()
    rings, centres = [], []
    for k in range(len(path)):
        p, out, crest, z, u = rail_frame(path, k)
        phi = math.radians(78) * crest
        long_axis, short_axis = 0.058 + 0.034 * crest, 0.030
        end = min(u, 1 - u)
        knuckle = 1.0 + 0.30 * math.exp(-((end - 0.012) / 0.012) ** 2)  # the arm ends swell into a rounded knuckle
        tip = math.sqrt(max(0.0, 1 - (1 - min(end, 0.016) / 0.016) ** 2))
        long_axis *= knuckle * (0.7 + 0.3 * tip)
        short_axis *= knuckle * (0.6 + 0.4 * tip)
        la = Vector((out.x * math.cos(phi), out.y * math.cos(phi), math.sin(phi)))
        sa = Vector((-out.x * math.sin(phi), -out.y * math.sin(phi), math.cos(phi)))
        centre = Vector((p.x, p.y, z))
        sec = pl.round_polygon([(-long_axis / 2, -short_axis / 2), (long_axis / 2, -short_axis / 2),
                                (long_axis / 2, short_axis / 2), (-long_axis / 2, short_axis / 2)],
                               short_axis * 0.45, 3)
        rings.append([centre + la * x + sa * y for x, y in sec])
        centres.append(centre)
    faces, _ = pl.loft_rings(b, rings, walnut)
    b.bm.normal_update()
    n = len(rings[0])
    if sum(f.normal.dot(f.calc_center_median() - centres[k // n]) for k, f in enumerate(faces[:-2])) < 0:
        for f in faces:
            f.normal_flip()
    return path


def turned(b, a, c, r, mat):
    """A turned spindle from a to c: a bead at the foot, a long swelling taper, a neck under the rail."""
    d = c - a
    length = d.length
    prof = [(0.0, 0.0), (r * 0.95, 0.0), (r * 1.15, length * 0.03), (r * 0.9, length * 0.07), (r * 1.05, length * 0.30),
            (r * 0.85, length * 0.62), (r * 0.66, length * 0.90), (r * 0.80, length * 0.95), (r * 0.70, length),
            (0.0, length)]
    rot = d.to_track_quat("Z", "Y").to_euler()
    b.lathe(prof, segments=10, loc=tuple(a), rot=tuple(math.degrees(v) for v in rot), mat=mat)


def build_spindles(b, walnut, path):
    for k in range(9):
        t = (k + 0.5) / 9
        a = math.pi - math.pi * (0.16 + 0.68 * t)
        foot = Vector((0.83 * HW_BACK * math.cos(a) / 0.9, SEAT_BACK - 0.030 + 0.020 * math.sin(a), SEAT_Z1 - 0.004))
        # the rail point above it: the closest along the path in plan
        best = min(range(len(path)), key=lambda i: (path[i][0] - foot.xy).length + 2 * abs(path[i][2] - (0.5 + (t - 0.5) * 0.62)))
        p, out, crest, z, _ = rail_frame(path, best)
        head = Vector((p.x, p.y, z)) - Vector((out.x, out.y, 0)) * 0.004 - Vector((0, 0, 0.038 * crest + 0.013))
        turned(b, foot, head, 0.0098, walnut)
    for side in (-1, 1):  # under each arm: a stout post at the front, two spindles behind it
        for y, r in ((-0.150, 0.0135), (-0.055, 0.0095), (0.030, 0.0095)):
            foot = Vector((side * (HW_FRONT - 0.030 + (y + 0.15) * 0.08), y, SEAT_Z1 - 0.004))
            head = Vector((side * RAIL_X, y, ARM_Z - 0.013))
            turned(b, foot, head, r, walnut)


def build_tilt(b, iron, brass):
    b.box((0.24, 0.26, 0.012), loc=(0.0, -0.01, SEAT_Z0 - 0.006), mat=iron, bevel=0.002, corner=0.02)
    b.box((0.13, 0.17, 0.050), loc=(0.0, 0.02, SEAT_Z0 - 0.040), mat=iron, bevel=0.005, corner=0.018)
    # the coil spring that sets the tilt's stiffness, between the housing and the seat's front
    helix = []
    turns, r, h, z0 = 6, 0.024, 0.052, SEAT_Z0 - 0.064
    for k in range(turns * 24 + 1):
        a = 2 * math.pi * k / 24
        helix.append(Vector((r * math.cos(a), -0.085 + r * math.sin(a), z0 + h * k / (turns * 24))))
    b.tube(helix, 0.0042, sides=6, mat=iron)
    b.cylinder(0.028, 0.008, segments=20, loc=(0.0, -0.085, z0 - 0.008), mat=iron, bevel=0.002)
    # the tension crank out of the housing's side, a brass knob on its end
    b.tube([Vector((0.065, 0.02, SEAT_Z0 - 0.040)), Vector((0.150, 0.02, SEAT_Z0 - 0.040)),
            Vector((0.168, 0.02, SEAT_Z0 - 0.058)), Vector((0.168, 0.02, SEAT_Z0 - 0.090))], 0.005, sides=8, mat=iron)
    b.lathe([(0.0, 0.0), (0.011, 0.002), (0.013, 0.012), (0.009, 0.022), (0.0, 0.024)], segments=14,
            loc=(0.168, 0.02, SEAT_Z0 - 0.112), mat=brass)


def build_base(b, walnut, iron, brass):
    # the threaded stem in its iron collar, the hub the four legs are bolted to
    b.cylinder(0.017, 0.22, segments=18, loc=(0, 0, 0.14), mat=iron, bevel=0.002)
    for k in range(9):
        b.torus(0.0172, 0.0018, segments=18, sides=4, loc=(0, 0, 0.250 + 0.012 * k), mat=iron)
    b.cylinder(0.030, 0.040, segments=20, loc=(0, 0, 0.330), mat=iron, bevel=0.004)
    b.cylinder(0.060, 0.060, segments=28, loc=(0, 0, 0.090), mat=iron, bevel=0.008)
    for k in range(4):
        ang = math.radians(45 + 90 * k)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        side = Vector((-d.y, d.x, 0))
        secs = [(0.040, 0.024, 0.026, 0.120), (0.110, 0.022, 0.024, 0.112), (0.190, 0.019, 0.020, 0.093),
                (0.250, 0.016, 0.017, 0.072), (0.285, 0.015, 0.015, 0.060)]
        rings = []
        for r, hw, hh, cz in secs:
            rings.append([d * r + side * sx + Vector((0, 0, cz + sz))
                          for sx, sz in pl.round_polygon([(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)], min(hw, hh) * 0.6, 3)])
        faces, _ = pl.loft_rings(b, rings, walnut)
        pl.orient_outward(b.bm, faces, d * 0.16 + Vector((0, 0, 0.09)))
        tip = d * 0.285
        b.cylinder(0.016, 0.010, segments=16, loc=(tip.x, tip.y, 0.040), mat=brass, bevel=0.002)
        b.box((0.008, 0.026, 0.020), loc=(tip.x, tip.y, 0.030), rot=(0, 0, math.degrees(ang)), mat=brass, bevel=0.002)
        wheel = tip + d * 0.010
        b.lathe([(0.0, -0.021), (0.012, -0.018), (0.020, -0.008), (0.021, 0.0), (0.020, 0.008), (0.012, 0.018),
                 (0.0, 0.021)], segments=16, loc=(wheel.x, wheel.y, 0.021), rot=(0, 90, math.degrees(ang) + 90),
                mat=brass)


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    walnut = pl.surface("tilter_walnut", (0.32, 0.20, 0.12), 0.42, color_tex=pl.polyhaven_texture(WOOD, "Diffuse"),
                        tint=(0.58, 0.44, 0.34), rough_tex=pl.polyhaven_texture(WOOD, "Rough"), rough_amount=0.2,
                        tile=0.6, coat=0.40, coat_roughness=0.25, edge_wear=0.35, edge_color=(0.40, 0.26, 0.15),
                        edge_width=0.002, grime=0.3, smudges=0.05, color_var=0.05)
    leather = pl.surface("tilter_leather", (0.30, 0.05, 0.04), 0.44, color_tex=pl.polyhaven_texture(LEATHER, "coll1"),
                         tint=(0.85, 0.55, 0.50), rough_tex=pl.polyhaven_texture(LEATHER, "Rough"), rough_amount=0.3,
                         height_tex=pl.polyhaven_texture(LEATHER, "coll1"), height_strength=0.12, tile=0.45,
                         edge_wear=0.35, edge_color=(0.42, 0.10, 0.07), edge_roughness=0.35, edge_width=0.004,
                         grime=0.5, coat=0.18, coat_roughness=0.3, color_var=0.05)
    iron = pl.surface("tilter_iron", (0.035, 0.033, 0.031), 0.55, metallic=0.6, edge_wear=0.35,
                      edge_color=(0.30, 0.29, 0.27), edge_metallic=1.0, dust=0.3, color_var=0.03, edge_width=0.0015)
    brass = pl.surface("tilter_brass", (0.72, 0.52, 0.26), 0.30, metallic=1.0, smudges=0.06, grime=0.3,
                       color_var=0.03)
    body = pl.Builder("desk_chair")
    build_seat(body, walnut, leather)
    path = build_rail(body, walnut)
    build_spindles(body, walnut, path)
    build_tilt(body, iron, brass)
    chair = body.finish(col, smooth_angle=40, seam_angle=50)
    chair["source"] = "made for this site"
    chair["gloss"] = 0.35  # waxed walnut and leather
    base_b = pl.Builder("desk_chair_base")
    build_base(base_b, walnut, iron, brass)
    base = base_b.finish(col, smooth_angle=40, seam_angle=50)
    base["source"] = "made for this site"
    base["gloss"] = 0.3
    pl.parent_keep_transform(base, chair)
    pl.report(NAME, col, 20000)
    pl.save_prop(NAME)


main()
