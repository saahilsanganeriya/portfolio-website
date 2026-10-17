"""coffee_mug: a speckled stoneware mug of black coffee, 82 mm across and 96 mm tall, a D handle on the right.

A thrown shape: a slightly flared wall, a rolled rim, an unglazed foot ring; cream glaze with iron speckle, breaking
to brown where it thins on the rim. The coffee's surface sits 14 mm below the rim, with a lighter ring where it
meets the wall. Objects: coffee_mug (the mug), its child coffee_mug_coffee (the coffee's surface) and the empty
coffee_steam just over the coffee, where the site's steam starts (extras width_m and height_m: the steam's size).
Faces -Y, origin at the base.
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

NAME = "coffee_mug"
RIM_Z = 0.0955
COFFEE_Z = 0.0815
STEAM_W, STEAM_H = 0.07, 0.22

# Outside from the centre of the base up over the rim and down the inside, (radius, height) in metres.
PROFILE = [
    (0.0, 0.0030), (0.0270, 0.0026), (0.0312, 0.0014), (0.0330, 0.0001), (0.0350, 0.0000), (0.0372, 0.0010),
    (0.0386, 0.0034), (0.0396, 0.0080), (0.0402, 0.0200), (0.0406, 0.0450), (0.0410, 0.0700), (0.0413, 0.0880),
    (0.0413, 0.0925), (0.0409, 0.0948), (0.0400, RIM_Z), (0.0389, 0.0952), (0.0381, 0.0935), (0.0377, 0.0900),
    (0.0373, 0.0700), (0.0369, 0.0450), (0.0362, 0.0220), (0.0345, 0.0120), (0.0300, 0.0088), (0.0200, 0.0080),
    (0.0, 0.0078),
]


def srgb(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def wall_radius(z, inside=False):
    pts = PROFILE[15:] if inside else PROFILE[:15]
    pts = sorted(pts, key=lambda p: p[1])
    for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return pts[-1][0]


def handle_path():
    """The handle's centre line: a D on the +X side, its ends sunk into the wall."""
    top, bottom = 0.079, 0.026
    key = [(wall_radius(top) - 0.004, top + 0.001), (wall_radius(top) + 0.010, top + 0.0015),
           (wall_radius(top) + 0.021, top - 0.004), (wall_radius(0.060) + 0.027, 0.058),
           (wall_radius(0.045) + 0.027, 0.044), (wall_radius(bottom) + 0.021, bottom + 0.004),
           (wall_radius(bottom) + 0.009, bottom - 0.0005), (wall_radius(bottom) - 0.004, bottom - 0.001)]
    pts = [Vector((x, 0.0, z)) for x, z in key]
    out = []
    p = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(p) - 2):
        for s in range(6):
            t = s / 6
            a, b, c, d = p[i - 1], p[i], p[i + 1], p[i + 2]
            out.append(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t +
                              (-a + 3 * b - 3 * c + d) * t ** 3))
    out.append(pts[-1])
    return out


def oval_sweep(builder, points, width, thickness, sides=14, mat=None):
    """Sweep an oval (`width` across the loop's plane, `thickness` in it) along a path in the XZ plane."""
    bm = builder.bm
    before = set(bm.faces)
    rings = []
    for k, p in enumerate(points):
        a = points[max(k - 1, 0)]
        b = points[min(k + 1, len(points) - 1)]
        t = (b - a).normalized()
        inplane = Vector((0, 1, 0)).cross(t).normalized()
        taper = 1.0 + 0.18 * (1 - min(k, len(points) - 1 - k) / 6) if min(k, len(points) - 1 - k) < 6 else 1.0
        ring = []
        for s in range(sides):
            ang = 2 * math.pi * s / sides
            ring.append(bm.verts.new(p + Vector((0, 1, 0)) * math.cos(ang) * width / 2 * taper +
                                     inplane * math.sin(ang) * thickness / 2 * taper))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for s in range(sides):
            s1 = (s + 1) % sides
            bm.faces.new((rings[k][s], rings[k][s1], rings[k + 1][s1], rings[k + 1][s]))
        # A seam down the inside of the D, where it faces the mug, so the closed sweep unwraps as one strip.
        bm.edges.get((rings[k][sides // 4], rings[k + 1][sides // 4])).seam = True
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        f = bm.faces.new(list(reversed(ring)) if flip else ring)
    new = [f for f in bm.faces if f not in before]
    bmesh.ops.recalc_face_normals(bm, faces=new)
    return builder._wrap(before, None, mat)


def glaze_material():
    """Cream glaze with iron speckle, browner where it thins on the rim; the foot ring left as raw clay."""
    mat, k = pl.new_material("coffee_mug_glaze")
    bsdf = k.node("ShaderNodeBsdfPrincipled")
    out = k.node("ShaderNodeOutputMaterial")
    obj = k.coords("Object")
    pos = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    z = pos.outputs["Z"]
    cream = (0.78, 0.72, 0.60, 1.0)
    base = k.mix_color(k.map_range(k.noise(obj, 22.0, detail=3.0), 0.3, 0.7), cream, (0.72, 0.65, 0.52, 1.0))
    speck = k.map_range(k.noise(obj, 520.0, detail=1.0, roughness=0.3), 0.69, 0.73)
    fine = k.map_range(k.noise(obj, 1400.0, detail=1.0), 0.72, 0.75)
    base = k.mix_color(k.math("MAXIMUM", speck, k.math("MULTIPLY", fine, 0.6)), base, (0.16, 0.10, 0.06, 1.0))
    rim = k.map_range(z, RIM_Z - 0.0035, RIM_Z - 0.0002)
    base = k.mix_color(k.math("MULTIPLY", rim, 0.75), base, (0.42, 0.28, 0.17, 1.0))
    foot = k.map_range(z, 0.0042, 0.0026)
    clay = k.mix_color(k.noise(obj, 300.0, detail=4.0), (0.48, 0.38, 0.27, 1.0), (0.56, 0.45, 0.33, 1.0))
    color = k.mix_color(foot, base, clay)
    rough = k.mix_float(foot, k.math("ADD", 0.14, k.math("MULTIPLY", speck, 0.2)), 0.82)
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.08, "Distance": 0.0006,
                                           "Height": k.math("ADD", k.noise(obj, 160.0, detail=3.0),
                                                            k.math("MULTIPLY", speck, -0.5))})
    for key, value in (("Base Color", color), ("Roughness", rough), ("Coat Weight", k.math("SUBTRACT", 1.0, foot)),
                       ("Coat Roughness", 0.06), ("Normal", bump.outputs["Normal"]), ("Specular IOR Level", 0.55)):
        k.set(bsdf, key, value)
    k.set(out, "Surface", bsdf.outputs["BSDF"])
    return mat


def coffee_material():
    """Black coffee: near-black brown, glossy, a lighter ring where it climbs the wall, faint drifting oil."""
    mat, k = pl.new_material("coffee_mug_coffee")
    bsdf = k.node("ShaderNodeBsdfPrincipled")
    out = k.node("ShaderNodeOutputMaterial")
    obj = k.coords("Object")
    pos = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    radius = k.node("ShaderNodeVectorMath", operation="LENGTH")
    k.set(radius, "Vector", k.node("ShaderNodeCombineXYZ", inputs={"X": pos.outputs["X"], "Y": pos.outputs["Y"]}).outputs[0])
    ring = k.map_range(radius.outputs["Value"], 0.0335, 0.0368)
    base = k.mix_color(k.map_range(k.noise(obj, 60.0, detail=2.0), 0.35, 0.65), (0.030, 0.014, 0.006, 1.0),
                       (0.045, 0.022, 0.010, 1.0))
    base = k.mix_color(ring, base, (0.16, 0.085, 0.035, 1.0))
    k.set(bsdf, "Base Color", base)
    k.set(bsdf, "Roughness", 0.04)
    k.set(bsdf, "Specular IOR Level", 0.6)
    k.set(out, "Surface", bsdf.outputs["BSDF"])
    return mat


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    glaze = glaze_material()
    b = pl.Builder(NAME)
    b.lathe(PROFILE, segments=64, mat=glaze, cap_start=False, cap_end=False)
    oval_sweep(b, handle_path(), 0.0142, 0.0090, sides=14, mat=glaze)
    mug = b.finish(col, smooth_angle=55)
    mug["source"] = "made for this site"

    c = pl.Builder("coffee_mug_coffee")
    r = wall_radius(COFFEE_Z, inside=True) - 0.0002
    c.lathe([(r, 0.0007), (r * 0.85, 0.0), (0.0, 0.0)], segments=64, mat=coffee_material(), cap_start=False,
            cap_end=False)
    coffee = c.finish(col, smooth_angle=60)
    coffee.location = (0, 0, COFFEE_Z - 0.0007)
    coffee["source"] = "made for this site"
    pl.parent_keep_transform(coffee, mug)
    steam = pl.empty("coffee_steam", col, (0.0, 0.0, COFFEE_Z + 0.004), size=0.03, parent=mug,
                     display="SINGLE_ARROW")
    steam["width_m"] = STEAM_W
    steam["height_m"] = STEAM_H
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
