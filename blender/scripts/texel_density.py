"""Report the shipped texel density of each baked atlas in room.blend: texels per metre on the surfaces, from each
object's 'bake' UV map and the atlas size export.py ships.

    blender -b blender/room.blend -P blender/scripts/texel_density.py [-- --json out.json]

Density of an object = sqrt(UV area share x shipped pixels^2 / world surface area). The atlas line gives the
area-weighted mean over its objects, the 10th / 50th / 90th percentiles by area, and the fill (the share of the
atlas its islands cover; islands never overlap).
"""

import json
import math
import sys
from pathlib import Path

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bake  # noqa: E402
import export  # noqa: E402

# Surfaces worth naming in the report (whichever exist in this version of the room).
WATCH = ("wall_back", "wall_left", "floor", "floor_fade", "desk_desk_top", "desk_crt_front", "desk_computer_front",
         "keyboard", "mouse", "coffee_mug", "crt_badge", "sticky_note_0", "desk_desk", "desk_crt", "crt_glow",
         "props_nas_4bay", "env_window_frame", "voyager_record", "props_frame_pale_blue_dot", "pennant_gatech",
         "print_japanese_lit", "darkroom_line_1", "poster_plaque", "props_mango_plant", "espresso_machine",
         "countertop_oven", "croissant", "bookshelf", "book_spine_kitchen", "record_player", "platter",
         "props_lounge_chair", "kitchen_counter", "env_credenza", "props_bakery_board", "lava_lamp")


def shipped_size(atlas: str) -> int:
    if atlas.startswith("window_"):
        return bake.ATLAS_SIZES[atlas]  # the view ships at its bake size
    return export.FULL_PX


def object_density(obj, size):
    mesh = obj.data
    if "bake" not in mesh.uv_layers:
        return None
    uvs = mesh.uv_layers["bake"].data
    mw = obj.matrix_world
    world_area = uv_area = 0.0
    for poly in mesh.polygons:
        pts = [mw @ mesh.vertices[v].co for v in poly.vertices]
        for i in range(1, len(pts) - 1):
            world_area += (pts[i] - pts[0]).cross(pts[i + 1] - pts[0]).length / 2
        uv = [uvs[i].uv for i in poly.loop_indices]
        uv_area += abs(sum(a.x * b.y - b.x * a.y for a, b in zip(uv, uv[1:] + uv[:1]))) / 2
    if world_area <= 0 or uv_area <= 0:
        return None
    return world_area, math.sqrt(uv_area * size * size / world_area), uv_area


def percentile(rows, q):
    total = sum(a for a, _ in rows)
    acc = 0.0
    for area, density in sorted(rows, key=lambda r: r[1]):
        acc += area
        if acc >= q * total:
            return density
    return rows[-1][1]


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = Path(argv[argv.index("--json") + 1]) if "--json" in argv else None
    by_atlas, named, named_all = {}, {}, {}
    for obj in bpy.context.scene.objects:
        atlas = obj.get("atlas")
        if obj.type != "MESH" or not atlas or atlas == "window_sky":  # the sky is drawn by the site, never baked
            continue
        size = shipped_size(atlas)
        found = object_density(obj, size)
        if found is None:
            continue
        by_atlas.setdefault(atlas, []).append(found)
        named_all[obj.name] = (atlas, round(found[1]))
        if obj.name in WATCH:
            named[obj.name] = round(found[1])
    report = {}
    for atlas, found in sorted(by_atlas.items()):
        rows = [(a, d) for a, d, _ in found]
        area = sum(a for a, _ in rows)
        mean = sum(a * d for a, d in rows) / area
        fill = sum(u for _, _, u in found)
        report[atlas] = {"shipped_px": shipped_size(atlas), "objects": len(rows), "area_m2": round(area, 2),
                         "mean_texels_per_m": round(mean), "p10": round(percentile(rows, 0.1)),
                         "p50": round(percentile(rows, 0.5)), "p90": round(percentile(rows, 0.9)),
                         "fill": round(fill, 3)}
        r = report[atlas]
        print(f"TEXEL {atlas:13s} {r['shipped_px']:5d} px  {r['objects']:4d} objects  {r['area_m2']:7.2f} m2  "
              f"mean {r['mean_texels_per_m']:5d} px/m  p10 {r['p10']:5d}  p50 {r['p50']:5d}  p90 {r['p90']:5d}  "
              f"fill {r['fill']:.0%}")
    for name, density in sorted(named.items()):
        print(f"TEXEL   {name:24s} {density:5d} px/m")
    if out:
        out.write_text(json.dumps({"atlases": report, "named": named,
                                   "objects": {k: {"atlas": a, "texels_per_m": d} for k, (a, d) in sorted(named_all.items())}},
                                  indent=2))


if __name__ == "__main__":
    main()
