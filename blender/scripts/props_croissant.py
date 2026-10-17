"""croissant: one butter croissant, 140 mm tip to tip, from Poly Haven's CC0 photogrammetry scan (`croissant`,
scanned by Dario Barresi, processed by Greg Zaal).

The scan (1,990 polygons, 200 mm long) is scaled to a bakery-sized 140 mm so it fits the countertop oven's rack
(a 236 x 200 mm cavity) and the kitchen board. Its own UVs are kept as `UVMap`: one atlas of non-overlapping islands
with an even texel density, as photogrammetry unwraps are; its 2k colour, roughness and normal maps drive one
Principled material, packed in the file. Objects: croissant. Faces -Y (the curve's open side toward the viewer),
origin at the base.
"""
import math
import os
import sys

from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "croissant"
LENGTH = 0.140


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    new = pl.import_gltf(pl.polyhaven_gltf("croissant", "2k"), col)
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    ob = meshes[0] if len(meshes) == 1 else pl.join(meshes, NAME)
    ob.name = ob.data.name = NAME
    ob.parent = None
    pl.apply_transforms(ob)
    me = ob.data
    if me.uv_layers:
        me.uv_layers[0].name = "UVMap"
    # Lay it down with its length along X, the open side of the curve toward -Y, then scale to LENGTH.
    co = [v.co.copy() for v in me.vertices]
    size = Vector([max(c[i] for c in co) - min(c[i] for c in co) for i in range(3)])
    longest = max(range(3), key=lambda i: size[i])
    if longest != 0:
        me.transform(Matrix.Rotation(math.radians(90), 4, "Z" if longest == 1 else "Y"))
    co = [v.co for v in me.vertices]
    centre = Vector([(max(c[i] for c in co) + min(c[i] for c in co)) / 2 for i in range(3)])
    tips_y = sum(c.y for c in co if abs(c.x - centre.x) > 0.4 * size[longest] / 1) / max(1, sum(
        1 for c in co if abs(c.x - centre.x) > 0.4 * size[longest]))
    if tips_y > centre.y:
        me.transform(Matrix.Rotation(math.radians(180), 4, "Z"))
    span = max(v.co.x for v in me.vertices) - min(v.co.x for v in me.vertices)
    me.transform(Matrix.Scale(LENGTH / span, 4))
    pl.set_origin_base(ob)
    ob.location = (0, 0, 0)
    for m in me.materials:
        m.name = "croissant_scan"
    ob["source"] = "Poly Haven croissant (CC0), scanned by Dario Barresi, processed by Greg Zaal; scaled to 140 mm"
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
