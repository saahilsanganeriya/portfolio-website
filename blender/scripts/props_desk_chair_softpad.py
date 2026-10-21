"""desk_chair_softpad: a soft-pad management chair, unbranded, after the 1958-69 type (cast aluminium side frames
holding a continuous run of thick stitched leather pads, on a five-star swivel base): chestnut leather, slim polished
aluminium, a black tilt and column. The bake holds no reflection, so the aluminium takes a dark base colour and the site
draws its polish live, as it does the leather's sheen.

Real proportions: seat 0.45 m at the front edge, 0.43 m deep, pads 0.50 m wide between the frames (0.58 m over them);
back 0.90 m, reclined 15 degrees; arms 0.65 m (below the desk top, so it tucks in); base 0.62 m across. Objects, each
with its own gloss for the site's live shine: desk_chair (frames, arms, mechanism), desk_chair_leather (the pads and the
arm pads) and desk_chair_base (column, base, casters). Origin: the column's axis on the floor; faces -Y.
"""
import math
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_lib as pl  # noqa: E402

NAME = "desk_chair_softpad"
RAIL_X, RAIL_W, RAIL_H = 0.270, 0.016, 0.028
PAD_HW = 0.252  # the pads stop short of the frames' inner faces (0.260): the leather tucks into their channel
PAD_T_SEAT, PAD_T_BACK = 0.058, 0.052
SEAT_PADS, BACK_PADS = 4, 5
RECLINE = math.radians(15)
LEATHER = "brown_leather"


# ---- the side frames' line (side view, y forward-negative, z up) ----

def frame_line(step=0.004):
    """Dense points along the frames' centre line: a small curl under the seat's front, the seat (tilted back 4.5
    degrees), a 70 mm bend, the back up to 0.90 m. Returns [(y, z)] and the arc length at the bend's middle."""
    seat0, corner = Vector((-0.255, 0.425)), Vector((0.170, 0.392))
    up = Vector((math.sin(RECLINE), math.cos(RECLINE)))
    top = corner + up * ((0.90 - corner.y) / up.y)
    seat_dir = (corner - seat0).normalized()
    r = 0.07
    half = seat_dir.angle(up) / 2
    cut = r * math.tan(half)
    a, b = corner - seat_dir * cut, corner + up * cut
    normal_in = Vector((-seat_dir.y, seat_dir.x))
    centre = a + normal_in * r
    pts = []
    for k in range(9):  # the front curl: 30 mm, falling 20 mm
        t = k / 8
        pts.append(Vector((-0.285 + 0.030 * t, 0.405 + 0.020 * math.sin(t * math.pi / 2))))
    n = max(2, int((a - seat0).length / step))
    pts += [seat0 + (a - seat0) * (k / n) for k in range(1, n + 1)]
    a0 = math.atan2((a - centre).y, (a - centre).x)
    a1 = math.atan2((b - centre).y, (b - centre).x)
    if a1 < a0:
        a1 += 2 * math.pi
    if a1 - a0 > math.pi:
        a0, a1 = a0 + 2 * math.pi, a1
    arc_n = 14
    arc = [centre + r * Vector((math.cos(a0 + (a1 - a0) * k / arc_n), math.sin(a0 + (a1 - a0) * k / arc_n)))
           for k in range(1, arc_n + 1)]
    bend_at = len(pts) + arc_n // 2
    pts += arc
    n = max(2, int((top - b).length / step))
    pts += [b + (top - b) * (k / n) for k in range(1, n + 1)]
    lengths = [0.0]
    for p, q in zip(pts, pts[1:]):
        lengths.append(lengths[-1] + (q - p).length)
    return pts, lengths, lengths[bend_at]


def sample(pts, lengths, s):
    """Point, unit tangent and the normal toward the sitter (tangent turned +90 degrees) at arc length s."""
    s = max(0.0, min(lengths[-1], s))
    i = max(1, next((k for k, L in enumerate(lengths) if L >= s), len(lengths) - 1))
    t = (s - lengths[i - 1]) / max(1e-9, lengths[i] - lengths[i - 1])
    p = pts[i - 1].lerp(pts[i], t)
    tan = (pts[i] - pts[i - 1]).normalized()
    return p, tan, Vector((-tan.y, tan.x))


def to3(x, yz):
    return Vector((x, yz.x, yz.y))


def build_frames(b, alu, pts, lengths):
    section = pl.round_polygon([(-RAIL_W / 2, -RAIL_H / 2), (RAIL_W / 2, -RAIL_H / 2), (RAIL_W / 2, RAIL_H / 2),
                                (-RAIL_W / 2, RAIL_H / 2)], 0.008, 3)
    L = lengths[-1]
    for side in (-1, 1):
        rings = []
        steps = 64
        for k in range(steps + 1):
            s = L * k / steps
            p, _, n = sample(pts, lengths, s)
            taper = 1.0 - 0.25 * max(0.0, (s - (L - 0.05)) / 0.05)  # the top ends narrow a little and round off
            ring = [to3(side * RAIL_X + sx, p + n * (0.004 + sz * taper)) for sx, sz in section]
            rings.append(ring)
        faces, _ = pl.loft_rings(b, rings, alu)
        pl.orient_outward(b.bm, faces, to3(side * (RAIL_X - 0.1), Vector((0.05, 0.6))))


def pad_thickness(s, s0, s1, bend):
    """The pads' puff along the run: a stitched valley every pad, the seat's pads thicker than the back's."""
    if s < bend:
        u = (s - s0) / ((bend - s0) / SEAT_PADS)
        t = PAD_T_SEAT
    else:
        u = (s - bend) / ((s1 - bend) / BACK_PADS)
        t = PAD_T_BACK
    puff = 0.30 + 0.70 * math.sin(math.pi * (u % 1.0)) ** 0.4
    end = min(s - s0, s1 - s)  # the run rolls over at both ends
    round_end = math.sqrt(max(0.0, 1.0 - (1.0 - min(end, 0.03) / 0.03) ** 2))
    return t * puff * (0.25 + 0.75 * round_end), round_end, min(u % 1.0, 1.0 - u % 1.0)


def build_pads(b, leather, pts, lengths, bend):
    s0, s1 = 0.012, lengths[-1] - 0.010
    nx = 12
    ss = []
    for k in range(SEAT_PADS):
        a, c = s0 + (bend - s0) * k / SEAT_PADS, s0 + (bend - s0) * (k + 1) / SEAT_PADS
        ss += [a + (c - a) * j / 8 for j in range(8)] + [a + 0.004, c - 0.004]
    for k in range(BACK_PADS):
        a, c = bend + (s1 - bend) * k / BACK_PADS, bend + (s1 - bend) * (k + 1) / BACK_PADS
        ss += [a + (c - a) * j / 8 for j in range(8)] + [a + 0.004, c - 0.004]
    ss.append(s1)
    ends = [s0 + 0.03 * j / 6 for j in range(6)] + [s1 - 0.03 + 0.03 * j / 6 for j in range(1, 6)]
    ss = sorted(set(round(v, 5) for v in ss + ends))
    rings = []
    for s in ss:
        p, _, n = sample(pts, lengths, s)
        t, rnd, from_seam = pad_thickness(s, s0, s1, bend)
        pad_len = (bend - s0) / SEAT_PADS if s < bend else (s1 - bend) / BACK_PADS
        seam = 0.0025 * math.exp(-((from_seam * pad_len) / 0.003) ** 2) * rnd  # the stitching shows on the back cover
        hw = PAD_HW * (0.92 + 0.08 * rnd)
        ring = []
        for i in range(nx + 1):  # across the top, left to right
            x = -hw + 2 * hw * i / nx
            ring.append(to3(x, p + n * (0.003 + t * (1.0 - 0.45 * (abs(x) / hw) ** 6))))
        for k in range(1, 4):  # down the right side, a soft roll
            a = math.pi / 2 * k / 4
            ring.append(to3(hw + 0.006 * math.sin(a), p + n * (0.003 + t * 0.55 * math.cos(a))))
        for i in range(6, -1, -1):  # along the back cover, right to left
            ring.append(to3(-hw + 2 * hw * i / 6 if i not in (0, 6) else (hw if i == 6 else -hw), p + n * seam))
        for k in range(3, 0, -1):  # up the left side
            a = math.pi / 2 * k / 4
            ring.append(to3(-hw - 0.006 * math.sin(a), p + n * (0.003 + t * 0.55 * math.cos(a))))
        rings.append(ring)
    faces, _ = pl.loft_rings(b, rings, leather, seams=(0, nx))
    pl.orient_outward(b.bm, faces, Vector((0, 0.10, 0.55)))


def build_arms(b, pads, alu, leather):
    line = [Vector((0.075, 0.392)), Vector((0.070, 0.470)), Vector((0.060, 0.560)), Vector((0.040, 0.615)),
            Vector((0.000, 0.637)), Vector((-0.080, 0.643)), Vector((-0.170, 0.643)), Vector((-0.215, 0.636)),
            Vector((-0.238, 0.618))]
    dense = []
    for p, q in zip(line, line[1:]):
        dense += [p.lerp(q, k / 6) for k in range(6)]
    dense.append(line[-1])
    section = pl.round_polygon([(-0.013, -0.009), (0.013, -0.009), (0.013, 0.009), (-0.013, 0.009)], 0.006, 2)
    for side in (-1, 1):
        rings = []
        for k, p in enumerate(dense):
            a = dense[max(0, k - 1)]
            c = dense[min(len(dense) - 1, k + 1)]
            tan = (c - a).normalized()
            n = Vector((-tan.y, tan.x))
            rings.append([to3(side * 0.301 + sx, p + n * sz) for sx, sz in section])
        faces, _ = pl.loft_rings(b, rings, alu)
        pl.orient_outward(b.bm, faces, to3(side * 0.25, Vector((-0.05, 0.55))))
        # the arm pad: leather over a firm core, on the arm's flat run
        pads.box((0.044, 0.215, 0.024), loc=(side * 0.301, -0.090, 0.660), mat=leather, bevel=0.006, bevel_seg=3,
                 corner=0.012, corner_axis="Z")
        # the bracket that ties the arm's foot to the frame
        b.box((0.034, 0.050, 0.018), loc=(side * 0.287, 0.075, 0.392), mat=alu, bevel=0.004)


def build_underframe(b, alu, black):
    for y in (-0.120, 0.090):
        b.cylinder(0.009, 2 * RAIL_X, segments=12, loc=(-RAIL_X, y, 0.398), rot=(0, 90, 0), mat=alu)
    b.box((0.050, 0.240, 0.014), loc=(0.0, -0.015, 0.385), mat=alu, bevel=0.003)
    b.box((0.170, 0.190, 0.034), loc=(0.0, 0.005, 0.355), mat=black, bevel=0.004, corner=0.016)
    b.cylinder(0.016, 0.030, segments=18, loc=(0.0, -0.100, 0.352), rot=(90, 0, 0), mat=black, bevel=0.003)
    b.cylinder(0.022, 0.035, segments=20, loc=(0.0, 0.0, 0.305), mat=black, bevel=0.003)


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    leather = pl.surface("softpad_leather", (0.20, 0.10, 0.055), 0.45,
                         color_tex=pl.polyhaven_texture(LEATHER, "Diffuse"), tint=(0.62, 0.40, 0.27),
                         rough_tex=pl.polyhaven_texture(LEATHER, "Rough"), rough_amount=0.25,
                         height_tex=pl.polyhaven_texture(LEATHER, "Diffuse"), height_strength=0.10, tile=0.45,
                         edge_wear=0.30, edge_color=(0.34, 0.19, 0.10), edge_roughness=0.36, edge_width=0.004,
                         grime=0.45, coat=0.18, coat_roughness=0.3, color_var=0.05)
    alu = pl.surface("softpad_aluminium", (0.075, 0.075, 0.072), 0.20, metallic=1.0, scratches=0.10, smudges=0.06,
                     color_var=0.0, edge_width=0.001)
    chrome = pl.surface("softpad_chrome", (0.09, 0.09, 0.09), 0.10, metallic=1.0, smudges=0.05, color_var=0.0)
    black = pl.surface("softpad_black", (0.03, 0.028, 0.026), 0.5, edge_wear=0.25, edge_color=(0.10, 0.10, 0.095),
                       color_var=0.02, dust=0.25, edge_width=0.0015)
    pts, lengths, bend = frame_line()
    body = pl.Builder("desk_chair")
    pads = pl.Builder("desk_chair_leather")
    build_frames(body, alu, pts, lengths)
    build_pads(pads, leather, pts, lengths, bend)
    build_arms(body, pads, alu, leather)
    build_underframe(body, alu, black)
    chair = body.finish(col, smooth_angle=40, seam_angle=50)
    chair["source"] = "made for this site"
    chair["gloss"] = 0.2  # polished aluminium
    leather_ob = pads.finish(col, smooth_angle=50, seam_angle=50)
    leather_ob["source"] = "made for this site"
    leather_ob["gloss"] = 0.45  # semi-matte leather
    base_b = pl.Builder("desk_chair_base")
    pl.five_star_base(base_b, alu, black, chrome, reach=0.30)
    base = base_b.finish(col, smooth_angle=40, seam_angle=50)
    base["source"] = "made for this site"
    base["gloss"] = 0.2
    for obj in (chair, leather_ob, base):
        obj.shadow_terminator_geometry_offset = 0.8  # grazing lamp light on the slim frames: no saw-tooth in the bake
    pl.parent_keep_transform(leather_ob, chair)
    pl.parent_keep_transform(base, chair)
    pl.report(NAME, col, 20000)
    pl.save_prop(NAME)


main()
