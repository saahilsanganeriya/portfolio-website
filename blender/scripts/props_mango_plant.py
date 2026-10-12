"""mango_plant: a mango seedling in a weathered terracotta pot, about 42 cm tall.

The pot is Poly Haven "Planter Pot Clay" (CC0) scaled to a 19 cm pot. The seedling is modelled: the stone it
grew from half-buried in the soil, a tapered stem with two growth flushes of drooping, keeled leaves and a limp
bronze flush of new leaves on top, plus one fallen dry leaf. Objects: mango_plant (pot) and its child
mango_plant_leaves (soil, stone, stem, leaves). Leaves carry a second UV map `leaf` (u across, v along).
"""
import math
import os
import random
import sys

import bmesh
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import props_lib as pl  # noqa: E402

NAME = "mango_plant"
POT_SCALE = 0.72
SEED = 20181207
GOLDEN = math.radians(137.5)


def leaf_halfwidth(t, width):
    a, b = 0.62, 1.0
    peak = (a / (a + b)) ** a * (b / (a + b)) ** b
    return width * (t ** a) * ((1 - t) ** b) / peak


def add_leaf(builder, leaf_uv, base, direction_az, pitch_deg, length, width, droop, mat, petiole_mat, rng,
             fold=0.22, twist_deg=0.0, rows=14, petiole=0.025, hang=False):
    """One leaf: petiole from `base`, then a lance-shaped keeled blade that arches down along its length."""
    az = math.radians(direction_az)
    pitch = math.radians(pitch_deg)
    fwd = Vector((math.cos(az) * math.cos(pitch), math.sin(az) * math.cos(pitch), math.sin(pitch)))
    side = Vector((-math.sin(az), math.cos(az), 0.0))
    up = fwd.cross(side).normalized()
    pet_end = base + fwd * petiole + Vector((0, 0, -petiole * 0.15))
    builder.tube([base, base.lerp(pet_end, 0.5) + up * 0.002, pet_end], 0.0011, sides=4, mat=petiole_mat, cap=False)

    across = (-1.0, -0.5, 0.0, 0.5, 1.0)
    wave_phase = rng.uniform(0, math.tau)
    rows_v = []
    for i in range(rows + 1):
        t = i / rows
        x = length * t
        z = -droop * length * t * t
        if hang:
            z -= 0.35 * length * t
        hw = leaf_halfwidth(max(t, 0.02), width) if i < rows else 0.0
        tw = math.radians(twist_deg) * t
        row = []
        for s in across:
            y = hw * s
            lift = fold * abs(y) + 0.0018 * math.sin(t * math.pi * 5 + wave_phase) * abs(s)
            yr = y * math.cos(tw) - lift * math.sin(tw)
            zr = y * math.sin(tw) + lift * math.cos(tw)
            row.append(pet_end + fwd * x + side * yr + up * (z + zr))
        rows_v.append(row)
    bm = builder.bm
    before = set(bm.faces)
    verts = [[bm.verts.new(p) for p in row] for row in rows_v]
    for i in range(rows):
        for j in range(len(across) - 1):
            f = bm.faces.new((verts[i][j], verts[i][j + 1], verts[i + 1][j + 1], verts[i + 1][j]))
            for loop in f.loops:
                ii = next(r for r in range(rows + 1) if loop.vert in verts[r])
                jj = verts[ii].index(loop.vert)
                loop[leaf_uv].uv = ((across[jj] + 1) / 2, ii / rows)
    tip = verts[rows]
    bmesh.ops.remove_doubles(bm, verts=tip, dist=1e-6)
    builder._wrap(before, None, mat)


def soil_disc(builder, radius, z, mat, rng, rings=6, segments=36):
    bm = builder.bm
    before = set(bm.faces)
    centre = bm.verts.new((0, 0, z + 0.006))
    prev = None
    ring_verts = []
    for r_i in range(1, rings + 1):
        rr = radius * r_i / rings
        ring = []
        for s in range(segments):
            a = math.tau * s / segments
            bump = 0.006 * (1 - (r_i / rings) ** 2) + rng.uniform(-0.0012, 0.0012)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z + bump)))
        ring_verts.append(ring)
    first = ring_verts[0]
    for s in range(segments):
        bm.faces.new((centre, first[s], first[(s + 1) % segments]))
    for r_i in range(rings - 1):
        a_ring, b_ring = ring_verts[r_i], ring_verts[r_i + 1]
        for s in range(segments):
            s1 = (s + 1) % segments
            bm.faces.new((a_ring[s], b_ring[s], b_ring[s1], a_ring[s1]))
    builder._wrap(before, None, mat)


def pot_inner_radius(pot, z):
    """Smallest radius of pot vertices in a thin band at height z (the inner wall)."""
    band = [v.co for v in pot.data.vertices if abs(v.co.z - z) < 0.006]
    return min(math.hypot(c.x, c.y) for c in band)


def main():
    rng = random.Random(SEED)
    pl.reset_scene()
    col = pl.root_collection(NAME)
    pot_objs = [o for o in pl.import_gltf(pl.polyhaven_gltf("planter_pot_clay", "2k"), col) if o.type == "MESH"]
    pot = pl.join(pot_objs, NAME) if len(pot_objs) > 1 else pot_objs[0]
    pot.name = NAME
    pl.apply_transforms(pot)
    pot.data.transform(Matrix.Diagonal((POT_SCALE, POT_SCALE, POT_SCALE, 1.0)))
    pl.set_origin_base(pot)
    pot.location = (0, 0, 0)
    pot_h = max(v.co.z for v in pot.data.vertices)

    soil_mat = soil_material()
    pebble_mat = pl.surface("pebble", (0.11, 0.095, 0.08), 0.7, micro_bump=(900, 0.2), color_var=0.25)
    stone_mat = pl.surface("mango_stone", (0.26, 0.19, 0.10), 0.9, micro_bump=(260, 0.9), color_var=0.2,
                           grime=0.7, edge_wear=0.25, edge_color=(0.34, 0.26, 0.15))
    stem_mat = pl.surface("mango_stem", (0.075, 0.06, 0.03), 0.55, micro_bump=(600, 0.3), color_var=0.25)
    leaf_mat = leaf_material("mango_leaf", (0.018, 0.050, 0.012), (0.15, 0.19, 0.055), 0.5)
    young_mat = leaf_material("mango_leaf_young", (0.12, 0.035, 0.018), (0.22, 0.12, 0.06), 0.5)
    dry_mat = leaf_material("mango_leaf_dry", (0.16, 0.09, 0.035), (0.24, 0.16, 0.07), 0.8)

    plant = pl.Builder(f"{NAME}_leaves")
    plant.bm.loops.layers.uv.new("UVMap")
    leaf_uv = plant.bm.loops.layers.uv.new("leaf")
    soil_z = pot_h * 0.86
    r_in = pot_inner_radius(pot, soil_z) + 0.0015
    soil_disc(plant, r_in, soil_z, soil_mat, rng)
    for _ in range(9):
        a, rr = rng.uniform(0, math.tau), rng.uniform(0.02, r_in - 0.012)
        sz = rng.uniform(0.004, 0.009)
        plant.lathe([(0, -sz * 0.5), (sz, -sz * 0.2), (sz * 0.9, sz * 0.25), (0, sz * 0.45)], segments=6,
                    loc=(rr * math.cos(a), rr * math.sin(a), soil_z + 0.001), rot=(rng.uniform(-20, 20), 0, rng.uniform(0, 90)),
                    mat=pebble_mat, phase=rng.uniform(0, 1))

    # the stone: flattened, lying a little tilted, half below the soil
    stone_prof = [(0.0, -0.013)] + [(0.034 * math.sin(math.pi * k / 10) * (1 - 0.15 * math.cos(math.pi * k / 10)),
                                     -0.013 * math.cos(math.pi * k / 10)) for k in range(1, 10)] + [(0.0, 0.013)]
    stone_faces = plant.lathe(stone_prof, segments=16, mat=stone_mat)
    place = (pl.xform(loc=(0.012, -0.004, soil_z - 0.003), rot=(8, -6, 25)) @
             Matrix.Diagonal((1.0, 0.62, 0.85, 1.0)))
    bmesh.ops.transform(plant.bm, matrix=place, verts=list({v for f in stone_faces for v in f.verts}))

    stem_base = Vector((0.004, 0.006, soil_z + 0.004))
    path = [stem_base]
    lean = Vector((0.006, -0.004, 0))
    height = 0.255
    for k in range(1, 15):
        t = k / 14
        wobble = Vector((0.004 * math.sin(t * 5.1), 0.003 * math.cos(t * 4.3), 0))
        path.append(stem_base + Vector((0, 0, height * t)) + lean * t * t + wobble)
    plant.tube(path, 0.0045, sides=7, mat=stem_mat, radius_fn=lambda t: 0.0046 - 0.0022 * t)
    plant.lathe([(0.0, 0.0), (0.0032, 0.004), (0.0022, 0.011), (0.0, 0.016)], segments=7,
                loc=tuple(path[-1]), mat=young_mat)

    def stem_point(h):
        t = h / height
        i = min(int(t * 14), 13)
        return path[i].lerp(path[i + 1], t * 14 - i)

    az = rng.uniform(0, 360)
    # first flush: older, larger leaves; second: a little smaller; top: limp bronze young leaves
    flushes = [(0.112, 7, (0.14, 0.17), (0.035, 0.043), (16, 30), 0.55, leaf_mat, False),
               (0.205, 6, (0.115, 0.145), (0.031, 0.038), (20, 34), 0.5, leaf_mat, False),
               (0.250, 4, (0.08, 0.11), (0.019, 0.025), (-62, -48), 0.25, young_mat, True)]
    for h, count, lens, widths, pitches, droop, mat, hang in flushes:
        for n in range(count):
            az += math.degrees(GOLDEN) + rng.uniform(-12, 12)
            base = stem_point(h + rng.uniform(-0.012, 0.004))
            add_leaf(plant, leaf_uv, base, az, rng.uniform(*pitches), rng.uniform(*lens), rng.uniform(*widths),
                     droop * rng.uniform(0.8, 1.2), mat, stem_mat, rng, fold=rng.uniform(0.15, 0.3),
                     twist_deg=rng.uniform(-25, 25), hang=hang, petiole=rng.uniform(0.018, 0.032))

    dry_base = Vector((-0.045, 0.035, soil_z + 0.006))
    add_leaf(plant, leaf_uv, dry_base, -35, -2, 0.085, 0.022, -0.05, dry_mat, dry_mat, rng, fold=0.55,
             twist_deg=30, petiole=0.008)
    leaves = plant.finish(col, smooth_angle=70, seam_angle=60)
    leaves.data.uv_layers.active = leaves.data.uv_layers["UVMap"]
    pl.parent_keep_transform(leaves, pot)

    pot["source"] = "Poly Haven planter_pot_clay (CC0), scaled to 72 %"
    leaves["source"] = "made for this site"
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


def soil_material():
    """Dark potting mix with clumps and white perlite specks."""
    mat, k = pl.new_material("potting_soil")
    obj = k.coords("Object")
    clumps = k.node("ShaderNodeTexVoronoi", inputs={"Vector": obj, "Scale": 180.0, "Randomness": 1.0},
                    feature="SMOOTH_F1")
    specks = k.node("ShaderNodeTexVoronoi", inputs={"Vector": obj, "Scale": 260.0}, feature="F1")
    perlite = k.math("MULTIPLY", k.map_range(specks.outputs["Distance"], 0.16, 0.10),
                     k.map_range(specks.outputs["Color"], 0.82, 0.86, smooth=False))
    base = k.mix_color(k.noise(obj, 40.0), (0.022, 0.015, 0.010, 1.0), (0.045, 0.032, 0.021, 1.0))
    color = k.mix_color(perlite, base, (0.62, 0.60, 0.56, 1.0))
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.7, "Distance": 0.0015,
                                           "Height": clumps.outputs["Distance"]})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.95,
                                                      "Normal": bump.outputs["Normal"]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs["BSDF"])
    return mat


def leaf_material(name, base, vein_color, roughness):
    """Waxy leaf: pale midrib and lateral veins from the `leaf` UV, browned tips, per-leaf colour variation."""
    mat, k = pl.new_material(name)
    uv = k.node("ShaderNodeUVMap", uv_map="leaf").outputs["UV"]
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": uv})
    u, v = sep.outputs["X"], sep.outputs["Y"]
    off = k.math("ABSOLUTE", k.math("SUBTRACT", u, 0.5))
    midrib = k.map_range(off, 0.035, 0.0)
    vein_coord = k.math("ADD", k.math("MULTIPLY", v, 26.0), k.math("MULTIPLY", off, 17.0))
    veins = k.math("POWER", k.math("ABSOLUTE", k.math("SINE", k.math("MULTIPLY", vein_coord, math.pi))), 18.0)
    veins = k.math("MULTIPLY", veins, k.map_range(off, 0.47, 0.30))
    veins = k.math("MULTIPLY", veins, 0.35)
    geo = k.node("ShaderNodeNewGeometry")
    rand = geo.outputs["Random Per Island"]
    hsv = k.node("ShaderNodeHueSaturation", inputs={"Color": base + (1.0,),
                                                     "Hue": k.map_range(rand, 0, 1, 0.47, 0.53, smooth=False),
                                                     "Value": k.map_range(rand, 0, 1, 0.75, 1.25, smooth=False)})
    color = hsv.outputs["Color"]
    color = k.mix_color(k.math("MAXIMUM", k.math("MULTIPLY", midrib, 0.8), veins), color, vein_color + (1.0,))
    tip = k.math("MULTIPLY", k.map_range(v, 0.86, 0.99),
                 k.map_range(k.noise(k.coords("Object"), 60.0), 0.35, 0.65))
    tip = k.math("MULTIPLY", tip, k.map_range(rand, 0.55, 0.75))
    color = k.mix_color(tip, color, (0.22, 0.13, 0.05, 1.0))
    edge = k.math("MULTIPLY", k.map_range(off, 0.42, 0.5), 0.5)
    color = k.mix_color(edge, color, (0.16, 0.17, 0.05, 1.0))
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.25, "Distance": 0.0004,
                                           "Height": k.math("ADD", k.math("MULTIPLY", midrib, -1.0), veins)})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": roughness,
                                                      "Normal": bump.outputs["Normal"], "Coat Weight": 0.06,
                                                      "Coat Roughness": 0.35, "Specular IOR Level": 0.32})
    trans = k.node("ShaderNodeBsdfTranslucent", inputs={"Color": k.mix_color(0.6, color, (0.25, 0.4, 0.05, 1.0))})
    mix = k.node("ShaderNodeMixShader", inputs={"Fac": 0.12, "Shader": bsdf.outputs["BSDF"],
                                               "Shader_001": trans.outputs["BSDF"]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", mix.outputs["Shader"])
    return mat


main()
