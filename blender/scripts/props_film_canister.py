"""film_canister: three variants, each its own object with its origin at its base.

film_canister_a  a 35 mm plastic canister (black body, grey snap lid)
film_canister_b  a 35 mm film cassette lying on its side, leader out
film_canister_c  a 200 ft 8 mm film tin with an embossed lid and a paper label
"""
import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "film_canister"


def canister_a(col, mats):
    b = pl.Builder("film_canister_a")
    r = 0.0153
    b.lathe([(0.0, 0.0012), (r - 0.0022, 0.0012), (r - 0.0016, 0.0), (r - 0.0006, 0.0), (r, 0.0008), (r, 0.0455),
             (r - 0.0008, 0.0462), (r - 0.0008, 0.044), (0.0, 0.044)], segments=28, mat=mats["black_plastic"])
    rl = r + 0.0011
    b.lathe([(0.0, 0.0485), (rl - 0.0011, 0.0485), (rl - 0.0011, 0.0412), (rl - 0.0004, 0.0412), (rl, 0.0418),
             (rl, 0.0496), (rl - 0.0008, 0.0503), (rl - 0.0034, 0.0503), (rl - 0.0042, 0.0490), (0.0, 0.0490)],
            segments=28, mat=mats["grey_lid"], cap_start=False, cap_end=False)
    ob = b.finish(col, smooth_angle=35)
    return ob


def canister_b(col, mats):
    b = pl.Builder("film_canister_b")
    r, length = 0.0124, 0.0385
    rz = r + 0.0005
    b.cylinder(r, length, segments=28, loc=(-length / 2, 0, rz), rot=(0, 90, 0), mat=mats["cassette_label"], bevel=0.0004)
    for x in (-length / 2 - 0.0009, length / 2 - 0.0002):
        b.cylinder(r + 0.0004, 0.0011, segments=28, loc=(x, 0, rz), rot=(0, 90, 0), mat=mats["cassette_metal"],
                   bevel=0.0003)
    b.lathe([(0.0042, 0.0), (0.0042, 0.0045), (0.0036, 0.0058), (0.0, 0.0058)], segments=12,
            loc=(length / 2 + 0.0008, 0, rz), rot=(0, 90, 0), mat=mats["black_plastic"],
            radial=lambda i, j, rr: rr * (0.93 if i % 2 and j < 2 else 1.0))
    b.cylinder(0.0035, 0.0022, segments=12, loc=(-length / 2 - 0.0028, 0, rz), rot=(0, 90, 0),
               mat=mats["black_plastic"], bevel=0.0004)
    b.box((length - 0.001, 0.0035, 0.0028), loc=(0, -r + 0.0006, rz - r + 0.0024), rot=(-24, 0, 0),
          mat=mats["velvet"], bevel=0.0004, bevel_seg=1)
    # leader: 35 mm film tongue out of the slot, curling down to the desk
    bm = b.bm
    before = set(bm.faces)
    rows = []
    for k in range(12):
        t = k / 11
        y = -r + 0.0005 - 0.046 * t
        zz = rz - r + 0.002 - 0.0038 * math.sin(min(t * 2.2, 1) * math.pi / 2)
        zz = max(zz, 0.00025)
        half = 0.0175 if t < 0.55 else 0.0175 - 0.0085 * min((t - 0.55) / 0.12, 1.0)
        x0 = -half if t < 0.55 else 0.0175 - 2 * half
        rows.append([bm.verts.new((x0, y, zz)), bm.verts.new((0.0175, y, zz))])
    for k in range(11):
        bm.faces.new((rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]))
    b._wrap(before, None, mats["film_base"])
    return b.finish(col, smooth_angle=35)


def canister_c(col, mats):
    b = pl.Builder("film_canister_c")
    r, h = 0.0675, 0.0165
    b.lathe([(0.0, 0.0008), (r - 0.003, 0.0008), (r - 0.0022, 0.0), (r - 0.0004, 0.0), (r, 0.0006), (r, h - 0.0062),
             (r - 0.0005, h - 0.006), (0.0, h - 0.006)], segments=56, mat=mats["tin"])
    rl = r + 0.0009
    prof = [(rl - 0.0009, h - 0.0074), (rl, h - 0.0068), (rl, h - 0.0006), (rl - 0.0008, h)]
    for rr, dz in ((0.061, 0.0), (0.0595, -0.0006), (0.0565, -0.0014), (0.0535, -0.0006), (0.052, 0.0),
                   (0.041, 0.0), (0.0395, -0.0006), (0.037, -0.0012), (0.0345, -0.0006), (0.033, 0.0),
                   (0.013, 0.0), (0.0115, 0.0005), (0.009, 0.0010), (0.0, 0.0010)):
        prof.append((rr, h + dz))
    b.lathe(prof, segments=56, mat=mats["tin"], cap_start=False)
    b.box((0.050, 0.030, 0.00025), loc=(0.006, -0.004, h + 0.00045), rot=(0, 0, -8), mat=mats["label"])
    b.box((0.032, 0.0035, 0.00015), loc=(0.005, -0.0105, h + 0.0006), rot=(0, 0, -8), mat=mats["pencil"])
    return b.finish(col, smooth_angle=35)


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    mats = {
        "black_plastic": pl.surface("canister_black", (0.012, 0.012, 0.013), 0.32, smudges=0.3, scratches=0.15,
                                    edge_wear=0.4, edge_color=(0.05, 0.05, 0.05), edge_width=0.0008, dust=0.4),
        "grey_lid": pl.surface("canister_lid", (0.30, 0.30, 0.29), 0.45, micro_bump=(3000, 0.05), smudges=0.2,
                               edge_wear=0.3, edge_width=0.0008, dust=0.5),
        "cassette_metal": pl.surface("cassette_metal", (0.58, 0.58, 0.56), 0.28, metallic=1.0, scratches=0.3,
                                     smudges=0.2, edge_wear=0.5, edge_color=(0.75, 0.74, 0.7), edge_width=0.0006),
        "cassette_label": cassette_label(),
        "velvet": pl.surface("light_trap_velvet", (0.01, 0.009, 0.009), 0.95, sheen=0.6, color_var=0.0),
        "film_base": pl.surface("film_leader", (0.10, 0.045, 0.02), 0.18, coat=0.4, color_var=0.05, smudges=0.3),
        "tin": pl.surface("film_tin", (0.40, 0.395, 0.375), 0.42, metallic=1.0, scratches=0.3, smudges=0.15,
                          edge_wear=0.6, edge_color=(0.24, 0.12, 0.06), edge_metallic=0.0, edge_roughness=0.8,
                          edge_width=0.0007, dust=0.5, grime=0.5),
        "label": pl.surface("tin_label", (0.58, 0.52, 0.40), 0.8, edge_wear=0.7, edge_color=(0.42, 0.35, 0.25),
                            edge_width=0.0001, grime=0.4, dust=0.5, color_var=0.15),
        "pencil": pl.surface("pencil_line", (0.12, 0.12, 0.13), 0.6, color_var=0.2),
    }
    obs = [canister_a(col, mats), canister_b(col, mats), canister_c(col, mats)]
    for ob, x in zip(obs, (-0.075, 0.0, 0.11)):
        ob.location.x = x
        ob["source"] = "made for this site"
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


def cassette_label():
    """Printed steel shell: a muted green band, a cream band and a dark rim, banded along the cassette axis."""
    mat, k = pl.new_material("cassette_label")
    obj = k.node("ShaderNodeTexCoord").outputs["Object"]
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    x = sep.outputs["X"]
    band = k.math("LESS_THAN", k.math("ABSOLUTE", k.math("SUBTRACT", x, 0.004)), 0.007)
    rim = k.math("GREATER_THAN", k.math("ABSOLUTE", x), 0.0165)
    color = k.mix_color(band, (0.13, 0.22, 0.15, 1.0), (0.70, 0.67, 0.58, 1.0))
    color = k.mix_color(rim, color, (0.03, 0.03, 0.03, 1.0))
    wear = k.node("ShaderNodeGroup", node_tree=pl._wear_group())
    k.set(wear, "Edge Width", 0.0008)
    color = k.mix_color(k.math("MULTIPLY", wear.outputs["Edge"], 0.8), color, (0.6, 0.6, 0.58, 1.0))
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.35,
                                                      "Metallic": k.math("MULTIPLY", wear.outputs["Edge"], 0.8),
                                                      "Coat Weight": 0.3})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs["BSDF"])
    return mat


main()
