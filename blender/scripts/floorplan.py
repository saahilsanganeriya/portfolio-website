"""Write public/room/floorplan.json from room.blend: the set's plan for the tour map, the orbit and the void.

    blender -b blender/room.blend -P blender/scripts/floorplan.py [-- <out.json>]

Plan coordinates are glTF world X and Z in metres (Blender X and -Y), the axes the site's scene uses, so a stop's
position can be compared with its camera node directly. The file holds:

  voidColor  the void's colour (sRGB hex): the site's clear colour, which the walls and the floor fade into
  corner     the two walls as one polyline: the left wall's free end, the corner, the back wall's free end
  outline    the floor's solid edge as a polygon (it fades out beyond this, to fadeOutline)
  walls      the two walls as segments;  windows  the window's opening as a segment
  furniture  labelled footprints (the bounds of the named objects)
  stops      the tour's stops in order, professional first: id, label, camera node, position
  orbit      the orbit's centre (glTF x, y, z) and limits, as on the orbit_center node
  probe      the room probe for the live shine (export.py: file, size, where it was taken)

Everything is read from the blend file (object bounds, the tour's camera empties) except the stop list, which comes
from build_room.TOUR_STOPS, and the void and the floor's curve, which come from room_lib.
"""

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_room  # noqa: E402
import room_lib  # noqa: E402
from room_lib import BACK_X1, FLOOR_EDGE, FLOOR_SOLID, LEFT_Y0, WIN_X0, WIN_X1, X_LEFT, Y_BACK  # noqa: E402

OUT = build_room.REPO / "public" / "room" / "floorplan.json"
FURNITURE = [
    # label, objects whose bounds make the footprint
    ("Desk", ["desk_desk", "desk_desk_top"]),
    ("Desk chair", ["desk_chair", "desk_chair_base"]),
    ("Credenza", ["env_credenza"]),
    ("Kitchen counter", ["kitchen_counter", "env_kitchen_top"]),
    ("Darkroom lines", ["darkroom_line_0", "darkroom_line_1", "darkroom_line_2"]),
    ("Bookcase", ["bookshelf"]),
    ("Armchair", ["props_lounge_chair"]),
    ("Reading lamp", ["props_lantern"]),
    ("Record cabinet", ["env_record_cabinet"]),
    ("Record crate", ["record_crate"]),
    ("Rug", ["env_rug"]),
    ("Rug", ["env_rug_corner"]),
]


def plan(x, y):
    """Blender (x, y) to plan (glTF x, z), rounded to millimetres."""
    return [round(x, 3), round(-y, 3)]


def footprint(names):
    pts = []
    for name in names:
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            raise SystemExit(f"floorplan: no mesh {name}")
        mw = obj.matrix_world
        pts += [mw @ v.co for v in obj.data.vertices]
    if not pts:
        raise SystemExit(f"floorplan: {names} have no vertices")
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts)))
    return [plan(lo.x, lo.y), plan(hi.x, lo.y), plan(hi.x, hi.y), plan(lo.x, hi.y)]


def floor_outline(t: float, segments: int = 48):
    """The floor's superellipse at t (FLOOR_SOLID: its solid edge; FLOOR_EDGE: where it has faded out)."""
    return [plan(p.x, p.y) for p in build_room.floor_ring(t, segments)]


def main(out: Path = OUT, extra: dict | None = None):
    cameras = {o.name for o in bpy.data.objects if o.name.startswith("cam_")}
    stops = []
    for stop_id, label, camera, (x, y) in build_room.TOUR_STOPS:
        if camera not in cameras or f"{camera}_target" not in cameras:
            raise SystemExit(f"floorplan: stop {stop_id} names {camera}, which the blend lacks")
        stops.append({"id": stop_id, "label": label, "camera": camera, "position": plan(x, y)})
    orbit = bpy.data.objects["orbit_center"]
    c = orbit.location
    data = {
        "units": "m",
        "axes": "glTF world: x to the right, z toward the open front (Blender x and -y)",
        "voidColor": room_lib.VOID_HEX,
        "corner": [plan(X_LEFT, LEFT_Y0), plan(X_LEFT, Y_BACK), plan(BACK_X1, Y_BACK)],
        "outline": floor_outline(FLOOR_SOLID),
        "fadeOutline": floor_outline(FLOOR_EDGE),
        "walls": [
            [plan(X_LEFT, LEFT_Y0), plan(X_LEFT, Y_BACK)],
            [plan(X_LEFT, Y_BACK), plan(BACK_X1, Y_BACK)],
        ],
        "windows": [[plan(WIN_X0, Y_BACK), plan(WIN_X1, Y_BACK)]],
        "furniture": [{"label": label, "polygon": footprint(names)} for label, names in FURNITURE],
        "stops": stops,
        "orbit": {"center": [round(c.x, 3), round(c.z, 3), round(-c.y, 3)],
                  **{k: orbit[k] for k in ("minDist", "maxDist", "minPolarDeg", "maxPolarDeg")}},
    }
    if extra is None and out.exists():
        extra = {k: v for k, v in json.loads(out.read_text()).items() if k == "probe"}
    data.update(extra or {})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2) + "\n")
    print(f"floorplan: {out} ({len(stops)} stops, {len(data['furniture'])} footprints)")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(Path(argv[0]) if argv else OUT)
