"""mango_plant: a grafted dwarf mango tree in a weathered terracotta pot, about 52 cm tall, with one mango.

The pot is Poly Haven "Planter Pot Clay" (CC0) scaled to a 19 cm pot. The tree is modelled: a short trunk with
the graft swelling, four branches each ending in a whorl of long lance-shaped leaves (one a limp bronze flush of
new leaves), and a ripening mango hanging on its stalk toward the room. Objects: mango_plant (pot), its children
mango_plant_leaves (soil, trunk, branches, leaves, stalk) and mango_fruit. Leaves carry a second UV map `leaf`
(u across, v along). Nothing reaches more than 9 cm behind the pot centre, where the window sash stands.
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
TRUNK_H = 0.17
# Branches from the fork: (azimuth, length, rise) in degrees and metres; azimuth 270 faces the room (-Y).
BRANCHES = [(285, 0.13, 30), (35, 0.10, 54), (150, 0.11, 46), (220, 0.085, 64)]
FRUIT_BRANCH, YOUNG_BRANCH = 0, 3
STALK_DROP = 0.085
FRUIT_L, FRUIT_R = 0.100, 0.036
FRUIT_FACING_DEG = -70
BACK_SOFT, BACK_LIMIT = 0.055, 0.088


def leaf_halfwidth(t, width):
    """Lanceolate: widest about a third of the way up, narrowing to a long drawn-out tip."""
    a, b = 0.7, 1.4
    peak = (a / (a + b)) ** a * (b / (a + b)) ** b
    return width * (t ** a) * ((1 - t) ** b) / peak


def add_leaf(builder, leaf_uv, base, direction_az, pitch_deg, length, width, droop, mat, petiole_mat, rng,
             fold=0.22, twist_deg=0.0, rows=12, petiole=0.025, hang=False):
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
            lift = fold * abs(y) - 0.9 * fold * hw * abs(s) ** 3 + 0.0016 * math.sin(t * math.pi * 5 + wave_phase) * abs(s)
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


def soil_disc(builder, radius, z, mat, rng, rings=9, segments=40):
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
            bump = 0.005 * (1 - (r_i / rings) ** 2) + rng.uniform(-0.0022, 0.0022) * (1 if r_i < rings else 0.3)
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
    bark_mat = pl.surface("mango_bark", (0.085, 0.07, 0.05), 0.75, micro_bump=(500, 0.6), color_var=0.25,
                          grime=0.4)
    stem_mat = pl.surface("mango_stem", (0.075, 0.06, 0.03), 0.55, micro_bump=(600, 0.3), color_var=0.25)
    leaf_mat = leaf_material("mango_leaf", (0.022, 0.058, 0.015), (0.16, 0.20, 0.06), 0.50)
    young_mat = leaf_material("mango_leaf_young", (0.12, 0.035, 0.018), (0.22, 0.12, 0.06), 0.5)
    dry_mat = leaf_material("mango_leaf_dry", (0.16, 0.09, 0.035), (0.24, 0.16, 0.07), 0.8)

    plant = pl.Builder(f"{NAME}_leaves")
    plant.bm.loops.layers.uv.new("UVMap")
    leaf_uv = plant.bm.loops.layers.uv.new("leaf")
    soil_z = pot_h - 0.011
    r_in = pot_inner_radius(pot, soil_z) + 0.0015
    soil_disc(plant, r_in, soil_z, soil_mat, rng)
    for _ in range(9):
        a, rr = rng.uniform(0, math.tau), rng.uniform(0.02, r_in - 0.012)
        sz = rng.uniform(0.004, 0.009)
        plant.lathe([(0, -sz * 0.5), (sz, -sz * 0.2), (sz * 0.9, sz * 0.25), (0, sz * 0.45)], segments=6,
                    loc=(rr * math.cos(a), rr * math.sin(a), soil_z + 0.001), rot=(rng.uniform(-20, 20), 0, rng.uniform(0, 90)),
                    mat=pebble_mat, phase=rng.uniform(0, 1))

    # A grafted dwarf tree: a short trunk with the graft swelling, forking into four branches; the fruiting
    # branch reaches toward the room so its mango hangs in view.
    base = Vector((0.004, 0.004, soil_z - 0.004))
    trunk = [base + Vector((0.006 * math.sin(t * 3.0), -0.004 * math.sin(t * 2.2), TRUNK_H * t))
             for t in (k / 10 for k in range(11))]
    plant.tube(trunk, 0.008, sides=9, mat=bark_mat,
               radius_fn=lambda t: 0.0088 - 0.0024 * t + 0.0016 * math.exp(-((t - 0.22) / 0.06) ** 2))
    fork = trunk[-1]
    tips = []
    for az_deg, length, rise_deg in BRANCHES:
        az, rise = math.radians(az_deg), math.radians(rise_deg)
        out = Vector((math.cos(az) * math.cos(rise), math.sin(az) * math.cos(rise), math.sin(rise)))
        path = [fork]
        for k in range(1, 9):
            t = k / 8
            bend = Vector((0, 0, 0.35 * length * t * t * (1 - math.sin(rise))))
            path.append(fork + out * length * t + bend)
        plant.tube(path, 0.005, sides=7, mat=stem_mat, radius_fn=lambda t: 0.0056 - 0.0026 * t)
        tips.append((path, az_deg))

    az = rng.uniform(0, 360)
    for idx, (path, branch_az) in enumerate(tips):
        tip = path[-1]
        # The flush at the tip: a whorl of long lance-shaped leaves, the upper ones rising, the lower drooping.
        young = idx == YOUNG_BRANCH
        count = 6 if young else 10
        for n in range(count):
            az += math.degrees(GOLDEN) + rng.uniform(-10, 10)
            h = rng.uniform(-0.03, 0.0)
            pos = tip + (path[-1] - path[-3]).normalized() * h
            if young:
                add_leaf(plant, leaf_uv, pos, az, rng.uniform(-70, -55), rng.uniform(0.09, 0.12),
                         rng.uniform(0.010, 0.013), 0.25, young_mat, stem_mat, rng, fold=0.3, twist_deg=rng.uniform(-20, 20),
                         hang=True, petiole=0.014)
            else:
                add_leaf(plant, leaf_uv, pos, az, rng.uniform(-6, 36), rng.uniform(0.13, 0.18),
                         rng.uniform(0.022, 0.027), rng.uniform(0.35, 0.55), leaf_mat, stem_mat, rng,
                         fold=rng.uniform(0.25, 0.4), twist_deg=rng.uniform(-25, 25), petiole=rng.uniform(0.018, 0.03))
        # An older flush lower on the branch fills the crown.
        for n in range(4):
            az += math.degrees(GOLDEN) + rng.uniform(-15, 15)
            pos = path[4] + Vector((0, 0, rng.uniform(-0.01, 0.01)))
            add_leaf(plant, leaf_uv, pos, az, rng.uniform(-14, 14), rng.uniform(0.12, 0.16), rng.uniform(0.020, 0.024),
                     rng.uniform(0.45, 0.65), leaf_mat, stem_mat, rng, fold=rng.uniform(0.25, 0.4),
                     twist_deg=rng.uniform(-25, 25), petiole=rng.uniform(0.016, 0.026))

    # The fruit's stalk leaves the fruiting branch under its leaves and hangs, bending, toward the room.
    path, _ = tips[FRUIT_BRANCH]
    stalk_top = path[6]
    stalk = [stalk_top]
    for k in range(1, 9):
        t = k / 8
        stalk.append(stalk_top + Vector((0.010 * t, -0.022 * t, -STALK_DROP * t ** 1.4)))
    plant.tube(stalk, 0.0017, sides=6, mat=stem_mat, radius_fn=lambda t: 0.0019 - 0.0004 * t)

    for dry_base, dry_az in ((Vector((-0.050, 0.030, soil_z + 0.006)), -35), (Vector((0.040, -0.045, soil_z + 0.005)), 140)):
        add_leaf(plant, leaf_uv, dry_base, dry_az, -2, 0.11, 0.013, -0.05, dry_mat, dry_mat, rng, fold=0.55,
                 twist_deg=30, petiole=0.008)
    keep_clear_of_window(plant.bm, pot_h + 0.01)
    leaves = plant.finish(col, smooth_angle=70, seam_angle=60)
    leaves.data.uv_layers.active = leaves.data.uv_layers["UVMap"]
    pl.parent_keep_transform(leaves, pot)

    fruit = build_fruit(col, stalk[-1])
    pl.parent_keep_transform(fruit, pot)

    pot["source"] = "Poly Haven planter_pot_clay (CC0), scaled to 72 %"
    leaves["source"] = "made for this site"
    fruit["source"] = "made for this site"
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


def keep_clear_of_window(bm, above_z):
    """Fold back leaves that reach past BACK_LIMIT (the sash behind the pot on the sill), as a plant pressed
    against the glass would."""
    for v in bm.verts:
        if v.co.z > above_z and v.co.y > BACK_SOFT:
            v.co.y = min(BACK_SOFT + (v.co.y - BACK_SOFT) * 0.35, BACK_LIMIT)


def build_fruit(col, stalk_end):
    """One ripening mango: a lathe body flattened and curved into the kidney shape, with the beak near its tip."""
    mat = mango_skin_material()
    b = pl.Builder("mango_fruit")
    prof = []
    for k in range(17):
        t = k / 16
        r = FRUIT_R * math.sin(math.pi * min(t, 0.999) ** 0.92) ** 0.72
        prof.append((max(r, 0.0), -FRUIT_L * t))
    prof[0] = (0.0, 0.0)
    prof[-1] = (0.0, -FRUIT_L)
    prof.reverse()
    faces = b.lathe(prof, segments=24, mat=mat)
    for v in {v for f in faces for v in f.verts}:
        t = -v.co.z / FRUIT_L
        v.co.y *= 0.84
        v.co.x += 0.013 * math.sin(math.pi * t) - 0.004
        v.co.x -= 0.005 * math.exp(-((t - 0.86) / 0.07) ** 2) * (1 if v.co.x < 0 else 0)
    b.cylinder(0.0024, 0.006, segments=8, loc=(0, 0, -0.001), mat=mat)
    fruit = b.finish(col, smooth_angle=80)
    fruit.data.transform(pl.xform(rot=(0, 8, FRUIT_FACING_DEG)))
    fruit.location = stalk_end
    return fruit


def mango_skin_material():
    """Waxy skin ripening from green at the stalk to yellow, with a red blush on one cheek and pale lenticels."""
    mat, k = pl.new_material("mango_skin")
    obj = k.coords("Object")
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    ripe = k.map_range(sep.outputs["Z"], -0.010, -0.075)
    color = k.mix_color(ripe, (0.13, 0.20, 0.03, 1.0), (0.62, 0.42, 0.04, 1.0))
    cheek = k.math("MULTIPLY", k.map_range(sep.outputs["X"], 0.004, 0.034), k.map_range(sep.outputs["Z"], -0.005, -0.045))
    cheek = k.math("MULTIPLY", cheek, k.map_range(k.noise(obj, 60.0, detail=3.0), 0.3, 0.6, 0.6, 1.0))
    color = k.mix_color(cheek, color, (0.45, 0.06, 0.03, 1.0))
    dots = k.node("ShaderNodeTexVoronoi", inputs={"Vector": obj, "Scale": 420.0}, feature="F1")
    lenticel = k.math("MULTIPLY", k.map_range(dots.outputs["Distance"], 0.12, 0.05), 0.35)
    color = k.mix_color(lenticel, color, (0.75, 0.66, 0.35, 1.0))
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.08, "Distance": 0.0004,
                                           "Height": k.noise(obj, 300.0, detail=4.0)})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.36,
                                                      "Normal": bump.outputs["Normal"], "Coat Weight": 0.25,
                                                      "Coat Roughness": 0.25, "Subsurface Weight": 0.08,
                                                      "Subsurface Radius": (0.004, 0.003, 0.001)})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs["BSDF"])
    return mat


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
