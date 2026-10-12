"""projector_screen: Poly Haven "Projector Screen" (CC0, PeterM), a tripod screen at its real size.

Objects: projector_screen (case, bars, tripod), projector_screen_surface (the fabric, own material) and the
empty projector_screen_center (centre of the fabric, local +Z out of the screen). Faces -Y, origin at the base.
"""
import os
import sys

import bmesh
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "projector_screen"


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    objs = [o for o in pl.import_gltf(pl.polyhaven_gltf("projector_screen", "2k"), col) if o.type == "MESH"]
    for o in objs:
        pl.apply_transforms(o)
    body = pl.join(objs, NAME)

    me = body.data
    fabric_idx = [i for i, m in enumerate(me.materials) if m.name == "projector_screen"][0]
    normal_sum = Vector()
    for p in me.polygons:
        if p.material_index == fabric_idx:
            normal_sum += p.normal * p.area
    if normal_sum.y > 0:
        me.transform(pl.xform(rot=(0, 0, 180)))
    pl.set_origin_base(body)
    body.location = (0, 0, 0)

    bm = bmesh.new()
    bm.from_mesh(me)
    fabric_faces = [f for f in bm.faces if f.material_index == fabric_idx]
    surface_me = bpy.data.meshes.new(f"{NAME}_surface")
    sbm = bmesh.new()
    sbm.from_mesh(me)
    bmesh.ops.delete(sbm, geom=[f for f in sbm.faces if f.material_index != fabric_idx], context="FACES")
    sbm.to_mesh(surface_me)
    sbm.free()
    bmesh.ops.delete(bm, geom=fabric_faces, context="FACES")
    bm.to_mesh(me)
    bm.free()
    surface = bpy.data.objects.new(f"{NAME}_surface", surface_me)
    col.objects.link(surface)
    surface_me.materials.clear()
    surface_me.materials.append(bpy.data.materials["projector_screen"])
    for p in surface_me.polygons:
        p.material_index = 0
    pl.parent_keep_transform(surface, body)

    lo = Vector([min(v.co[i] for v in surface_me.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in surface_me.vertices) for i in range(3)])
    centre = (lo + hi) / 2
    flat = [v.co.y for v in surface_me.vertices
            if abs(v.co.x - centre.x) < 0.15 and abs(v.co.z - centre.z) < 0.15]
    centre.y = min(flat) - 0.001
    pl.empty(f"{NAME}_center", col, centre, rotation_deg=(90, 0, 0), size=0.1, parent=body)

    for o in (body, surface):
        o["source"] = "Poly Haven projector_screen (CC0)"
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
