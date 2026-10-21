"""lounge_chair: the reading chair by the record player (Poly Haven's Mid Century Lounge Chair, CC0), prepared so its
close-up reads as leather and walnut: the full 6,148-triangle mesh (the room kept 2,423 after a collapse), the 2K
textures (it had 1K), one texel density over the whole chair for the bake, and its colours set for the bake.

Why the colours change for the bake: the bake keeps the view-independent light only. Live, this dark, fairly glossy
leather is mostly reflection at the angles the room sees it from; baked head-on, its diffuse alone under the floor lamp
comes out pale and mauve at the room's exposure (+2.8 stops, AgX), like suede. So the leather is scaled toward the brown
the eye reads on the real chair, its brightest pores are held to the leather's own range and its normal map is halved
(both read as white flecks once the bake has the texels to show them), and the aluminium base is a satin grey (metal
bakes as diffuse in its own colour: bright aluminium comes out as white plastic). The walnut keeps its colour.

Real proportions: 0.92 m tall (as the room had it), 0.98 x 0.94 m. Objects: lounge_chair. Origin: the base's centre on
the floor; faces -Y as the scan does (the room turns it).
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_lib as pl  # noqa: E402

NAME = "lounge_chair"
ASSET = "mid_century_lounge_chair"
HEIGHT = 0.92
# In the 2K colour map (linear) the leather is saturation 0.61-0.73 at every value, its pores included (1.6 % of its
# pixels are brighter than 0.13); the walnut is 0.83-0.91 and the aluminium near 0. So saturation alone picks the leather.
LEATHER_SATURATION = (0.40, 0.79)
LEATHER_BAKE_TINT = (0.56, 0.38, 0.25)
LEATHER_VALUE_CAP = 0.11  # the leather's 90th percentile: brighter pores are scaled down to it
LEATHER_NORMAL = 0.5  # the share of the normal map's bumps kept on the leather
METAL_BAKE_SCALE = 0.15  # aluminium (linear ~0.46 in the map) -> ~0.07: dark satin metal, not white


def bake_colours(mat):
    """Leather toward a deep cognac with its pores held in range and its bumps halved; metal toward satin grey."""
    nt = mat.node_tree
    k = pl.NodeKit(nt)
    bsdf = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    colour = bsdf.inputs["Base Color"].links[0].from_socket
    metal = bsdf.inputs["Metallic"].links[0].from_socket
    normal = bsdf.inputs["Normal"].links[0].from_socket
    hsv = k.node("ShaderNodeSeparateColor", mode="HSV")
    k.set(hsv, "Color", colour)
    sat = hsv.outputs["Green"]
    leather = k.math("MULTIPLY", k.map_range(sat, LEATHER_SATURATION[0] - 0.06, LEATHER_SATURATION[0]),
                     k.map_range(sat, LEATHER_SATURATION[1] + 0.04, LEATHER_SATURATION[1]), clamp=True)
    held = k.math("MINIMUM", 1.0, k.math("DIVIDE", LEATHER_VALUE_CAP, k.math("MAXIMUM", hsv.outputs["Blue"], 1e-4)))
    scaled = k.node("ShaderNodeVectorMath", operation="SCALE")
    k.set(scaled, "Vector", colour)
    k.set(scaled, "Scale", held)
    tinted = k.mix_color(1.0, scaled.outputs["Vector"], LEATHER_BAKE_TINT + (1.0,), blend="MULTIPLY")
    out = k.mix_color(leather, colour, tinted)
    grey = k.mix_color(1.0, out, (METAL_BAKE_SCALE,) * 3 + (1.0,), blend="MULTIPLY")
    k.set(bsdf, "Base Color", k.mix_color(metal, out, grey))
    flat = k.node("ShaderNodeMix", data_type="VECTOR")
    k.set(flat, "Factor_Float", k.math("MULTIPLY", leather, 1.0 - LEATHER_NORMAL))
    k.set(flat, "A_Vector", normal)
    k.set(flat, "B_Vector", k.node("ShaderNodeNewGeometry").outputs["Normal"])
    k.set(bsdf, "Normal", pl._sock(flat.outputs, "Result_Vector"))


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    new = pl.import_gltf(pl.polyhaven_gltf(ASSET, "2k"), col)
    bpy.context.view_layer.update()
    meshes = [o for o in new if o.type == "MESH"]
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.data = obj.data.copy()
        obj.data.transform(world)
        obj.matrix_world = Matrix.Identity(4)
    for obj in new:
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    chair = pl.join(meshes, NAME) if len(meshes) > 1 else meshes[0]
    chair.name = chair.data.name = NAME
    pl.set_origin_base(chair)
    zs = [v.co.z for v in chair.data.vertices]
    s = HEIGHT / (max(zs) - min(zs))
    chair.data.transform(Matrix.Diagonal((s, s, s, 1.0)))
    chair.location = (0.0, 0.0, 0.0)
    chair.data.uv_layers[0].name = "UVMap"
    # The scan's islands carry 2.8x different densities (its 10th and 90th percentile); the bake gets one density
    # from the same islands: seams from the islands, then bake.py's "unwrap" (angle-based, islands scaled even).
    pl._activate(chair)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.seams_from_islands(mark_seams=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    chair["bake_uv"] = "unwrap"
    for slot in chair.material_slots:
        bake_colours(slot.material)
    chair.data.shade_smooth()
    chair.data.set_sharp_from_angle(angle=math.radians(50))
    chair["source"] = "Poly Haven mid_century_lounge_chair (CC0), Kuutti Siitonen"
    chair["gloss"] = 0.45  # leather and lacquered walnut
    pl.report(NAME, col, 8000)
    pl.save_prop(NAME)


main()
