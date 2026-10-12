"""nas_4bay: a small four-bay home NAS (199 x 166 x 223 mm, the size of common four-bay units), unbranded.

Front: control strip (power button with ring light, status and LAN lights, four drive lights, USB) and four
drive trays with vent slots and latches. Back: two fans and ports. A label-maker strip on top reads
"projectionist". Objects: nas_4bay and its children nas_led_0 .. nas_led_3 (one emissive material each, so the
scene can blink them). Faces -Y, origin at the base.
"""
import math
import os
import sys

from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "nas_4bay"
W, H, D = 0.199, 0.166, 0.223
FRONT = -D / 2
LED_GREEN = (0.30, 1.0, 0.42)


def slot_material(name, base):
    """Black tray front with a grid of horizontal vent slots (object space, metres)."""
    mat, k = pl.new_material(name)
    obj = k.node("ShaderNodeTexCoord").outputs["Object"]
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    row = k.math("FRACT", k.math("DIVIDE", sep.outputs["Z"], 0.0042))
    col = k.math("FRACT", k.math("DIVIDE", k.math("ADD", sep.outputs["X"], 0.0016), 0.0371 / 4))
    slot = k.math("MULTIPLY", k.math("LESS_THAN", row, 0.36), k.math("LESS_THAN", col, 0.78))
    zband = k.math("MULTIPLY", k.math("GREATER_THAN", sep.outputs["Z"], 0.036),
                   k.math("LESS_THAN", sep.outputs["Z"], 0.142))
    slot = k.math("MULTIPLY", slot, zband)
    wear = k.node("ShaderNodeGroup", node_tree=pl._wear_group())
    color = k.mix_color(slot, base + (1.0,), (0.003, 0.003, 0.003, 1.0))
    dust = k.math("MULTIPLY", wear.outputs["Top"], k.map_range(wear.outputs["Fine"], 0.3, 0.7, 0.3, 1.0))
    color = k.mix_color(k.math("MULTIPLY", dust, 0.8), color, (0.30, 0.28, 0.25, 1.0))
    rough = k.mix_float(slot, 0.5, 0.9)
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.6, "Distance": 0.0006,
                                           "Height": k.math("SUBTRACT", 1.0, slot)})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": rough,
                                                      "Normal": bump.outputs["Normal"]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs["BSDF"])
    return mat


def led_material(name, color, strength):
    return pl.surface(name, tuple(c * 0.25 for c in color), 0.25, emission=(color, strength), color_var=0.0,
                      edge_width=0.0003)


def set_origin(ob, point):
    ob.data.transform(pl.xform(loc=-Vector(point)))
    ob.location = point


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    plastic = pl.ambientcg("Plastic012B")
    shell = pl.surface("nas_shell", (0.022, 0.022, 0.024), 0.52, rough_tex=plastic["Roughness"], rough_amount=0.2,
                       micro_bump=(1400, 0.08), dust=0.6, dust_color=(0.30, 0.285, 0.26), smudges=0.18,
                       edge_wear=0.35, edge_color=(0.06, 0.06, 0.065), edge_width=0.001, grime=0.3)
    tray = slot_material("nas_tray_front", (0.03, 0.03, 0.032))
    trim = pl.surface("nas_trim", (0.012, 0.012, 0.013), 0.35, smudges=0.25, dust=0.6, color_var=0.0)
    rubber = pl.surface("rubber_black", (0.018, 0.017, 0.016), 0.82, micro_bump=(1800, 0.2), dust=0.3)
    metal = pl.surface("port_metal", (0.62, 0.62, 0.60), 0.32, metallic=1.0, scratches=0.2, color_var=0.03)
    port_black = pl.surface("port_insert", (0.01, 0.01, 0.01), 0.6, color_var=0.0)
    power_led = led_material("nas_power_led", (0.35, 0.55, 1.0), 3.0)
    status_led = led_material("nas_status_led", LED_GREEN, 2.5)
    tape = pl.surface("label_tape", (0.012, 0.012, 0.014), 0.32, micro_bump=(2500, 0.05), color_var=0.0,
                      edge_wear=0.5, edge_color=(0.05, 0.05, 0.05), edge_width=0.0004)
    tape_ink = pl.surface("label_tape_letters", (0.80, 0.80, 0.78), 0.45, color_var=0.0, edge_width=0.0003)
    sticker = pl.surface("nas_sticker", (0.72, 0.71, 0.68), 0.5, dust=0.4, grime=0.5, color_var=0.05)

    b = pl.Builder(NAME)
    b.box((W, D, H - 0.004), loc=(0, 0, 0.004 + (H - 0.004) / 2), mat=shell, corner=0.006, corner_seg=4,
          corner_axis="Y", bevel=0.0012, bevel_seg=2)

    strip_x0 = -W / 2 + 0.006
    tray_x0 = -W / 2 + 0.040
    tray_w = (W / 2 - 0.006 - tray_x0 - 3 * 0.0015) / 4
    for i in range(4):
        x = tray_x0 + tray_w / 2 + i * (tray_w + 0.0015)
        b.box((tray_w, 0.003, 0.132), loc=(x, FRONT - 0.0005, 0.018 + 0.066), mat=tray, bevel=0.0008, bevel_seg=2)
        b.box((tray_w * 0.62, 0.002, 0.009), loc=(x, FRONT - 0.0025, 0.026), mat=trim, bevel=0.0006, bevel_seg=1)
        b.box((tray_w * 0.18, 0.0012, 0.004), loc=(x + tray_w * 0.22, FRONT - 0.0038, 0.026), mat=rubber,
              bevel=0.0003, bevel_seg=1)
    strip_cx = (strip_x0 + tray_x0 - 0.002) / 2
    b.box((tray_x0 - 0.002 - strip_x0, 0.0016, 0.132), loc=(strip_cx, FRONT - 0.0004, 0.084), mat=trim,
          bevel=0.0006, bevel_seg=1)
    b.cylinder(0.0062, 0.003, segments=24, loc=(strip_cx, FRONT - 0.0008, 0.032), rot=(90, 0, 0), mat=power_led,
               bevel=0.0006)
    b.cylinder(0.0048, 0.0042, segments=24, loc=(strip_cx, FRONT - 0.0012, 0.032), rot=(90, 0, 0), mat=trim,
               bevel=0.0008)
    for z in (0.140, 0.130, 0.122):
        b.box((0.0042, 0.0012, 0.0016), loc=(strip_cx, FRONT - 0.0012, z), mat=status_led, bevel=0.0003, bevel_seg=1)
    b.box((0.0125, 0.003, 0.0055), loc=(strip_cx, FRONT - 0.0002, 0.055), mat=metal, bevel=0.0005, bevel_seg=1)
    b.box((0.0105, 0.002, 0.0018), loc=(strip_cx, FRONT - 0.0013, 0.0553), mat=port_black, bevel=0.0002, bevel_seg=1)

    back = D / 2
    for fx in (-0.047, 0.047):
        b.lathe([(0.0, -0.001), (0.017, -0.001), (0.016, 0.0), (0.0, 0.0)], segments=24,
                loc=(fx, back - 0.002, 0.095), rot=(-90, 0, 0), mat=trim)
        for r in (0.026, 0.036, 0.044):
            b.torus(r, 0.0011, segments=40, sides=4, loc=(fx, back + 0.0004, 0.095), rot=(90, 0, 0), mat=trim)
        for s in range(4):
            a = math.radians(45 + 90 * s)
            b.box((0.0024, 0.0016, 0.030), loc=(fx + math.cos(a) * 0.031, back + 0.0004, 0.095 + math.sin(a) * 0.031),
                  rot=(0, -45 - 90 * s + 90, 0), mat=trim)
    for i, px in enumerate((-0.060, -0.040)):
        b.box((0.016, 0.004, 0.0135), loc=(px, back - 0.0005, 0.024), mat=metal, bevel=0.0004, bevel_seg=1)
        b.box((0.012, 0.003, 0.009), loc=(px, back + 0.0003, 0.023), mat=port_black)
    b.box((0.0125, 0.003, 0.0055), loc=(-0.018, back - 0.0005, 0.022), mat=metal, bevel=0.0004, bevel_seg=1)
    b.cylinder(0.0045, 0.004, segments=16, loc=(0.075, back + 0.001, 0.024), rot=(-90, 0, 0), mat=metal, bevel=0.0005)
    b.box((0.050, 0.0004, 0.022), loc=(0.020, back + 0.0002, 0.150), mat=sticker)

    for fx in (-W / 2 + 0.022, W / 2 - 0.022):
        for fy in (-D / 2 + 0.025, D / 2 - 0.025):
            b.cylinder(0.008, 0.0042, segments=16, loc=(fx, fy, 0.0), mat=rubber, bevel=0.001)

    tape_y = FRONT + 0.032
    b.box((0.064, 0.0105, 0.0004), loc=(-0.040, tape_y, H + 0.0002), rot=(0, 0, 1.5), mat=tape, bevel=0.00015,
          bevel_seg=1)
    b.text("projectionist", 0.0062, loc=(-0.040, tape_y, H + 0.00048), rot=(0, 0, 1.5), mat=tape_ink,
           resolution=2, spacing=1.05)

    nas = b.finish(col, smooth_angle=30)
    nas["source"] = "made for this site"
    led_z = (0.110, 0.100, 0.090, 0.080)
    for i, z in enumerate(led_z):
        led = pl.Builder(f"nas_led_{i}")
        led.box((0.0042, 0.0014, 0.0016), loc=(strip_cx, FRONT - 0.0012, z), mat=led_material(f"nas_led_{i}", LED_GREEN, 3.0),
                bevel=0.0003, bevel_seg=1)
        ob = led.finish(col, weighted=False)
        set_origin(ob, (strip_cx, FRONT - 0.0012, z))
        ob["source"] = "made for this site"
        pl.parent_keep_transform(ob, nas)
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
