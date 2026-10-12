"""ceiling_fan: a 1930s-style ceiling fan, 1.14 m across, antique brass with five walnut blades, unbranded.

Hangs from its mount point, so its origin is the top of the canopy (z = 0) and everything is below it. Objects:
ceiling_fan (canopy, downrod, motor housing, switch cup, pull chain) and its child ceiling_fan_blades (five
pitched blades on brass irons) whose origin is the hub, so the site spins it about its own +Z (glTF +Y).
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

NAME = "ceiling_fan"
HUB_Z = -0.395
BLADES, PITCH_DEG = 5, 12.0
BLADE_R0, BLADE_R1 = 0.175, 0.57
CANOPY = [(0.0, 0.0), (0.077, 0.0), (0.077, -0.005), (0.073, -0.014), (0.062, -0.033), (0.045, -0.052),
          (0.030, -0.063), (0.019, -0.070), (0.0, -0.071)]
HOUSING = [(0.0, -0.282), (0.024, -0.284), (0.041, -0.291), (0.074, -0.301), (0.097, -0.316), (0.106, -0.333),
           (0.106, -0.372), (0.100, -0.382), (0.091, -0.387), (0.091, -0.401), (0.080, -0.404), (0.060, -0.408),
           (0.046, -0.410)]
SWITCH_CUP = [(0.046, -0.410), (0.050, -0.418), (0.048, -0.436), (0.037, -0.451), (0.021, -0.461), (0.011, -0.467),
              (0.006, -0.475), (0.010, -0.481), (0.007, -0.488), (0.0, -0.491)]


def strap(builder, path, width_fn, thickness, mat):
    """A flat brass strap swept along a polyline in a vertical plane; width across, thickness up."""
    bm = builder.bm
    before = set(bm.faces)
    pts = [Vector(p) for p in path]
    rings = []
    for k, p in enumerate(pts):
        a, b = pts[max(k - 1, 0)], pts[min(k + 1, len(pts) - 1)]
        tangent = (b - a).normalized()
        across = tangent.cross(Vector((0, 0, 1))).normalized()
        up = across.cross(tangent).normalized()
        w = width_fn(k / (len(pts) - 1)) / 2
        h = thickness / 2
        rings.append([bm.verts.new(p + across * sx * w + up * sz * h) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for k in range(len(rings) - 1):
        for s in range(4):
            s1 = (s + 1) % 4
            bm.faces.new((rings[k][s], rings[k][s1], rings[k + 1][s1], rings[k + 1][s]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    faces = [f for f in bm.faces if f not in before]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return builder._wrap(before, None, mat)


def blade_outline():
    """Paddle outline in the XZ plane: x along the radius, z across; square root, rounded tip."""
    length = BLADE_R1 - BLADE_R0
    root_w, tip_w = 0.112, 0.132
    pts = [(0.0, -root_w / 2)]
    for i in range(1, 7):
        t = i / 7 * 0.82
        pts.append((length * t, -(root_w + (tip_w - root_w) * t / 0.82) / 2))
    cx = length * 0.82
    for i in range(13):
        a = -math.pi / 2 + math.pi * i / 12
        r_along, r_across = length * 0.18, tip_w / 2
        pts.append((cx + r_along * math.cos(a), r_across * math.sin(a)))
    for i in range(6, 0, -1):
        t = i / 7 * 0.82
        pts.append((length * t, (root_w + (tip_w - root_w) * t / 0.82) / 2))
    pts.append((0.0, root_w / 2))
    return pl.round_polygon(pts, [0.012] + [0.0] * (len(pts) - 2) + [0.012], segments=3)


def main():
    pl.reset_scene()
    col = pl.root_collection(NAME)
    brass = pl.surface("fan_brass", (0.47, 0.31, 0.13), 0.32, metallic=1.0, micro_bump=(1200, 0.04),
                       edge_wear=0.45, edge_color=(0.86, 0.66, 0.36), edge_roughness=0.18, grime=0.9, dust=0.5,
                       dust_color=(0.34, 0.31, 0.27), scratches=0.12, color_var=0.10)
    dark = pl.surface("fan_brass_dark", (0.20, 0.13, 0.06), 0.40, metallic=1.0, grime=0.6, dust=0.6, color_var=0.08)
    wood = pl.ambientcg("Wood051")
    walnut = pl.surface("fan_walnut", (0.30, 0.18, 0.10), 0.45, color_tex=wood["Color"], tint=(0.62, 0.44, 0.32),
                        rough_tex=wood["Roughness"], rough_amount=0.2, tile=0.45, coat=0.35, coat_roughness=0.2,
                        edge_wear=0.25, edge_color=(0.42, 0.28, 0.17), dust=0.3, dust_color=(0.36, 0.33, 0.29),
                        color_var=0.10)
    chain = pl.surface("fan_chain", (0.60, 0.44, 0.22), 0.35, metallic=1.0, color_var=0.05)

    b = pl.Builder(NAME)
    b.lathe(CANOPY, segments=48, mat=brass)
    b.cylinder(0.0105, 0.215, segments=20, loc=(0, 0, -0.282), mat=brass)
    b.cylinder(0.019, 0.022, segments=24, loc=(0, 0, -0.286), mat=dark, bevel=0.003)
    b.cylinder(0.0028, 0.044, segments=8, loc=(-0.022, 0, -0.275), rot=(0, 90, 0), mat=dark)
    b.lathe(HOUSING, segments=48, mat=brass)
    for z in (-0.341, -0.364):
        b.torus(0.1068, 0.0018, segments=64, sides=6, loc=(0, 0, z), mat=dark)
    b.lathe(SWITCH_CUP, segments=36, mat=brass, cap_start=False)
    chain_top, chain_end = Vector((0.026, 0.0, -0.447)), Vector((0.030, -0.004, -0.600))
    b.tube([chain_top.lerp(chain_end, t / 6) for t in range(7)], 0.0011, sides=4, mat=chain, cap=False)
    b.lathe([(0.0, 0.0), (0.006, 0.003), (0.0085, 0.012), (0.006, 0.022), (0.0, 0.025)], segments=16,
            loc=tuple(chain_end - Vector((0, 0, 0.025))), mat=walnut)
    body = b.finish(col, smooth_angle=40)
    body["source"] = "made for this site"

    blades = pl.Builder(f"{NAME}_blades")
    for i in range(BLADES):
        az = math.radians(90 + 360 * i / BLADES)
        rot = Matrix.Rotation(az, 4, "Z")
        iron_path = []
        for k in range(10):
            t = k / 9
            r = 0.080 + (BLADE_R0 + 0.075 - 0.080) * t
            drop = -0.022 * (0.5 - 0.5 * math.cos(min(t * 1.6, 1.0) * math.pi))
            iron_path.append(rot @ Vector((r, 0.0, HUB_Z - 0.004 + drop)))
        strap(blades, iron_path, lambda t: 0.030 + 0.030 * t ** 1.5, 0.006, brass)
        outline = blade_outline()
        faces = blades.extrude(outline, 0.0085, mat=walnut, bevel=0.0018, bevel_seg=2)
        place = (rot @ Matrix.Translation((BLADE_R0, 0.0, HUB_Z - 0.0335)) @
                 Matrix.Rotation(math.radians(PITCH_DEG), 4, "X") @ Matrix.Rotation(math.radians(90), 4, "X"))
        bmesh.ops.transform(blades.bm, matrix=place, verts=list({v for f in faces for v in f.verts}))
        for dx in (0.025, 0.058):
            for dy in (-0.012, 0.012):
                p = rot @ Vector((BLADE_R0 + dx, dy, HUB_Z - 0.0255))
                blades.cylinder(0.0032, 0.003, segments=10, loc=tuple(p), mat=dark)
    fan_blades = blades.finish(col, smooth_angle=35)
    fan_blades.data.transform(Matrix.Translation((0, 0, -HUB_Z)))
    fan_blades.location = (0, 0, HUB_Z)
    fan_blades["source"] = "made for this site"
    pl.parent_keep_transform(fan_blades, body)
    pl.report(NAME, col, 15000)
    pl.save_prop(NAME)


main()
