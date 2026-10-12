"""espresso_machine: a small home lever espresso machine in the 1960s style, 47 cm to the lever ball, unbranded.

Polished brass boiler with a pressure gauge, a group head with its lever up, a portafilter with a walnut handle,
a steam wand, a sight glass and a demitasse of coffee on the drip tray. Objects: espresso_machine and the empty
espresso_steam at the portafilter spouts (where the site starts its steam). Faces -Y, origin at the base.
"""
import math
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "espresso_machine"
BOILER = Vector((0.0, 0.045, 0.0))
BOILER_R, BOILER_TOP = 0.072, 0.250
GROUP = Vector((0.0, -0.088, 0.0))
SPOUT_Z = 0.099


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    brass = pl.surface("espresso_brass", (0.62, 0.43, 0.19), 0.16, metallic=1.0, micro_bump=(1500, 0.03),
                       edge_wear=0.3, edge_color=(0.90, 0.72, 0.42), edge_roughness=0.10, grime=0.7,
                       smudges=0.35, scratches=0.18, dust=0.25, color_var=0.07)
    chrome = pl.surface("espresso_chrome", (0.72, 0.72, 0.70), 0.12, metallic=1.0, smudges=0.3, scratches=0.2,
                        grime=0.5, color_var=0.03)
    wood = pl.ambientcg("Wood051")
    walnut = pl.surface("espresso_walnut", (0.30, 0.18, 0.10), 0.4, color_tex=wood["Color"], tint=(0.55, 0.38, 0.27),
                        rough_tex=wood["Roughness"], tile=0.12, coat=0.5, coat_roughness=0.12, edge_wear=0.3,
                        edge_color=(0.45, 0.30, 0.18), smudges=0.2, color_var=0.08)
    bakelite = pl.surface("espresso_bakelite", (0.02, 0.016, 0.014), 0.3, smudges=0.2, color_var=0.0)
    porcelain = pl.surface("espresso_porcelain", (0.82, 0.80, 0.75), 0.1, coat=0.6, coat_roughness=0.05,
                           grime=0.3, color_var=0.02)
    coffee = pl.surface("espresso_crema", (0.20, 0.09, 0.035), 0.35, micro_bump=(900, 0.15), color_var=0.2)
    gauge_face = pl.surface("espresso_gauge_face", (0.78, 0.74, 0.64), 0.35, grime=0.4, color_var=0.03)
    glass = pl.surface("espresso_sight_glass", (0.12, 0.13, 0.12), 0.05, coat=0.8, color_var=0.0)
    jewel = pl.surface("espresso_pilot", (0.5, 0.06, 0.03), 0.2, emission=((1.0, 0.18, 0.06), 1.5), color_var=0.0)

    b = pl.Builder(NAME)
    b.box((0.205, 0.255, 0.028), loc=(0, 0.0, 0.014), mat=brass, corner=0.032, corner_seg=5, bevel=0.004)
    b.box((0.140, 0.110, 0.008), loc=(0, -0.062, 0.032), mat=chrome, corner=0.012, corner_seg=3, bevel=0.002)
    for i in range(9):
        b.box((0.122, 0.0045, 0.003), loc=(0, -0.104 + i * 0.0105, 0.0375), mat=chrome, bevel=0.0008, bevel_seg=1)

    b.lathe([(0.082, 0.028), (0.080, 0.036), (0.074, 0.044), (BOILER_R, 0.050), (BOILER_R, BOILER_TOP - 0.012),
             (BOILER_R + 0.003, BOILER_TOP - 0.008), (BOILER_R + 0.003, BOILER_TOP), (0.066, BOILER_TOP + 0.012),
             (0.050, BOILER_TOP + 0.024), (0.028, BOILER_TOP + 0.031), (0.0, BOILER_TOP + 0.033)], segments=48,
            loc=tuple(BOILER), mat=brass, cap_start=False)
    for z in (0.085, 0.205):
        b.torus(BOILER_R + 0.0012, 0.0022, segments=64, sides=6, loc=tuple(BOILER + Vector((0, 0, z))), mat=brass)

    # Pressure gauge on the boiler crown, tilted toward the user.
    gauge = BOILER + Vector((0.0, -0.012, BOILER_TOP + 0.030))
    b.cylinder(0.008, 0.026, segments=16, loc=tuple(gauge - Vector((0, 0, 0.012))), mat=brass)
    tilt = (62, 0, 0)
    centre = gauge + Vector((0, -0.006, 0.030))
    b.cylinder(0.029, 0.018, segments=40, loc=tuple(centre), rot=tilt, mat=brass, bevel=0.003)
    face_dir = Vector((0, -math.sin(math.radians(62)), math.cos(math.radians(62))))
    b.cylinder(0.024, 0.0006, segments=40, loc=tuple(centre + face_dir * 0.0182), rot=tilt, mat=gauge_face)
    face_up = Vector((0, math.cos(math.radians(62)), math.sin(math.radians(62))))
    b.box((0.0014, 0.0006, 0.017), loc=tuple(centre + face_dir * 0.0192 + face_up * 0.006), rot=(62 - 90, 0, 0),
          mat=bakelite)

    # Group head: neck from the boiler, the vertical group, the lever yoke and the lever with its walnut ball.
    neck_z = 0.213
    b.cylinder(0.024, 0.075, segments=24, loc=(0, BOILER.y - BOILER_R + 0.02, neck_z), rot=(90, 0, 0), mat=brass)
    b.lathe([(0.0, 0.135), (0.036, 0.135), (0.038, 0.143), (0.031, 0.151), (0.031, 0.239), (0.036, 0.247),
             (0.033, 0.257), (0.0, 0.259)], segments=40, loc=tuple(GROUP), mat=brass)
    for sx in (-1, 1):
        b.box((0.006, 0.030, 0.050), loc=(sx * 0.036, GROUP.y, 0.269), mat=chrome, bevel=0.002)
    b.cylinder(0.005, 0.084, segments=12, loc=(-0.042, GROUP.y, 0.277), rot=(0, 90, 0), mat=chrome)
    pivot = Vector((0.0, GROUP.y, 0.277))
    lever = [pivot + Vector((0, 0.06 * (t / 8) ** 2, 0.235 * t / 8)) for t in range(9)]
    b.tube(lever, 0.0075, sides=10, mat=chrome, radius_fn=lambda t: 0.0085 - 0.002 * t)
    b.lathe([(0.0, -0.022), (0.012, -0.019), (0.020, -0.010), (0.022, 0.0), (0.020, 0.010), (0.012, 0.019),
             (0.0, 0.022)], segments=24, loc=tuple(lever[-1] + Vector((0, 0.004, 0.020))), mat=walnut)

    # Portafilter, its walnut handle angled to the front right, twin spouts.
    b.lathe([(0.0, 0.111), (0.022, 0.111), (0.031, 0.118), (0.034, 0.129), (0.034, 0.135), (0.0, 0.135)],
            segments=32, loc=tuple(GROUP), mat=chrome)
    for sx in (-0.009, 0.009):
        b.cylinder(0.0035, 0.012, segments=10, loc=(sx, GROUP.y, SPOUT_Z), mat=chrome)
    handle_dir = Vector((0.45, -1.0, -0.08)).normalized()
    start = GROUP + Vector((0, 0, 0.124)) + handle_dir * 0.030
    b.tube([start, start + handle_dir * 0.035], 0.008, sides=12, mat=chrome)
    grip = [start + handle_dir * (0.035 + 0.11 * t / 6) for t in range(7)]
    b.tube(grip, 0.012, sides=14, mat=walnut, radius_fn=lambda t: 0.0105 + 0.0035 * math.sin(math.pi * t ** 0.8))

    # Steam wand and its valve on the right of the boiler; sight glass on the left front.
    valve = BOILER + Vector((BOILER_R + 0.010, -0.010, 0.215))
    b.cylinder(0.011, 0.024, segments=16, loc=tuple(valve - Vector((0.014, 0, 0))), rot=(0, 90, 0), mat=brass)
    b.cylinder(0.006, 0.022, segments=12, loc=tuple(valve + Vector((0, 0, 0.004))), mat=brass)
    b.lathe([(0.0, 0.0), (0.012, 0.002), (0.014, 0.010), (0.010, 0.018), (0.0, 0.020)], segments=20,
            loc=tuple(valve + Vector((0, 0, 0.026))), mat=walnut)
    wand = [valve + Vector((0.012, 0, -0.006))]
    for t in range(1, 9):
        s = t / 8
        wand.append(valve + Vector((0.030 + 0.012 * s, -0.030 * s, -0.012 - 0.115 * s ** 1.3)))
    b.tube(wand, 0.0042, sides=10, mat=chrome)
    sight = BOILER + Vector((-0.052, -0.052, 0.0))
    for z in (0.072, 0.158):
        b.cylinder(0.0075, 0.010, segments=14, loc=tuple(sight + Vector((0, 0, z))), mat=brass)
    b.cylinder(0.0048, 0.076, segments=14, loc=tuple(sight + Vector((0, 0, 0.082))), mat=glass)
    b.cylinder(0.006, 0.004, segments=14, loc=(0.072, -0.124, 0.012), rot=(90, 0, 0), mat=jewel)
    b.cylinder(0.0075, 0.003, segments=16, loc=(0.072, -0.1255, 0.012), rot=(90, 0, 0), mat=brass)

    # A demitasse of coffee on its saucer under the spouts.
    cup = GROUP + Vector((0, 0, 0.040))
    b.lathe([(0.0, 0.0), (0.040, 0.0), (0.050, 0.004), (0.048, 0.007), (0.020, 0.005), (0.0, 0.005)],
            segments=40, loc=tuple(cup), mat=porcelain)
    b.lathe([(0.0, 0.005), (0.016, 0.005), (0.022, 0.012), (0.027, 0.030), (0.029, 0.050), (0.026, 0.050),
             (0.024, 0.032), (0.019, 0.016), (0.0, 0.014)], segments=36, loc=tuple(cup), mat=porcelain,
            cap_start=False, cap_end=False)
    b.cylinder(0.0245, 0.001, segments=36, loc=tuple(cup + Vector((0, 0, 0.040))), mat=coffee)
    b.torus(0.010, 0.0028, segments=16, sides=6, loc=tuple(cup + Vector((0.034, 0, 0.032))), rot=(90, 0, 0),
            mat=porcelain, arc=math.radians(230))

    machine = b.finish(col, smooth_angle=38)
    machine["source"] = "made for this site"
    pl.empty("espresso_steam", col, tuple(GROUP + Vector((0, 0, SPOUT_Z))), size=0.03, parent=machine,
             display="SINGLE_ARROW")
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
