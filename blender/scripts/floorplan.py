"""Write public/room/floorplan.json from room.blend: the room's plan for the tour map.

    blender -b blender/room.blend -P blender/scripts/floorplan.py [-- <out.json>]

Plan coordinates are glTF world X and Z in metres (Blender X and -Y), the axes the site's scene uses, so a stop's
position can be compared with its camera node directly. The file holds:

  outline    the floor as one polygon
  walls      the three walls as segments (the front and the right side beyond the return are open)
  doors      the doorway's opening as a segment;  windows  the window's opening as a segment
  furniture  labelled footprints (the bounds of the named objects)
  stops      the tour's stops in order, professional first: id, label, camera node, position

Everything is read from the blend file (object bounds, the tour's camera empties) except the stop list, which comes
from build_room.TOUR_STOPS.
"""

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_room  # noqa: E402
from room_lib import DOOR_Y0, DOOR_Y1, RETURN_Y, WIN_X0, WIN_X1, X_LEFT, X_RIGHT, Y_BACK, Y_FRONT  # noqa: E402

OUT = build_room.REPO / "public" / "room" / "floorplan.json"
FURNITURE = [
    # label, objects whose bounds make the footprint
    ("Desk", ["desk_desk"]),
    ("Desk chair", ["desk_chair_base", "desk_chair_seat"]),
    ("Credenza", ["env_credenza"]),
    ("Kitchen counter", ["kitchen_counter", "env_kitchen_top"]),
    ("Bookcase", ["bookshelf"]),
    ("Armchair", ["props_lounge_chair"]),
    ("Reading lamp", ["props_lantern"]),
    ("Record cabinet", ["env_record_cabinet"]),
    ("Record crate", ["record_crate"]),
    ("Radiator", ["env_radiator"]),
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
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts)))
    return [plan(lo.x, lo.y), plan(hi.x, lo.y), plan(hi.x, hi.y), plan(lo.x, hi.y)]


def floor_outline():
    floor = bpy.data.objects["env_floor"]
    mw = floor.matrix_world
    tops = [p for p in floor.data.polygons if p.normal.z > 0.9]
    pts = [mw @ floor.data.vertices[i].co for p in tops for i in p.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts)))
    return [plan(lo.x, lo.y), plan(hi.x, lo.y), plan(hi.x, hi.y), plan(lo.x, hi.y)]


def main(out: Path = OUT):
    cameras = {o.name for o in bpy.data.objects if o.name.startswith("cam_")}
    stops = []
    for stop_id, label, camera, (x, y) in build_room.TOUR_STOPS:
        if camera not in cameras or f"{camera}_target" not in cameras:
            raise SystemExit(f"floorplan: stop {stop_id} names {camera}, which the blend lacks")
        stops.append({"id": stop_id, "label": label, "camera": camera, "position": plan(x, y)})
    data = {
        "units": "m",
        "axes": "glTF world: x to the right, z toward the open front (Blender x and -y)",
        "outline": floor_outline(),
        "walls": [
            [plan(X_LEFT, Y_FRONT), plan(X_LEFT, Y_BACK)],
            [plan(X_LEFT, Y_BACK), plan(X_RIGHT, Y_BACK)],
            [plan(X_RIGHT, Y_BACK), plan(X_RIGHT, RETURN_Y)],
        ],
        "doors": [[plan(X_LEFT, DOOR_Y0), plan(X_LEFT, DOOR_Y1)]],
        "windows": [[plan(WIN_X0, Y_BACK), plan(WIN_X1, Y_BACK)]],
        "furniture": [{"label": label, "polygon": footprint(names)} for label, names in FURNITURE],
        "stops": stops,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2) + "\n")
    print(f"floorplan: {out} ({len(stops)} stops, {len(data['furniture'])} footprints)")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(Path(argv[0]) if argv else OUT)
