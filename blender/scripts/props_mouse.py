"""mouse: a two-button ball mouse of the late 1980s in the room's cream plastic, 108 x 62 x 35 mm, unbranded.

A soap-bar shell, low at the buttons and highest under the palm, wider at the back; a parting line runs round the
side where the top shell meets the base. The two buttons are the front of the top shell, split by thin seams (in
the material, with a slight bump, so they bake as real gaps). The cable leaves the front through a strain relief,
loops lazily on the desk, runs back past the computer and drops over the desk's back edge.

Objects: mouse; its child mouse_cable, with the empty mouse_cable_drop where the cable leaves the desk (extras
drop_y_m: how far behind the mouse's origin the desk's back edge is assumed to be). Faces -Y (the palm toward the
typist, the buttons and the cable away), origin at the base.
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

NAME = "mouse"
HALF_L, HALF_W = 0.054, 0.0305
SIDE_H = 0.0125           # the parting line's height
PEAK_H, PEAK_Y = 0.0340, -0.014
SPLIT_Y = -0.006          # the buttons' back edge (the buttons are the shell in front of it)
DROP_Y = 0.708            # assumed distance from the origin back to the desk's back edge (room v3 layout)
RINGS, SEGMENTS = 16, 56


def srgb(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def outline(phi):
    """A point on the plan's outline: a superellipse, narrower at the buttons (+Y) than under the palm."""
    c, s = math.cos(phi), math.sin(phi)
    n = 3.3
    x = HALF_W * math.copysign(abs(c) ** (2 / n), c)
    y = HALF_L * math.copysign(abs(s) ** (2 / n), s)
    return Vector((x * (1.0 - 0.07 * y / HALF_L), y, 0.0))


def crown(y):
    """The top's height along the length: highest under the palm, falling to the buttons and the heel."""
    t = (y - PEAK_Y) / (HALF_L + abs(PEAK_Y))
    return PEAK_H - (0.0105 if t > 0 else 0.0085) * t * t


def build_shell(col, mat):
    bm = bmesh.new()
    bm.loops.layers.uv.new("UVMap")
    rings = []
    radii = [1.0 - (1.0 - k / RINGS) ** 1.6 for k in range(1, RINGS + 1)]
    centre = bm.verts.new((0.0, 0.0, crown(0.0)))
    for r in radii:
        ring = []
        for i in range(SEGMENTS):
            p = outline(2 * math.pi * i / SEGMENTS) * r
            z = SIDE_H + (crown(p.y) - SIDE_H) * (1.0 - r ** 3.0) ** (1 / 3.0)
            ring.append(bm.verts.new((p.x, p.y, z)))
        rings.append(ring)
    # The side below the parting line: straight down, a slight tuck, then a chamfer to the base.
    for z, scale in ((SIDE_H - 0.0006, 0.996), (0.0035, 0.985), (0.0012, 0.965), (0.0, 0.935)):
        rings.append([bm.verts.new((v.co.x * scale, v.co.y * scale, z)) for v in rings[RINGS - 1]])
    for i in range(SEGMENTS):
        bm.faces.new((centre, rings[0][i], rings[0][(i + 1) % SEGMENTS]))
    for k in range(len(rings) - 1):
        for i in range(SEGMENTS):
            j = (i + 1) % SEGMENTS
            bm.faces.new((rings[k][i], rings[k + 1][i], rings[k + 1][j], rings[k][j]))
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # Seams: the parting line (a real line on the shell) and the base's edge; one cut down the heel.
    for ring in (rings[RINGS - 1], rings[-1]):
        for i in range(SEGMENTS):
            e = bm.edges.get((ring[i], ring[(i + 1) % SEGMENTS]))
            e.seam = True
    heel = 3 * SEGMENTS // 4
    for k in range(RINGS - 1, len(rings) - 1):
        bm.edges.get((rings[k][heel], rings[k + 1][heel])).seam = True
    me = bpy.data.meshes.new(NAME)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(NAME, me)
    col.objects.link(ob)
    pl.finish_object(ob, smooth_angle=60, unwrap=False)
    pl.unwrap_object(ob, seam_angle=179)
    return ob


def shell_material():
    """Cream ABS with the button seams and the parting line as thin dark grooves (colour and bump)."""
    mat = pl.surface("mouse_shell", srgb("#D4C7AA"), 0.46, micro_bump=(2200, 0.03), grime=0.6, dust=0.2,
                     edge_wear=0.1, smudges=0.45, color_var=0.05)
    nt = mat.node_tree
    k = pl.NodeKit(nt)
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    pos = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": k.node("ShaderNodeTexCoord").outputs["Object"]})
    x, y, z = pos.outputs["X"], pos.outputs["Y"], pos.outputs["Z"]
    half = 0.00028
    across = k.math("LESS_THAN", k.math("ABSOLUTE", k.math("SUBTRACT", y, SPLIT_Y)), half)
    along = k.math("MULTIPLY", k.math("LESS_THAN", k.math("ABSOLUTE", x), half), k.math("GREATER_THAN", y, SPLIT_Y))
    parting = k.math("LESS_THAN", k.math("ABSOLUTE", k.math("SUBTRACT", z, SIDE_H - 0.0003)), 0.00025)
    groove = k.math("MINIMUM", k.math("ADD", k.math("ADD", across, along), parting), 1.0)
    top = k.math("GREATER_THAN", z, SIDE_H + 0.001)
    seams = k.math("MAXIMUM", k.math("MULTIPLY", k.math("MINIMUM", k.math("ADD", across, along), 1.0), top), parting)
    base_in = bsdf.inputs["Base Color"]
    src = base_in.links[0].from_socket
    dark = k.mix_color(seams, src, (0.09, 0.075, 0.06, 1.0))
    nt.links.new(dark, base_in)
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.6, "Distance": 0.0004,
                                           "Height": k.math("SUBTRACT", 1.0, seams)})
    normal_in = bsdf.inputs["Normal"]
    if normal_in.links:
        nt.links.new(normal_in.links[0].from_socket, bump.inputs["Normal"])
    nt.links.new(bump.outputs["Normal"], normal_in)
    del groove
    return mat


def smooth_path(points, sub):
    out = []
    p = [points[0]] + points + [points[-1]]
    for i in range(1, len(p) - 2):
        for s in range(sub):
            t = s / sub
            a, b, c, d = p[i - 1], p[i], p[i + 1], p[i + 2]
            out.append(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t +
                              (-a + 3 * b - 3 * c + d) * t ** 3))
    out.append(points[-1])
    return out


def build_cable(col, cable_mat, relief_mat):
    """The strain relief at the front, then the cable: a lazy curve on the desk, back past the computer, over the
    desk's back edge and down."""
    r = 0.0017
    front = outline(math.pi / 2).y
    exit_z = 0.0105
    b = pl.Builder("mouse_cable")
    b.lathe([(0.0, 0.0), (0.0034, 0.0), (0.0034, 0.0025), (0.0028, 0.0045), (0.0021, 0.0105), (0.0019, 0.0125),
             (0.0, 0.0125)], segments=12, loc=(0, front - 0.003, exit_z), rot=(-90, 0, 0), mat=relief_mat)
    start = Vector((0.0, front + 0.0095, exit_z))
    pts = [start, start + Vector((0.0, 0.010, -0.0025)), start + Vector((0.003, 0.022, -0.0070)),
           Vector((0.008, front + 0.045, r + 0.0006))]
    path = [(0.016, 0.135), (0.012, 0.19), (-0.004, 0.25), (0.004, 0.33), (0.012, 0.42), (0.010, 0.52),
            (0.012, 0.61), (0.013, DROP_Y - 0.032), (0.013, DROP_Y - 0.010)]
    for x, y in path:
        pts.append(Vector((x, y, r + (0.0004 if y > DROP_Y - 0.02 else 0.0))))
    edge = Vector((0.013, DROP_Y, 0.0))
    for a in (30, 60, 90):
        t = math.radians(a)
        pts.append(edge + Vector((0.0, (r + 0.0004) * math.sin(t), (r + 0.0004) * math.cos(t))))
    for k in range(1, 6):
        pts.append(edge + Vector((-0.003 * k / 5, r + 0.0015 + 0.005 * (k / 5) ** 2, -0.05 * k)))
    b.tube(smooth_path(pts, 4), r, sides=8, mat=cable_mat)
    ob = b.finish(col, smooth_angle=60)
    return ob, edge


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    shell = build_shell(col, shell_material())
    shell["source"] = "made for this site"
    cable_mat = pl.surface("mouse_cable", srgb("#BDB29C"), 0.62, micro_bump=(900, 0.02), grime=0.3, dust=0.2,
                           color_var=0.03)
    relief_mat = pl.surface("mouse_relief", srgb("#C9BC9F"), 0.55, grime=0.4, color_var=0.03)
    cable, edge = build_cable(col, cable_mat, relief_mat)
    cable["drop_y_m"] = DROP_Y
    cable["source"] = "made for this site"
    pl.parent_keep_transform(cable, shell)
    drop = pl.empty("mouse_cable_drop", col, tuple(edge), size=0.02, parent=shell, display="PLAIN_AXES")
    drop["drop_y_m"] = DROP_Y
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
