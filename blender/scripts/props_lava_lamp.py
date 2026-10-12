"""lava_lamp: a 1960s rocket-shaped lava lamp, 40.5 cm tall, unbranded.

A worn copper cone base, a tapered glass bottle of amber liquid with red wax, and a copper cap. Objects:
lava_lamp (base, cap, cord), its child lava_lamp_glass (the bottle, own material, cylindrical UV: u around,
v up, for the site's wax shader) and the empty lava_lamp_light at the centre of the liquid. Faces -Y, origin at
the base.
"""
import math
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "lava_lamp"
BASE = [(0.0, 0.0), (0.0705, 0.0), (0.0735, 0.0025), (0.0735, 0.0065), (0.0705, 0.0095), (0.0660, 0.026),
        (0.0560, 0.068), (0.0470, 0.112), (0.0415, 0.140), (0.0440, 0.1425), (0.0440, 0.1475), (0.0405, 0.150)]
GLASS = [(0.0395, 0.149), (0.0455, 0.166), (0.0515, 0.196), (0.0535, 0.226), (0.0515, 0.262), (0.0455, 0.300),
         (0.0380, 0.336), (0.0320, 0.357)]
CAP = [(0.0300, 0.3555), (0.0335, 0.3575), (0.0335, 0.3625), (0.0280, 0.3735), (0.0190, 0.3880), (0.0105, 0.3985),
       (0.0050, 0.4040), (0.0, 0.4050)]
LIGHT_Z = 0.23


def glass_material():
    """Amber liquid glowing from the bulb in the base, red wax gathered low and high with one rising blob."""
    mat, k = pl.new_material("lava_lamp_glass")
    obj = k.coords("Object")
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    z = sep.outputs["Z"]
    stretch = k.node("ShaderNodeMapping", inputs={"Vector": obj, "Scale": (22.0, 22.0, 8.5),
                                                  "Location": (0.0, 0.0, -1.3)})
    blobs = k.noise(stretch.outputs[0], 1.0, detail=1.2, roughness=0.35)
    pool = k.map_range(z, 0.200, 0.172)
    crown = k.map_range(z, 0.305, 0.335)
    wax = k.math("MAXIMUM", k.math("MAXIMUM", pool, crown), k.map_range(blobs, 0.53, 0.57))
    heat = k.map_range(z, 0.15, 0.36, 1.0, 0.45, smooth=False)
    liquid = k.mix_color(k.map_range(z, 0.15, 0.36), (1.0, 0.36, 0.07, 1.0), (0.80, 0.25, 0.05, 1.0))
    color = k.mix_color(wax, liquid, (0.62, 0.035, 0.018, 1.0))
    # Wax is denser than the liquid: it glows less, so the blobs read as dark red shapes in the amber.
    strength = k.math("MULTIPLY", heat, k.mix_float(wax, 1.5, 1.1))
    emit = k.node("ShaderNodeEmission", inputs={"Color": color, "Strength": strength})
    gloss = k.node("ShaderNodeBsdfGlossy", inputs={"Color": (1.0, 0.95, 0.9, 1.0), "Roughness": 0.06})
    fresnel = k.node("ShaderNodeLayerWeight", inputs={"Blend": 0.25})
    mix = k.node("ShaderNodeMixShader", inputs={"Fac": k.math("MULTIPLY", fresnel.outputs["Fresnel"], 0.6),
                                                "Shader": emit.outputs[0], "Shader_001": gloss.outputs[0]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", mix.outputs[0])
    return mat


def cylindrical_uv(ob, z0, z1):
    me = ob.data
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        cos = [me.vertices[me.loops[i].vertex_index].co for i in poly.loop_indices]
        us = [(math.atan2(co.y, co.x) / math.tau) % 1.0 for co in cos]
        if max(us) - min(us) > 0.5:  # the face across the seam continues past u = 1
            us = [u + 1.0 if u < 0.5 else u for u in us]
        for i, u, co in zip(poly.loop_indices, us, cos):
            uv.data[i].uv = (u, (co.z - z0) / (z1 - z0))


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    copper = pl.surface("lamp_copper", (0.50, 0.27, 0.15), 0.28, metallic=1.0, micro_bump=(900, 0.05),
                        edge_wear=0.5, edge_color=(0.80, 0.52, 0.34), edge_roughness=0.18, dust=0.5, grime=0.6,
                        smudges=0.3, scratches=0.15, color_var=0.08)
    dark = pl.surface("lamp_band", (0.08, 0.05, 0.035), 0.45, metallic=1.0, dust=0.4, color_var=0.05)
    cord = pl.surface("lamp_cord", (0.03, 0.025, 0.02), 0.6, micro_bump=(2000, 0.1), color_var=0.05)
    rubber = pl.surface("lamp_foot", (0.02, 0.018, 0.016), 0.85, color_var=0.0)

    b = pl.Builder(NAME)
    b.lathe(BASE, segments=48, mat=copper)
    b.lathe([(0.0655, 0.0300), (0.0672, 0.0318), (0.0672, 0.0372), (0.0650, 0.0390)], segments=48, mat=dark,
            cap_start=False, cap_end=False)
    b.lathe(CAP, segments=48, mat=copper, cap_start=False)
    b.cylinder(0.072, 0.0012, segments=48, loc=(0, 0, -0.0004), mat=rubber)
    cord_pts = [Vector((0.0, 0.050, 0.010))]
    for i in range(1, 9):
        t = i / 8
        cord_pts.append(Vector((0.03 * math.sin(t * 2.4), 0.050 + 0.17 * t, 0.010 - 0.0065 * min(t * 4, 1))))
    b.tube(cord_pts, 0.0024, sides=6, mat=cord)
    lamp = b.finish(col, smooth_angle=40)
    lamp["source"] = "made for this site"

    g = pl.Builder(f"{NAME}_glass")
    g.lathe(GLASS, segments=40, mat=glass_material(), cap_start=False, cap_end=False)
    glass = g.finish(col, smooth_angle=80, unwrap=False)
    cylindrical_uv(glass, GLASS[0][1], GLASS[-1][1])
    glass["source"] = "made for this site"
    pl.parent_keep_transform(glass, lamp)

    pl.empty("lava_lamp_light", col, (0.0, 0.0, LIGHT_Z), size=0.03, parent=lamp, display="SPHERE")
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
