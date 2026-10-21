"""desk_chair_tilter: a banker's swivel tilting desk chair, unbranded, after the American office chairs of c. 1900-1940
(newsrooms, studio writers' rooms). One steam-bent walnut rail is the arms and, rising at the back, a broad crest that
leans back; seven turned spindles stand under the crest and a turned post and a spindle under each arm. The walnut seat
carries a diamond-tufted oxblood leather pad held by a row of brass nails. Under it the cast-iron tilt and swivel: a
four-armed spider under the seat, the tilt's coil spring and tension screw in front of a threaded spindle, an iron hub
with four walnut legs strapped to it, brass-capped casters.

Real proportions: seat 0.47 m at the pad's crown, 0.46 m deep, 0.51 m wide at the front; arms 0.665 m (below the desk
top); crest 0.86 m; base 0.64 m across. Objects: desk_chair (walnut, iron, the nails), desk_chair_leather (the pad and
its buttons: the site's live shine is drawn on it, so it is its own mesh with its own gloss), desk_chair_base (spindle,
hub, legs, casters). Origin: the stem's axis on the floor; faces -Y.
"""
import math
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_lib as pl  # noqa: E402

NAME = "desk_chair_tilter"
LEATHER, WOOD = "leather_red_02", "black_walnut_veneer_02"
SEAT_Z0, SEAT_Z1 = 0.385, 0.425  # the walnut seat board
PAD_H = 0.042  # the pad's height over the board at its rim; the crown rises 10 mm more
RAIL_X, RAIL_FRONT, RAIL_ARC_Y, RAIL_RY = 0.292, -0.170, 0.030, 0.226
ARM_Z, CREST_Z = 0.652, 0.792  # centres of the arm and of the crest board
CREST_TILT = 12.0  # how far the crest leans back from upright, degrees
# A diamond of seven buttons (2-3-2); creases join diagonal neighbours, pleats run from the outer ones to the edge.
BUTTONS = [(-0.075, -0.125), (0.075, -0.125), (-0.150, -0.025), (0.0, -0.025), (0.150, -0.025), (-0.075, 0.075),
           (0.075, 0.075)]
PLEATS = [((-0.075, -0.125), (-0.075, -0.25)), ((0.075, -0.125), (0.075, -0.25)), ((-0.150, -0.025), (-0.28, -0.025)),
          ((0.150, -0.025), (0.28, -0.025)), ((-0.075, 0.075), (-0.10, 0.20)), ((0.075, 0.075), (0.10, 0.20))]


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def resample(pts, n):
    """n points evenly spaced along a closed 2D outline."""
    seg = [(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    total = sum((q - p).length for p, q in seg)
    out, i, run = [], 0, 0.0
    for k in range(n):
        s = total * k / n
        while run + (seg[i][1] - seg[i][0]).length < s:
            run += (seg[i][1] - seg[i][0]).length
            i += 1
        p, q = seg[i]
        out.append(p.lerp(q, (s - run) / max(1e-9, (q - p).length)))
    return out


def inward_normals(pts):
    c = sum(pts, Vector((0, 0))) / len(pts)
    out = []
    for i in range(len(pts)):
        t = (pts[(i + 1) % len(pts)] - pts[i - 1]).normalized()
        nrm = Vector((t.y, -t.x))
        out.append(-nrm if nrm.dot(pts[i] - c) > 0 else nrm)
    return out


def offset(pts, d):
    return [p + n * d for p, n in zip(pts, inward_normals(pts))]


def seat_outline():
    back = [(0.240 * math.cos(a), 0.030 + 0.190 * math.sin(a)) for a in (math.pi * k / 16 for k in range(17))]
    pts = back + [(-0.255, -0.228), (0.0, -0.240), (0.255, -0.228)]
    return [Vector(p) for p in pl.round_polygon(pts, [0.0] * len(back) + [0.075, 0.0, 0.075], 8)]


def pad_outline(n):
    """The pad's edge: 7 mm in from the board's front, where it rolls over, and 36-50 mm in at the sides and back,
    where the spindles and posts stand."""
    seat = resample(seat_outline(), n)
    out = []
    for p, nrm in zip(seat, inward_normals(seat)):
        d = 0.036 + (0.007 - 0.036) * smooth((nrm.y - 0.5) / 0.4) + 0.014 * smooth((p.y + 0.02) / 0.16)
        out.append(p + nrm * d)
    return out


def segment_distance(x, y, a, b):
    a, b, p = Vector(a), Vector(b), Vector((x, y))
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - a - ab * t).length, t


def tuft(x, y):
    """How far the pad's top is pulled down at (x, y): a dimple at each button, creases between diagonal neighbours,
    pleats from the outer buttons to the edge."""
    depth = 0.0
    for bx, by in BUTTONS:
        depth += 0.022 * math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * 0.012 ** 2))
    for i, a in enumerate(BUTTONS):
        for b in BUTTONS[i + 1:]:
            if abs(abs(a[0] - b[0]) - 0.075) < 1e-6 and abs(abs(a[1] - b[1]) - 0.10) < 1e-6:
                d, _ = segment_distance(x, y, a, b)
                depth += 0.0085 * math.exp(-d * d / (2 * 0.0055 ** 2))
    for a, b in PLEATS:
        d, t = segment_distance(x, y, a, b)
        depth += 0.005 * (1 - 0.5 * t) * math.exp(-d * d / (2 * 0.005 ** 2))
    return min(depth, 0.024)


def pad_height(p, centre, reach):
    crown = 0.010 * max(0.0, 1 - ((p - centre).length / reach) ** 2)
    return PAD_H + crown - tuft(p.x, p.y)


def build_pad(pad, leather):
    outline = pad_outline(120)
    centre = sum(outline, Vector((0, 0))) / len(outline)
    reach = max((p - centre).length for p in outline)
    rim = [(0.0, 0.000), (0.0, 0.011), (0.002, 0.022), (0.006, 0.031), (0.012, 0.037), (0.021, 0.041)]
    rings = []
    for d, h in rim:
        fade = smooth((h - 0.030) / 0.015)
        ring = []
        for p in offset(outline, d):
            z = SEAT_Z1 + h + fade * (pad_height(p, centre, reach) - PAD_H)
            ring.append(Vector((p.x, p.y, z)))
        rings.append(ring)
    last = offset(outline, rim[-1][0])
    for k in range(1, 18):
        s = 1 - 0.965 * k / 17
        ring = []
        for q in last:
            p = centre + (q - centre) * s
            ring.append(Vector((p.x, p.y, SEAT_Z1 + pad_height(p, centre, reach))))
        rings.append(ring)
    faces, verts = pl.loft_rings(pad, rings, leather, caps=False)
    faces.append(pad.bm.faces.new(verts[-1]))
    faces[-1].material_index = pad.slot(leather)
    pl.orient_outward(pad.bm, faces, Vector((centre.x, centre.y, SEAT_Z1 + 0.01)))
    for bx, by in BUTTONS:
        z = SEAT_Z1 + pad_height(Vector((bx, by)), centre, reach)
        pad.lathe([(0.0, 0.0), (0.0086, 0.0004), (0.0080, 0.0030), (0.0048, 0.0052), (0.0, 0.0058)], segments=12,
                  loc=(bx, by, z - 0.0012), mat=leather)
    return outline


def build_nails(b, outline, brass):
    """Brass upholstery nails round the pad's foot, front and sides, every 34 mm."""
    since = 0.034
    for i, (p, nrm) in enumerate(zip(outline, inward_normals(outline))):
        since += (p - outline[i - 1]).length
        if p.y > 0.06 or since < 0.034:
            continue
        since = 0.0
        out = Vector((-nrm.x, -nrm.y, 0.0))
        rot = out.to_track_quat("Z", "Y").to_euler()
        at = Vector((p.x, p.y, SEAT_Z1 + 0.0075)) + out * 0.0005
        b.lathe([(0.0, 0.0), (0.0056, 0.0), (0.0050, 0.0022), (0.0, 0.0041)], segments=10,
                loc=tuple(at), rot=tuple(math.degrees(v) for v in rot), mat=brass)


def build_seat(b, walnut):
    outline = resample(seat_outline(), 72)
    prof = [(0.012, SEAT_Z0), (0.004, SEAT_Z0 + 0.003), (0.0, SEAT_Z0 + 0.011), (0.0, SEAT_Z1 - 0.009),
            (0.003, SEAT_Z1 - 0.003), (0.009, SEAT_Z1)]
    rings = [[Vector((p.x, p.y, z)) for p in offset(outline, d)] for d, z in prof]
    faces, _ = pl.loft_rings(b, rings, walnut)
    pl.orient_outward(b.bm, faces, Vector((0, 0, (SEAT_Z0 + SEAT_Z1) / 2)))


def rail_path(n=110):
    """The rail's centre line in plan: straight arms, then half an ellipse round the back. (point, how far round the
    back 0-1, arc length from the left arm's end)."""
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
        out.append((p0.lerp(p1, t), b0 + (b1 - b0) * t, s))
    return out, lengths[-1]


def rail_section(path, total, k):
    """Centre, the section's long and short axes (unit vectors) and half sizes at path index k: a flat oval arm that
    turns, round the back, into a broad crest board leaning back, its top edge arched; each arm ends in a knuckle that
    dips and rounds over."""
    p, back, s = path[k]
    q0, q1 = path[max(0, k - 1)][0], path[min(len(path) - 1, k + 1)][0]
    tan = (q1 - q0).normalized()
    out = Vector((tan.y, -tan.x))
    if out.dot(p - Vector((0, RAIL_ARC_Y))) < 0:
        out = -out
    crest = smooth((back - 0.30) / 0.70)
    end = min(s, total - s)
    z = ARM_Z + (CREST_Z - ARM_Z) * crest - 0.010 * (1 - smooth(end / 0.035))
    phi = math.radians(90 - CREST_TILT) * crest
    half_long = (0.028 + 0.028 * crest) * (1 + 0.10 * crest * max(0.0, back - 0.6) / 0.4)
    half_short = 0.0150 - 0.0020 * crest
    knuckle = 1.0 + 0.22 * math.exp(-((end - 0.018) / 0.013) ** 2)
    tip = math.sqrt(max(0.0, 1 - (1 - min(end, 0.018) / 0.018) ** 2))
    half_long *= knuckle * (0.62 + 0.38 * tip)
    half_short *= knuckle * (0.55 + 0.45 * tip)
    la = Vector((out.x * math.cos(phi), out.y * math.cos(phi), math.sin(phi)))
    sa = Vector((-out.x * math.sin(phi), -out.y * math.sin(phi), math.cos(phi)))
    return Vector((p.x, p.y, z)), la, sa, half_long, half_short, crest


def build_rail(b, walnut):
    path, total = rail_path()
    rings, centres = [], []
    for k in range(len(path)):
        centre, la, sa, hl, hs, crest = rail_section(path, total, k)
        corner = hs * (0.85 - 0.40 * crest)
        # starts mid-way along the inner side (the crest's lower edge), where the seam hides
        sec = [(-hl, 0.0)] + pl.round_polygon([(-hl, -hs), (hl, -hs), (hl, hs), (-hl, hs)], corner, 2)
        rings.append([centre + la * x + sa * y for x, y in sec])
        centres.append(centre)
    faces, _ = pl.loft_rings(b, rings, walnut)
    b.bm.normal_update()
    n = len(rings[0])
    if sum(f.normal.dot(f.calc_center_median() - centres[k // n]) for k, f in enumerate(faces[:-2])) < 0:
        for f in faces:
            f.normal_flip()
    return path, total


def turned(b, a, c, r, mat, post=False):
    """A turned spindle from a to c: a bead over a cove at the foot, a long gentle swell, a ring under a slim neck at
    the head. A post (under an arm's knuckle) is stouter, with a fuller vase and a second ring."""
    d = c - a
    L = d.length
    if post:
        prof = [(r * 0.70, 0.0), (r * 0.98, L * 0.02), (r * 1.18, L * 0.045), (r * 0.80, L * 0.08), (r * 1.20, L * 0.30),
                (r * 0.95, L * 0.52), (r * 0.72, L * 0.66), (r * 0.98, L * 0.70), (r * 0.72, L * 0.74),
                (r * 0.68, L * 0.92), (r * 0.62, L)]
    else:
        prof = [(r * 0.70, 0.0), (r * 0.95, L * 0.02), (r * 1.12, L * 0.04), (r * 0.82, L * 0.065),
                (r * 1.06, L * 0.32), (r * 0.80, L * 0.72), (r * 0.66, L * 0.88), (r * 0.84, L * 0.915),
                (r * 0.64, L * 0.95), (r * 0.60, L)]
    rot = d.to_track_quat("Z", "Y").to_euler()
    b.lathe(prof, segments=9, loc=tuple(a), rot=tuple(math.degrees(v) for v in rot), mat=mat)


def under_rail(path, total, at):
    """Where a spindle's head ends inside the rail above `at` (in plan): a little below the rail's centre line, so its
    end stays inside the rail however the rail twists."""
    k = min(range(len(path)), key=lambda i: (path[i][0] - at).length)
    centre, la, sa, hl, hs, crest = rail_section(path, total, k)
    under = -la if la.z > 0.2 else -sa  # toward the crest's lower edge, or the arm's underside
    half = hl if la.z > 0.2 else hs
    return centre + under * (half * 0.25)


def build_spindles(b, walnut, path, total):
    for k in range(7):
        a = math.pi * (0.26 + 0.48 * k / 6)
        foot = Vector((0.212 * math.cos(a), 0.030 + 0.163 * math.sin(a), SEAT_Z1 - 0.005))
        head = under_rail(path, total, Vector((RAIL_X * math.cos(a), RAIL_ARC_Y + RAIL_RY * math.sin(a))))
        turned(b, foot, head, 0.0112, walnut)
    for side in (-1, 1):  # under each arm: a stout post behind the knuckle, one spindle between it and the back
        for y, r, post in ((RAIL_FRONT + 0.030, 0.0140, True), (-0.050, 0.0108, False)):
            foot = Vector((side * 0.228, y + 0.004, SEAT_Z1 - 0.005))
            head = under_rail(path, total, Vector((side * RAIL_X, y)))
            turned(b, foot, head, r, walnut, post)


def build_tilt(b, iron, brass):
    """The cast-iron spider under the seat, the tilt housing and its pivot, the coil spring and its tension screw."""
    zs = SEAT_Z0 - 0.005
    for end in (Vector((-0.17, -0.15, zs)), Vector((0.17, -0.15, zs)), Vector((0.15, 0.13, zs)),
                Vector((-0.15, 0.13, zs))):
        mid = end * 0.5
        heading = math.degrees(math.atan2(end.y, end.x))
        b.box((end.xy.length, 0.028, 0.008), loc=(mid.x, mid.y, zs), rot=(0, 0, heading), mat=iron, bevel=0.002)
        b.cylinder(0.0075, 0.004, segments=10, loc=(end.x, end.y, zs + 0.004), mat=iron)  # a screw's head
    b.box((0.110, 0.140, 0.040), loc=(0.0, 0.010, zs - 0.024), mat=iron, bevel=0.004, corner=0.016)
    b.cylinder(0.012, 0.170, segments=14, loc=(-0.085, -0.050, zs - 0.030), rot=(0, 90, 0), mat=iron, bevel=0.002)
    # the spring sits on an arm reaching forward from the spindle's collar, under the housing's nose
    spring_y, z_lo, z_hi = -0.088, 0.292, zs - 0.008
    b.box((0.050, 0.110, 0.012), loc=(0.0, -0.040, z_lo - 0.008), mat=iron, bevel=0.003, corner=0.012)
    helix, turns = [], 5.5
    for k in range(int(turns * 16) + 1):
        a = 2 * math.pi * k / 16
        helix.append(Vector((0.026 * math.cos(a), spring_y + 0.026 * math.sin(a),
                             z_lo + 0.006 + (z_hi - z_lo - 0.012) * k / (turns * 16))))
    b.tube(helix, 0.0046, sides=5, mat=iron)
    for z in (z_lo, z_hi):
        b.cylinder(0.031, 0.006, segments=20, loc=(0.0, spring_y, z - 0.003), mat=iron, bevel=0.0015)
    # the tension screw through the spring, its brass knob below the arm
    b.cylinder(0.0055, z_hi - z_lo + 0.050, segments=10, loc=(0.0, spring_y, z_lo - 0.050), mat=iron)
    b.lathe([(0.0, 0.0), (0.012, 0.002), (0.016, 0.010), (0.014, 0.020), (0.008, 0.026), (0.0, 0.028)], segments=14,
            loc=(0.0, spring_y, z_lo - 0.078), mat=brass)


def leg_centre(d, r):
    """A leg's centre line: level off the hub, curving down to the caster."""
    t = (r - 0.050) / 0.255
    return d * r + Vector((0, 0, 0.138 - 0.064 * t ** 1.5))


def build_base(b, walnut, iron, brass):
    # the threaded spindle and its collar nut, the cast hub the legs are bolted into
    b.cylinder(0.019, 0.190, segments=18, loc=(0, 0, 0.150), mat=iron, bevel=0.002)
    for k in range(7):
        b.torus(0.0192, 0.0019, segments=14, sides=3, loc=(0, 0, 0.180 + 0.011 * k), mat=iron)
    b.lathe([(0.0, 0.0), (0.034, 0.0), (0.036, 0.008), (0.028, 0.016), (0.0, 0.016)], segments=6,
            loc=(0, 0, 0.262), mat=iron)
    b.lathe([(0.0, 0.0), (0.066, 0.0), (0.070, 0.012), (0.062, 0.030), (0.046, 0.062), (0.034, 0.090),
             (0.036, 0.100), (0.0, 0.100)], segments=24, loc=(0, 0, 0.068), mat=iron)
    for k in range(4):
        ang = math.radians(45 + 90 * k)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        side = Vector((-d.y, d.x, 0))
        rings = []
        for i in range(9):
            r = 0.050 + 0.255 * i / 8
            hw = 0.023 - 0.006 * i / 8
            hh = 0.025 - 0.007 * i / 8
            c = leg_centre(d, r)
            rings.append([c + side * sx + Vector((0, 0, sz))
                          for sx, sz in pl.round_polygon([(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)], hw * 0.55, 2)])
        faces, _ = pl.loft_rings(b, rings, walnut)
        pl.orient_outward(b.bm, faces, d * 0.17 + Vector((0, 0, 0.10)))
        # the iron strap over the leg's top where it meets the hub, and its two bolts
        strap = []
        for i in range(4):
            r = 0.055 + 0.090 * i / 3
            c = leg_centre(d, r) + Vector((0, 0, 0.025 - 0.007 * (r - 0.05) / 0.255 + 0.0025))
            strap.append([c + side * sx + Vector((0, 0, sz)) for sx, sz in ((-0.016, -0.003), (0.016, -0.003),
                                                                             (0.016, 0.003), (-0.016, 0.003))])
        faces, _ = pl.loft_rings(b, strap, iron)
        pl.orient_outward(b.bm, faces, leg_centre(d, 0.10))
        for r in (0.085, 0.130):
            c = leg_centre(d, r) + Vector((0, 0, 0.028 - 0.007 * (r - 0.05) / 0.255))
            b.cylinder(0.0055, 0.004, segments=8, loc=tuple(c), mat=iron)
        # the brass cap over the leg's end, the caster's brass swivel plate and fork, an iron wheel
        cap = []
        for i in range(3):
            r = 0.282 + 0.024 * i / 2
            c = leg_centre(d, r)
            hw, hh = 0.0185, 0.0195
            cap.append([c + side * sx + Vector((0, 0, sz))
                        for sx, sz in pl.round_polygon([(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)], hw * 0.55, 2)])
        faces, _ = pl.loft_rings(b, cap, brass)
        pl.orient_outward(b.bm, faces, leg_centre(d, 0.29))
        tip = leg_centre(d, 0.296)
        b.cylinder(0.008, 0.014, segments=10, loc=(tip.x, tip.y, 0.050), mat=brass)
        b.cylinder(0.017, 0.006, segments=16, loc=(tip.x, tip.y, 0.046), mat=brass, bevel=0.0015)
        heading = math.degrees(ang) + 90 + (20 - 13 * k)
        trail = Vector((math.cos(math.radians(heading - 90)), math.sin(math.radians(heading - 90)), 0)) * 0.012
        hub = tip + trail
        axle = Vector((math.cos(math.radians(heading)), math.sin(math.radians(heading)), 0))
        for s in (-1, 1):
            plate = hub + axle * (s * 0.010)
            b.box((0.004, 0.030, 0.034), loc=(plate.x, plate.y, 0.030), rot=(0, 0, heading - 90), mat=brass,
                  corner=0.008, corner_seg=2, corner_axis="X")
        b.cylinder(0.021, 0.013, segments=14, loc=(hub.x - axle.x * 0.0065, hub.y - axle.y * 0.0065, 0.021),
                   rot=(0, 90, heading), mat=iron, bevel=0.0025)


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    # the desk's own walnut (its texture x (0.21, 0.13, 0.08)): lit by the desk lamp, anything lighter bakes orange
    walnut = pl.surface("tilter_walnut", (0.072, 0.026, 0.0096), 0.42, color_tex=pl.polyhaven_texture(WOOD, "Diffuse"),
                        tint=(0.21, 0.13, 0.08), rough_tex=pl.polyhaven_texture(WOOD, "Rough"), rough_amount=0.2,
                        tile=0.8, coat=0.30, coat_roughness=0.30, edge_wear=0.55, edge_color=(0.115, 0.058, 0.026),
                        edge_width=0.003, grime=0.45, smudges=0.04, color_var=0.05)
    leather = pl.surface("tilter_leather", (0.040, 0.0075, 0.0088), 0.45, color_tex=pl.polyhaven_texture(LEATHER, "coll1"),
                         tint=(0.50, 0.30, 0.80), rough_tex=pl.polyhaven_texture(LEATHER, "Rough"), rough_amount=0.25,
                         height_tex=pl.polyhaven_texture(LEATHER, "coll1"), height_strength=0.04, tile=0.22,
                         edge_wear=0.45, edge_color=(0.110, 0.040, 0.030), edge_roughness=0.55, edge_width=0.004,
                         grime=0.55, color_var=0.05)
    iron = pl.surface("tilter_iron", (0.045, 0.042, 0.040), 0.50, metallic=0.7, edge_wear=0.5,
                      edge_color=(0.16, 0.155, 0.15), edge_metallic=1.0, dust=0.25, color_var=0.04, edge_width=0.0015)
    brass = pl.surface("tilter_brass", (0.42, 0.29, 0.12), 0.32, metallic=1.0, smudges=0.05, grime=0.4,
                       color_var=0.04)
    body = pl.Builder("desk_chair")
    build_seat(body, walnut)
    path, total = build_rail(body, walnut)
    build_spindles(body, walnut, path, total)
    build_tilt(body, iron, brass)
    pad_b = pl.Builder("desk_chair_leather")
    outline = build_pad(pad_b, leather)
    build_nails(body, outline, brass)
    chair = body.finish(col, smooth_angle=40, seam_angle=50)
    chair["source"] = "made for this site"
    pad = pad_b.finish(col, smooth_angle=60, seam_angle=60)
    pad["source"] = "made for this site"
    pad["gloss"] = 0.45  # semi-matte leather: the site draws its live shine
    base_b = pl.Builder("desk_chair_base")
    build_base(base_b, walnut, iron, brass)
    base = base_b.finish(col, smooth_angle=40, seam_angle=50)
    base["source"] = "made for this site"
    for obj in (chair, pad, base):
        obj.shadow_terminator_geometry_offset = 0.8  # the bake's lamp light grazes the rail: no saw-tooth on its quads
    pl.parent_keep_transform(pad, chair)
    pl.parent_keep_transform(base, chair)
    pl.report(NAME, col, 20000)
    pl.save_prop(NAME)


main()
