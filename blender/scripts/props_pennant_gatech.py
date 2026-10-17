"""pennant_gatech: a felt Georgia Tech pennant, 30 x 12 inches (762 x 305 mm), pinned to the wall by its header.

Navy felt with a sewn Tech Gold header, the interlocking GT (the Institute's athletic mark, from Wikimedia Commons;
public domain as simple text and shapes, a Georgia Tech trademark) and GEORGIA TECH in block letters that shrink
toward the tip, drawn by props_art.mjs and read through the UV map `art` on the front. Two brass tacks hold the
header flat; past it the felt bows off the wall and the tail droops about 3 cm. The back and the cut edge are plain
navy felt. Objects: pennant_gatech. Origin: bottom centre of the back face (the wall); faces -Y.
"""
import hashlib
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

NAME = "pennant_gatech"
HERE = os.path.dirname(os.path.abspath(__file__))
LOGO_URL = "https://upload.wikimedia.org/wikipedia/commons/b/bf/Georgia_Tech_Yellow_Jackets_logo.svg"
LOGO_SHA256 = "d981e07deb212e8c74a2930183070d3373b79355543e045dcb667a2ec5d47b92"
L, H = 0.762, 0.305
HEADER = L * 0.085
TIP = 0.0011
FELT_T = 0.0022
NX, NZ = 56, 16
SAG = 0.032
# The desk wall's picture light and the room's exposure (2.8 stops) washed the felt out to sky blue and white in the
# bake. The felt's brightness is scaled per colour of its art, by the art's luminance from the navy (0.028) to the gold
# (0.37): measured on straight-on renders of the room's light, these land near #003057 and #B3A369.
LUM_NAVY, LUM_GOLD = 0.028, 0.37
FELT_SCALE_NAVY, FELT_SCALE_GOLD = 0.075, 0.03


def srgb(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def half(x):
    return H / 2 * (1 - x / L) + TIP


def draped(x, z):
    """Where a point of the flat pennant (x along it, z across) hangs: flat under the header, then bowing off the
    wall (-Y), drooping and turning a little toward the tip."""
    t = max(0.0, (x - HEADER) / (L - HEADER))
    bow = 0.010 * math.sin(math.pi * min(1.0, t * 1.15)) + 0.004 * math.sin(2.6 * math.pi * t) * t
    twist = 0.012 * t * t * (z / (H / 2))
    y = -(bow + twist) * (1 - math.exp(-t * 14))
    return Vector((x, y, z - SAG * t ** 1.8 - 0.004 * t * (z / (H / 2)) ** 2))


def logo_svg():
    path = os.path.join(pl.CACHE_DIR, "art", "gt_interlocking.svg")
    if not os.path.exists(path):
        pl._download(LOGO_URL, path)
    with open(path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    if digest != LOGO_SHA256:
        raise RuntimeError(f"Georgia Tech logo changed upstream: sha256 {digest}")
    return path


def draw_art():
    out_dir = os.path.join(pl.CACHE_DIR, "art")
    subprocess.run(["node", os.path.join(HERE, "props_art.mjs"), "pennant", logo_svg(), out_dir], check=True)
    img = bpy.data.images.load(os.path.join(out_dir, "pennant_gatech.png"))
    img.name = "pennant_gatech_art"
    return img


def felt_material(name, colour, art=None):
    """Wool felt: matt, a soft sheen, fine fuzz; on the front the art, its letters standing a hair proud."""
    mat, k = pl.new_material(name)
    bsdf = k.node("ShaderNodeBsdfPrincipled")
    out = k.node("ShaderNodeOutputMaterial")
    obj = k.coords("Object")
    fuzz = k.noise(obj, 2600.0, detail=6.0, roughness=0.7)
    mottle = k.map_range(k.noise(obj, 40.0, detail=3.0), 0.3, 0.7, 0.93, 1.05)
    if art is not None:
        uv = k.node("ShaderNodeUVMap", uv_map="art")
        tex = k.node("ShaderNodeTexImage", image=art, interpolation="Linear", extension="EXTEND")
        k.set(tex, "Vector", uv.outputs["UV"])
        base = tex.outputs["Color"]
        lum = k.node("ShaderNodeRGBToBW", inputs={"Color": base}).outputs[0]
        height = k.math("ADD", k.math("MULTIPLY", fuzz, 0.5), k.map_range(lum, 0.12, 0.3, 0.0, 0.6))
        scale = k.map_range(lum, LUM_NAVY, LUM_GOLD, FELT_SCALE_NAVY, FELT_SCALE_GOLD, smooth=False)
    else:
        base = colour + (1.0,)
        height = fuzz
        scale = FELT_SCALE_NAVY
    hsv = k.node("ShaderNodeHueSaturation", inputs={"Color": base, "Value": k.math("MULTIPLY", mottle, scale)})
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.22, "Distance": 0.0005, "Height": height})
    for key, value in (("Base Color", hsv.outputs["Color"]), ("Roughness", 0.92), ("Sheen Weight", 0.32),
                       ("Sheen Roughness", 0.45), ("Specular IOR Level", 0.3), ("Normal", bump.outputs["Normal"])):
        k.set(bsdf, key, value)
    k.set(out, "Surface", bsdf.outputs["BSDF"])
    return mat


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    art = draw_art()
    front_mat = felt_material("pennant_felt_front", srgb("#003057"), art)
    back_mat = felt_material("pennant_felt_back", srgb("#0B2D4F"))
    brass = pl.surface("pennant_tack_brass", (0.62, 0.45, 0.22), 0.25, metallic=1.0, edge_wear=0.3,
                       grime=0.5, color_var=0.05)

    b = pl.Builder(NAME)
    bm = b.bm
    uv_main = bm.loops.layers.uv.new("UVMap")
    uv_art = bm.loops.layers.uv.new("art")
    fi, bi = b.slot(front_mat), b.slot(back_mat)
    grid = []
    for i in range(NX + 1):
        x = L * (i / NX) ** 1.08
        col_pts = []
        for j in range(NZ + 1):
            z = (2 * j / NZ - 1) * half(x)
            p = draped(x, z)
            col_pts.append((bm.verts.new(p), bm.verts.new(p + Vector((0, FELT_T, 0))), x, z))
        grid.append(col_pts)

    def face(vs, mat, art_xz=None):
        f = bm.faces.new(vs)
        f.material_index = mat
        if art_xz:
            for loop, (x, z) in zip(f.loops, art_xz):
                loop[uv_art].uv = (x / L, 0.5 + z / H)
        else:
            for loop in f.loops:
                loop[uv_art].uv = (0.5, 0.5)
        return f

    for i in range(NX):
        for j in range(NZ):
            a, b_, c, d = grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]
            face([a[0], d[0], c[0], b_[0]], fi, [(a[2], a[3]), (d[2], d[3]), (c[2], c[3]), (b_[2], b_[3])])
            face([a[1], b_[1], c[1], d[1]], bi)
    edge_ring = [grid[i][0] for i in range(NX + 1)] + [grid[NX][j] for j in range(1, NZ + 1)] + \
        [grid[i][NZ] for i in range(NX - 1, -1, -1)] + [grid[0][j] for j in range(NZ - 1, 0, -1)]
    rim_edges = []
    for k in range(len(edge_ring)):
        p, q = edge_ring[k], edge_ring[(k + 1) % len(edge_ring)]
        face([p[0], q[0], q[1], p[1]], bi)
        rim_edges.append((p[1], q[1]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # Seams on the hidden side: where the cut edge meets the back.
    for a, c in rim_edges:
        e = bm.edges.get((a, c))
        if e:
            e.seam = True
    # Brass tacks through the header, top and bottom.
    for z in (H / 2 - 0.020, -(H / 2 - 0.020)):
        b.lathe([(0.0, 0.0), (0.0048, 0.0), (0.0050, 0.0012), (0.0042, 0.0026), (0.0022, 0.0034), (0.0, 0.0036)],
                segments=20, loc=(HEADER * 0.45, 0.0, z), rot=(90, 0, 0), mat=brass)
    for f in bm.faces:
        for loop in f.loops:
            if loop[uv_art].uv.length == 0:
                loop[uv_art].uv = (0.5, 0.5)
    ob = b.finish(col, smooth_angle=40, unwrap=False)
    pl.unwrap_object(ob, seam_angle=60)
    me = ob.data
    xs = [v.co.x for v in me.vertices]
    offset = Vector(((min(xs) + max(xs)) / 2, max(v.co.y for v in me.vertices), min(v.co.z for v in me.vertices)))
    me.transform(Matrix.Translation(-offset))
    ob["source"] = "made for this site; the interlocking GT from Wikimedia Commons (public domain, trademarked)"
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
