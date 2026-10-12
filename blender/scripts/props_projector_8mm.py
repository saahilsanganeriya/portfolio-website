"""projector_8mm: Poly Haven "Filmstrip Projector 8mm" (CC0, PeterM), a Super 8 projector with two reels.

The mains cable and plug are removed and each part is decimated so the prop fits 15k triangles. Objects:
projector_8mm (body, rollers, film path), projector_8mm_reel_front / _reel_rear (separate so they can spin),
and the empty projector_lens at the lens front (beam along local -Z). Faces -Y (the lens), origin at the base.
"""
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "projector_8mm"
PREFIX = "filmstrip_projector_8mm"
DROP = {"cable", "cable_curve", "connector", "schuko"}
# Triangle target per imported part (the body is a dense scan; flat reels decimate well).
TARGETS = {"": 6800, "spool_feed": 1900, "spool_takeup": 1900, "film_side": 260, "feed_holder": 380,
           "feed_roller": 520, "takeup_holder": 460, "spool_arm": 620, "dial_mode": 240, "dial_speed": 240,
           "focus": 160, "switch": 166, "film": 284}
RED_REEL_HSV = (0.505, 0.9, 0.5)


def part_key(ob):
    key = ob.name[len(PREFIX):].lstrip("_")
    head, _, rest = key.partition("_")
    return rest if head.isdigit() else key


def decimate(ob, target):
    tris = pl.triangle_count([ob])
    if tris <= target:
        return
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = target / tris
    mod.use_collapse_triangulate = True
    pl.apply_modifier(ob, mod)


def muted_reel_material(src):
    """Copy of the projector material that pulls the red reel toward the room's oxide red."""
    mat = src.copy()
    mat.name = f"{NAME}_reel_red"
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    link = bsdf.inputs["Base Color"].links[0]
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Hue"].default_value, hsv.inputs["Saturation"].default_value, hsv.inputs["Value"].default_value = \
        RED_REEL_HSV
    nt.links.new(link.from_socket, hsv.inputs["Color"])
    nt.links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    objs = pl.import_gltf(pl.polyhaven_gltf(PREFIX, "2k"), col)
    keep = []
    for ob in objs:
        if part_key(ob) in DROP:
            bpy.data.objects.remove(ob)
            continue
        keep.append(ob)
    for ob in keep:
        pl.apply_transforms(ob)
        decimate(ob, TARGETS.get(part_key(ob), 400))

    by_key = {part_key(o): o for o in keep}
    shell = by_key[""].data.vertices
    front = min(v.co.y for v in shell)
    lens_verts = [v.co for v in shell if v.co.y < front + 0.004]
    lens = sum(lens_verts, Vector()) / len(lens_verts)
    body_parts = [o for k, o in by_key.items() if k not in ("", "spool_feed", "film_side", "spool_takeup")]
    reel_front = pl.join([by_key["spool_feed"], by_key["film_side"]], f"{NAME}_reel_front")
    reel_rear = pl.join([by_key["spool_takeup"]], f"{NAME}_reel_rear")
    body = pl.join([by_key[""]] + body_parts, NAME)

    everything = [body, reel_front, reel_rear]
    lo = Vector([min(min((o.matrix_world @ v.co)[i] for v in o.data.vertices) for o in everything) for i in range(3)])
    hi = Vector([max(max((o.matrix_world @ v.co)[i] for v in o.data.vertices) for o in everything) for i in range(3)])
    shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for ob in everything:
        ob.data.transform(pl.xform(loc=-shift))
    for reel in (reel_front, reel_rear):
        pl.set_origin_base(reel)
        pl.parent_keep_transform(reel, body)

    # The feed reel is the red one; its own material copy mutes it toward the room's oxide red.
    src = body.data.materials[0]
    red = muted_reel_material(src)
    reel_front.data.materials.clear()
    reel_front.data.materials.append(red)

    lens -= shift
    pl.empty("projector_lens", col, (lens.x, front - shift.y - 0.001, lens.z), rotation_deg=(-90, 0, 0), size=0.04,
             parent=body)

    for o in everything:
        o["source"] = "Poly Haven filmstrip_projector_8mm (CC0), cable removed, decimated"
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
