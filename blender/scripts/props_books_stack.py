"""books_stack: four books stacked a little askew — three cloth hardcovers and a paperback.

Hardcovers have rounded spines with hinge grooves, boards that overhang the page block by 3 mm, a concave
fore-edge, headbands and two gold-foil bands on the spine; the paperback lies the other way round, fore-edge
out. One object, books_stack. Spines face -Y, origin at the base.
"""
import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "books_stack"
BOARD = 0.0025
SQUARE = 0.003
ARC = 8


def case_profile(width, thick, bulge=0.006, spine_wall=0.0016, joint=0.008):
    """C-shaped case cross-section (u across the width, spine at -width/2; v up the thickness)."""
    w2 = width / 2
    cx = -w2 + bulge
    pts = [(w2, 0.0), (w2, BOARD)]
    pts.append((-w2 + joint, BOARD))
    for k in range(ARC + 1):
        t = math.pi * k / ARC
        pts.append((cx - (bulge - spine_wall) * math.sin(t), thick / 2 - (thick / 2 - BOARD) * math.cos(t)))
    pts += [(-w2 + joint, thick - BOARD), (w2, thick - BOARD), (w2, thick),
            (-w2 + joint + 0.0022, thick), (-w2 + joint, thick - 0.0007), (-w2 + joint - 0.0022, thick)]
    for k in range(ARC + 1):
        t = math.pi * k / ARC
        pts.append((cx - bulge * math.sin(t), thick / 2 + thick / 2 * math.cos(t)))
    pts += [(-w2 + joint - 0.0022, 0.0), (-w2 + joint, 0.0007), (-w2 + joint + 0.0022, 0.0)]
    return dedupe(pts)


def block_profile(width, thick, bulge=0.006, spine_wall=0.0016):
    w2 = width / 2
    cx = -w2 + bulge
    top, bottom = thick - BOARD - 0.0002, BOARD + 0.0002
    fore = w2 - SQUARE
    pts = []
    for k in range(ARC + 1):
        t = k / ARC
        pts.append((fore - 0.0012 * math.sin(math.pi * t), top - (top - bottom) * t))
    for k in range(ARC + 1):
        t = math.pi * k / ARC
        pts.append((cx - (bulge - spine_wall - 0.0004) * math.sin(t), thick / 2 - (thick / 2 - bottom) * math.cos(t)))
    return dedupe(pts[:ARC + 1] + list(reversed(pts[ARC + 1:])))


def dedupe(pts):
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) > 1e-6:
            out.append(p)
    if abs(out[0][0] - out[-1][0]) + abs(out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    return out


def spine_band(width, thick, bulge=0.006):
    w2 = width / 2
    cx = -w2 + bulge
    outer = [(cx - (bulge + 0.00018) * math.sin(math.pi * k / ARC), thick / 2 + (thick / 2 + 0.00005) * math.cos(math.pi * k / ARC))
             for k in range(ARC + 1)]
    inner = [(cx - (bulge - 0.0003) * math.sin(math.pi * k / ARC), thick / 2 + (thick / 2 - 0.0003) * math.cos(math.pi * k / ARC))
             for k in range(ARC + 1)]
    return outer + list(reversed(inner))


def hardcover(b, length, width, thick, z, rot_z, offset, cloth, pages, foil, headband):
    loc = (offset[0], offset[1], z)
    b.extrude(case_profile(width, thick), length, loc=loc, rot=(0, 0, 90 + rot_z), mat=cloth)
    b.extrude(block_profile(width, thick), length - 2 * SQUARE, loc=loc, rot=(0, 0, 90 + rot_z), mat=pages)
    for sign in (-1, 1):
        shift = sign * (length / 2 - 0.016)
        dx, dy = -shift * math.sin(math.radians(90 + rot_z)), shift * math.cos(math.radians(90 + rot_z))
        b.extrude(spine_band(width, thick), 0.0016, loc=(loc[0] + dx, loc[1] + dy, z), rot=(0, 0, 90 + rot_z), mat=foil)
        hs = sign * (length / 2 - SQUARE - 0.0008)
        hx, hy = -hs * math.sin(math.radians(90 + rot_z)), hs * math.cos(math.radians(90 + rot_z))
        u = -width / 2 + 0.0034
        ux, uy = u * math.cos(math.radians(90 + rot_z)), u * math.sin(math.radians(90 + rot_z))
        b.cylinder(0.0011, thick - 2 * BOARD - 0.001, segments=6, loc=(loc[0] + hx + ux, loc[1] + hy + uy, z + BOARD + 0.0005),
                   mat=headband)


def paperback(b, length, width, thick, z, rot_z, offset, cover, pages):
    loc = (offset[0], offset[1], z)
    w2, c = width / 2, 0.0005
    b.box((length - 0.001, width - 0.0012, thick - 2 * c), loc=(loc[0], loc[1], z + thick / 2), rot=(0, 0, rot_z),
          mat=pages, bevel=0.0005, bevel_seg=1)
    wrap = [(w2, 0.0), (w2, c), (-w2 + c, c), (-w2 + c, thick - c), (w2, thick - c), (w2 - 0.0006, thick + 0.0004),
            (-w2 + 0.0008, thick), (-w2, thick - 0.0008), (-w2, 0.0008), (-w2 + 0.0008, 0.0)]
    b.extrude(wrap, length, loc=loc, rot=(0, 0, 90 + rot_z), mat=cover)


def page_material():
    mat, k = pl.new_material("book_pages")
    obj = k.node("ShaderNodeTexCoord").outputs["Object"]
    bands = k.node("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z",
                   inputs={"Vector": obj, "Scale": 380.0, "Distortion": 2.0, "Detail": 2.0})
    stripes = k.node("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z",
                     inputs={"Vector": obj, "Scale": 3200.0, "Distortion": 0.5})
    wear = k.node("ShaderNodeGroup", node_tree=pl._wear_group())
    base = k.mix_color(k.noise(obj, 30.0), (0.50, 0.43, 0.31, 1.0), (0.60, 0.53, 0.40, 1.0))
    color = k.mix_color(k.math("MULTIPLY", bands.outputs["Fac"], 0.12), base, (0.45, 0.40, 0.32, 1.0))
    color = k.mix_color(k.math("MULTIPLY", stripes.outputs["Fac"], 0.08), color, (0.55, 0.50, 0.40, 1.0))
    dirt = k.math("MULTIPLY", wear.outputs["Edge"], 0.6)
    color = k.mix_color(dirt, color, (0.42, 0.36, 0.27, 1.0))
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.15, "Distance": 0.0003, "Height": stripes.outputs["Fac"]})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.85,
                                                      "Normal": bump.outputs["Normal"]})
    k.set(wear, "Edge Width", 0.0012)
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs["BSDF"])
    return mat


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    fabric = pl.ambientcg("Fabric036")

    def cloth(name, color, wear_color):
        return pl.surface(name, color, 0.78, color_tex=fabric["Color"], tint=color, height_tex=fabric["Displacement"],
                          height_strength=0.35, tile=0.018, edge_wear=0.7, edge_color=wear_color, edge_width=0.0007,
                          edge_roughness=0.6, dust=0.55, grime=0.4, color_var=0.08, sheen=0.25)

    oxblood = cloth("cloth_oxblood", (0.105, 0.032, 0.025), (0.22, 0.12, 0.09))
    green = cloth("cloth_green", (0.034, 0.055, 0.036), (0.13, 0.15, 0.11))
    navy = cloth("cloth_navy", (0.028, 0.034, 0.06), (0.11, 0.12, 0.15))
    pages = page_material()
    foil = pl.surface("gold_foil", (0.62, 0.45, 0.20), 0.32, metallic=1.0, edge_wear=0.6,
                      edge_color=(0.2, 0.15, 0.08), edge_metallic=0.0, edge_width=0.0006, color_var=0.1)
    headband = pl.surface("headband", (0.42, 0.10, 0.07), 0.7, micro_bump=(4000, 0.4), color_var=0.2)
    cover = pl.surface("paperback_cover", (0.36, 0.25, 0.08), 0.55, edge_wear=0.8, edge_color=(0.62, 0.55, 0.40),
                       edge_width=0.0004, dust=0.4, grime=0.3, color_var=0.1, micro_bump=(2500, 0.1))

    b = pl.Builder(NAME)
    z = 0.0
    hardcover(b, 0.245, 0.172, 0.031, z, 0.0, (0.0, 0.0), oxblood, pages, foil, headband)
    z += 0.031
    hardcover(b, 0.214, 0.142, 0.026, z, 6.5, (0.006, 0.004), green, pages, foil, headband)
    z += 0.026
    paperback(b, 0.198, 0.129, 0.019, z, 180 - 4.0, (-0.004, 0.006), cover, pages)
    z += 0.019
    hardcover(b, 0.182, 0.118, 0.022, z, 11.0, (0.009, -0.002), navy, pages, foil, headband)
    ob = b.finish(col, smooth_angle=40, seam_angle=50)
    ob["source"] = "made for this site"
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
