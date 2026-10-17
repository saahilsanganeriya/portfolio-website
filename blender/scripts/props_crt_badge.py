"""crt_badge: the CRT's bezel nameplate, 72 x 11.25 mm, a satin aluminium plate 0.8 mm thick with bevelled edges.

It carries a thread-spool mark (the family's spinning mill) and the SANGANERIYA wordmark, printed in ink with the
spool's thread in the site's thread red. The artwork is drawn by props_art.mjs into blender/props/art/
(crt_badge.svg, the source, and crt_badge.png, 2048 px wide, transparent around the ink) and read through the UV map
`art` on the plate's face. Objects: crt_badge. Origin: bottom centre of the back face (it sits on the bezel); faces -Y.
"""
import os
import subprocess
import sys

import bmesh
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "crt_badge"
HERE = os.path.dirname(os.path.abspath(__file__))
ART_DIR = os.path.join(pl.PROPS_DIR, "art")
W, H, T = 0.072, 0.01125, 0.0008


def plate_material(art):
    """Satin aluminium, brushed along its length, with the artwork laid over by its alpha."""
    mat, k = pl.new_material("crt_badge_plate")
    bsdf = k.node("ShaderNodeBsdfPrincipled")
    out = k.node("ShaderNodeOutputMaterial")
    obj = k.coords("Object")
    brushed = k.node("ShaderNodeMapping", inputs={"Scale": (40.0, 2400.0, 2400.0)})
    k.set(brushed, "Vector", obj)
    streak = k.noise(brushed.outputs[0], 1.0, detail=4.0)
    uv = k.node("ShaderNodeUVMap", uv_map="art")
    tex = k.node("ShaderNodeTexImage", image=art, interpolation="Linear", extension="CLIP")
    k.set(tex, "Vector", uv.outputs["UV"])
    ink = k.math("MULTIPLY", tex.outputs["Alpha"], 1.0)
    metal = (0.78, 0.77, 0.74, 1.0)
    color = k.mix_color(ink, metal, tex.outputs["Color"])
    for key, value in (("Base Color", color), ("Metallic", k.math("SUBTRACT", 1.0, ink)),
                       ("Roughness", k.mix_float(ink, k.map_range(streak, 0.3, 0.7, 0.26, 0.38), 0.45)),
                       ("Coat Weight", k.math("MULTIPLY", ink, 0.3)), ("Coat Roughness", 0.2)):
        k.set(bsdf, key, value)
    k.set(out, "Surface", bsdf.outputs["BSDF"])
    return mat


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    os.makedirs(ART_DIR, exist_ok=True)
    subprocess.run(["node", os.path.join(HERE, "props_art.mjs"), "badge", ART_DIR], check=True)
    art = bpy.data.images.load(os.path.join(ART_DIR, "crt_badge.png"))
    art.name = "crt_badge_art"
    art.alpha_mode = "STRAIGHT"

    b = pl.Builder(NAME)
    bm = b.bm
    bm.loops.layers.uv.new("UVMap")
    uv_art = bm.loops.layers.uv.new("art")
    outline = pl.round_polygon([(-W / 2, 0.0), (W / 2, 0.0), (W / 2, H), (-W / 2, H)], 0.0012, 4)
    b.extrude(outline, T, loc=(0, -T / 2, 0), mat=plate_material(art), bevel=0.00022, bevel_seg=2)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method="BEAUTY",
                          ngon_method="BEAUTY")
    bm.normal_update()
    for f in bm.faces:
        front = f.normal.y < -0.9
        for loop in f.loops:
            co = loop.vert.co
            loop[uv_art].uv = ((co.x + W / 2) / W, co.z / H) if front else (0.001, 0.001)
    # The bevels split every edge into steps under the seam angle, so cut the plate open along its hidden back face.
    for e in bm.edges:
        backs = [f.normal.y > 0.9 for f in e.link_faces]
        if len(backs) == 2 and backs[0] != backs[1]:
            e.seam = True
    ob = b.finish(col, smooth_angle=35, unwrap=True)
    ob["source"] = "made for this site (artwork: blender/props/art/crt_badge.svg)"
    ob["width_m"], ob["height_m"] = W, H
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
