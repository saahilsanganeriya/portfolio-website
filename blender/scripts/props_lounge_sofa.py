"""lounge_sofa: a low two-seat lounge sofa, unbranded, after the 1970s frameless-foam type: no legs and no frame, a
deep pleated seat block on the floor and one pleated bolster that leans back behind it and wraps a little round its
ends, all in cognac leather whose folds are tucked into creases (five across the bolster, two round the seat).

Real proportions: 1.34 m wide, 0.96 m deep, 0.70 m at the bolster's crown, seat 0.38 m. Objects: lounge_sofa. Origin:
the footprint's centre on the floor; faces -Y.
"""
import math
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_lib as pl  # noqa: E402

NAME = "lounge_sofa"
HALF_W, FRONT, BACK = 0.64, -0.48, 0.30  # the seat block in plan
SEAT_Z = 0.38
BOLSTER_CREST = 0.70
LEATHER = "brown_leather"


def pleat(t, folds, depth):
    """How far a pleated surface stands out at t (0-1 across it): round bulges between tucked creases."""
    f = (t * folds) % 1.0
    return depth * math.sin(math.pi * f) ** 0.65


def seat_outline(n=96):
    hw, hd = HALF_W, (BACK - FRONT) / 2
    cy = (BACK + FRONT) / 2
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        c, s = math.cos(a), math.sin(a)
        # a superellipse: square enough to read as a block, soft enough to be foam
        x = hw * math.copysign(abs(c) ** 0.28, c)
        y = cy + hd * math.copysign(abs(s) ** 0.28, s)
        pts.append(Vector((x, y)))
    return pts


def build_seat(b, leather):
    outline = seat_outline()
    centre = Vector((0.0, (BACK + FRONT) / 2))
    rings = []
    heights = [0.0, 0.012]
    heights += [0.012 + (SEAT_Z - 0.06) * k / 18 for k in range(1, 19)]
    for z in heights:
        # the sides bulge in two folds up the block's height, tucked at the floor and under the crown
        t = (z - 0.012) / (SEAT_Z - 0.072)
        bulge = pleat(max(0.0, min(1.0, t)), 2, 0.020) - 0.018 * (z < 0.02)
        rings.append([centre + (p - centre) * (1.0 + bulge / (p - centre).length) for p in outline])
        rings[-1] = [Vector((p.x, p.y, z)) for p in rings[-1]]
    for d, dz in ((0.015, 0.030), (0.035, 0.050), (0.065, 0.060), (0.11, 0.064), (0.17, 0.066)):
        ring = []
        for p in outline:
            q = centre + (p - centre) * max(0.2, 1.0 - d / (p - centre).length)
            ring.append(Vector((q.x, q.y, SEAT_Z - 0.06 + dz)))
        rings.append(ring)
    faces, _ = pl.loft_rings(b, rings, leather)
    pl.orient_outward(b.bm, faces, Vector((centre.x, centre.y, SEAT_Z / 2)))


def bolster_path(n=72):
    """Plan line of the bolster's foot: along the seat's back, bowed a little toward the sitter at the middle."""
    pts = []
    for k in range(n + 1):
        u = k / n
        x = -HALF_W * 0.97 + 2 * HALF_W * 0.97 * u
        y = BACK - 0.05 - 0.025 * math.sin(math.pi * u)
        pts.append((Vector((x, y)), u))
    return pts


def bolster_section(u):
    """The bolster's section in its own plane (r toward the sitter negative, z up): a leaning, rolled sausage whose
    front face carries four folds; it lowers and rounds off toward both ends."""
    end = abs(2 * u - 1)
    low = 1.0 - 0.18 * end ** 6
    crest = SEAT_Z + (BOLSTER_CREST - SEAT_Z) * low
    lean = 0.20
    front = []
    steps = 24
    for k in range(steps + 1):  # up the front face from the seat to under the crown
        t = k / steps
        z = SEAT_Z - 0.02 + (crest - SEAT_Z - 0.06) * t
        r = -0.16 + lean * (z - SEAT_Z) / max(0.1, crest - SEAT_Z) * 0.6 - pleat(t, 5, 0.030)
        front.append((r, z))
    top = []
    r0, z0 = front[-1]
    for k in range(1, 9):  # over the crown, a full roll
        a = math.pi * k / 9
        top.append((r0 + 0.11 * (1 - math.cos(a)), z0 + 0.055 * math.sin(a) + 0.01 * math.sin(a) ** 2))
    back = []
    for k in range(10):  # down the back, a slight belly, to the floor
        t = k / 9
        back.append((r0 + 0.22 + 0.025 * math.sin(math.pi * t), z0 - (z0 - 0.015) * t))
    under = [(0.10, 0.004), (-0.05, 0.004), (-0.15, SEAT_Z * 0.5)]
    return front + top + back + under


def build_bolster(b, leather):
    path = bolster_path()
    rings = []
    for k, (p, u) in enumerate(path):
        q0, q1 = path[max(0, k - 1)][0], path[min(len(path) - 1, k + 1)][0]
        tan = (q1 - q0).normalized()
        back = Vector((-tan.y, tan.x))
        if back.y < 0:
            back = -back
        end = abs(2 * u - 1)
        squash = math.sqrt(max(0.0, 1 - max(0.0, (end - 0.90) / 0.10) ** 2))  # the ends close in a round
        ring = []
        for r, z in bolster_section(u):
            zz = 0.20 + (z - 0.20) * (0.25 + 0.75 * squash)
            rr = r * (0.35 + 0.65 * squash)
            ring.append(Vector((p.x + back.x * rr, p.y + back.y * rr, zz)))
        rings.append(ring)
    faces, _ = pl.loft_rings(b, rings, leather)
    b.bm.normal_update()
    n = len(rings[0])
    centres = [sum(r, Vector()) / len(r) for r in rings]
    if sum(f.normal.dot(f.calc_center_median() - centres[k // n]) for k, f in enumerate(faces[:-2])) < 0:
        for f in faces:
            f.normal_flip()


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    leather = pl.surface("sofa_leather", (0.42, 0.20, 0.09), 0.46, color_tex=pl.polyhaven_texture(LEATHER, "Diffuse"),
                         tint=(0.95, 0.62, 0.40), rough_tex=pl.polyhaven_texture(LEATHER, "Rough"), rough_amount=0.3,
                         height_tex=pl.polyhaven_texture(LEATHER, "Diffuse"), height_strength=0.12, tile=0.5,
                         edge_wear=0.30, edge_color=(0.55, 0.32, 0.16), edge_roughness=0.36, edge_width=0.006,
                         grime=0.55, coat=0.15, coat_roughness=0.3, color_var=0.06)
    body = pl.Builder(NAME)
    build_seat(body, leather)
    build_bolster(body, leather)
    sofa = body.finish(col, smooth_angle=50, seam_angle=55)
    sofa["source"] = "made for this site"
    sofa["gloss"] = 0.45  # leather
    pl.report(NAME, col, 20000)
    pl.save_prop(NAME)


main()
