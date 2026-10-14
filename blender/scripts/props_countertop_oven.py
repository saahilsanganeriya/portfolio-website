"""countertop_oven: a 1950s countertop oven, 40 x 27 x 22 cm, cream enamel and chrome, unbranded.

A rounded enamel body with side louvres and a real cavity, a chrome door that drops open on a hinge along its bottom
edge, a handle bar, two bakelite dials, a pilot light and bakelite feet, and a croissant on the rack inside.
Objects: countertop_oven, its children oven_door (origin on the hinge axis; it opens by turning about its local +X
by up to DOOR_OPEN_DEG, the top swinging out toward the viewer), oven_glow (the cavity lining, rack and glowing
elements, own material, so the site can flicker it) and croissant. Faces -Y, origin at the base.
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

NAME = "countertop_oven"
W, D, H = 0.40, 0.27, 0.215
FOOT = 0.012
FRONT = -D / 2
DOOR_X0, DOOR_X1, DOOR_Z0, DOOR_Z1 = -0.185, 0.075, FOOT + 0.022, FOOT + H - 0.030
DOOR_T = 0.026
WIN_X0, WIN_X1, WIN_Z0, WIN_Z1 = -0.162, 0.052, FOOT + 0.052, FOOT + H - 0.062
# The cavity behind the door: a little larger than the window, 20 cm deep.
CAV_X0, CAV_X1, CAV_Z0, CAV_Z1, CAV_D = -0.173, 0.063, FOOT + 0.040, FOOT + H - 0.044, 0.20
DOOR_OPEN_DEG = 82.0


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    enamel = pl.surface("oven_enamel", (0.74, 0.66, 0.49), 0.32, micro_bump=(700, 0.03), edge_wear=0.35,
                        edge_color=(0.16, 0.12, 0.09), edge_roughness=0.6, edge_width=0.0012, grime=0.6, dust=0.6,
                        smudges=0.25, scratches=0.1, coat=0.3, coat_roughness=0.15, color_var=0.05)
    chrome = pl.surface("oven_chrome", (0.74, 0.73, 0.71), 0.12, metallic=1.0, smudges=0.35, scratches=0.25,
                        grime=0.6, dust=0.3, color_var=0.03)
    bakelite = pl.surface("oven_bakelite", (0.03, 0.02, 0.015), 0.28, smudges=0.3, edge_wear=0.2,
                          edge_color=(0.10, 0.06, 0.04), color_var=0.02)
    slot = pl.surface("oven_slot", (0.012, 0.01, 0.009), 0.8, color_var=0.0)
    lettering = pl.surface("oven_lettering", (0.06, 0.05, 0.04), 0.5, color_var=0.0, edge_width=0.0003)
    pilot = pl.surface("oven_pilot", (0.5, 0.2, 0.03), 0.2, emission=((1.0, 0.45, 0.08), 2.0), color_var=0.0)

    b = pl.Builder(NAME)
    b.box((W, D, H), loc=(0, 0, FOOT + H / 2), mat=enamel, corner=0.034, corner_seg=6, corner_axis="Y",
          bevel=0.004, bevel_seg=2)
    door = pl.Builder("oven_door")
    # Door: four chrome rails around the window, proud of the body by DOOR_T.
    y = FRONT - DOOR_T / 2
    rails = [((DOOR_X1 - DOOR_X0, WIN_Z0 - DOOR_Z0), ((DOOR_X0 + DOOR_X1) / 2, (DOOR_Z0 + WIN_Z0) / 2)),
             ((DOOR_X1 - DOOR_X0, DOOR_Z1 - WIN_Z1), ((DOOR_X0 + DOOR_X1) / 2, (WIN_Z1 + DOOR_Z1) / 2)),
             ((WIN_X0 - DOOR_X0, WIN_Z1 - WIN_Z0), ((DOOR_X0 + WIN_X0) / 2, (WIN_Z0 + WIN_Z1) / 2)),
             ((DOOR_X1 - WIN_X1, WIN_Z1 - WIN_Z0), ((WIN_X1 + DOOR_X1) / 2, (WIN_Z0 + WIN_Z1) / 2))]
    for (w, h), (x, z) in rails:
        door.box((w, DOOR_T, h), loc=(x, y, z), mat=chrome, bevel=0.0025, bevel_seg=2)
    # Handle bar on stand-offs across the top rail.
    hz, hy = (WIN_Z1 + DOOR_Z1) / 2 + 0.002, FRONT - DOOR_T - 0.022
    for x in (DOOR_X0 + 0.035, DOOR_X1 - 0.035):
        door.cylinder(0.0055, 0.024, segments=12, loc=(x, FRONT - DOOR_T + 0.002, hz), rot=(90, 0, 0), mat=chrome)
    door.tube([Vector((DOOR_X0 + 0.022, hy, hz)), Vector((DOOR_X0 + 0.035, hy - 0.002, hz)),
               Vector((DOOR_X1 - 0.035, hy - 0.002, hz)), Vector((DOOR_X1 - 0.022, hy, hz))], 0.0068, sides=12,
              mat=chrome)
    # The hinge barrel along the bottom edge.
    door.cylinder(0.005, DOOR_X1 - DOOR_X0 - 0.04, segments=12, loc=((DOOR_X0 + DOOR_X1) / 2, FRONT - 0.004, DOOR_Z0),
                  rot=(0, 90, 0), mat=chrome)

    # Controls on the right: pilot light, two dials with chrome skirts and lettering.
    cx = (DOOR_X1 + W / 2) / 2
    b.cylinder(0.0065, 0.004, segments=16, loc=(cx, FRONT, FOOT + H - 0.040), rot=(90, 0, 0), mat=pilot)
    b.cylinder(0.009, 0.0025, segments=16, loc=(cx, FRONT + 0.001, FOOT + H - 0.040), rot=(90, 0, 0), mat=chrome)
    for z, label in ((FOOT + H - 0.090, "BAKE"), (FOOT + 0.058, "TIMER")):
        b.cylinder(0.024, 0.004, segments=40, loc=(cx, FRONT + 0.001, z), rot=(90, 0, 0), mat=chrome, bevel=0.001)
        b.lathe([(0.0, 0.0), (0.018, 0.0), (0.019, 0.004), (0.016, 0.016), (0.012, 0.020), (0.0, 0.021)],
                segments=32, loc=(cx, FRONT - 0.003, z), rot=(90, 0, 0), mat=bakelite)
        b.box((0.0026, 0.012, 0.0035), loc=(cx, FRONT - 0.019, z + 0.008), rot=(0, 0, 0), mat=chrome)
        b.text(label, 0.0068, loc=(cx, FRONT - 0.0005, z + 0.032), rot=(90, 0, 0), mat=lettering, resolution=2,
               spacing=1.1)
    # Louvres on both sides and a row of vents on the top.
    for sx in (-1, 1):
        for i in range(6):
            b.box((0.003, 0.11, 0.0055), loc=(sx * (W / 2 + 0.0005), 0.035, FOOT + 0.070 + i * 0.016), mat=slot,
                  bevel=0.001, bevel_seg=1)
    for i in range(7):
        b.box((0.13, 0.0045, 0.003), loc=(0.05, 0.035 + (i - 3) * 0.013, FOOT + H + 0.0004), mat=slot, bevel=0.001,
              bevel_seg=1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.lathe([(0.0, 0.0), (0.011, 0.0), (0.013, 0.004), (0.010, FOOT + 0.002), (0.0, FOOT + 0.002)],
                    segments=20, loc=(sx * (W / 2 - 0.04), sy * (D / 2 - 0.035), 0.0), mat=bakelite)
    oven = b.finish(col, smooth_angle=36, unwrap=False)
    cut_cavity(oven)
    pl.unwrap_object(oven)
    oven["source"] = "made for this site"
    door_obj = door.finish(col, smooth_angle=36)
    door_obj["source"] = "made for this site"
    # Origin on the hinge axis (the door's bottom edge at the body's front face).
    hinge = Vector(((DOOR_X0 + DOOR_X1) / 2, FRONT - 0.004, DOOR_Z0))
    door_obj.data.transform(Matrix.Translation(-hinge))
    door_obj.location = hinge
    door_obj["turn_axis"] = "+X"
    door_obj["open_angle_deg"] = DOOR_OPEN_DEG
    pl.parent_keep_transform(door_obj, oven)

    glow_mat = glow_material()
    rack_mat = pl.surface("oven_rack", (0.35, 0.33, 0.30), 0.35, metallic=1.0, grime=0.8, color_var=0.05)
    element_mat = pl.surface("oven_element", (0.25, 0.08, 0.03), 0.4, metallic=0.5,
                             emission=((1.0, 0.30, 0.06), 9.0), color_var=0.0)
    g = pl.Builder("oven_glow")
    # The cavity lining: back, sides, roof and floor of the cut, a millimetre inside it, facing in.
    x0, x1, z0, z1 = CAV_X0 + 0.001, CAV_X1 - 0.001, CAV_Z0 + 0.001, CAV_Z1 - 0.001
    yf, yb = FRONT + 0.001, FRONT + CAV_D - 0.001
    g.box((x1 - x0, 0.002, z1 - z0), loc=((x0 + x1) / 2, yb, (z0 + z1) / 2), mat=glow_mat)
    for (sx, sy, sz), (cx_, cy_, cz_) in (
            ((x1 - x0, yb - yf, 0.002), ((x0 + x1) / 2, (yf + yb) / 2, z0)),
            ((x1 - x0, yb - yf, 0.002), ((x0 + x1) / 2, (yf + yb) / 2, z1)),
            ((0.002, yb - yf, z1 - z0), (x0, (yf + yb) / 2, (z0 + z1) / 2)),
            ((0.002, yb - yf, z1 - z0), (x1, (yf + yb) / 2, (z0 + z1) / 2))):
        g.box((sx, sy, sz), loc=(cx_, cy_, cz_), mat=glow_mat)
    for z in (z1 - 0.012, z0 + 0.012):
        for dy in (0.05, 0.15):
            g.tube([Vector((x0 + 0.006, yf + dy, z)), Vector((x1 - 0.006, yf + dy, z))], 0.003, sides=8,
                   mat=element_mat)
    rack_z = z0 + 0.034
    for i in range(10):
        x = x0 + 0.012 + i * (x1 - x0 - 0.024) / 9
        g.tube([Vector((x, yf + 0.01, rack_z)), Vector((x, yb - 0.008, rack_z))], 0.0011, sides=5, mat=rack_mat)
    for dy in (0.02, 0.17):
        g.tube([Vector((x0 + 0.004, yf + dy, rack_z + 0.0015)), Vector((x1 - 0.004, yf + dy, rack_z + 0.0015))],
               0.0014, sides=6, mat=rack_mat)
    glow = g.finish(col, smooth_angle=50)
    glow["source"] = "made for this site"
    pl.parent_keep_transform(glow, oven)

    pastry = pl.croissant("croissant", col, Vector(((CAV_X0 + CAV_X1) / 2, FRONT + CAV_D * 0.48, rack_z + 0.0025)))
    pl.parent_keep_transform(pastry, oven)
    pl.report(NAME, col, 18000)
    pl.save_prop(NAME)


def cut_cavity(oven):
    """Cut the cavity into the body's front with an exact boolean."""
    bm = bmesh.new()
    geom = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((CAV_X1 - CAV_X0, CAV_D + 0.05, CAV_Z1 - CAV_Z0)), verts=geom["verts"])
    bmesh.ops.translate(bm, vec=Vector(((CAV_X0 + CAV_X1) / 2, FRONT + (CAV_D - 0.05) / 2, (CAV_Z0 + CAV_Z1) / 2)),
                        verts=geom["verts"])
    me = bpy.data.meshes.new("cavity_cutter")
    bm.to_mesh(me)
    bm.free()
    cutter = bpy.data.objects.new("cavity_cutter", me)
    bpy.context.scene.collection.objects.link(cutter)
    mod = oven.modifiers.new("cavity", "BOOLEAN")
    mod.operation, mod.solver, mod.object = "DIFFERENCE", "EXACT", cutter
    pl.apply_modifier(oven, mod)
    bpy.data.objects.remove(cutter, do_unlink=True)


def glow_material():
    """Dark enamel cavity, brightest near the elements, so it reads as lit from inside even before the bake."""
    mat, k = pl.new_material("oven_cavity")
    obj = k.coords("Object")
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    near_element = k.math("MAXIMUM", k.map_range(sep.outputs["Z"], WIN_Z1 - 0.02, WIN_Z1),
                          k.map_range(sep.outputs["Z"], WIN_Z0 + 0.02, WIN_Z0))
    color = k.mix_color(k.noise(obj, 220.0), (0.06, 0.035, 0.02, 1.0), (0.10, 0.06, 0.035, 1.0))
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.45,
                                                      "Emission Color": (1.0, 0.36, 0.08, 1.0),
                                                      "Emission Strength": k.math("MULTIPLY", near_element, 0.6)})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs["BSDF"])
    return mat


main()
