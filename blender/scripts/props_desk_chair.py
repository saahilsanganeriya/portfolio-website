"""desk_chair: a mid-century swivel desk chair, unbranded: a barrel back of bent walnut plywood that sweeps down into
low arms, a cognac leather back pad and seat cushion on a walnut seat pan, a tilt mechanism and a gas column on a
polished aluminium five-star base with twin-wheel casters.

Real proportions: seat 0.45 m high at the front edge, 0.48 m deep (front edge to the back pad), 0.50 m wide; arms
0.66 m (below the desk top, so it tucks in); back 0.82 m; base 0.64 m across. Objects: desk_chair (shell, pads, seat,
mechanism) and desk_chair_base (column, base, casters). Origin: the column's axis on the floor; faces -Y.
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

NAME = "desk_chair"
SEAT_Z, SEAT_FRONT_Y = 0.45, -0.25
# The back's inner surface in plan: half-ellipses round the seat (deeper toward the front), swept +-120 degrees from
# the back (+Y); the seat's outline is the same curve 8 mm inside it.
BACK_RX, BACK_RY, FRONT_RY, SWEEP = 0.255, 0.23, 0.26, math.radians(120)
SHELL_T, SHELL_BOTTOM = 0.014, 0.382
BACK_TOP, ARM_TOP = 0.82, 0.66
LEAN = math.tan(math.radians(9))
FLARE = 0.10  # the shell opens outward this much per metre of height
POLYHAVEN = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k"


def texture(name, kind):
    path = os.path.join(pl.CACHE_DIR, "polyhaven", f"{name}_{kind}_2k.jpg")
    if not os.path.exists(path):
        pl._download(f"{POLYHAVEN}/{name}/{name}_{kind}_2k.jpg", path)
    return path


# ---- the barrel back ----

def top_height(theta):
    """The shell's top edge: the back's crest, falling to the arms, then rounding down to the seat at the arm's end."""
    a = abs(math.degrees(theta))
    if a <= 92:
        return ARM_TOP + (BACK_TOP - ARM_TOP) * math.cos(math.radians(a) * 90 / 92) ** 2
    if a <= 98:
        return ARM_TOP
    u = min(1.0, (a - 98) / 22)
    return SEAT_Z + 0.025 + (ARM_TOP - SEAT_Z - 0.025) * math.sqrt(max(0.0, 1 - u * u))


def shell_point(theta, z, offset):
    """A point on the shell at sweep angle theta and height z, `offset` metres outward from the inner surface."""
    h = z - SHELL_BOTTOM
    ry0 = BACK_RY if math.cos(theta) >= 0 else FRONT_RY
    rx, ry = BACK_RX * (1 + FLARE * h), ry0 * (1 + FLARE * h)
    lean = max(0.0, math.cos(theta)) * h * LEAN
    x, y = rx * math.sin(theta), ry * math.cos(theta) + lean
    n = Vector((math.sin(theta) / rx, math.cos(theta) / ry)).normalized()
    return Vector((x + n.x * offset, y + n.y * offset, z))


def section_loop(theta, inner_offset, thickness, z0, z1, rows, rim=4):
    """Closed cross-section of a band at angle theta (a stadium): up its inner face, over a half-round top, down its
    outer face, under a half-round bottom. Profile index 0 is the inner face's foot, `rows` its top, rows + rim the
    outer face's top, 2 * rows + rim its foot."""
    r = thickness / 2
    lo, hi = z0 + r, z1 - r
    pts = [shell_point(theta, lo + (hi - lo) * j / rows, inner_offset) for j in range(rows + 1)]
    for k in range(1, rim):
        a = math.pi * k / rim
        pts.append(shell_point(theta, hi + r * math.sin(a), inner_offset + r * (1 - math.cos(a))))
    pts += [shell_point(theta, lo + (hi - lo) * j / rows, inner_offset + thickness) for j in range(rows, -1, -1)]
    for k in range(1, rim):
        a = math.pi * k / rim
        pts.append(shell_point(theta, lo - r * math.sin(a), inner_offset + thickness - r * (1 - math.cos(a))))
    return pts


def loft_sections(bm, loops, mat_index, seam_rows=(), closed_caps=True):
    """Quads between consecutive closed loops (equal counts), ngon caps at both ends; returns the faces."""
    n = len(loops[0])
    verts = [[bm.verts.new(p) for p in loop] for loop in loops]
    faces = []
    for k in range(len(verts) - 1):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((verts[k][i], verts[k][j], verts[k + 1][j], verts[k + 1][i]))
            f.material_index = mat_index
            faces.append(f)
    if closed_caps:
        for ring in (verts[0], verts[-1]):
            f = bm.faces.new(ring)
            f.material_index = mat_index
            faces.append(f)
    for i in seam_rows:
        for k in range(len(verts) - 1):
            e = bm.edges.get((verts[k][i], verts[k + 1][i]))
            if e:
                e.seam = True
    return faces, verts


def orient_outward(bm, faces, centre):
    bm.normal_update()
    out = sum((f.normal.dot(f.calc_center_median() - centre) * f.calc_area()) for f in faces)
    if out < 0:
        for f in faces:
            f.normal_flip()
    bm.normal_update()


def build_shell(b, walnut):
    """The bent plywood barrel: 14 mm thick with a half-round top edge, open below to the seat pan."""
    steps = 72
    rows = 9
    loops = []
    for i in range(steps + 1):
        theta = -SWEEP + 2 * SWEEP * i / steps
        loops.append(section_loop(theta, 0.0, SHELL_T, SHELL_BOTTOM, top_height(theta), rows))
    faces, _ = loft_sections(b.bm, loops, b.slot(walnut), seam_rows=(0, rows, rows + 4, 2 * rows + 4))
    orient_outward(b.bm, faces, Vector((0, -0.05, 0.5)))


def build_back_pad(b, leather):
    """The leather pad inside the barrel: 26 mm thick, rounded all round, thinning to a rounded end at each side."""
    steps, rows = 56, 6
    span = math.radians(100)
    loops = []
    for i in range(steps + 1):
        theta = -span + 2 * span * i / steps
        thick = 0.026 * math.sqrt(max(0.05, 1 - (abs(theta) / span) ** 6))
        loops.append(section_loop(theta, -thick - 0.001, thick, SEAT_Z + 0.030, top_height(theta) - 0.028, rows))
    faces, _ = loft_sections(b.bm, loops, b.slot(leather), seam_rows=(0, rows, rows + 4, 2 * rows + 4))
    orient_outward(b.bm, faces, Vector((0, 0.0, 0.6)))


def seat_outline(n=64):
    """Plan of the seat: the shell's inner curve at its foot, 8 mm in."""
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        ry = BACK_RY if math.cos(t) >= 0 else FRONT_RY
        pts.append(Vector(((BACK_RX - 0.008) * math.sin(t), (ry - 0.008) * math.cos(t))))
    return pts


def offset_polygon(pts, d):
    """Offset a convex CCW-or-CW closed polygon inward by d along its vertex normals."""
    c = sum(pts, Vector((0, 0))) / len(pts)
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        t = (p2 - p0).normalized()
        nrm = Vector((t.y, -t.x))
        if nrm.dot(p1 - c) < 0:
            nrm = -nrm
        out.append(p1 - nrm * d)
    return out


def build_seat(b, leather, walnut, black):
    outline = seat_outline()
    # Cushion: rings up its side, a rounded top edge, a slight crown.
    profile = [(0.012, 0.394), (0.004, 0.399), (0.0, 0.410), (0.0, 0.428), (0.004, 0.440), (0.012, 0.448),
               (0.026, SEAT_Z + 0.003), (0.07, SEAT_Z + 0.008), (0.13, SEAT_Z + 0.011), (0.19, SEAT_Z + 0.012)]
    loops = [[Vector((p.x, p.y, z)) for p in offset_polygon(outline, d)] for d, z in profile]
    faces, verts = loft_sections(b.bm, loops, b.slot(leather), seam_rows=(0,), closed_caps=True)
    orient_outward(b.bm, faces, Vector((0, 0, 0.42)))
    for ring in (verts[0], verts[5]):
        for i in range(len(ring)):
            e = b.bm.edges.get((ring[i], ring[(i + 1) % len(ring)]))
            if e:
                e.seam = True
    # The walnut seat pan under it, 17 mm, its edge showing as a line of wood under the leather.
    pan = offset_polygon(outline, -0.006)
    pan_profile = [(0.010, 0.377), (0.002, 0.380), (0.0, 0.386), (0.002, 0.392), (0.012, 0.395)]
    loops = [[Vector((p.x, p.y, z)) for p in offset_polygon(pan, d)] for d, z in pan_profile]
    faces, verts = loft_sections(b.bm, loops, b.slot(walnut), seam_rows=(0,))
    orient_outward(b.bm, faces, Vector((0, 0, 0.386)))
    # Tilt mechanism under the pan, its tension knob at the front.
    b.box((0.20, 0.22, 0.010), loc=(0.0, 0.0, 0.371), mat=black, bevel=0.002, corner=0.012)
    b.box((0.13, 0.17, 0.040), loc=(0.0, 0.005, 0.346), mat=black, bevel=0.004, corner=0.018)
    b.cylinder(0.018, 0.034, segments=20, loc=(0.0, -0.085, 0.346), rot=(90, 0, 0), mat=black, bevel=0.003)


def build_base(b, aluminium, black, chrome):
    # Gas column: the chrome rod out of a black telescoping shroud, into the base's hub.
    b.cylinder(0.0145, 0.12, segments=20, loc=(0, 0, 0.21), mat=chrome, bevel=0.001)
    b.cylinder(0.026, 0.13, segments=24, loc=(0, 0, 0.085), mat=black, bevel=0.003)
    b.cylinder(0.050, 0.056, segments=32, loc=(0, 0, 0.058), mat=aluminium, bevel=0.007)
    # Five arms: each a lofted, tapering, rounded section from the hub to the caster socket.
    secs = [(0.030, 0.029, 0.026, 0.087), (0.100, 0.027, 0.023, 0.083), (0.200, 0.023, 0.019, 0.077),
            (0.268, 0.021, 0.016, 0.073), (0.290, 0.021, 0.016, 0.072)]  # (r, half width, half height, centre z)
    for k in range(5):
        ang = math.radians(90 + 72 * k)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        side = Vector((-d.y, d.x, 0))
        loops = []
        for r, hw, hh, cz in secs:
            loop = []
            for (sx, sz) in pl.round_polygon([(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)], min(hw, hh) * 0.75, 3):
                loop.append(d * r + side * sx + Vector((0, 0, cz + sz)))
            loops.append(loop)
        faces, _ = loft_sections(b.bm, loops, b.slot(aluminium), seam_rows=(0,))
        orient_outward(b.bm, faces, d * 0.16 + Vector((0, 0, 0.08)))
        # Caster: a swivel stem into the socket, a hood over twin wheels, the axle trailing the stem.
        tip = d * 0.290
        b.cylinder(0.009, 0.020, segments=12, loc=(tip.x, tip.y, 0.046), mat=chrome)
        heading = math.degrees(ang) + 90 + (25 - 17 * k)
        back = Vector((math.cos(math.radians(heading + 90)), math.sin(math.radians(heading + 90)), 0)) * 0.018
        hub = tip + back
        b.box((0.014, 0.040, 0.034), loc=(hub.x, hub.y, 0.034), rot=(0, 0, heading), mat=black, bevel=0.002,
              corner=0.010, corner_axis="X")
        axle = Vector((math.cos(math.radians(heading)), math.sin(math.radians(heading)), 0))
        for side_sign in (-1, 1):
            w = hub + axle * (side_sign * 0.0135 - 0.0055)
            b.cylinder(0.025, 0.011, segments=18, loc=(w.x, w.y, 0.025), rot=(0, 90, heading), mat=black, bevel=0.003)


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    walnut = pl.surface("chair_walnut", (0.34, 0.21, 0.13), 0.42, color_tex=texture("black_walnut_veneer_02", "diff"),
                        tint=(0.50, 0.38, 0.30), rough_tex=texture("black_walnut_veneer_02", "rough"),
                        rough_amount=0.2, tile=1.0, coat=0.35, coat_roughness=0.25, edge_wear=0.25,
                        edge_color=(0.30, 0.19, 0.11), edge_width=0.002, smudges=0.04, color_var=0.04)
    leather = pl.surface("chair_leather", (0.40, 0.19, 0.08), 0.48, color_tex=texture("fabric_leather_02", "diff"),
                         tint=(0.78, 0.44, 0.24), rough_tex=texture("fabric_leather_02", "rough"), rough_amount=0.3,
                         height_tex=texture("fabric_leather_02", "diff"), height_strength=0.15, tile=0.5,
                         edge_wear=0.35, edge_color=(0.42, 0.22, 0.10), edge_roughness=0.35, edge_width=0.004,
                         grime=0.3, coat=0.15, coat_roughness=0.3, color_var=0.05)
    aluminium = pl.surface("chair_aluminium", (0.78, 0.78, 0.76), 0.24, metallic=1.0, scratches=0.12, smudges=0.06,
                           color_var=0.0, edge_width=0.001)
    chrome = pl.surface("chair_chrome", (0.86, 0.86, 0.86), 0.10, metallic=1.0, smudges=0.05, color_var=0.0)
    black = pl.surface("chair_black", (0.03, 0.028, 0.026), 0.5, edge_wear=0.25, edge_color=(0.10, 0.10, 0.095),
                       color_var=0.02, dust=0.25, edge_width=0.0015)

    body = pl.Builder(NAME)
    build_shell(body, walnut)
    build_back_pad(body, leather)
    build_seat(body, leather, walnut, black)
    chair = body.finish(col, smooth_angle=40, seam_angle=50)
    chair["source"] = "made for this site"
    chair["gloss"] = 0.35  # lacquered walnut

    base_b = pl.Builder(f"{NAME}_base")
    build_base(base_b, aluminium, black, chrome)
    base = base_b.finish(col, smooth_angle=40, seam_angle=50)
    base["source"] = "made for this site"
    base["gloss"] = 0.24  # polished aluminium
    pl.parent_keep_transform(base, chair)
    pl.report(NAME, col, 20000)
    pl.save_prop(NAME)


main()
