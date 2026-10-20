"""lounge_chair: the reading chair by the record player (Poly Haven's Mid Century Lounge Chair, CC0), prepared so its
close-up reads as leather and walnut: the full 6,148-triangle mesh (the room kept 2,423 after a collapse), the 2K
textures (it had 1K), one texel density over the whole chair for the bake, and the leather darkened for the bake.

Why the leather bakes darker than the model's texture: the bake keeps the view-independent light only. Live, this dark,
fairly glossy leather is mostly reflection at the angles the room sees it from; baked head-on, its diffuse alone under
the floor lamp comes out pale and mauve at the room's exposure (+2.8 stops, AgX), like suede. The leather's base colour
is scaled toward the brown the eye reads on the real chair; the walnut and the aluminium keep theirs.

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
# The leather is the colour map's dark browns (linear value 0.04-0.12, saturation 0.62-0.73 in the 2K map); the walnut
# is lighter and more saturated (0.18-0.30, 0.83-0.91), the aluminium grey.
LEATHER_VALUE, LEATHER_SATURATION = (0.13, 0.16), (0.40, 0.77)
LEATHER_BAKE_TINT = (0.56, 0.38, 0.25)


def leather_bake_tint(mat):
    """Base colour = the colour map, scaled toward a deep cognac where the map shows leather."""
    nt = mat.node_tree
    k = pl.NodeKit(nt)
    bsdf = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    colour = bsdf.inputs["Base Color"].links[0].from_socket
    hsv = k.node("ShaderNodeSeparateColor", mode="HSV")
    k.set(hsv, "Color", colour)
    dark = k.map_range(hsv.outputs["Blue"], LEATHER_VALUE[1], LEATHER_VALUE[0])
    muted = k.math("MULTIPLY", k.map_range(hsv.outputs["Green"], LEATHER_SATURATION[0] - 0.06, LEATHER_SATURATION[0]),
                   k.map_range(hsv.outputs["Green"], LEATHER_SATURATION[1] + 0.06, LEATHER_SATURATION[1]), clamp=True)
    leather = k.math("MULTIPLY", dark, muted, clamp=True)
    tinted = k.mix_color(1.0, colour, LEATHER_BAKE_TINT + (1.0,), blend="MULTIPLY")
    k.set(bsdf, "Base Color", k.mix_color(leather, colour, tinted))


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
        leather_bake_tint(slot.material)
    chair.data.shade_smooth()
    chair.data.set_sharp_from_angle(angle=math.radians(50))
    chair["source"] = "Poly Haven mid_century_lounge_chair (CC0), Kuutti Siitonen"
    chair["gloss"] = 0.45  # leather and lacquered walnut
    pl.report(NAME, col, 8000)
    pl.save_prop(NAME)


main()
