"""poster_frame: a 40 x 60 cm (2:3) print in a mitred walnut moulding behind glass.

Objects: poster_frame (moulding + backing board), poster_frame_glass, poster_frame_art. The art plane uses
material `poster_art`, whose image node `poster_image` holds a placeholder; the room swaps in each poster PNG
(one material copy per frame). Origin: bottom centre of the back face; the frame faces -Y.
"""
import os
import sys

import bmesh
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "poster_frame"
ART_W, ART_H = 0.40, 0.60
LIP = 0.005           # how far the sight edge overlaps the print
FACE_W = 0.024        # moulding face width
DEPTH = 0.030         # moulding depth, back to front
GRAIN_TILE = 0.26     # metres of wood per texture repeat
JOINT_GAP = 0.00012   # hairline gap at each mitre

# Moulding cross-section (u: inward from the outer edge, v: forward from the back), walked with the
# material on the left so faces point outwards.
PROFILE = [
    (0.0, 0.0), (0.0, DEPTH - 0.0045), (0.0006, DEPTH - 0.0016), (0.0022, DEPTH - 0.0003), (0.0045, DEPTH),
    (FACE_W - 0.0075, DEPTH - 0.0018), (FACE_W - 0.0032, DEPTH - 0.0036), (FACE_W - 0.0008, DEPTH - 0.0056),
    (FACE_W, DEPTH - 0.0072), (FACE_W, DEPTH - 0.0110), (FACE_W - LIP, DEPTH - 0.0110), (FACE_W - LIP, 0.0),
]


def moulding(builder, mat, grain):
    sight_w, sight_h = ART_W - 2 * LIP, ART_H - 2 * LIP
    outer_w, outer_h = sight_w + 2 * FACE_W, sight_h + 2 * FACE_W
    bm = builder.bm
    uv_grain = bm.loops.layers.uv["grain"]
    uv_main = bm.loops.layers.uv["UVMap"]
    # side: (axis along the piece, inward direction, outer-edge midpoint, outer length, grain offset)
    sides = [
        (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 0, 0)), outer_w, 0.00),
        (Vector((0, 0, 1)), Vector((-1, 0, 0)), Vector((outer_w / 2, 0, outer_h / 2)), outer_h, 0.31),
        (Vector((-1, 0, 0)), Vector((0, 0, -1)), Vector((0, 0, outer_h)), outer_w, 0.57),
        (Vector((0, 0, -1)), Vector((1, 0, 0)), Vector((-outer_w / 2, 0, outer_h / 2)), outer_h, 0.83),
    ]
    perim = [0.0]
    for a, b in zip(PROFILE, PROFILE[1:] + PROFILE[:1]):
        perim.append(perim[-1] + (Vector(b) - Vector(a)).length)
    before = set(bm.faces)
    for axis, inward, mid, length, offset in sides:
        starts, ends = [], []
        for (u, v) in PROFILE:
            half = length / 2 - u - JOINT_GAP
            base = mid + inward * u + Vector((0, -v, 0))
            starts.append(bm.verts.new(base - axis * half))
            ends.append(bm.verts.new(base + axis * half))
        n = len(PROFILE)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((starts[i], starts[j], ends[j], ends[i]))
            for loop in f.loops:
                idx = starts.index(loop.vert) if loop.vert in starts else ends.index(loop.vert)
                pv = perim[n] if (i == n - 1 and idx == 0) else perim[idx]
                s = (loop.vert.co - mid).dot(axis)
                loop[uv_grain].uv = (s / GRAIN_TILE + offset * 3.0, pv / GRAIN_TILE * 6.0 + offset)
                loop[uv_main].uv = (s, pv)
    faces = [f for f in bm.faces if f not in before]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    mi = builder.slot(mat)
    for f in faces:
        f.material_index = mi


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    wood = pl.ambientcg("Wood051")
    walnut = pl.surface(
        "walnut_satin", (0.23, 0.15, 0.10), 0.36, color_tex=wood["Color"], tint=(1.0, 0.80, 0.62),
        rough_tex=wood["Roughness"], rough_amount=0.22, height_tex=wood["Displacement"], height_strength=0.08,
        tile=GRAIN_TILE, uv_map="grain", coat=0.35, coat_roughness=0.18, edge_wear=0.55,
        edge_color=(0.30, 0.20, 0.13), edge_roughness=0.5, edge_width=0.0012, dust=0.65, grime=0.4,
        color_var=0.05)
    backing_mat = pl.surface("hardboard", (0.20, 0.13, 0.08), 0.8, micro_bump=(900, 0.15), color_var=0.08)

    frame = pl.Builder(NAME)
    frame.bm.loops.layers.uv.new("UVMap")
    frame.bm.loops.layers.uv.new("grain")
    moulding(frame, walnut, "grain")
    rebate_back = DEPTH - 0.0110
    art_v = rebate_back - 0.0022
    backing = frame.box((ART_W - 0.0006, 0.003, ART_H - 0.0006), loc=(0, -(art_v - 0.0018), (ART_H + 2 * (FACE_W - LIP)) / 2),
                        mat=backing_mat, bevel=0.0004, bevel_seg=1)
    for f in backing:
        f.normal_update()
    pl.planar_uv(backing, frame.bm.loops.layers.uv["UVMap"])
    ob = frame.finish(col, smooth_angle=34, keep_uv=True)
    pl.pack_uv(ob)

    outer_h = ART_H - 2 * LIP + 2 * FACE_W
    centre_z = outer_h / 2
    glass_mat = pl.surface("poster_glass", (0.92, 0.94, 0.93), 0.015, transmission=1.0, ior=1.52, smudges=0.12,
                           dust=0.5, color_var=0.0, edge_width=0.0005)
    glass = pl.Builder("poster_frame_glass")
    glass.box((ART_W - 0.0004, 0.002, ART_H - 0.0004), loc=(0, -(rebate_back - 0.001), centre_z), mat=glass_mat)
    glass_ob = glass.finish(col, weighted=False)

    art_mat, k = pl.new_material("poster_art")
    placeholder = bpy.data.images.new("poster_placeholder", 400, 600)
    placeholder.generated_color = (0.86, 0.82, 0.74, 1.0)
    placeholder.pack()
    img = k.node("ShaderNodeTexImage", image=placeholder, name="poster_image", label="poster_image")
    k.set(img, "Vector", k.node("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"])
    paper = pl.ambientcg("Paper001")
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.06, "Distance": 0.0005,
                                           "Height": k.image(paper["Displacement"], k.coords("Object", 1 / 0.3),
                                                             non_color=True).outputs["Color"]})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": img.outputs["Color"], "Roughness": 0.62,
                                                      "Normal": bump.outputs["Normal"]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs["BSDF"])

    art = pl.Builder("poster_frame_art")
    art_bm = art.bm
    uv = art_bm.loops.layers.uv.new("UVMap")
    y = -art_v
    z0 = centre_z - ART_H / 2
    corners = [(-ART_W / 2, y, z0), (ART_W / 2, y, z0), (ART_W / 2, y, z0 + ART_H), (-ART_W / 2, y, z0 + ART_H)]
    verts = [art_bm.verts.new(c) for c in corners]
    face = art_bm.faces.new(verts)
    for loop, (u, v) in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    face.normal_update()
    if face.normal.y > 0:
        face.normal_flip()
    art.slot(art_mat)
    art_ob = art.finish(col, weighted=False, keep_uv=True)

    for o in (glass_ob, art_ob):
        pl.parent_keep_transform(o, ob)
    ob["source"] = "made for this site"
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
