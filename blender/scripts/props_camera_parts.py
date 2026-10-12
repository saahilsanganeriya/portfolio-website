"""Parts and materials shared by the camera props: lens barrels, dials, buttons, strap lugs.

Lenses run along -Y from the body front. Knurled or ribbed bands are real geometry (alternating vertex radii),
so they catch light the way milled rings do.
"""
import math

from mathutils import Vector

import props_lib as pl


def camera_materials():
    leather = pl.ambientcg("Leather026")
    brushed = pl.ambientcg("Metal009")
    return {
        "leatherette": pl.surface(
            "leatherette", (0.016, 0.016, 0.017), 0.62, height_tex=leather["Displacement"], height_strength=0.9,
            tile=0.065, rough_tex=leather["Roughness"], rough_amount=0.2, edge_wear=0.55, edge_color=(0.05, 0.05, 0.05),
            edge_roughness=0.38, edge_width=0.0012, dust=0.35, grime=0.4, smudges=0.12, color_var=0.04),
        "satin_silver": pl.surface(
            "satin_silver", (0.80, 0.79, 0.76), 0.30, metallic=1.0, rough_tex=brushed["Roughness"], rough_amount=0.16,
            tile=0.05, micro_bump=(5000, 0.04), edge_wear=0.4, edge_color=(0.93, 0.92, 0.9), edge_roughness=0.16,
            edge_width=0.0009, smudges=0.12, scratches=0.1, dust=0.3, grime=0.25, color_var=0.02),
        "chrome": pl.surface(
            "chrome", (0.86, 0.86, 0.85), 0.11, metallic=1.0, edge_wear=0.25, edge_color=(0.95, 0.95, 0.94),
            edge_roughness=0.06, edge_width=0.0008, smudges=0.3, scratches=0.28, dust=0.3, grime=0.5, color_var=0.02),
        "black_paint": pl.surface(
            "black_paint", (0.018, 0.018, 0.019), 0.40, micro_bump=(6000, 0.05), edge_wear=0.85,
            edge_color=(0.55, 0.54, 0.52), edge_metallic=1.0, edge_roughness=0.3, edge_width=0.0009, smudges=0.28,
            scratches=0.15, dust=0.35, grime=0.35, color_var=0.03),
        "black_anodised": pl.surface(
            "black_anodised", (0.02, 0.02, 0.021), 0.34, metallic=0.6, micro_bump=(5000, 0.05), edge_wear=0.7,
            edge_color=(0.62, 0.62, 0.60), edge_metallic=1.0, edge_roughness=0.25, edge_width=0.0007, smudges=0.25,
            scratches=0.18, dust=0.25, grime=0.3, color_var=0.02),
        "black_plastic": pl.surface(
            "camera_plastic", (0.02, 0.02, 0.021), 0.45, micro_bump=(4000, 0.06), edge_wear=0.4,
            edge_color=(0.07, 0.07, 0.07), edge_width=0.0007, smudges=0.3, dust=0.3, grime=0.3, color_var=0.03),
        "rubber": pl.surface(
            "camera_rubber", (0.013, 0.013, 0.013), 0.8, micro_bump=(3000, 0.25), edge_wear=0.3,
            edge_color=(0.04, 0.04, 0.04), edge_width=0.0008, dust=0.5, grime=0.5, color_var=0.03),
        "glass": pl.surface(
            "lens_glass", (0.004, 0.005, 0.006), 0.02, specular=0.6, thin_film=420.0, smudges=0.12, dust=0.4,
            color_var=0.0, edge_width=0.0004),
        "screen": pl.surface(
            "lcd_glass", (0.006, 0.007, 0.008), 0.05, coat=1.0, coat_roughness=0.03, smudges=0.4, dust=0.3,
            color_var=0.0, edge_width=0.0004),
        "paint_white": pl.surface(
            "engraving_white", (0.78, 0.77, 0.73), 0.5, edge_width=0.0002, color_var=0.05, grime=0.2),
        "paint_black": pl.surface(
            "engraving_black", (0.015, 0.015, 0.015), 0.5, edge_width=0.0002, color_var=0.0),
        "paint_orange": pl.surface(
            "engraving_orange", (0.55, 0.20, 0.06), 0.5, edge_width=0.0002, color_var=0.05),
        "inner_black": pl.surface("inner_black", (0.006, 0.006, 0.006), 0.7, color_var=0.0, edge_width=0.0004),
    }


def knurl(depth=0.0006):
    """Radial function for Builder.lathe: alternate vertex radii on the marked profile rows."""
    def fn(i, j, r, rows=None):
        return r - depth * (i % 2)
    return fn


def lens(b, x, z, front_y, bands, glass_r, glass_depth, mats, segments=48, glass_mat="glass", inner_mat="inner_black"):
    """Lens barrel along -Y from (x, front_y, z).

    bands: list of (radius_start, radius_end, length, material_key, style) with style 'plain', 'knurl' or 'ribs'.
    The front of the last band steps in to the glass, which is a shallow dome `glass_depth` behind the front.
    """
    y = 0.0
    for r0, r1, length, mat_key, style in bands:
        if style == "plain":
            prof = [(r0, y), (r1, y + length)]
            b.lathe(prof, segments, loc=(x, front_y, z), rot=(90, 0, 0), mat=mats[mat_key], cap_start=False,
                    cap_end=False)
        else:
            rows = 2 if style == "knurl" else 4
            prof = [(r0 - 0.0003, y)]
            for k in range(rows):
                prof.append((r0 + (r1 - r0) * (k + 0.5) / rows, y + length * (0.08 + 0.84 * k / max(rows - 1, 1))))
            prof.append((r1 - 0.0003, y + length))
            depth = 0.00055 if style == "knurl" else 0.0011
            step = 1 if style == "knurl" else 2

            def radial(i, j, r, n=len(prof), d=depth, st=step):
                if j in (0, n - 1):
                    return r
                return r - d * ((i // st) % 2)
            b.lathe(prof, segments * (1 if style == "ribs" else 3) // (1 if style == "ribs" else 2), loc=(x, front_y, z),
                    rot=(90, 0, 0),
                    mat=mats[mat_key], cap_start=False, cap_end=False, radial=radial)
        y += length
    r_front = bands[-1][1]
    face = [(r_front, y), (r_front - 0.0012, y + 0.0004), (glass_r + 0.0018, y + 0.0004),
            (glass_r + 0.0012, y - glass_depth * 0.5), (glass_r, y - glass_depth)]
    b.lathe(face, segments, loc=(x, front_y, z), rot=(90, 0, 0), mat=mats[inner_mat], cap_start=False,
            cap_end=False)
    dome = [(glass_r, y - glass_depth)]
    for k in range(1, 6):
        t = k / 5
        dome.append((glass_r * math.cos(t * math.pi / 2 * 0.6) * (1 - t) + glass_r * (1 - t) * 0.0,
                     y - glass_depth + glass_depth * 0.55 * math.sin(t * math.pi / 2)))
    dome[-1] = (0.0, dome[-1][1])
    b.lathe(dome, segments // 2, loc=(x, front_y, z), rot=(90, 0, 0), mat=mats[glass_mat], cap_start=False,
            cap_end=False)
    return y


def dial(b, x, y, z, r, h, side_mat, top_mat, ridges=40, labels=(), label_mat=None, label_size=0.0016,
         label_radius=None, start_deg=90, sweep_deg=300, ticks=0, tick_mat=None, cap_mat=None, cap_r=0.0):
    """Knurled dial standing on (x, y, z); labels are engraved around the top face, clockwise from start_deg."""
    prof = [(r - 0.0004, 0.0), (r, h * 0.12), (r, h * 0.8), (r - 0.0009, h), (cap_r if cap_r else 0.0, h)]

    def radial(i, j, rr):
        return rr - 0.00045 * (i % 2) if j in (1, 2) else rr
    b.lathe(prof, ridges * 2, loc=(x, y, z), mat=side_mat, radial=radial)
    if cap_r:
        b.lathe([(cap_r, h), (cap_r, h + 0.0006), (cap_r * 0.92, h + 0.0009), (0.0, h + 0.0009)], 24,
                loc=(x, y, z), mat=cap_mat or top_mat, cap_start=False)
    lr = label_radius or r * 0.7
    n = max(len(labels), 1)
    for k, text in enumerate(labels):
        a = math.radians(start_deg - sweep_deg * k / max(n - 1, 1))
        px, py = x + lr * math.cos(a), y + lr * math.sin(a)
        b.text(text, label_size, loc=(px, py, z + h + 0.00006), rot=(0, 0, math.degrees(a) - 90), mat=label_mat,
               resolution=1)
    for k in range(ticks):
        a = math.radians(start_deg - 360 * k / ticks)
        px, py = x + (r - 0.0014) * math.cos(a), y + (r - 0.0014) * math.sin(a)
        b.box((0.0003, 0.0012, 0.0001), loc=(px, py, z + h + 0.00005), rot=(0, 0, math.degrees(a) - 90),
              mat=tick_mat or label_mat)


def button(b, x, y, z, r, h, mat, segments=12, axis="Z", dome=0.3):
    rot = {"Z": (0, 0, 0), "-Y": (90, 0, 0), "Y": (-90, 0, 0), "X": (0, 90, 0), "-X": (0, -90, 0)}[axis]
    prof = [(r, 0.0), (r, h * (1 - 0.3 * dome)), (r * 0.7, h), (0.0, h)]
    b.lathe(prof, segments, loc=(x, y, z), rot=rot, mat=mat, cap_start=False)


def strap_lug(b, x, y, z, side, mat):
    """Triangular split ring through a small lug post on the body end (side = -1 or +1 along X)."""
    b.cylinder(0.0022, 0.003, segments=8, loc=(x, y, z), rot=(0, 90 * side, 0), mat=mat)
    ring_c = Vector((x + side * 0.0055, y, z - 0.002))
    b.torus(0.0042, 0.00075, segments=12, sides=4, loc=tuple(ring_c), rot=(90, 0, 0), mat=mat)
