"""The view from the window: San Francisco on the left and Delhi on the right, joined by the Golden Gate across an
imagined bay (Delhi has no coast), built as a small diorama behind the back wall.

Every part of the land, water and landmarks is its own object in atlas window_sf or window_delhi (the seam is the
plane x = SEAM_X, behind the middle of the window's one pane); export.py joins each atlas into one mesh,
window_view_sf and window_view_delhi. bake.py bakes each half by day only (both cities are always by day): the
materials read the value WINDOW_NIGHT, held at 0, and only the lights in window_lights marked "day" switch on.

The sky is one object across both cities, window_sky, which the site draws at runtime (one continuous gradient from
San Francisco's day sky to Delhi's), so it is never baked: its emission only lights the diorama while the halves bake.
The markers window_sky_centre (the dome's centre) and window_sky_eye (the window framing's eye) place that runtime sky
and the blend between the cities.

The diorama stays inside an envelope that no framing can see except through the window: a sky dome whose every
point is hidden behind the wall from each camera (and the idle sway), checked by check_hidden().

The diorama is modelled in its own frame (the round-two window's, seam at x = 1.33) and placed behind the room's
window by one similarity transform, DIORAMA_TO_ROOM (scale VIEW_SCALE about the seam on the water line): the room's
window, walls and cameras are carried into the diorama's frame for every visibility test, so the layout tuned for
the first window keeps its look and reads larger through the bigger one.

    blender -b --factory-startup -P blender/scripts/window_view.py -- <out_dir> [day|night] [cam ...]

renders quick previews of the view alone (a bare wall with the window), for work on the diorama.
"""

import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import props_lib as pl  # noqa: E402
import room_lib as room  # noqa: E402
from room_lib import collection  # noqa: E402

# ---- the diorama's frame ----
SEAM_X = 1.33
WALL_BACK = room.Y_BACK + room.WALL_T
WATER_Z = 0.95
VIEW_SCALE = 1.75  # round 8: closer to round six's big landmarks, through the one big pane
ROOM_SEAM = Vector(((room.WIN_X0 + room.WIN_X1) / 2, WALL_BACK, room.WIN_Z0 + 0.04))
DIORAMA_SEAM = Vector((SEAM_X, WALL_BACK, WATER_Z))
DIORAMA_TO_ROOM = (Matrix.Translation(ROOM_SEAM) @ Matrix.Diagonal((VIEW_SCALE,) * 3 + (1.0,))
                   @ Matrix.Translation(-DIORAMA_SEAM))


def to_diorama(p) -> Vector:
    return DIORAMA_SEAM + (Vector(p) - ROOM_SEAM) / VIEW_SCALE


# The room's window and walls, in the diorama's frame.
WIN_X0, WIN_Z0 = to_diorama((room.WIN_X0, 0, room.WIN_Z0)).xz
WIN_X1, WIN_Z1 = to_diorama((room.WIN_X1, 0, room.WIN_Z1)).xz
Y_BACK = WALL_BACK - room.WALL_T / VIEW_SCALE
WALL_LEFT_END = to_diorama((room.X_LEFT - room.WALL_T, 0, 0)).x
WALL_RIGHT_END = to_diorama((room.BACK_X1, 0, 0)).x
WALL_TOP = to_diorama((0, 0, room.WALL_H)).z
DOME_CENTRE = Vector((SEAM_X, WALL_BACK + 0.06, WATER_Z))
DOME_AXES = (2.2, 1.75, 1.5, 1.25)  # left, back, up, right reach in metres before the envelope trims it
ENVELOPE_MARGIN = 0.05
WINDOW_NIGHT = "window_night"
SEED = 1937  # the year the Golden Gate opened

# Framings the envelope must hold for, in the diorama's frame: the room's cameras, the idle camera swayed, and
# points along the glides the site makes. setup_viewpoints() fills these from the room's framings.
IDLE_SWAY = 0.16  # radians either way; the site sways cam_idle by 0.14
CAMERAS: list[Vector] = []
VIEWPOINTS: list[Vector] = []


def glide(points, steps=5):
    out = []
    for a, b in zip(points, points[1:]):
        out += [a.lerp(b, t / steps) for t in range(1, steps)]
    return out


def setup_viewpoints(framings):
    """framings: {name: (position, target)} in room metres. CAMERAS (for the envelope) holds every framing, the
    swayed idle camera and the arrival glide; VIEWPOINTS (for culling unseen faces) adds the tour's legs and the
    moves between every framing and the idle and desk framings."""
    pos = {name: to_diorama(p) for name, (p, _) in framings.items()}
    idle, target = pos["cam_idle"], to_diorama(framings["cam_idle"][1])
    sway = [target + Matrix.Rotation(a, 3, "Z") @ (idle - target) for a in (-IDLE_SWAY, -IDLE_SWAY / 2, IDLE_SWAY / 2,
                                                                             IDLE_SWAY)]
    arrival = [pos[n] for n in ("cam_loading", "cam_arrival_0", "cam_arrival_1", "cam_arrival_2", "cam_desk")
               if n in pos]
    CAMERAS[:] = list(pos.values()) + sway + glide(arrival, 6) + glide([pos["cam_loading"], idle], 6)
    tours = [pos[n] for n in sorted(pos) if n.startswith("cam_tour_")]
    legs = glide(tours + tours[:1], 4)
    hubs = [p for name, p in pos.items() if name not in ("cam_loading", "cam_idle", "cam_desk")]
    moves = []
    for hub in (idle, pos["cam_desk"]):
        for p in hubs:
            moves += glide([hub, p], 4)
    VIEWPOINTS[:] = CAMERAS + legs + moves


SF_HILLS = [  # (x, y, height above water, radius)
    (0.80, 1.86, 0.22, 0.20), (1.08, 1.94, 0.13, 0.16), (0.50, 1.84, 0.15, 0.24), (0.70, 1.02, 0.07, 0.16),
    (0.15, 1.05, 0.13, 0.22), (0.25, 1.65, 0.12, 0.2),
]
SUTRO = (0.82, 1.87)
BRIDGE_Y, BRIDGE_X = 1.36, (0.70, 1.86)
TOWERS_X = (0.96, 1.62)
DECK_Z = WATER_Z + 0.10
TOWER_TOP = WATER_Z + 0.40
LOTUS, INDIA_GATE, QUTUB = (1.56, 0.86), (1.72, 1.04), (1.80, 1.20)
# Round seven: downtown San Francisco with the Transamerica Pyramid and Salesforce Tower, Coit Tower on Telegraph
# Hill and Alcatraz in the bay; Humayun's Tomb, Jama Masjid and the Red Fort's wall in Delhi; a far ridge.
TRANSAMERICA, SALESFORCE, COIT, ALCATRAZ = (1.10, 1.70), (0.99, 1.76), (0.70, 1.03), (1.17, 1.57)
DOWNTOWN = ((0.90, 1.24), (1.63, 1.86), (1.06, 1.75))  # x range, y range, densest point (behind the bridge)
HUMAYUN, JAMA_MASJID, RED_FORT_Y = (1.88, 1.42), (1.60, 1.72), 1.96
HAZE_NEAR, HAZE_FAR, HAZE_MAX = 1.05, 2.35, 0.25


def sf_coast(y):
    """x of the San Francisco shoreline at depth y: a foreground promontory, the bay's west shore at the bridge,
    and the far shore behind it where the hills rise."""
    t = smoothstep(0.92, 1.16, y)
    far = smoothstep(1.52, 1.72, y)
    return (1.24 * (1 - t) + 0.78 * t) * (1 - far) + (SEAM_X + 0.06) * far


def delhi_coast(y):
    """x of the Delhi shoreline at depth y: a ghat close to the window, a shore for the bridge to land on, and the
    far shore across the back."""
    t = smoothstep(0.90, 1.12, y)
    far = smoothstep(1.50, 1.68, y)
    return (1.43 * (1 - t) + 1.71 * t) * (1 - far) + (SEAM_X - 0.06) * far


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---- the envelope ----

SEEN_MARGIN = 0.06


def seen(p: Vector) -> bool:
    """True when some viewpoint sees p through the window opening (both faces of the wall), with a margin."""
    for c in VIEWPOINTS:
        if c.y >= Y_BACK or p.y <= WALL_BACK:
            continue
        ok = True
        for plane in (Y_BACK, WALL_BACK):
            t = (plane - c.y) / (p.y - c.y)
            x, z = c.x + (p.x - c.x) * t, c.z + (p.z - c.z) * t
            if not (WIN_X0 - SEEN_MARGIN < x < WIN_X1 + SEEN_MARGIN and WIN_Z0 - SEEN_MARGIN < z < WIN_Z1 + SEEN_MARGIN):
                ok = False
                break
        if ok:
            return True
    return False


def cull_unseen(obj):
    """Drop the faces no viewpoint can see through the window; returns the share kept."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    seen_vert = {v: seen(obj.matrix_world @ v.co) for v in bm.verts}
    doomed = [f for f in bm.faces if not any(seen_vert[v] for v in f.verts)]
    kept = 1 - len(doomed) / max(len(bm.faces), 1)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    return kept


def hidden(p: Vector, margin=ENVELOPE_MARGIN) -> bool:
    """True when every camera's ray to p meets the back wall's back face (or its window) before p."""
    for c in CAMERAS:
        if p.y <= WALL_BACK or c.y >= WALL_BACK:
            continue
        t = (WALL_BACK - c.y) / (p.y - c.y)
        x, z = c.x + (p.x - c.x) * t, c.z + (p.z - c.z) * t
        if x > WALL_RIGHT_END - margin or z > WALL_TOP - margin or x < WALL_LEFT_END + margin:
            return False
    return True


def dome_radius(direction: Vector) -> float:
    """How far the sky reaches from DOME_CENTRE along a direction: an ellipsoid, trimmed to the envelope."""
    left, back, up, right = DOME_AXES
    ax = left if direction.x < 0 else right
    r_max = 1.0 / math.sqrt((direction.x / ax) ** 2 + (direction.y / back) ** 2 + (max(direction.z, 0) / up) ** 2)
    lo, hi = 0.05, r_max
    if hidden(DOME_CENTRE + direction * hi):
        return hi
    for _ in range(30):
        mid = (lo + hi) / 2
        if hidden(DOME_CENTRE + direction * mid):
            lo = mid
        else:
            hi = mid
    return lo


def inside_dome(p: Vector, margin=0.02) -> bool:
    d = p - DOME_CENTRE
    if d.length < 1e-6:
        return True
    return d.length < dome_radius(d.normalized()) - margin


def check_hidden(objs):
    """Fail the build if any diorama vertex could be seen past the wall from any framing."""
    bad = []
    for obj in objs:
        mw = obj.matrix_world
        for v in obj.data.vertices:
            p = mw @ v.co
            if p.y > WALL_BACK + 0.005 and not hidden(p, margin=0.0):
                bad.append((obj.name, tuple(round(c, 3) for c in p)))
    if bad:
        raise RuntimeError(f"window view: {len(bad)} vertices visible past the wall, e.g. {bad[:5]}")


# ---- materials ----

def night_value():
    """The single value every view material reads: 0 by day, 1 by night (bake.py sets it)."""
    ng = bpy.data.node_groups.get(WINDOW_NIGHT)
    if ng is None:
        ng = bpy.data.node_groups.new(WINDOW_NIGHT, "ShaderNodeTree")
        ng.interface.new_socket("Night", in_out="OUTPUT", socket_type="NodeSocketFloat")
        val = ng.nodes.new("ShaderNodeValue")
        val.name = "night"
        val.outputs[0].default_value = 0.0
        out = ng.nodes.new("NodeGroupOutput")
        ng.links.new(val.outputs[0], out.inputs[0])
    return ng


def set_night(value: float):
    night_value().nodes["night"].outputs[0].default_value = value


def view_material(name, day, night=None, rough=0.85, emit_night=None, emit_strength=0.0, kit=None, metal=0.0):
    """Diffuse diorama paint whose colour moves from `day` to `night`; optional emission by night only."""
    mat, k = pl.new_material(name)
    n = k.node("ShaderNodeGroup", node_tree=night_value()).outputs[0]
    color = k.mix_color(n, day + (1.0,), (night or day) + (1.0,)) if night else day + (1.0,)
    glow = None
    if kit is not None:
        color = kit(k, color, n)
        if isinstance(color, tuple):
            color, glow = color
    # Aerial perspective: the further back (object y, the diorama's depth), the more the colour fades into the haze
    # on the horizon, pale by day and blue-black by night.
    depth = k.map_range(k.node("ShaderNodeSeparateXYZ", inputs={"Vector": k.coords("Object")}).outputs["Y"], HAZE_NEAR,
                        HAZE_FAR, 0.0, HAZE_MAX)
    haze = k.mix_color(n, (0.66, 0.72, 0.80, 1.0), (0.030, 0.034, 0.055, 1.0))
    color = k.mix_color(depth, color, haze)
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": rough, "Metallic": metal})
    if emit_night is not None:
        strength = k.math("MULTIPLY", n, emit_strength)
        strength = k.math("MULTIPLY", strength, k.math("SUBTRACT", 1.0, k.math("MULTIPLY", depth, 0.8)))
        if glow is not None:
            strength = k.math("MULTIPLY", strength, glow)
        k.set(bsdf, "Emission Color", emit_night + (1.0,))
        k.set(bsdf, "Emission Strength", strength)
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs[0])
    return mat


def lit_windows(k, color, n, scale=(180.0, 180.0, 260.0), share=0.45, warm=(1.0, 0.62, 0.28)):
    """Building faces: a grid of windows, dark glass by day; by night a share of them glow warm."""
    obj = k.coords("Object")
    mp = k.node("ShaderNodeMapping", inputs={"Vector": obj, "Scale": scale})
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": mp.outputs[0]})
    fx = k.math("ABSOLUTE", k.math("SUBTRACT", k.math("FRACT", k.math("ADD", sep.outputs["X"], sep.outputs["Y"])), 0.5))
    fz = k.math("ABSOLUTE", k.math("SUBTRACT", k.math("FRACT", sep.outputs["Z"]), 0.5))
    pane = k.math("MULTIPLY", k.math("LESS_THAN", fx, 0.2), k.math("LESS_THAN", fz, 0.2))
    geo = k.node("ShaderNodeNewGeometry")
    wall = k.math("LESS_THAN", k.math("ABSOLUTE", k.node("ShaderNodeSeparateXYZ", inputs={"Vector": geo.outputs["Normal"]}).outputs["Z"]), 0.5)
    pane = k.math("MULTIPLY", pane, wall)
    cells = k.node("ShaderNodeTexVoronoi", inputs={"Vector": k.node("ShaderNodeMapping", inputs={"Vector": obj, "Scale": (180.0, 180.0, 260.0)}).outputs[0], "Randomness": 0.0})
    on = k.math("LESS_THAN", cells.outputs["Color"], share)
    glass = k.mix_color(pane, color, (0.05, 0.06, 0.08, 1.0))
    return glass, k.math("MULTIPLY", pane, on)


def sky_material(side):
    """The sky's light on the diorama while the halves bake: one day gradient over both cities. Emission only; the site
    draws the sky itself (window_sky), so nothing here is seen."""
    mat, k = pl.new_material(f"view_sky_{side}")
    geo = k.node("ShaderNodeNewGeometry")
    rel = k.node("ShaderNodeVectorMath", operation="SUBTRACT", inputs={0: geo.outputs["Position"], 1: tuple(DOME_CENTRE)})
    d = k.node("ShaderNodeVectorMath", operation="NORMALIZE", inputs={0: rel.outputs[0]})
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": d.outputs[0]})
    up = k.math("MAXIMUM", sep.outputs["Z"], 0.0)
    day_hz = (0.78, 0.73, 0.66, 1.0)  # one glow for both halves: their water then meets at the seam in one colour
    day = k.mix_color(k.math("POWER", up, 0.55), day_hz, (0.13, 0.30, 0.62, 1.0))
    emit = k.node("ShaderNodeEmission", inputs={"Color": day, "Strength": 0.34})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", emit.outputs[0])
    return mat


def water_material():
    """Bay water: cool and rippled by day; by night dark, with long streaks of reflected lights near the shores."""
    def paint(k, color, n):
        obj = k.coords("Object")
        ripples = k.noise(k.node("ShaderNodeMapping", inputs={"Vector": obj, "Scale": (40.0, 140.0, 40.0)}).outputs[0],
                          1.0, detail=3.0)
        color = k.mix_color(k.map_range(ripples, 0.45, 0.62, 0.0, 0.35), color, (0.55, 0.64, 0.68, 1.0))
        sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
        streak = k.noise(k.node("ShaderNodeMapping", inputs={"Vector": obj, "Scale": (90.0, 6.0, 90.0)}).outputs[0], 1.0,
                         detail=2.0)
        near = k.math("MAXIMUM", k.map_range(sep.outputs["X"], 1.05, 0.80),
                      k.map_range(sep.outputs["X"], 1.55, 1.80))
        bridge = k.map_range(k.math("ABSOLUTE", k.math("SUBTRACT", sep.outputs["Y"], BRIDGE_Y)), 0.25, 0.0)
        glints = k.math("MULTIPLY", k.map_range(streak, 0.66, 0.78), k.math("MAXIMUM", near, bridge))
        return color, glints
    return view_material("view_water", (0.10, 0.22, 0.27), (0.008, 0.014, 0.022), rough=0.3, kit=paint,
                         emit_night=(0.95, 0.58, 0.26), emit_strength=0.45)


def land_material(name, day, night, lights_share=0.0):
    """Ground painted by height and noise; by night a scatter of warm house lights."""
    def paint(k, color, n):
        obj = k.coords("Object")
        sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
        patches = k.noise(k.coords("Object", 18.0), 1.0, detail=3.0)
        color = k.mix_color(k.map_range(patches, 0.4, 0.62), color, tuple(c * 0.72 for c in day) + (1.0,))
        high = k.map_range(sep.outputs["Z"], WATER_Z + 0.08, WATER_Z + 0.25)
        color = k.mix_color(k.math("MULTIPLY", high, k.math("SUBTRACT", 1.0, n)), color, (0.52, 0.47, 0.30, 1.0))
        if lights_share > 0:
            dots = k.node("ShaderNodeTexVoronoi", inputs={"Vector": k.coords("Object", 70.0)}, feature="F1")
            lit = k.math("MULTIPLY", k.map_range(dots.outputs["Distance"], 0.18, 0.05),
                         k.map_range(dots.outputs["Color"], 1 - lights_share, 1 - lights_share + 0.02, smooth=False))
            lit = k.math("MULTIPLY", lit, k.map_range(sep.outputs["Z"], WATER_Z + 0.005, WATER_Z + 0.03))
            return color, lit
        return color
    return view_material(name, day, night, rough=0.95, kit=paint, emit_night=(1.0, 0.62, 0.28) if lights_share else None,
                         emit_strength=4.0)


def build_materials():
    m = {}
    m["water"] = water_material()
    m["sf_land"] = land_material("view_sf_land", (0.30, 0.31, 0.15), (0.020, 0.021, 0.018), lights_share=0.35)
    m["delhi_land"] = land_material("view_delhi_land", (0.33, 0.34, 0.16), (0.022, 0.020, 0.015), lights_share=0.2)
    m["lawn"] = view_material("view_lawn", (0.16, 0.26, 0.07), (0.010, 0.016, 0.008), rough=0.95)
    m["path"] = view_material("view_path", (0.52, 0.40, 0.25), (0.05, 0.035, 0.022), rough=0.9)
    m["trees"] = view_material("view_trees", (0.06, 0.12, 0.04), (0.006, 0.010, 0.006), rough=0.9)
    m["fog"] = view_material("view_fog", (0.80, 0.82, 0.86), (0.12, 0.09, 0.10), rough=1.0,
                             emit_night=(0.60, 0.40, 0.26), emit_strength=0.035, kit=fog_paint)
    m["ggb"] = view_material("view_ggb", (0.55, 0.075, 0.035), (0.13, 0.03, 0.02), rough=0.55)
    m["ggb_dark"] = view_material("view_ggb_dark", (0.20, 0.035, 0.02), (0.03, 0.01, 0.008), rough=0.6)
    m["concrete"] = view_material("view_concrete", (0.48, 0.46, 0.42), (0.04, 0.04, 0.04), rough=0.9)
    m["deck_lights"] = view_material("view_deck_lights", (0.30, 0.25, 0.18), (0.08, 0.06, 0.03), rough=0.5,
                                     emit_night=(1.0, 0.62, 0.25), emit_strength=6.0)
    m["red_light"] = view_material("view_red_light", (0.4, 0.05, 0.03), (0.2, 0.02, 0.01), rough=0.4,
                                   emit_night=(1.0, 0.05, 0.02), emit_strength=8.0)
    m["sutro"] = sutro_material()
    m["houses"] = [view_material(f"view_house_{i}", c, tuple(x * 0.08 for x in c), rough=0.8, emit_night=(1.0, 0.58, 0.24),
                                 emit_strength=1.6, kit=lambda k, col, n: lit_windows(k, col, n, share=0.55))
                   for i, c in enumerate([(0.52, 0.62, 0.70), (0.80, 0.52, 0.52), (0.85, 0.74, 0.40),
                                          (0.55, 0.72, 0.58), (0.62, 0.55, 0.72), (0.86, 0.64, 0.48)])]
    m["trim"] = view_material("view_trim", (0.86, 0.85, 0.80), (0.05, 0.05, 0.05), rough=0.7)
    m["roof"] = view_material("view_roof", (0.18, 0.17, 0.18), (0.02, 0.02, 0.022), rough=0.8)
    m["city"] = view_material("view_city", (0.80, 0.78, 0.72), (0.05, 0.05, 0.05), rough=0.85,
                              emit_night=(1.0, 0.60, 0.26), emit_strength=1.6,
                              kit=lambda k, col, n: lit_windows(k, col, n, share=0.4))
    m["delhi_city"] = view_material("view_delhi_city", (0.80, 0.74, 0.62), (0.05, 0.045, 0.04), rough=0.9,
                                    emit_night=(1.0, 0.70, 0.36), emit_strength=1.4,
                                    kit=lambda k, col, n: lit_windows(k, col, n, share=0.35))
    m["sandstone"] = view_material("view_sandstone", (0.62, 0.42, 0.27), (0.10, 0.06, 0.035), rough=0.85)
    m["red_sandstone"] = qutub_material()
    m["marble"] = view_material("view_marble", (0.86, 0.85, 0.82), (0.10, 0.11, 0.13), rough=0.6,
                                emit_night=(0.75, 0.82, 1.0), emit_strength=0.06)
    m["pool"] = view_material("view_pool", (0.20, 0.38, 0.45), (0.02, 0.03, 0.05), rough=0.25,
                              emit_night=(0.35, 0.55, 0.85), emit_strength=0.35)
    m["ghat"] = view_material("view_ghat", (0.55, 0.40, 0.28), (0.06, 0.04, 0.03), rough=0.9)
    m["street_lights"] = view_material("view_street_lights", (0.3, 0.28, 0.25), (0.05, 0.04, 0.03), rough=0.5,
                                       emit_night=(1.0, 0.55, 0.18), emit_strength=7.0)
    m["sail"] = view_material("view_sail", (0.86, 0.84, 0.78), (0.06, 0.06, 0.07), rough=0.8)
    m["tower_white"] = view_material("view_tower_white", (0.84, 0.83, 0.79), (0.05, 0.05, 0.055), rough=0.7,
                                     emit_night=(1.0, 0.70, 0.40), emit_strength=1.4,
                                     kit=lambda k, col, n: lit_windows(k, col, n, scale=(320.0, 320.0, 420.0), share=0.5))
    m["tower_glass"] = view_material("view_tower_glass", (0.55, 0.62, 0.68), (0.04, 0.045, 0.06), rough=0.35,
                                     emit_night=(0.95, 0.78, 0.55), emit_strength=1.2,
                                     kit=lambda k, col, n: lit_windows(k, col, n, scale=(300.0, 300.0, 380.0), share=0.45))
    m["crown"] = view_material("view_crown", (0.80, 0.82, 0.84), (0.2, 0.2, 0.22), rough=0.4,
                               emit_night=(0.85, 0.90, 1.0), emit_strength=5.0)
    m["red_stone"] = view_material("view_red_stone", (0.46, 0.17, 0.09), (0.07, 0.03, 0.02), rough=0.85)
    m["rock"] = view_material("view_rock", (0.36, 0.33, 0.28), (0.03, 0.03, 0.03), rough=0.95)
    m["ridge"] = view_material("view_ridge", (0.10, 0.17, 0.07), (0.008, 0.012, 0.008), rough=0.95)
    m["hull"] = view_material("view_hull", (0.30, 0.16, 0.08), (0.03, 0.02, 0.015), rough=0.7)
    return m


def fog_paint(k, color, n):
    """Fog is brightest on its tops and dims into the hills, so it reads as mist, not snow."""
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": k.coords("Object")})
    wisps = k.noise(k.coords("Object", 30.0), 1.0, detail=4.0)
    fade = k.map_range(sep.outputs["Z"], WATER_Z + 0.08, WATER_Z + 0.26, 0.55, 1.0)
    fade = k.math("MULTIPLY", fade, k.map_range(wisps, 0.3, 0.7, 0.85, 1.05))
    return k.mix_color(fade, (0.42, 0.45, 0.42, 1.0), color)


def sutro_material():
    """Sutro Tower's red and white bands, by height."""
    def paint(k, color, n):
        sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": k.coords("Object")})
        band = k.math("LESS_THAN", k.math("FRACT", k.math("DIVIDE", sep.outputs["Z"], 0.024)), 0.5)
        day = k.mix_color(band, (0.82, 0.80, 0.76, 1.0), (0.62, 0.08, 0.05, 1.0))
        return k.mix_color(n, day, (0.06, 0.03, 0.03, 1.0))
    return view_material("view_sutro", (0.8, 0.8, 0.8), None, rough=0.6, kit=paint)


def qutub_material():
    """Red sandstone with the paler bands of the upper storeys and inscription friezes."""
    def paint(k, color, n):
        sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": k.coords("Object")})
        z = sep.outputs["Z"]
        frieze = k.math("LESS_THAN", k.math("FRACT", k.math("DIVIDE", z, 0.018)), 0.18)
        upper = k.map_range(z, WATER_Z + 0.21, WATER_Z + 0.23)
        day = k.mix_color(frieze, (0.42, 0.16, 0.08, 1.0), (0.55, 0.30, 0.18, 1.0))
        day = k.mix_color(k.math("MULTIPLY", upper, 0.7), day, (0.78, 0.70, 0.60, 1.0))
        return k.mix_color(n, day, (0.10, 0.04, 0.02, 1.0))
    return view_material("view_red_sandstone", (0.42, 0.16, 0.08), None, rough=0.85, kit=paint)


# ---- building blocks ----

class Parts:
    """Collects the diorama's parts per half; each becomes an object in that half's atlas."""

    def __init__(self):
        self.parts = []

    def add(self, name, builder, texel=1.0, split=False, side=None, smooth=False):
        self.parts.append((name, builder, texel, split, side, smooth))

    def build(self):
        objs = []
        coll = collection("window_view")
        for name, b, texel, split, side, smooth in self.parts:
            me = bpy.data.meshes.new(name)
            bmesh.ops.remove_doubles(b.bm, verts=b.bm.verts, dist=1e-7)
            b.bm.normal_update()
            b.bm.to_mesh(me)
            b.bm.free()
            for m in b.materials:
                me.materials.append(m)
            obj = bpy.data.objects.new(name, me)
            coll.objects.link(obj)
            if smooth:
                me.shade_smooth()
            else:
                me.shade_flat()
            cull_unseen(obj)
            if not len(obj.data.polygons):
                bpy.data.objects.remove(obj, do_unlink=True)
                continue
            halves = split_at_seam(obj) if split else [(obj, side or ("sf" if centre_x(obj) < SEAM_X else "delhi"))]
            for o, s in halves:
                o.name = o.data.name = f"window_{s}_{name}"
                o["atlas"] = f"window_{s}"
                o["texel"] = texel
                o["view_side"] = s
                objs.append(o)
        return objs


def centre_x(obj):
    xs = [v.co.x for v in obj.data.vertices]
    return (min(xs) + max(xs)) / 2 if xs else 0.0


def split_at_seam(obj):
    """Cut an object at the seam plane into a San Francisco half and a Delhi half."""
    halves = []
    for side, clear_inner, clear_outer in (("sf", False, True), ("delhi", True, False)):
        o = obj.copy()
        o.data = obj.data.copy()
        bm = bmesh.new()
        bm.from_mesh(o.data)
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(SEAM_X, 0, 0), plane_no=(1, 0, 0), clear_inner=clear_inner,
                               clear_outer=clear_outer)
        bm.to_mesh(o.data)
        bm.free()
        if len(o.data.polygons):
            obj.users_collection[0].objects.link(o)
            halves.append((o, side))
        else:
            bpy.data.meshes.remove(o.data)
    bpy.data.meshes.remove(obj.data)
    return halves


def heightfield(b, x0, x1, y0, y1, step, height, mat, keep):
    """A faceted ground grid; faces where keep(x, y) is false (open water) are left out."""
    nx, ny = int((x1 - x0) / step) + 1, int((y1 - y0) / step) + 1
    rng = random.Random(SEED + int(x0 * 100))
    grid = {}
    for i in range(nx + 1):
        for j in range(ny + 1):
            x = x0 + (x1 - x0) * i / nx + (rng.uniform(-0.25, 0.25) * step if 0 < i < nx else 0)
            y = y0 + (y1 - y0) * j / ny + (rng.uniform(-0.25, 0.25) * step if 0 < j < ny else 0)
            grid[i, j] = (x, y, height(x, y))
    bm = b.bm
    before = set(bm.faces)
    verts = {}
    for i in range(nx):
        for j in range(ny):
            quad = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            pts = [grid[q] for q in quad]
            if not any(keep(p[0], p[1]) for p in pts) or max(p[2] for p in pts) < WATER_Z - 0.01:
                continue
            vs = []
            for q in quad:
                if q not in verts:
                    verts[q] = bm.verts.new(grid[q])
                vs.append(verts[q])
            bm.faces.new(vs)
    return b._wrap(before, None, mat)


def dome(b, mats_by_side):
    """The sky: rings of directions from the dome centre, each pushed out to the envelope."""
    bm = b.bm
    before = set(bm.faces)
    n_az, elevations = 48, [-3, 2, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 88]
    rings = []
    for el in elevations:
        ring = []
        for i in range(n_az + 1):
            az = math.radians(180 * i / n_az)
            d = Vector((math.cos(math.radians(el)) * math.cos(az), math.cos(math.radians(el)) * math.sin(az),
                        math.sin(math.radians(el))))
            ring.append(bm.verts.new(DOME_CENTRE + d * dome_radius(d)))
        rings.append(ring)
    top = bm.verts.new(DOME_CENTRE + Vector((0, 0, 1)) * dome_radius(Vector((0, 0, 1))))
    for a, c in zip(rings, rings[1:]):
        for i in range(n_az):
            bm.faces.new((a[i], a[i + 1], c[i + 1], c[i]))
    for i in range(n_az):
        bm.faces.new((rings[-1][i], rings[-1][i + 1], top))
    faces = [f for f in bm.faces if f not in before]
    for f in faces:
        f.normal_update()
        centre = f.calc_center_median()
        if f.normal.dot(centre - DOME_CENTRE) > 0:
            f.normal_flip()
    return b._wrap(before, None, None)


def water_plane(b, mat):
    """The bay: a fan of quads from the wall to the foot of the dome."""
    bm = b.bm
    before = set(bm.faces)
    n_az, n_r = 48, 10
    rings = []
    for k in range(n_r + 1):
        ring = []
        for i in range(n_az + 1):
            az = math.radians(180 * i / n_az)
            d = Vector((math.cos(az), math.sin(az), 0.0))
            r = dome_radius(Vector((d.x, d.y, -0.03)).normalized()) * (k / n_r) * 1.002
            p = DOME_CENTRE + d * r
            ring.append(bm.verts.new((p.x, max(p.y, WALL_BACK + 0.004), WATER_Z)))
        rings.append(ring)
    for a, c in zip(rings, rings[1:]):
        for i in range(n_az):
            try:
                bm.faces.new((a[i], c[i], c[i + 1], a[i + 1]))
            except ValueError:
                pass
    faces = [f for f in bm.faces if f not in before]
    for f in faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    return b._wrap(before, None, mat)


def sf_height(x, y):
    inland = sf_coast(y) - x
    h = WATER_Z - 0.02 + 0.045 * smoothstep(-0.01, 0.10, inland)
    for hx, hy, hh, hr in SF_HILLS:
        h += hh * math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / (hr * hr)) * smoothstep(-0.02, 0.08, inland)
    return h


def delhi_height(x, y):
    inland = x - delhi_coast(y)
    return WATER_Z - 0.02 + 0.03 * smoothstep(-0.01, 0.04, inland)


# ---- landmarks ----

def golden_gate(b, mats):
    """Two art-deco towers on piers, the deck on its truss, main cables, suspenders and the approaches."""
    x0, x1 = BRIDGE_X
    y = BRIDGE_Y
    half_w = 0.032
    b.box((x1 - x0, 2 * half_w, 0.010), loc=((x0 + x1) / 2, y, DECK_Z), mat=mats["ggb"])
    b.box((x1 - x0, 2 * half_w - 0.008, 0.012), loc=((x0 + x1) / 2, y, DECK_Z - 0.011), mat=mats["ggb_dark"])
    for k in range(int((x1 - x0) / 0.022)):
        xk = x0 + 0.011 + k * 0.022
        b.box((0.0025, 2 * half_w - 0.004, 0.012), loc=(xk, y, DECK_Z - 0.011), rot=(0, 45 if k % 2 else -45, 0),
              mat=mats["ggb_dark"])
    for xt in TOWERS_X:
        b.box((0.07, 0.11, 0.05), loc=(xt, y, WATER_Z + 0.005), mat=mats["concrete"])
        for side in (-1, 1):
            yl = y + side * (half_w + 0.004)
            for z0, z1, w in ((WATER_Z + 0.03, WATER_Z + 0.20, 0.016), (WATER_Z + 0.20, WATER_Z + 0.31, 0.013),
                              (WATER_Z + 0.31, TOWER_TOP, 0.010)):
                b.box((w + 0.004, w, z1 - z0), loc=(xt, yl, (z0 + z1) / 2), mat=mats["ggb"], bevel=0.0008, bevel_seg=1)
        for zs in (DECK_Z + 0.07, DECK_Z + 0.15, DECK_Z + 0.22, TOWER_TOP - 0.025):
            b.box((0.012, 2 * half_w + 0.006, 0.016 if zs < TOWER_TOP - 0.03 else 0.022), loc=(xt, y, zs),
                  mat=mats["ggb"])
        b.box((0.014, 2 * half_w + 0.006, 0.012), loc=(xt, y, DECK_Z - 0.03), mat=mats["ggb"])
        for side in (-1, 1):
            b.box((0.004, 0.004, 0.004), loc=(xt, y + side * (half_w + 0.004), TOWER_TOP + 0.003), mat=mats["red_light"])
    # Main cables: catenaries over the towers, down to the anchorages.
    for side in (-1, 1):
        yc = y + side * (half_w + 0.004)
        pts = []
        for k in range(61):
            x = x0 + (x1 - x0) * k / 60
            if x < TOWERS_X[0]:
                t = (x - x0) / (TOWERS_X[0] - x0)
                z = DECK_Z + 0.01 + (TOWER_TOP - 0.004 - DECK_Z - 0.01) * t ** 1.4
            elif x > TOWERS_X[1]:
                t = (x1 - x) / (x1 - TOWERS_X[1])
                z = DECK_Z + 0.01 + (TOWER_TOP - 0.004 - DECK_Z - 0.01) * t ** 1.4
            else:
                t = (x - TOWERS_X[0]) / (TOWERS_X[1] - TOWERS_X[0])
                z = DECK_Z + 0.022 + (TOWER_TOP - 0.004 - DECK_Z - 0.022) * (2 * t - 1) ** 2
            pts.append(Vector((x, yc, z)))
        b.tube(pts, 0.0019, sides=5, mat=mats["ggb"])
        for p in pts[1:-1:2]:
            if p.z - DECK_Z > 0.012 and all(abs(p.x - xt) > 0.01 for xt in TOWERS_X):
                facing_quad(b, p.x, yc, DECK_Z + 0.005, p.z, 0.0012, mats["ggb"])
        for k in range(1, 26):
            x = x0 + (x1 - x0) * k / 26
            facing_quad(b, x, y + side * (half_w - 0.002) - 0.003, DECK_Z + 0.0065, DECK_Z + 0.0095, 0.003,
                        mats["deck_lights"])
    for xa in (x0, x1):
        b.box((0.05, 0.09, 0.03), loc=(xa, y, DECK_Z - 0.005), mat=mats["concrete"])


def facing_quad(b, x, y, z0, z1, width, mat):
    """A thin vertical quad facing the room (-Y): suspenders and lamps, a quarter of a box's vertices."""
    bm = b.bm
    before = set(bm.faces)
    vs = [bm.verts.new((x - width / 2, y, z0)), bm.verts.new((x + width / 2, y, z0)),
          bm.verts.new((x + width / 2, y, z1)), bm.verts.new((x - width / 2, y, z1))]
    bm.faces.new(vs)
    return b._wrap(before, None, mat)


def sutro_tower(b, mats, base):
    """Three legs leaning in to a waist, cross-braced, each topped by an antenna mast: the trident on the hill."""
    bx, by = base
    bz = sf_height(bx, by) - 0.004
    h = 0.20
    legs = []
    for k in range(3):
        a = math.radians(90 + 120 * k)
        foot = Vector((bx + 0.034 * math.cos(a), by + 0.034 * math.sin(a), bz))
        waist = Vector((bx + 0.010 * math.cos(a), by + 0.010 * math.sin(a), bz + h * 0.55))
        top = Vector((bx + 0.022 * math.cos(a), by + 0.022 * math.sin(a), bz + h))
        legs.append((foot, waist, top))
        b.tube([foot, waist, top], 0.0026, sides=5, mat=mats["sutro"], radius_fn=lambda t: 0.0028 - 0.0012 * t)
        b.tube([top, top + Vector((0, 0, 0.055))], 0.0012, sides=4, mat=mats["sutro"])
        b.box((0.004, 0.004, 0.004), loc=tuple(top + Vector((0, 0, 0.057))), mat=mats["red_light"])
    for t in (0.2, 0.45, 0.75, 1.0):
        ring = []
        for foot, waist, top in legs:
            ring.append(foot.lerp(waist, t / 0.55) if t <= 0.55 else waist.lerp(top, (t - 0.55) / 0.45))
        for p, q in zip(ring, ring[1:] + ring[:1]):
            b.tube([p, q], 0.0011, sides=4, mat=mats["sutro"])


def painted_ladies(b, mats, rng):
    """A stepped row of Victorian houses with gables, bay windows and white trim, down the foreground slope."""
    x, y = 1.08, 0.80
    for i in range(5):
        w, d, hgt = 0.046, 0.05, 0.058
        xc = x + i * (w + 0.002)
        base = sf_height(xc, y) - 0.004
        mat = mats["houses"][i % len(mats["houses"])]
        b.box((w, d, hgt), loc=(xc, y, base + hgt / 2), mat=mat)
        roof = [(-w / 2, 0.0), (w / 2, 0.0), (0.0, 0.026)]
        faces = b.extrude(roof, d, mat=mats["roof"])
        bmesh.ops.transform(b.bm, matrix=Matrix.Translation((xc, y, base + hgt)),
                            verts=list({v for f in faces for v in f.verts}))
        b.box((w * 0.52, 0.010, hgt * 0.55), loc=(xc - w * 0.12, y - d / 2 - 0.005, base + hgt * 0.42), mat=mat)
        b.box((w + 0.003, 0.004, 0.004), loc=(xc, y - d / 2 - 0.001, base + hgt), mat=mats["trim"])
        b.box((w * 0.6, 0.006, 0.003), loc=(xc - w * 0.12, y - d / 2 - 0.008, base + hgt * 0.7), mat=mats["trim"])
        b.box((0.012, 0.016, 0.012), loc=(xc + w * 0.3, y - d / 2 - 0.008, base + 0.004), mat=mats["trim"])


def sf_city(b, mats, rng):
    """White and pastel houses on a street grid over the hills; none on Sutro's hilltop park."""
    rot = math.radians(10)
    step = 0.05
    for i in range(-40, 40):
        for j in range(-40, 40):
            gx, gy = i * step, j * step
            x = 0.6 + gx * math.cos(rot) - gy * math.sin(rot) + rng.uniform(-0.004, 0.004)
            y = 1.25 + gx * math.sin(rot) + gy * math.cos(rot) + rng.uniform(-0.004, 0.004)
            if y < 0.66 or x > SEAM_X - 0.02 or not inside_dome(Vector((x, y, sf_height(x, y) + 0.04)), 0.04):
                continue
            inland = sf_coast(y) - x
            hgt = sf_height(x, y)
            if inland < 0.025 or hgt > WATER_Z + 0.24 or math.hypot(x - SUTRO[0], y - SUTRO[1]) < 0.12:
                continue
            if 1.04 < x < SEAM_X and y < 0.86 or rng.random() < 0.25:
                continue
            w, d, h = rng.uniform(0.024, 0.04), rng.uniform(0.02, 0.032), rng.uniform(0.014, 0.034)
            mat = mats["city"] if rng.random() < 0.7 else rng.choice(mats["houses"])
            faces = b.box((w, d, h), loc=(x, y, hgt - 0.006 + h / 2), rot=(0, 0, 10 + rng.uniform(-4, 4)), mat=mat)
            bmesh.ops.delete(b.bm, geom=[f for f in faces if f.normal.z < -0.9], context="FACES")


def fog_height(x, y):
    """Karl the fog: a blanket lying over the hills behind the city, thickest at the back, lumpy, thinning to
    nothing toward the bay and the seam, so Sutro Tower stands out of it."""
    lumps = 0.55 + 0.25 * math.sin(x * 23.0 + 1.3) * math.sin(y * 17.0) + 0.2 * math.sin(x * 51.0 + y * 37.0)
    thick = 0.065 * smoothstep(1.58, 1.86, y) * (1 - smoothstep(SEAM_X - 0.22, SEAM_X - 0.02, x)) * lumps
    return sf_height(x, y) + thick, thick


def fog_bank(b, mats, rng):
    heightfield(b, -0.95, SEAM_X, 1.6, 2.35, 0.05, lambda x, y: fog_height(x, y)[0], mats["fog"],
                keep=lambda x, y: fog_height(x, y)[1] > 0.012 and inside_dome(Vector((x, y, fog_height(x, y)[0])), 0.03))


def lotus_temple(b, mats, centre):
    """Bahá'í House of Worship: nine-sided podium and pools, three rings of nine marble petals."""
    cx, cy = centre
    base = delhi_height(cx, cy)
    b.lathe([(0.0, 0.0), (0.085, 0.0), (0.085, 0.006), (0.0, 0.006)], segments=9, loc=(cx, cy, base - 0.002),
            mat=mats["ghat"], phase=math.radians(20))
    b.lathe([(0.0, 0.0), (0.078, 0.0), (0.078, 0.0015), (0.0, 0.0015)], segments=9, loc=(cx, cy, base + 0.004),
            mat=mats["pool"], phase=math.radians(20))
    b.lathe([(0.0, 0.0), (0.050, 0.0), (0.050, 0.010), (0.0, 0.010)], segments=9, loc=(cx, cy, base + 0.004),
            mat=mats["marble"], phase=math.radians(20))
    z0 = base + 0.013
    rings = [(0.050, 0.030, 0.034, 30, 0.0), (0.034, 0.050, 0.030, 8, 20.0), (0.016, 0.066, 0.024, -12, 0.0)]
    for r0, height, width, lean, phase in rings:
        for k in range(9):
            a = math.radians(40 * k + phase)
            add_petal(b, mats["marble"], Vector((cx, cy, z0)), a, r0, height, width, lean)


def add_petal(b, mat, centre, az, r0, height, width, lean_deg):
    """One petal: a pointed, cupped shell rising from radius r0, leaning outward by lean_deg."""
    bm = b.bm
    before = set(bm.faces)
    nu, nv = 5, 3
    rows = []
    out = Vector((math.cos(az), math.sin(az), 0))
    side = Vector((-math.sin(az), math.cos(az), 0))
    lean = math.radians(lean_deg)
    for i in range(nu + 1):
        u = i / nu
        w = width / 2 * math.sin(math.pi * min(u * 0.92 + 0.08, 1.0)) ** 0.8 * (1 - u ** 3)
        rise = height * u
        reach = r0 + rise * math.tan(lean) + 0.012 * math.sin(math.pi * u) * (1 if lean_deg >= 0 else -1)
        row = []
        for j in range(nv + 1):
            v = -1 + 2 * j / nv
            cup = 0.006 * (1 - v * v) * (1 - u)
            p = centre + out * (reach - cup) + side * (w * v) + Vector((0, 0, rise))
            row.append(bm.verts.new(p))
        rows.append(row)
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
    faces = [f for f in bm.faces if f not in before]
    bmesh.ops.solidify(bm, geom=faces, thickness=0.0012)
    faces = [f for f in bm.faces if f not in before]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return b._wrap(before, None, mat)


def india_gate(b, mats, centre):
    """The war memorial arch: a deep block pierced by the great arch, cornices, attic and the shallow bowl."""
    cx, cy = centre
    base = delhi_height(cx, cy) + 0.004
    w, d, h = 0.074, 0.030, 0.090
    r = 0.016
    spring = 0.042
    sand = mats["sandstone"]
    b.box((w + 0.02, d + 0.02, 0.006), loc=(cx, cy, base - 0.003), mat=mats["path"])
    pier = w / 2 - r
    for side in (-1, 1):
        b.box((pier, d, spring + r), loc=(cx + side * (r + pier / 2), cy, base + (spring + r) / 2), mat=sand)
    b.box((w, d, h - spring - r), loc=(cx, cy, base + spring + r + (h - spring - r) / 2), mat=sand)
    # Spandrels between the round arch and the crown line, one convex quad per arc segment.
    n = 8
    for k in range(n):
        a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
        x0, x1 = r * math.cos(a0), r * math.cos(a1)
        quad = [(x1, r * math.sin(a1)), (x0, r * math.sin(a0)), (x0, r), (x1, r)]
        quad = [q for q in quad]
        faces = b.extrude([(quad[0][0], quad[0][1]), (quad[1][0], quad[1][1]), (quad[2][0], quad[2][1]),
                           (quad[3][0], quad[3][1])][::-1] if x0 > x1 else quad, d, mat=sand)
        bmesh.ops.transform(b.bm, matrix=Matrix.Translation((cx, cy, base + spring)),
                            verts=list({v for f in faces for v in f.verts}))
    z = base + h
    b.box((w + 0.006, d + 0.006, 0.004), loc=(cx, cy, z + 0.002), mat=sand)
    b.box((w * 0.82, d * 0.82, 0.012), loc=(cx, cy, z + 0.010), mat=sand)
    b.box((w * 0.86, d * 0.86, 0.003), loc=(cx, cy, z + 0.0175), mat=sand)
    b.lathe([(0.0, 0.0), (0.016, 0.0), (0.020, 0.006), (0.0, 0.004)], segments=16, loc=(cx, cy, z + 0.019), mat=sand)


def qutub_minar(b, mats, centre):
    """Five storeys of fluted red sandstone narrowing upward, a corbelled balcony at each storey and a cupola."""
    cx, cy = centre
    base = delhi_height(cx, cy)
    storeys = [(0.024, 0.019, 0.080), (0.019, 0.0155, 0.058), (0.0155, 0.0128, 0.044), (0.0128, 0.0108, 0.030),
               (0.0108, 0.0095, 0.026)]
    z = base - 0.002
    for k, (r0, r1, hgt) in enumerate(storeys):
        flutes = 16
        b.lathe([(r0, 0.0), (r1, hgt)], segments=flutes * 2, loc=(cx, cy, z), mat=mats["red_sandstone"],
                radial=(lambda i, j, r, k=k: r * (1.0 if i % 2 == 0 else (0.90 if k < 1 else 0.93))))
        z += hgt
        b.lathe([(r1 * 0.98, -0.004), (r1 + 0.005, -0.001), (r1 + 0.005, 0.0015), (r1 * 0.98, 0.0015)], segments=16,
                loc=(cx, cy, z), mat=mats["red_sandstone"], cap_start=False, cap_end=False)
    b.lathe([(0.0090, 0.0), (0.0085, 0.010), (0.006, 0.014), (0.0, 0.016)], segments=12, loc=(cx, cy, z),
            mat=mats["red_sandstone"])


def delhi_ground(b, mats, rng):
    """Lawns and paths around the monuments, a stepped ghat down to the water, trees, low whitewashed houses and
    street lamps along the river front."""
    xs = delhi_coast(0.62)
    for k in range(4):
        y0, y1 = WALL_BACK + 0.02, 1.30
        steps = []
        for j in range(12):
            y = y0 + (y1 - y0) * j / 11
            steps.append((delhi_coast(y) - 0.012 * (3 - k), y))
        for (xa, ya), (xb, yb) in zip(steps, steps[1:]):
            z = WATER_Z - 0.012 + 0.0075 * k
            b.box((0.014, yb - ya + 0.001, 0.008), loc=(xa + 0.007, (ya + yb) / 2, z), mat=mats["ghat"])
    for centre, size in ((INDIA_GATE, (0.16, 0.14)), (LOTUS, (0.20, 0.18)), (QUTUB, (0.10, 0.10))):
        cx, cy = centre
        b.box((size[0], size[1], 0.003), loc=(cx, cy, delhi_height(cx, cy) + 0.0005), mat=mats["lawn"])
    b.box((0.012, 0.30, 0.0035), loc=(INDIA_GATE[0], INDIA_GATE[1] - 0.12, delhi_height(*INDIA_GATE) + 0.001),
          mat=mats["path"])
    for k in range(36):
        x, y = rng.uniform(1.45, 1.95), rng.uniform(0.62, 1.32)
        if x < delhi_coast(y) + 0.02 or not inside_dome(Vector((x, y, WATER_Z + 0.05)), 0.03):
            continue
        if any(math.hypot(x - c[0], y - c[1]) < r for c, r in ((INDIA_GATE, 0.06), (LOTUS, 0.10), (QUTUB, 0.04))):
            continue
        r = rng.uniform(0.010, 0.018)
        faces = b.lathe([(0.0, 0.0), (r, r * 0.4), (r * 0.9, r * 1.2), (0.0, r * 1.6)], segments=6, mat=mats["trees"],
                        phase=rng.uniform(0, 1))
        bmesh.ops.transform(b.bm, matrix=Matrix.Translation((x, y, delhi_height(x, y) + 0.004)),
                            verts=list({v for f in faces for v in f.verts}))
    for k in range(96):
        x, y = (rng.uniform(1.62, 1.98), rng.uniform(1.12, 1.45)) if k < 18 else (rng.uniform(1.30, 1.90),
                                                                                      rng.uniform(1.62, 2.1)) \
            if k < 60 else (rng.uniform(1.95, 2.30), rng.uniform(1.40, 2.05))
        if x < delhi_coast(y) + 0.03 or not inside_dome(Vector((x, y, WATER_Z + 0.06)), 0.04):
            continue
        w, d, h = rng.uniform(0.016, 0.03), rng.uniform(0.014, 0.024), rng.uniform(0.010, 0.026)
        b.box((w, d, h), loc=(x, y, delhi_height(x, y) + h / 2 - 0.002), rot=(0, 0, rng.uniform(-8, 8)),
              mat=mats["delhi_city"])
    for j in range(14):
        y = WALL_BACK + 0.08 + j * 0.05
        x = delhi_coast(y) + 0.006
        b.cylinder(0.0008, 0.016, segments=4, loc=(x, y, delhi_height(x, y)), mat=mats["roof"])
        b.box((0.0035, 0.0035, 0.0035), loc=(x, y, delhi_height(x, y) + 0.017), mat=mats["street_lights"])
    for j in range(10):
        y = 0.72 + j * 0.06
        x = sf_coast(y) - 0.008
        if y > 0.95:
            b.cylinder(0.0008, 0.016, segments=4, loc=(x, y, sf_height(x, y)), mat=mats["roof"])
            b.box((0.0035, 0.0035, 0.0035), loc=(x, y, sf_height(x, y) + 0.017), mat=mats["street_lights"])


def boats(b, mats):
    """A sloop on the bay and a rowing boat at the ghat."""
    hull = [(-0.03, 0.0), (0.03, 0.0), (0.024, 0.008), (-0.026, 0.008)]
    for (x, y), scale, sail in (((1.12, 1.06), 1.0, True), ((1.50, 0.70), 0.7, False)):
        faces = b.extrude(hull, 0.016 * scale, mat=mats["hull"])
        m = Matrix.Translation((x, y, WATER_Z - 0.003)) @ Matrix.Diagonal((scale, scale, scale, 1.0))
        bmesh.ops.transform(b.bm, matrix=m, verts=list({v for f in faces for v in f.verts}))
        if sail:
            b.tube([Vector((x, y, WATER_Z + 0.005)), Vector((x, y, WATER_Z + 0.075))], 0.0008, sides=4,
                   mat=mats["roof"])
            faces = b.extrude([(0.001, 0.0), (0.034, 0.0), (0.001, 0.066)], 0.0012, mat=mats["sail"])
            bmesh.ops.transform(b.bm, matrix=Matrix.Translation((x, y, WATER_Z + 0.009)),
                                verts=list({v for f in faces for v in f.verts}))


# ---- round seven: more landmarks, and a far ridge for depth ----

def transamerica(b, mats, base):
    """The Transamerica Pyramid: a slender four-sided spire with the two 'wings' of its lift shafts, on a podium."""
    x, y = base
    z = sf_height(x, y) - 0.004
    w, h = 0.044, 0.27
    b.box((w * 1.3, w * 1.3, 0.008), loc=(x, y, z + 0.004), mat=mats["concrete"])
    b.frustum((w, w), (0.002, 0.002), h, loc=(x, y, z + 0.008), mat=mats["tower_white"])
    for side in (-1, 1):
        b.frustum((0.012, 0.014), (0.006, 0.010), h * 0.42, loc=(x + side * w * 0.42, y, z + h * 0.30),
                  mat=mats["tower_white"])
    b.box((0.0016, 0.0016, 0.03), loc=(x, y, z + 0.008 + h + 0.012), mat=mats["crown"])


def salesforce(b, mats, base):
    """Salesforce Tower: a tall obelisk with rounded corners and a domed top whose crown lights up at night."""
    x, y = base
    z = sf_height(x, y) - 0.004
    w, h = 0.040, 0.30
    b.box((w, w, h), loc=(x, y, z + h / 2), mat=mats["tower_glass"], corner=0.008, corner_seg=3)
    b.lathe([(w / 2 - 0.001, 0.0), (w / 2 - 0.003, 0.012), (w / 2 - 0.009, 0.022), (0.006, 0.030), (0.0, 0.032)],
            segments=12, loc=(x, y, z + h), mat=mats["crown"])


def downtown(b, mats, rng):
    """A cluster of towers around the two landmarks, tallest in the middle, so the skyline climbs behind the
    Painted Ladies."""
    (x0, x1), (y0, y1), (cx, cy) = DOWNTOWN
    for k in range(34):
        x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
        if math.hypot(x - TRANSAMERICA[0], y - TRANSAMERICA[1]) < 0.045 or math.hypot(x - SALESFORCE[0], y - SALESFORCE[1]) < 0.045:
            continue
        if sf_coast(y) - x < 0.03 or not inside_dome(Vector((x, y, WATER_Z + 0.2)), 0.04):
            continue
        centre = math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 0.012)
        w, d = rng.uniform(0.022, 0.036), rng.uniform(0.022, 0.034)
        h = 0.05 + 0.16 * centre * rng.uniform(0.6, 1.0)
        mat = mats["tower_glass"] if rng.random() < 0.5 else mats["tower_white"]
        faces = b.box((w, d, h), loc=(x, y, sf_height(x, y) - 0.004 + h / 2), rot=(0, 0, 10 + rng.uniform(-3, 3)), mat=mat)
        bmesh.ops.delete(b.bm, geom=[f for f in faces if f.normal.z < -0.9], context="FACES")
    transamerica(b, mats, TRANSAMERICA)
    salesforce(b, mats, SALESFORCE)


def coit_tower(b, mats, base):
    """Coit Tower on Telegraph Hill: a fluted white column with a crown of arched openings."""
    x, y = base
    z = sf_height(x, y) - 0.003
    b.lathe([(0.014, 0.0), (0.016, 0.006), (0.0, 0.006)], segments=16, loc=(x, y, z), mat=mats["trim"])
    b.lathe([(0.0098, 0.0), (0.0098, 0.062), (0.0115, 0.066), (0.0108, 0.072), (0.0, 0.074)], segments=16,
            loc=(x, y, z + 0.006), mat=mats["tower_white"],
            radial=lambda i, j, r: r * (0.88 if i % 2 and 0 < j < 2 else 1.0))


def alcatraz(b, mats, base):
    """Alcatraz in the bay: a low rocky island, the long cellhouse on top and the lighthouse beside it."""
    x, y = base
    b.lathe([(0.0, 0.0), (0.065, 0.0), (0.05, 0.010), (0.03, 0.022), (0.0, 0.026)], segments=14,
            loc=(x, y, WATER_Z - 0.006), mat=mats["rock"], radial=lambda i, j, r: r * (1.0 + 0.18 * math.sin(i * 1.7)))
    b.box((0.05, 0.02, 0.012), loc=(x - 0.005, y + 0.004, WATER_Z + 0.022), rot=(0, 0, 12), mat=mats["concrete"])
    b.cylinder(0.0025, 0.035, segments=6, loc=(x + 0.026, y - 0.004, WATER_Z + 0.036), mat=mats["trim"])
    b.box((0.004, 0.004, 0.004), loc=(x + 0.026, y - 0.004, WATER_Z + 0.055), mat=mats["deck_lights"])


def humayun_tomb(b, mats, base):
    """Humayun's Tomb: a red sandstone plinth of arches, the octagonal hall trimmed in white marble, its white
    double dome with a finial, and four small domed pavilions (chhatris) on the roof."""
    x, y = base
    z = delhi_height(x, y)
    b.box((0.13, 0.13, 0.016), loc=(x, y, z + 0.006), mat=mats["red_stone"])
    b.lathe([(0.048, 0.0), (0.048, 0.040), (0.0, 0.040)], segments=8, loc=(x, y, z + 0.014), mat=mats["red_stone"],
            phase=math.radians(22.5))
    b.lathe([(0.0485, 0.0), (0.0485, 0.004), (0.0, 0.004)], segments=8, loc=(x, y, z + 0.054), mat=mats["marble"],
            phase=math.radians(22.5))
    b.lathe([(0.020, 0.0), (0.022, 0.010), (0.028, 0.026), (0.024, 0.042), (0.012, 0.052), (0.002, 0.058), (0.0, 0.066)],
            segments=20, loc=(x, y, z + 0.058), mat=mats["marble"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = x + sx * 0.034, y + sy * 0.034
            b.box((0.012, 0.012, 0.010), loc=(cx, cy, z + 0.063), mat=mats["red_stone"])
            b.lathe([(0.008, 0.0), (0.007, 0.006), (0.0, 0.011)], segments=10, loc=(cx, cy, z + 0.068), mat=mats["marble"])


def jama_masjid(b, mats, base):
    """Jama Masjid: a red sandstone prayer hall under three white domes, the middle one largest, between two tall
    minarets with their pavilions."""
    x, y = base
    z = delhi_height(x, y)
    b.box((0.12, 0.05, 0.03), loc=(x, y, z + 0.015), mat=mats["red_stone"])
    for dx, r in ((-0.036, 0.013), (0.0, 0.019), (0.036, 0.013)):
        b.lathe([(r * 0.8, 0.0), (r, 0.008), (r * 0.85, 0.02), (r * 0.4, 0.03), (0.0, 0.034 * r / 0.019)], segments=16,
                loc=(x + dx, y, z + 0.030), mat=mats["marble"])
    for sx in (-1, 1):
        mx = x + sx * 0.068
        b.cylinder(0.0045, 0.10, segments=8, loc=(mx, y - 0.01, z + 0.05), mat=mats["red_stone"])
        b.lathe([(0.0065, 0.0), (0.006, 0.004), (0.0, 0.010)], segments=8, loc=(mx, y - 0.01, z + 0.10), mat=mats["marble"])


def red_fort(b, mats):
    """The Red Fort's wall across the back of Delhi: a long crenellated red sandstone curtain wall with the Lahori
    Gate's two octagonal towers and their small white pavilions."""
    y = RED_FORT_Y
    x0, x1 = 1.40, 2.10
    x = x0
    while x < x1:
        seg = min(0.06, x1 - x)
        if inside_dome(Vector((x + seg / 2, y, WATER_Z + 0.06)), 0.03):
            b.box((seg, 0.022, 0.05), loc=(x + seg / 2, y, delhi_height(x, y) + 0.025), mat=mats["red_stone"])
            for k in range(int(seg / 0.012)):
                b.box((0.006, 0.022, 0.006), loc=(x + 0.006 + k * 0.012, y, delhi_height(x, y) + 0.053), mat=mats["red_stone"])
        x += seg
    gx = 1.74
    if inside_dome(Vector((gx, y, WATER_Z + 0.08)), 0.03):
        for sx in (-1, 1):
            tx = gx + sx * 0.03
            b.lathe([(0.012, 0.0), (0.012, 0.075), (0.0, 0.075)], segments=8, loc=(tx, y - 0.004, delhi_height(tx, y)),
                    mat=mats["red_stone"])
            b.lathe([(0.010, 0.0), (0.009, 0.007), (0.0, 0.014)], segments=10, loc=(tx, y - 0.004, delhi_height(tx, y) + 0.075),
                    mat=mats["marble"])
        b.box((0.05, 0.026, 0.065), loc=(gx, y - 0.002, delhi_height(gx, y) + 0.0325), mat=mats["red_stone"])


def far_ridge(b, mats):
    """The Delhi Ridge: low wooded hills along the back of the Delhi half, just inside the sky, a last layer for the
    eye before the sky."""
    bm = b.bm
    before = set(bm.faces)
    n = 24
    row_lo, row_hi = [], []
    for i in range(n + 1):
        az = math.radians(70 * i / n)
        d = Vector((math.cos(az), math.sin(az), 0.0))
        r = dome_radius(Vector((d.x, d.y, 0.02)).normalized()) * 0.94
        p = DOME_CENTRE + d * r
        h = 0.018 + 0.03 * (0.5 + 0.5 * math.sin(i * 0.9 + 1.0)) * (0.6 + 0.4 * math.sin(i * 0.37)) * math.sin(math.pi * i / n) ** 0.5
        row_lo.append(bm.verts.new((p.x, p.y, WATER_Z - 0.01)))
        row_hi.append(bm.verts.new((p.x * 0.995 + DOME_CENTRE.x * 0.005, p.y * 0.995 + DOME_CENTRE.y * 0.005, WATER_Z + h)))
    for i in range(n):
        bm.faces.new((row_lo[i], row_lo[i + 1], row_hi[i + 1], row_hi[i]))
    faces = [f for f in bm.faces if f not in before]
    for f in faces:
        f.normal_update()
        if f.normal.dot(DOME_CENTRE - f.calc_center_median()) < 0:
            f.normal_flip()
    return b._wrap(before, None, mats["ridge"])


# ---- lights ----

def build_lights():
    """Sun and sky fill by day; moon, floodlights on the monuments and the bridge's glow by night."""
    coll = collection("window_lights")

    def add(name, kind, loc, color, energy, mode, aim=None, size=0.05, spot=None):
        data = bpy.data.lights.new(name, kind)
        data.color = color
        data.energy = energy
        if kind == "SUN":
            data.angle = math.radians(size)
        elif kind == "SPOT":
            data.spot_size, data.spot_blend = math.radians(spot or 60), 0.5
            data.shadow_soft_size = size
        else:
            data.shadow_soft_size = size
        obj = bpy.data.objects.new(f"window_light_{name}", data)
        obj.location = loc
        if aim is not None:
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = (Vector(aim) - Vector(loc)).normalized().to_track_quat("-Z", "Y")
        obj["window_mode"] = mode
        obj["window_energy"] = energy
        coll.objects.link(obj)
        obj.hide_render = True
        return obj

    add("sun", "SUN", (0.0, 0.8, 3.0), (1.0, 0.92, 0.80), 2.6, "day", aim=(1.0, 1.6, WATER_Z), size=2.0)
    add("sky_fill", "SUN", (2.0, 0.6, 3.0), (0.55, 0.68, 0.95), 0.6, "day", aim=(0.6, 1.8, WATER_Z), size=30.0)
    add("moon", "SUN", (2.5, 0.8, 3.0), (0.55, 0.65, 1.0), 0.12, "night", aim=(0.8, 1.5, WATER_Z), size=3.0)
    for name, target, color, energy, offset in (
            ("india_gate", INDIA_GATE, (1.0, 0.68, 0.35), 2.2, (-0.10, -0.12, 0.02)),
            ("qutub", QUTUB, (1.0, 0.62, 0.32), 1.6, (-0.08, -0.10, 0.03)),
            ("lotus", LOTUS, (0.80, 0.86, 1.0), 0.9, (0.0, -0.14, 0.05)),
            ("tower_sf", (TOWERS_X[0], BRIDGE_Y), (1.0, 0.55, 0.30), 2.5, (0.05, -0.15, 0.04)),
            ("tower_delhi", (TOWERS_X[1], BRIDGE_Y), (1.0, 0.55, 0.30), 2.5, (-0.05, -0.15, 0.04)),
            ("humayun", HUMAYUN, (1.0, 0.86, 0.66), 1.4, (-0.06, -0.14, 0.05)),
            ("jama_masjid", JAMA_MASJID, (1.0, 0.80, 0.55), 1.0, (0.05, -0.14, 0.05)),
            ("transamerica", TRANSAMERICA, (0.95, 0.92, 0.85), 1.2, (0.08, -0.12, 0.06))):
        tx, ty = target
        tz = WATER_Z + 0.08
        add(f"flood_{name}", "SPOT", (tx + offset[0], ty + offset[1], tz + offset[2]), color, energy, "night",
            aim=(tx, ty, tz + 0.04), size=0.02, spot=55)
    add("city_glow_sf", "POINT", (0.45, 1.25, WATER_Z + 0.06), (1.0, 0.55, 0.25), 3.0, "night", size=0.3)
    add("city_glow_delhi", "POINT", (1.80, 1.20, WATER_Z + 0.05), (1.0, 0.58, 0.26), 2.0, "night", size=0.3)


# ---- assembly ----

def build_window_view(framings):
    """Build both halves of the view and its lights behind the room's window (framings: the room's cameras,
    {name: (position, target)}); returns the part objects."""
    setup_viewpoints(framings)
    rng = random.Random(SEED)
    mats = build_materials()
    parts = Parts()

    water = pl.Builder("water")
    water_plane(water, mats["water"])
    parts.add("water", water, texel=0.35, split=True)

    sf = pl.Builder("land")
    heightfield(sf, -0.95, SEAM_X, WALL_BACK + 0.01, 2.35, 0.055, sf_height,
                mats["sf_land"], keep=lambda x, y: x < sf_coast(y) + 0.02 and inside_dome(Vector((x, y, sf_height(x, y)))))
    parts.add("land", sf, texel=0.7, side="sf")

    city = pl.Builder("city")
    sf_city(city, mats, rng)
    painted_ladies(city, mats, rng)
    parts.add("city", city, texel=1.6, side="sf")

    tower = pl.Builder("sutro")
    sutro_tower(tower, mats, SUTRO)
    parts.add("sutro", tower, texel=1.2, side="sf")

    sky_line = pl.Builder("skyline")
    downtown(sky_line, mats, random.Random(SEED + 3))
    coit_tower(sky_line, mats, COIT)
    parts.add("skyline", sky_line, texel=2.0, side="sf")

    rock = pl.Builder("alcatraz")
    alcatraz(rock, mats, ALCATRAZ)
    parts.add("alcatraz", rock, texel=1.6, side="sf")

    ridge = pl.Builder("ridge")
    far_ridge(ridge, mats)
    parts.add("ridge", ridge, texel=0.25, side="delhi")

    fog = pl.Builder("fog")
    fog_bank(fog, mats, rng)
    parts.add("fog", fog, texel=0.35, side="sf", smooth=True)

    bridge = pl.Builder("bridge")
    golden_gate(bridge, mats)
    parts.add("bridge", bridge, texel=2.2, split=True)

    boat = pl.Builder("boats")
    boats(boat, mats)
    parts.add("boats", boat, texel=1.2, split=True)

    dl = pl.Builder("land")
    heightfield(dl, SEAM_X, 2.1, WALL_BACK + 0.01, 1.8, 0.04, delhi_height, mats["delhi_land"],
                keep=lambda x, y: x > delhi_coast(y) - 0.02 and inside_dome(Vector((x, y, WATER_Z + 0.04))))
    parts.add("land", dl, texel=0.7, side="delhi")

    ground = pl.Builder("ground")
    delhi_ground(ground, mats, rng)
    parts.add("ground", ground, texel=1.2, split=True)

    monuments = pl.Builder("monuments")
    lotus_temple(monuments, mats, LOTUS)
    india_gate(monuments, mats, INDIA_GATE)
    qutub_minar(monuments, mats, QUTUB)
    humayun_tomb(monuments, mats, HUMAYUN)
    jama_masjid(monuments, mats, JAMA_MASJID)
    red_fort(monuments, mats)
    parts.add("monuments", monuments, texel=2.6, side="delhi")

    objs = parts.build() + [build_sky()]
    check_hidden(objs)
    build_lights()
    place_in_room(objs)
    build_sky_markers(framings)
    set_night(0.0)
    return objs


def build_sky():
    """The sky dome as one object across both cities, window_sky (atlas window_sky, which bake.py never bakes)."""
    sky = pl.Builder("sky")
    faces = dome(sky, None)
    sky.materials = [sky_material("sf"), sky_material("delhi")]
    for f in faces:
        f.material_index = 0 if f.calc_center_median().x < SEAM_X else 1
    me = bpy.data.meshes.new("window_sky")
    sky.bm.normal_update()
    sky.bm.to_mesh(me)
    sky.bm.free()
    for m in sky.materials:
        me.materials.append(m)
    obj = bpy.data.objects.new("window_sky", me)
    collection("window_view").objects.link(obj)
    me.shade_smooth()
    cull_unseen(obj)
    obj["atlas"] = "window_sky"
    return obj


def build_sky_markers(framings):
    """window_sky_centre: the dome's centre in the room (sky directions start there), and window_sky_eye: the window
    framing's eye, from which both the sky and the city line blend from one city to the other across the window."""
    for name, location in (("window_sky_centre", DIORAMA_TO_ROOM @ DOME_CENTRE),
                           ("window_sky_eye", Vector(framings["cam_window"][0]))):
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type, empty.empty_display_size = "PLAIN_AXES", 0.08
        empty.location = location
        collection("markers").objects.link(empty)


def place_in_room(objs):
    """Carry the diorama (built and checked in its own frame) behind the room's window. Mesh data stays in the
    diorama's frame, so the materials' object-space patterns keep their scale; point and spot lights get VIEW_SCALE
    squared more power for the same light at the scaled distances."""
    for obj in objs:
        obj.matrix_world = DIORAMA_TO_ROOM @ obj.matrix_world
    for light in bpy.data.collections["window_lights"].objects:
        light.matrix_world = DIORAMA_TO_ROOM @ light.matrix_world
        light.scale = (1.0, 1.0, 1.0)
        if light.data.type in ("POINT", "SPOT"):
            light.data.energy *= VIEW_SCALE ** 2
            light["window_energy"] = light.data.energy
        if light.data.type != "SUN":
            light.data.shadow_soft_size *= VIEW_SCALE


# ---- previews of the view alone ----

def preview_scene():
    """A bare back wall with the window opening and the room's framings, for quick looks at the view."""
    import build_room
    mats = build_room.build_materials()
    build_room.build_shell(mats)
    build_room.build_window(mats)
    bpy.data.objects["env_sky"].hide_render = True
    for name, (pos, target) in build_room.CAMERAS.items():
        build_room.add_empty(name, pos, coll="cameras", fov_deg=build_room.CAMERA_FOV_DEG)
        build_room.add_empty(f"{name}_target", target, coll="cameras")
    build_room.setup_world_and_render()


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = Path(argv[0]) if argv else Path("/tmp")
    mode = argv[1] if len(argv) > 1 else "day"
    cams = argv[2:] or ["cam_window"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import build_room
    preview_scene()
    objs = build_window_view(build_room.CAMERAS)
    set_night(1.0 if mode == "night" else 0.0)
    for obj in bpy.data.collections["window_lights"].objects:
        obj.hide_render = obj["window_mode"] != mode
    scene = bpy.context.scene
    scene.cycles.samples = 64
    scene.render.threads_mode, scene.render.threads = "FIXED", 16
    scene.render.resolution_x, scene.render.resolution_y = 1200, 750
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    tris = sum(len(o.data.polygons) for o in objs)
    print(f"VIEW parts={len(objs)} faces={tris}")
    for cam in cams:
        build_room.aim_camera(cam)
        scene.render.filepath = str(out / f"view_{mode}_{cam}.png")
        bpy.ops.render.render(write_still=True)
        print("VIEW_RENDER", cam)


if __name__ == "__main__":
    main()
