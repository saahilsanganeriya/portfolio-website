"""hanging_pod: a hanging egg chair on its own stand, unbranded, after the 1957-68 hanging shells: a cream lacquered
fibreglass egg open to the front, lined with cognac leather quilted in channels that fan out from the opening, a round
seat cushion, hung on a short chrome rod from a bent walnut arch that rises from a black steel disc behind it.

Real proportions: the egg 0.84 m wide, 0.80 m deep, 1.16 m tall, its seat 0.55 m off the floor; the arch 1.66 m tall;
the disc 0.80 m across. Objects: hanging_pod (the egg, lining, cushion, rod) and hanging_pod_stand (disc, arch, hook).
Origin: the disc's centre on the floor, under the egg; the egg opens toward -Y.
"""
import math
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_lib as pl  # noqa: E402

NAME = "hanging_pod"
CENTRE = Vector((0.0, 0.0, 0.86))
RX, RY, RZ = 0.42, 0.40, 0.58
SHELL_T = 0.026
OPENING = Vector((0.0, -1.0, -0.22)).normalized()  # the opening faces forward and a little down
OPEN_DEG = 57.0
CHANNELS = 12
ARCH = [Vector((0, 0.34, 0.035)), Vector((0, 0.47, 0.30)), Vector((0, 0.545, 0.62)), Vector((0, 0.545, 0.98)),
        Vector((0, 0.50, 1.28)), Vector((0, 0.38, 1.50)), Vector((0, 0.20, 1.62)), Vector((0, 0.035, 1.645))]
HOOK_Z = 1.615
LEATHER = "fabric_leather_02"


def frame():
    """A rotation taking +Z to the opening's direction."""
    return OPENING.to_track_quat("Z", "Y").to_matrix()


def on_egg(beta, psi, inset):
    """The point on the egg (inset metres inside its surface) at angle beta from the opening's axis, psi round it."""
    u = frame() @ Vector((math.sin(beta) * math.cos(psi), math.sin(beta) * math.sin(psi), math.cos(beta)))
    r = 1.0 / math.sqrt((u.x / RX) ** 2 + (u.y / RY) ** 2 + (u.z / RZ) ** 2)
    return CENTRE + u * (r - inset)


def build_shell(b, shell):
    n = 64
    b0 = math.radians(OPEN_DEG)
    back = math.pi - 0.04
    rings = []
    for k in range(18):  # the outside, from the back to the rim
        beta = back - (back - b0) * k / 17
        rings.append([on_egg(beta, 2 * math.pi * i / n, 0.0) for i in range(n)])
    for k in range(1, 6):  # the rolled lip
        a = math.pi * k / 6
        beta = b0 - 0.012 * math.sin(a)
        rings.append([on_egg(beta, 2 * math.pi * i / n, SHELL_T * (1 - math.cos(a)) / 2) for i in range(n)])
    for k in range(18):  # the inside, from the rim to the back
        beta = b0 + (back - b0) * k / 17
        rings.append([on_egg(beta, 2 * math.pi * i / n, SHELL_T) for i in range(n)])
    faces, _ = pl.loft_rings(b, rings, shell)
    b.bm.normal_update()
    # outward: the outside's faces away from the centre (the inside's then face the hollow)
    outside = faces[: 17 * n]
    if sum(f.normal.dot(f.calc_center_median() - CENTRE) for f in outside) < 0:
        for f in faces:
            f.normal_flip()


def build_lining(b, leather):
    """Leather quilted in channels that fan out from the opening, a little proud of the shell's inside."""
    n = CHANNELS * 8
    b0 = math.radians(OPEN_DEG + 5)
    back = math.pi - 0.04
    rings = []
    for k in range(20):
        beta = b0 + (back - b0) * k / 19
        edge = min(1.0, (beta - b0) / 0.10)
        ring = []
        for i in range(n):
            psi = 2 * math.pi * i / n
            puff = 0.055 * math.sin(math.pi * ((psi * CHANNELS / (2 * math.pi)) % 1.0)) ** 0.4
            ring.append(on_egg(beta, psi, SHELL_T + 0.004 + (0.008 + puff) * math.sqrt(edge)))
        rings.append(ring)
    faces, _ = pl.loft_rings(b, rings, leather, caps=True)
    b.bm.normal_update()
    if sum(f.normal.dot(CENTRE - f.calc_center_median()) for f in faces[:-2]) < 0:
        for f in faces:
            f.normal_flip()


def build_cushion(b, leather):
    """The round seat cushion in the egg's bottom, its top at 0.55 m."""
    c = Vector((0.0, 0.02, 0.0))
    prof = [(0.0, 0.452), (0.17, 0.451), (0.23, 0.456), (0.250, 0.470), (0.258, 0.494), (0.254, 0.520),
            (0.240, 0.536), (0.20, 0.545), (0.12, 0.549), (0.0, 0.551)]
    b.lathe(prof, segments=48, loc=tuple(c), mat=leather)
    b.torus(0.256, 0.0045, segments=48, sides=6, loc=(c.x, c.y, 0.505), mat=leather)


def build_rod(b, chrome):
    top = CENTRE + Vector((0, 0, RZ))
    b.cylinder(0.030, 0.012, segments=20, loc=(0, 0, top.z - 0.004), mat=chrome, bevel=0.003)
    b.cylinder(0.008, HOOK_Z - 0.005 - top.z, segments=12, loc=(0, 0, top.z + 0.006), mat=chrome)
    b.torus(0.022, 0.006, segments=20, sides=8, loc=(0, 0, HOOK_Z), rot=(90, 0, 0), mat=chrome)


def build_stand(b, walnut, steel, chrome):
    b.lathe([(0.0, 0.0), (0.395, 0.0), (0.40, 0.006), (0.40, 0.024), (0.392, 0.032), (0.36, 0.036), (0.0, 0.037)],
            segments=64, mat=steel)
    # a Catmull-Rom curve through the arch's points, so the laminated arch reads as one bend
    pts = [ARCH[0] * 2 - ARCH[1]] + ARCH + [ARCH[-1] * 2 - ARCH[-2]]
    dense = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(10):
            t = k / 10
            dense.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                                + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    dense.append(ARCH[-1])
    rings = []
    for k, p in enumerate(dense):
        a, c = dense[max(0, k - 1)], dense[min(len(dense) - 1, k + 1)]
        tan = (c - a).normalized()
        side = Vector((1, 0, 0))
        nrm = tan.cross(side).normalized()
        w = 0.080 - 0.022 * k / (len(dense) - 1)
        t = 0.042 - 0.008 * k / (len(dense) - 1)
        sec = pl.round_polygon([(-w / 2, -t / 2), (w / 2, -t / 2), (w / 2, t / 2), (-w / 2, t / 2)], t * 0.4, 3)
        rings.append([p + side * x + nrm * y for x, y in sec])
    faces, _ = pl.loft_rings(b, rings, walnut)
    b.bm.normal_update()
    n = len(rings[0])
    if sum(f.normal.dot(f.calc_center_median() - dense[k // n]) for k, f in enumerate(faces[:-2])) < 0:
        for f in faces:
            f.normal_flip()
    b.box((0.10, 0.07, 0.03), loc=(0.0, 0.34, 0.045), mat=steel, bevel=0.004)  # the arch's foot in its steel shoe
    b.box((0.050, 0.060, 0.030), loc=(0.0, 0.035, ARCH[-1].z), mat=chrome, bevel=0.004)  # the hook's block at the tip


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    shell = pl.surface("pod_shell", (0.84, 0.79, 0.68), 0.32, coat=0.6, coat_roughness=0.12, edge_wear=0.2,
                       edge_color=(0.90, 0.86, 0.76), grime=0.25, smudges=0.04, dust=0.15, color_var=0.03)
    leather = pl.surface("pod_leather", (0.50, 0.24, 0.10), 0.46, color_tex=pl.polyhaven_texture(LEATHER, "Diffuse"),
                         tint=(0.90, 0.52, 0.30), rough_tex=pl.polyhaven_texture(LEATHER, "Rough"), rough_amount=0.3,
                         height_tex=pl.polyhaven_texture(LEATHER, "Diffuse"), height_strength=0.12, tile=0.5,
                         edge_wear=0.3, edge_color=(0.60, 0.34, 0.16), edge_width=0.004, grime=0.5, coat=0.15,
                         coat_roughness=0.3, color_var=0.05)
    walnut = pl.surface("pod_walnut", (0.32, 0.20, 0.12), 0.40,
                        color_tex=pl.polyhaven_texture("black_walnut_veneer_02", "Diffuse"), tint=(0.60, 0.46, 0.36),
                        rough_tex=pl.polyhaven_texture("black_walnut_veneer_02", "Rough"), rough_amount=0.2, tile=0.8,
                        coat=0.4, coat_roughness=0.22, edge_wear=0.25, edge_color=(0.40, 0.26, 0.15), edge_width=0.002,
                        color_var=0.04)
    steel = pl.surface("pod_steel", (0.035, 0.034, 0.032), 0.45, metallic=0.7, edge_wear=0.3,
                       edge_color=(0.25, 0.24, 0.22), dust=0.3, color_var=0.03)
    chrome = pl.surface("pod_chrome", (0.86, 0.86, 0.86), 0.10, metallic=1.0, smudges=0.05, color_var=0.0)
    body = pl.Builder(NAME)
    build_shell(body, shell)
    build_lining(body, leather)
    build_cushion(body, leather)
    build_rod(body, chrome)
    pod = body.finish(col, smooth_angle=50, seam_angle=55)
    pod["source"] = "made for this site"
    pod["gloss"] = 0.3  # lacquered shell
    stand_b = pl.Builder(f"{NAME}_stand")
    build_stand(stand_b, walnut, steel, chrome)
    stand = stand_b.finish(col, smooth_angle=40, seam_angle=50)
    stand["source"] = "made for this site"
    pl.parent_keep_transform(pod, stand)
    pl.report(NAME, col, 20000)
    pl.save_prop(NAME)


main()
