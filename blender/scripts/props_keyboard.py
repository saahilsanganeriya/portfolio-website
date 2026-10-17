"""keyboard: a full-size 1980s-style mechanical keyboard in the room's cream plastic, 443 x 152 mm, unbranded.

The 101-key layout of the period (function row on top, Ctrl / Alt / a wide space bar / Alt / Ctrl along the bottom,
the cursor block and the keypad), sculpted rows on a plate tilted 5.5 degrees, so the rows step up toward the back,
a wedge case with the keys sunk in a well, three lock lights over the keypad and a cable out of the back. Each keycap
is a tapered cap with a rounded top edge; alphanumerics are light cream and the rest a darker greige. The legends are
an image this script has props_art.mjs draw (about 9,200 px per metre), read through the UV map `legend`, so they
bake crisp; `UVMap` is the bake map (one island per keycap, seams on the hidden bottom edge and the back-left corner).

Objects: keyboard; its child keyboard_cable (out of the back, along the desk, over the desk's back edge), with the
empty keyboard_cable_drop where it leaves the desk (extras drop_y_m: how far behind the keyboard's origin the desk's
back edge is assumed to be). Faces -Y, origin at the base.
"""
import json
import math
import os
import subprocess
import sys

import bmesh
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "keyboard"
HERE = os.path.dirname(os.path.abspath(__file__))
U = 0.01905                     # one key unit
KEY_W, KEY_D = 22.5 * U, 6.5 * U
BORDER_SIDE, BORDER_FRONT, BORDER_BACK = 0.0072, 0.0105, 0.0135
CASE_W = KEY_W + 2 * BORDER_SIDE
CASE_D = KEY_D + BORDER_FRONT + BORDER_BACK
TILT = math.radians(5.5)        # the plate's slope, rising toward the back
PLATE_Z = 0.0125                # the plate's height at the front edge of the case
BEZEL_N = 0.0075                # the bezel's top above the plate
CAP_N = 0.0052                  # keycap bottoms above the plate (inside the well)
GAP = 0.0009                    # between neighbouring keycaps
LEGEND_PPM = 4096 / CASE_W      # legend image resolution, pixels per metre
DROP_Y = 0.70                   # assumed distance from the origin back to the desk's back edge (room v3 layout)

# Row profile, back to front: centre height of the cap and the tilt of its top (degrees; + faces the typist).
ROWS = {0: (0.0110, 9.0), 1: (0.0110, 9.0), 2: (0.0096, 4.0), 3: (0.0090, -1.0), 4: (0.0094, -6.0), 5: (0.0094, -9.0)}
ROW_S = {0: 6.0, 1: 4.5, 2: 3.5, 3: 2.5, 4: 1.5, 5: 0.5}   # row centres from the key area's front edge, in units

BIG, MED, SMALL, TINY = 6.2, 4.8, 3.5, 2.9   # legend sizes (em, mm)


def tl(text, size=SMALL, line=0):
    return {"t": text, "size_mm": size, "at": "tl", "line": line}


def bl(text, size=MED, line=0):
    return {"t": text, "size_mm": size, "at": "bl", "line": line}


def words(*lines, size=SMALL):
    return [tl(t, size, i) for i, t in enumerate(lines)]


def arrow(direction, at="c", size=MED):
    return {"arrow": direction, "size_mm": size, "at": at}


def pair(shifted, plain):
    return [tl(shifted, MED), bl(plain, MED)]


def layout():
    """(left edge in units, row, width, height in units, colour, legends) for the 101 keys."""
    keys = []

    def add(x, row, legends, w=1.0, h=1.0, kind="mod"):
        keys.append((x, row, w, h, kind, legends))

    add(0, 0, words("Esc"))
    for i in range(12):
        add([2, 3, 4, 5, 6.5, 7.5, 8.5, 9.5, 11, 12, 13, 14][i], 0, words(f"F{i + 1}"))
    for i, lab in enumerate([("Print", "Screen"), ("Scroll", "Lock"), ("Pause",)]):
        add(15.25 + i, 0, words(*lab))

    for i, (s, p) in enumerate([("~", "`"), ("!", "1"), ("@", "2"), ("#", "3"), ("$", "4"), ("%", "5"), ("^", "6"),
                                ("&", "7"), ("*", "8"), ("(", "9"), (")", "0"), ("_", "-"), ("+", "=")]):
        add(i, 1, pair(s, p), kind="alpha")
    add(13, 1, words("Backspace"), w=2)
    for i, lab in enumerate([("Insert",), ("Home",), ("Page", "Up")]):
        add(15.25 + i, 1, words(*lab))
    add(18.5, 1, words("Num", "Lock"))
    for i, t in enumerate(["/", "*", "-"]):
        add(19.5 + i, 1, [tl(t, MED)])

    add(0, 2, words("Tab"), w=1.5)
    for i, ch in enumerate("QWERTYUIOP"):
        add(1.5 + i, 2, [tl(ch, BIG)], kind="alpha")
    for i, (s, p) in enumerate([("{", "["), ("}", "]")]):
        add(11.5 + i, 2, pair(s, p), kind="alpha")
    add(13.5, 2, pair("|", "\\"), w=1.5, kind="alpha")
    for i, lab in enumerate([("Delete",), ("End",), ("Page", "Down")]):
        add(15.25 + i, 2, words(*lab))

    add(0, 3, words("Caps Lock"), w=1.75)
    for i, ch in enumerate("ASDFGHJKL"):
        add(1.75 + i, 3, [tl(ch, BIG)], kind="alpha")
    for i, (s, p) in enumerate([(":", ";"), ('"', "'")]):
        add(10.75 + i, 3, pair(s, p), kind="alpha")
    add(12.75, 3, words("Enter"), w=2.25)

    add(0, 4, words("Shift"), w=2.25)
    for i, ch in enumerate("ZXCVBNM"):
        add(2.25 + i, 4, [tl(ch, BIG)], kind="alpha")
    for i, (s, p) in enumerate([("<", ","), (">", "."), ("?", "/")]):
        add(9.25 + i, 4, pair(s, p), kind="alpha")
    add(12.25, 4, words("Shift"), w=2.75)
    add(16.25, 4, [arrow("up")])

    add(0, 5, words("Ctrl"), w=1.5)
    add(2.5, 5, words("Alt"), w=1.5)
    add(4, 5, [], w=7, kind="alpha")
    add(11, 5, words("Alt"), w=1.5)
    add(13.5, 5, words("Ctrl"), w=1.5)
    for i, d in enumerate(["left", "down", "right"]):
        add(15.25 + i, 5, [arrow(d)])

    pad = {(0, 2): ("7", "Home"), (1, 2): ("8", "up"), (2, 2): ("9", "PgUp"), (0, 3): ("4", "left"), (1, 3): ("5", ""),
           (2, 3): ("6", "right"), (0, 4): ("1", "End"), (1, 4): ("2", "down"), (2, 4): ("3", "PgDn")}
    for (col, row), (digit, second) in pad.items():
        legends = [tl(digit, MED)]
        if second in ("up", "down", "left", "right"):
            legends.append(arrow(second, at="bl", size=SMALL))
        elif second:
            legends.append(bl(second, TINY))
        add(18.5 + col, row, legends, kind="alpha")
    add(21.5, 2, [tl("+", MED)], h=2)
    add(18.5, 5, [tl("0", MED), bl("Ins", TINY)], w=2, kind="alpha")
    add(20.5, 5, [tl(".", MED), bl("Del", TINY)], kind="alpha")
    add(21.5, 4, words("Enter", size=TINY), h=2)
    return keys


# ---- frames: the flat key plane T (x, s along the slope, n off the plate) and the world ----

def t_to_world(x, s, nn):
    return Vector((x, s * math.cos(TILT) - nn * math.sin(TILT), PLATE_Z + s * math.sin(TILT) + nn * math.cos(TILT)))


T_MATRIX = Matrix.Translation((0, 0, PLATE_Z)) @ Matrix.Rotation(TILT, 4, "X")


def legend_uv(x, s):
    return ((x + CASE_W / 2) / CASE_W, s / CASE_D)


def rounded_rect(w, d, r, seg, cx=0.0, cy=0.0):
    pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    return [(cx + x, cy + y) for x, y in pl.round_polygon(pts, min(r, w * 0.49, d * 0.49), seg)]


def srgb(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


# ---- the legend image ----

def draw_legends(keys):
    os.makedirs(os.path.join(pl.CACHE_DIR, "art"), exist_ok=True)
    spec = {"width_m": CASE_W, "height_m": CASE_D, "px_per_m": LEGEND_PPM, "inset_mm": 1.35, "keys": [], "marks": []}
    for x0, row, w, h, kind, legends in keys:
        cx, cs, tw, td = key_top(x0, row, w, h)
        spec["keys"].append({"x": cx + CASE_W / 2, "y": cs, "w": tw, "h": td, "legends": legends})
    for lx, label in zip(LED_X, ("Num Lock", "Caps Lock", "Scroll Lock")):
        spec["marks"].append({"t": label, "size_mm": 1.9, "x": lx + CASE_W / 2, "y": LED_S - 0.0042})
    layout_file = os.path.join(pl.CACHE_DIR, "art", "keyboard_legends.json")
    out = os.path.join(pl.CACHE_DIR, "art", "keyboard_legends.png")
    with open(layout_file, "w") as fh:
        json.dump(spec, fh)
    subprocess.run(["node", os.path.join(HERE, "props_art.mjs"), "legends", layout_file, out], check=True)
    img = bpy.data.images.load(out)
    img.colorspace_settings.name = "Non-Color"
    img.name = "keyboard_legends"
    return img


def key_top(x0, row, w, h):
    """Centre (x, s) of a key on the plane T and the size of its top."""
    cx = -KEY_W / 2 + (x0 + w / 2) * U
    rows = [row, row + 1] if h > 1 else [row]
    cs = BORDER_FRONT + sum(ROW_S[r] for r in rows) / len(rows) * U
    bw, bd = w * U - GAP, h * U - GAP
    return cx, cs, bw - 0.0056, bd - 0.0048


# ---- the lock lights over the keypad (in the space the function row leaves there) ----

LED_S = BORDER_FRONT + 6.0 * U + 0.0012
LED_X = [-KEY_W / 2 + (18.5 + 0.5 + i * 1.35) * U + 0.004 for i in range(3)]


# ---- geometry ----

def keycap(bm, uv_main, uv_leg, x0, row, w, h, mat_index, seam_edges):
    """One keycap: a tapered skirt and a rounded top edge, tilted by its row's sculpt, open underneath."""
    cx, cs, tw, td = key_top(x0, row, w, h)
    bw, bd = w * U - GAP, h * U - GAP
    rows = [row, row + 1] if h > 1 else [row]
    height = sum(ROWS[r][0] for r in rows) / len(rows)
    tilt = math.radians(sum(ROWS[r][1] for r in rows) / len(rows))
    rings_spec = [
        (bw, bd, 0.0010, 0.0),
        (tw + 0.0007, td + 0.0007, 0.0019, height - 0.0010),
        (tw + 0.0002, td + 0.0002, 0.0017, height - 0.0003),
        (tw - 0.0005, td - 0.0005, 0.0015, height),
    ]
    rings = []
    for k, (rw, rd, rr, z) in enumerate(rings_spec):
        ring = []
        for (x, y) in rounded_rect(rw, rd, rr, 2):
            zz = z + (y * math.tan(tilt) if k > 0 else 0.0)
            v = bm.verts.new(t_to_world(cx + x, cs + y, CAP_N + zz))
            ring.append((v, cx + x, cs + y))
        rings.append(ring)
    faces = []
    count = len(rings[0])
    for k in range(len(rings) - 1):
        for i in range(count):
            j = (i + 1) % count
            quad = (rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i])
            faces.append((bm.faces.new([q[0] for q in quad]), quad))
    top = rings[-1]
    faces.append((bm.faces.new([q[0] for q in top]), top))
    for f, quad in faces:
        f.material_index = mat_index
        f.smooth = True
        for loop, (_, lx, ls) in zip(f.loops, quad):
            loop[uv_leg].uv = legend_uv(lx, ls)
    # Seams: the open bottom edge is a boundary already; cut the skirt at the back-left corner (index 9..11 region).
    corner = 10
    for k in range(len(rings) - 1):
        e = bm.edges.get((rings[k][corner][0], rings[k + 1][corner][0]))
        if e:
            seam_edges.append(e)


def build_caps(col, mats):
    b = pl.Builder("keyboard_caps")
    bm = b.bm
    uv_main = bm.loops.layers.uv.new("UVMap")
    uv_leg = bm.loops.layers.uv.new("legend")
    alpha, mod = b.slot(mats["alpha"]), b.slot(mats["mod"])
    seams = []
    for x0, row, w, h, kind, legends in layout():
        keycap(bm, uv_main, uv_leg, x0, row, w, h, alpha if kind == "alpha" else mod, seams)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method="BEAUTY",
                          ngon_method="BEAUTY")
    for e in seams:
        if e.is_valid:
            e.seam = True
    ob = b.finish(col, smooth_angle=50, unwrap=False)
    pl.unwrap_object(ob, seam_angle=179)
    return ob


def build_case(col, mats):
    """The wedge case: vertical walls in the world, a rounded top edge, the bezel and the key well."""
    b = pl.Builder("keyboard_case")
    bm = b.bm
    uv_main = bm.loops.layers.uv.new("UVMap")
    uv_leg = bm.loops.layers.uv.new("legend")
    case, plate = b.slot(mats["case"]), b.slot(mats["plate"])
    seg = 4
    cs0 = CASE_D / 2
    well_w, well_d = KEY_W + 0.0016, KEY_D + 0.0016
    well_cs = BORDER_FRONT + KEY_D / 2

    def t_ring(w, d, r, nn, cs=cs0):
        return [(t_to_world(x, s, nn), x, s) for x, s in rounded_rect(w, d, r, seg, 0.0, cs)]

    top_flat = t_ring(CASE_W - 0.0044, CASE_D - 0.0044, 0.0078, BEZEL_N)
    edge_mid = t_ring(CASE_W - 0.0012, CASE_D - 0.0012, 0.0094, BEZEL_N - 0.0006)
    edge_out = t_ring(CASE_W, CASE_D, 0.0100, BEZEL_N - 0.0022)
    wall_bottom = [(Vector((p.x, p.y, 0.0016)), x, s) for p, x, s in edge_out]
    ys = [p.y for p, _, _ in edge_out]
    yc, half_d = (max(ys) + min(ys)) / 2, (max(ys) - min(ys)) / 2
    foot = [(Vector((p.x * (CASE_W / 2 - 0.0016) / (CASE_W / 2), yc + (p.y - yc) * (half_d - 0.0016) / half_d, 0.0)),
             x, s) for p, x, s in edge_out]
    well_top = t_ring(well_w, well_d, 0.0022, BEZEL_N, well_cs)
    well_lip = t_ring(well_w, well_d, 0.0022, BEZEL_N - 0.0005, well_cs)
    well_floor = t_ring(well_w, well_d, 0.0022, 0.0, well_cs)

    def verts(ring):
        return [(bm.verts.new(p), x, s) for p, x, s in ring]

    rings = [verts(r) for r in (foot, wall_bottom, edge_out, edge_mid, top_flat)]
    inner = [verts(r) for r in (well_top, well_lip, well_floor)]
    faces = []

    def bridge(ra, rb, mat, on_top):
        n_ = len(ra)
        for i in range(n_):
            j = (i + 1) % n_
            quad = (ra[i], ra[j], rb[j], rb[i])
            f = bm.faces.new([q[0] for q in quad])
            f.material_index = mat
            faces.append((f, quad, on_top))

    for k in range(len(rings) - 1):
        bridge(rings[k], rings[k + 1], case, k >= 3)
    bridge(rings[-1], inner[0], case, True)            # the bezel's flat top
    bridge(inner[0], inner[1], case, True)
    bridge(inner[1], inner[2], plate, False)          # the well's walls
    floor = bm.faces.new([q[0] for q in inner[2]])
    floor.material_index = plate
    faces.append((floor, inner[2], False))
    bottom = bm.faces.new([q[0] for q in reversed(rings[0])])
    bottom.material_index = case
    faces.append((bottom, list(reversed(rings[0])), False))
    for f, quad, on_top in faces:
        for loop, (_, lx, ls) in zip(f.loops, quad):
            loop[uv_leg].uv = legend_uv(lx, ls) if on_top else (0.002, 0.002)

    # Panels flush with the bezel where the well has no key: the lock lights over the keypad, and the blanks in the
    # bottom row, beside the up arrow and between Esc and F1 (a bare plate there reads as a missing key).
    panel_rings = []

    def panel(cx, cs, w, d):
        top = [(t_to_world(x, s, BEZEL_N - 0.0003), x, s) for x, s in rounded_rect(w, d, 0.0012, 2, cx, cs)]
        low = [(t_to_world(x, s, 0.0), x, s) for x, s in rounded_rect(w, d, 0.0012, 2, cx, cs)]
        pt, plo = verts(top), verts(low)
        for i in range(len(pt)):
            j = (i + 1) % len(pt)
            f = bm.faces.new([plo[i][0], plo[j][0], pt[j][0], pt[i][0]])
            f.material_index = case
            for loop in f.loops:
                loop[uv_leg].uv = (0.002, 0.002)
        f = bm.faces.new([q[0] for q in pt])
        f.material_index = case
        for loop, (_, lx, ls) in zip(f.loops, pt):
            loop[uv_leg].uv = legend_uv(lx, ls)
        panel_rings.append((plo, pt))

    pad_x0 = -KEY_W / 2 + 18.5 * U
    panel_s0 = BORDER_FRONT + 5.5 * U + 0.0004
    panel_w = KEY_W / 2 - pad_x0 + 0.0008
    panel_d = (well_cs + well_d / 2) - panel_s0
    panel(pad_x0 + panel_w / 2 - 0.0002, panel_s0 + panel_d / 2, panel_w, panel_d)
    clear = GAP / 2 + 0.0003
    for x0, w, row in ((1.5, 1.0, 5), (12.5, 1.0, 5), (15.25, 1.0, 4), (17.25, 1.0, 4), (15.25, 3.0, 3), (1.0, 1.0, 0)):
        cx = -KEY_W / 2 + (x0 + w / 2) * U
        panel(cx, BORDER_FRONT + ROW_S[row] * U, w * U - 2 * clear, U - 2 * clear)

    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method="BEAUTY",
                          ngon_method="BEAUTY")
    # Seams: the bottom edge and the well's floor edge are hidden; one cut down the back-left corner.
    for ring in (rings[0], inner[2]):
        for i in range(len(ring)):
            e = bm.edges.get((ring[i][0], ring[(i + 1) % len(ring)][0]))
            if e:
                e.seam = True
    corner = len(rings[0]) - 3
    chain = [r[corner][0] for r in rings] + [inner[0][corner][0], inner[1][corner][0], inner[2][corner][0]]
    for a, c in zip(chain, chain[1:]):
        e = bm.edges.get((a, c))
        if e:
            e.seam = True
    for plo, pt in panel_rings:
        for i in range(len(plo)):
            e = bm.edges.get((plo[i][0], plo[(i + 1) % len(plo)][0]))
            if e:
                e.seam = True
        e = bm.edges.get((plo[0][0], pt[0][0]))
        if e:
            e.seam = True

    # Lights and the cable's strain relief (UV legend at a blank texel).
    for lx in LED_X:
        new = b.box((0.0034, 0.0022, 0.0009), mat=mats["led"])
        m = Matrix.Translation(t_to_world(lx, LED_S, BEZEL_N - 0.0001)) @ Matrix.Rotation(TILT, 4, "X")
        bmesh.ops.transform(bm, matrix=m, verts=list({v for f in new if f.is_valid for v in f.verts}))
    back_y = t_to_world(0, CASE_D, BEZEL_N - 0.0022).y
    relief = Vector((-0.09, back_y, 0.016))
    b.lathe([(0.0, 0.0), (0.0055, 0.0), (0.0055, 0.004), (0.0042, 0.006), (0.0030, 0.014), (0.0024, 0.017),
             (0.0, 0.017)], segments=12, loc=tuple(relief - Vector((0, 0.003, 0))), rot=(-90, 0, 0), mat=mats["case"])
    for f in bm.faces:
        for loop in f.loops:
            if loop[uv_leg].uv.length == 0:
                loop[uv_leg].uv = (0.002, 0.002)
    ob = b.finish(col, smooth_angle=40, unwrap=False)
    pl.unwrap_object(ob, seam_angle=60)
    return ob, relief


def build_cable(col, mat, start, y_c):
    """Out of the back, a turn to the left past the computer, back along the desk and over its back edge.

    `y_c` is the case's centre (the origin once the keyboard is centred); the path is laid out from it."""
    r = 0.0021
    rel = start.y - y_c
    pts = [start + Vector((0, 0.002, 0)), start + Vector((0, 0.010, -0.002)), start + Vector((-0.003, 0.022, -0.008)),
           Vector((start.x - 0.010, start.y + 0.040, r + 0.0006))]
    path = [(-0.125, rel + 0.060), (-0.160, rel + 0.080), (-0.195, rel + 0.110), (-0.214, 0.25), (-0.221, 0.36),
            (-0.217, 0.48), (-0.213, 0.58), (-0.212, DROP_Y - 0.032), (-0.212, DROP_Y - 0.010)]
    for x, y in path:
        pts.append(Vector((x + 0.003 * math.sin(y * 23), y + y_c, r + (0.0004 if y > DROP_Y - 0.02 else 0.0))))
    edge = Vector((-0.212, DROP_Y + y_c, 0.0))
    for a in (30, 60, 90):
        t = math.radians(a)
        pts.append(edge + Vector((0, (r + 0.0004) * math.sin(t), (r + 0.0004) * math.cos(t))))
    for k in range(1, 6):
        pts.append(edge + Vector((0.003 * k / 5, r + 0.0015 + 0.006 * (k / 5) ** 2, -0.05 * k)))
    b = pl.Builder("keyboard_cable")
    b.tube(smooth_path(pts, 4), r, sides=8, mat=mat)
    ob = b.finish(col, smooth_angle=60)
    return ob, edge


def smooth_path(points, sub):
    """Catmull-Rom through the points, `sub` samples per span."""
    out = []
    p = [points[0]] + points + [points[-1]]
    for i in range(1, len(p) - 2):
        for k in range(sub):
            t = k / sub
            a, b_, c, d = p[i - 1], p[i], p[i + 1], p[i + 2]
            out.append(0.5 * ((2 * b_) + (-a + c) * t + (2 * a - 5 * b_ + 4 * c - d) * t * t +
                              (-a + 3 * b_ - 3 * c + d) * t ** 3))
    out.append(points[-1])
    return out


# ---- materials ----

def with_legend(mat, image, ink):
    """Mix the legend image into a surface() material's base colour through the `legend` UV map."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    k = pl.NodeKit(nt)
    base_in = bsdf.inputs["Base Color"]
    src = base_in.links[0].from_socket if base_in.links else None
    uv = k.node("ShaderNodeUVMap", uv_map="legend")
    tex = k.node("ShaderNodeTexImage", image=image, interpolation="Linear", extension="CLIP")
    k.set(tex, "Vector", uv.outputs["UV"])
    mix = k.node("ShaderNodeMix", data_type="RGBA", blend_type="MIX", clamp_result=True)
    k.set(mix, "Factor_Float", tex.outputs["Color"])
    if src is not None:
        nt.links.new(src, pl._sock(mix.inputs, "A_Color"))
    else:
        pl._sock(mix.inputs, "A_Color").default_value = base_in.default_value
    pl._sock(mix.inputs, "B_Color").default_value = ink + (1.0,)
    nt.links.new(pl._sock(mix.outputs, "Result_Color"), base_in)
    return mat


def materials(legend_img):
    ink = srgb("#2A2520")
    case = pl.surface("keyboard_case", srgb("#D2C5A8"), 0.5, micro_bump=(1800, 0.025), grime=0.5, dust=0.25,
                      edge_wear=0.12, smudges=0.15, color_var=0.05)
    alpha = pl.surface("keyboard_cap_alpha", srgb("#DED4BF"), 0.42, micro_bump=(2600, 0.02), grime=0.35, dust=0.12,
                       edge_wear=0.1, smudges=0.3, color_var=0.04)
    mod = pl.surface("keyboard_cap_mod", srgb("#ABA290"), 0.44, micro_bump=(2600, 0.02), grime=0.35, dust=0.12,
                     edge_wear=0.1, smudges=0.25, color_var=0.04)
    plate = pl.surface("keyboard_plate", srgb("#8C8371"), 0.6, grime=0.4, color_var=0.03)
    led = pl.surface("keyboard_led", (0.015, 0.035, 0.02), 0.12, coat=0.6, color_var=0.0)
    cable = pl.surface("keyboard_cable", srgb("#BDB29C"), 0.62, micro_bump=(900, 0.02), grime=0.3, dust=0.2,
                       color_var=0.03)
    for m in (case, alpha, mod):
        with_legend(m, legend_img, ink)
    return {"case": case, "alpha": alpha, "mod": mod, "plate": plate, "led": led, "cable": cable}


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    legend_img = draw_legends(layout())
    mats = materials(legend_img)
    case, relief = build_case(col, mats)
    caps = build_caps(col, mats)
    keyboard = pl.join([case, caps], NAME)
    pl.pack_uv(keyboard)
    keyboard["source"] = "made for this site"
    keyboard["legend_px_per_m"] = round(LEGEND_PPM)
    y_c = (min(v.co.y for v in keyboard.data.vertices) + max(v.co.y for v in keyboard.data.vertices)) / 2
    cable, edge = build_cable(col, mats["cable"], relief + Vector((0, 0.014, 0)), y_c)
    cable["drop_y_m"] = DROP_Y
    cable["source"] = "made for this site"
    pl.set_origin_base(keyboard)
    offset = keyboard.location.copy()
    keyboard.location = (0, 0, 0)
    cable.data.transform(Matrix.Translation(-offset))
    pl.parent_keep_transform(cable, keyboard)
    drop = pl.empty("keyboard_cable_drop", col, tuple(edge - offset), size=0.02, parent=keyboard, display="PLAIN_AXES")
    drop["drop_y_m"] = DROP_Y
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
