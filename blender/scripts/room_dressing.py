"""The lived-in layer of the room: the kitchen corner, the poster plaque, the photo wall, the album, the projector's
program dial, books, records, fairy lights, desk clutter and CC0 plants and objects.

build_room.py calls build_dressing() after the props are placed. Everything here is baked into an atlas except the
photo prints (photo_print_*), which the site textures at runtime like the posters.
"""

import math
import random
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

import props_lib as pl
from import_henry import CACHE, fetch_cached
from room_lib import X_LEFT, Y_BACK, add_box, add_cylinder, collection, new_object, smooth_by_angle

SEED = 20261012

# Newsreader (SIL OFL), the site's heading face, pinned to the Google Fonts commit that added it.
NEWSREADER = ("https://raw.githubusercontent.com/google/fonts/991ce1de6075188e6b8977a5aa9fcd3610a4e946/ofl/newsreader/"
              "Newsreader%5Bopsz,wght%5D.ttf", "8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1")

# Kitchen corner: a walnut sideboard under the posters, its long side against the left wall.
SIDEBOARD_X0, SIDEBOARD_X1 = X_LEFT, X_LEFT + 0.40
SIDEBOARD_Y0, SIDEBOARD_Y1 = -1.86, -0.72
SIDEBOARD_TOP = 0.76

PLAQUE_CENTRE = Vector((X_LEFT + 0.006, -1.67, 1.272))
PLAQUE_TEXT = "Four favourites — from Letterboxd"

# Photo wall on the back wall above the projector screen: (x, z) centre of the picture, picture width and height.
# Slots 0-2 take the aspect of the three prints the photography marks for the wall (square, 4:3, 16:9); 3 and 4
# are a 3:2 landscape and a 4:5 portrait for the rest of the collection.
PHOTO_SLOTS = [((-1.78, 2.30), (0.24, 0.24)), ((-2.22, 2.30), (0.24, 0.18)), ((-1.30, 2.30), (0.28, 0.159)),
               ((-2.03, 1.965), (0.18, 0.12)), ((-1.56, 1.965), (0.12, 0.15))]
PHOTO_MAT, PHOTO_FRAME = 0.034, 0.016
# Stills only: the prints the photography collection puts on the wall, then two more from the collection.
STILL_PHOTOS = ["sweat-and-toil", "cansupport", "visual-depiction-paresthesia", "circles", "voice"]
SAFELIGHT = Vector((-2.475, Y_BACK - 0.035, 2.30))
READING_CHAIR = (Vector((1.62, -2.12, 0.0)), -143.0)  # facing back into the room, toward the desk
FLOOR_LAMP = Vector((2.12, -2.50, 0.0))

DESK_TOP = 0.7325
SHELF_LOW, SHELF_TOP = 1.6475, 2.0075
ALBUM = (Vector((-0.875, -0.33, DESK_TOP)), 10.0)
ALBUM_SIZE = (0.26, 0.21, 0.052)

CC0 = {
    # name: (Poly Haven id, location, z rotation in degrees, height in metres, triangle budget)
    "props_syngonium": ("potted_plant_02", (1.86, -0.26, 0.0), 200, 0.62, 2400),
    "props_haworthia": ("potted_plant_04", (1.64, 0.355, 0.92), 30, 0.17, 4000),
    "props_vase": ("ceramic_vase_01", (-0.20, 0.30, SHELF_TOP), 0, 0.19, 2600),
    "props_lota": ("brass_vase_03", (0.252, 0.30, SHELF_LOW), 0, 0.15, 2700),
    "props_alarm_clock": ("alarm_clock_01", (0.17, 0.30, SHELF_TOP), -25, 0.13, 3500),
    "props_tea_tin": ("oil_tin", (-2.40, -0.95, SIDEBOARD_TOP + 0.227), 80, 0.11, 2900),
    "props_pen_cup": ("stationery_supplies", (-0.30, 0.16, DESK_TOP), 0, None, 3000),
    "props_lounge_chair": ("mid_century_lounge_chair", (*READING_CHAIR[0].xy, 0.0), READING_CHAIR[1], 0.92, 2600),
}


def build_dressing(mats, placed):
    """Add every dressing item; returns the objects the click proxies and markers need."""
    rng = random.Random(SEED)
    found = {}
    build_sideboard(mats)
    found["plaque"] = build_plaque(mats)
    found.update(build_photo_wall(mats))
    found["album"] = build_album()
    found["dial"] = build_projector_dial(placed)
    build_books(rng)
    build_fairy_lights()
    build_records(rng)
    build_desk_clutter(rng)
    found["cc0"] = {name: import_cc0(name, *spec) for name, spec in CC0.items()}
    build_jacket()
    build_pothos(rng)
    build_floor_books(rng)
    found["floor_lamp"] = build_reading_corner()
    return found


# ---- helpers ----

def newsreader():
    path = fetch_cached(NEWSREADER[0], CACHE / "fonts" / "Newsreader.ttf", NEWSREADER[1])
    return bpy.data.fonts.load(str(path), check_existing=True)


def finish(builder, name, atlas="props", smooth=36.0, **extra):
    obj = builder.finish(collection("props"), smooth_angle=smooth)
    obj.name = obj.data.name = name
    obj["atlas"] = atlas
    obj["source"] = "made for this site"
    for k, v in extra.items():
        obj[k] = v
    return obj


def raycast(obj, origin, direction):
    """World-space hit on obj along a ray: (location, normal) or None."""
    inv = obj.matrix_world.inverted()
    hit, loc, normal, _ = obj.ray_cast(inv @ Vector(origin), (inv.to_3x3() @ Vector(direction)).normalized())
    if not hit:
        return None
    return obj.matrix_world @ loc, (obj.matrix_world.to_3x3().inverted().transposed() @ normal).normalized()


def place(obj, loc, rot_z_deg=0.0, rot=None):
    m = Matrix.Translation(loc) @ Matrix.Rotation(math.radians(rot_z_deg), 4, "Z")
    if rot is not None:
        m = m @ rot
    obj.matrix_world = m
    return obj


# ---- kitchen corner ----

def build_sideboard(mats):
    """A mid-century walnut sideboard: slab top, carcass with two sliding doors and brass pulls, splayed legs."""
    walnut, brass, section = mats["walnut"], mats["brass"], mats["section"]
    x0, x1, y0, y1 = SIDEBOARD_X0, SIDEBOARD_X1, SIDEBOARD_Y0, SIDEBOARD_Y1
    leg_h, top_t = 0.19, 0.03
    bm = bmesh.new()
    add_box(bm, (x1 - x0, y1 - y0, top_t), ((x0 + x1) / 2, (y0 + y1) / 2, SIDEBOARD_TOP - top_t / 2), bevel=0.006,
            segments=3)
    body_x0, body_x1 = x0 + 0.01, x1 - 0.03
    add_box(bm, (body_x1 - body_x0, y1 - y0 - 0.04, SIDEBOARD_TOP - top_t - leg_h),
            ((body_x0 + body_x1) / 2, (y0 + y1) / 2, (leg_h + SIDEBOARD_TOP - top_t) / 2), bevel=0.004)
    door_h = SIDEBOARD_TOP - top_t - leg_h - 0.03
    half = (y1 - y0 - 0.06) / 2
    for k, y in enumerate((y0 + 0.03 + half / 2, y1 - 0.03 - half / 2)):
        add_box(bm, (0.014, half - 0.004, door_h), (body_x1 + 0.007 + 0.009 * k, y, leg_h + 0.015 + door_h / 2),
                bevel=0.003)
        add_box(bm, (0.006, 0.014, 0.11), (body_x1 + 0.017 + 0.009 * k, y + (half / 2 - 0.05) * (1 if k == 0 else -1),
                                           leg_h + 0.015 + door_h * 0.55), bevel=0.002, mat=1)
    add_box(bm, (body_x1 - body_x0, y1 - y0 - 0.06, 0.02), ((body_x0 + body_x1) / 2, (y0 + y1) / 2, leg_h + 0.01))
    for lx in (body_x0 + 0.05, body_x1 - 0.04):
        for ly in (y0 + 0.07, y1 - 0.07):
            foot = Vector((lx + (0.025 if lx > x0 + 0.2 else -0.01), ly + (-0.025 if ly < -1.3 else 0.025), 0.0))
            head = Vector((lx, ly, leg_h + 0.005))
            leg = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.011, radius2=0.017,
                                        depth=(head - foot).length)
            rot = (head - foot).to_track_quat("Z", "Y").to_matrix()
            for v in leg["verts"]:
                v.co = rot @ v.co + (head + foot) / 2
            add_cylinder(bm, 0.0115, 0.012, foot + Vector((0, 0, 0.006)), segments=10, mat=1)
    obj = new_object("env_sideboard", bm, "env", "env", [walnut, brass, section])
    smooth_by_angle(obj, 40)
    return obj


def build_plaque(mats):
    """'Four favourites - from Letterboxd': a brass plate engraved in Newsreader on a walnut board under the posters."""
    font = newsreader()
    brass = pl.surface("plaque_brass", (0.55, 0.39, 0.17), 0.24, metallic=1.0, edge_wear=0.4,
                       edge_color=(0.85, 0.66, 0.38), grime=0.7, smudges=0.2, scratches=0.15, color_var=0.06)
    ink = pl.surface("plaque_engraving", (0.03, 0.022, 0.014), 0.6, metallic=0.3, color_var=0.0, edge_width=0.0002)
    b = pl.Builder("poster_plaque")
    size = 0.0175
    probe = pl.Builder("probe")
    probe.text(PLAQUE_TEXT, size, mat=ink, font=font)
    xs = [v.co.x for v in probe.bm.verts]
    text_w = max(xs) - min(xs)
    probe.bm.free()
    plate_w, plate_h = text_w + 0.05, 0.05
    walnut_mat = mats["walnut"]
    # Built facing -Y (the props convention), then turned to face the room (+X) on the left wall.
    b.box((plate_w + 0.03, 0.012, plate_h + 0.026), loc=(0, 0.006, 0), mat=walnut_mat, bevel=0.003)
    b.box((plate_w, 0.002, plate_h), loc=(0, -0.001, 0), mat=brass, bevel=0.0008, bevel_seg=1)
    for sx in (-1, 1):
        b.cylinder(0.0028, 0.0012, segments=12, loc=(sx * (plate_w / 2 - 0.009), -0.0021, 0), rot=(90, 0, 0), mat=brass)
    b.text(PLAQUE_TEXT, size, loc=(0, -0.00215, -0.002), rot=(90, 0, 0), mat=ink, font=font, resolution=2)
    obj = finish(b, "poster_plaque", smooth=30)
    place(obj, PLAQUE_CENTRE, 90.0)
    return obj


# ---- photo wall ----

def build_photo_wall(mats):
    """Five framed prints over the projector screen: thin black frames and mats are baked; each picture is its own
    unbaked mesh (photo_print_<i>, UVs 0-1 over the picture) that the site textures from the photography."""
    frame_mat = pl.surface("photo_frame_wood", (0.018, 0.014, 0.012), 0.42, edge_wear=0.3,
                           edge_color=(0.10, 0.07, 0.05), dust=0.4, smudges=0.2, color_var=0.04)
    mat_board = pl.surface("photo_mat_board", (0.78, 0.75, 0.68), 0.85, grime=0.3, dust=0.3, color_var=0.03)
    mat_core = pl.surface("photo_mat_bevel", (0.88, 0.85, 0.77), 0.8, color_var=0.0)
    found = {"prints": [], "frames": []}
    y_wall = Y_BACK
    for i, ((cx, cz), (pw, ph)) in enumerate(PHOTO_SLOTS):
        ow, oh = pw + 2 * (PHOTO_MAT + PHOTO_FRAME), ph + 2 * (PHOTO_MAT + PHOTO_FRAME)
        b = pl.Builder(f"props_photo_frame_{i}")
        depth = 0.022
        y = y_wall - depth / 2
        for (w, h), (x, z) in (((ow, PHOTO_FRAME), (0, oh / 2 - PHOTO_FRAME / 2)),
                               ((ow, PHOTO_FRAME), (0, -oh / 2 + PHOTO_FRAME / 2)),
                               ((PHOTO_FRAME, oh - 2 * PHOTO_FRAME), (-ow / 2 + PHOTO_FRAME / 2, 0)),
                               ((PHOTO_FRAME, oh - 2 * PHOTO_FRAME), (ow / 2 - PHOTO_FRAME / 2, 0))):
            b.box((w, depth, h), loc=(cx + x, y, cz + z), mat=frame_mat, bevel=0.0015, bevel_seg=2)
        mw, mh = ow - 2 * PHOTO_FRAME, oh - 2 * PHOTO_FRAME
        my = y_wall - 0.012
        for (w, h), (x, z) in (((mw, PHOTO_MAT), (0, mh / 2 - PHOTO_MAT / 2)), ((mw, PHOTO_MAT), (0, -mh / 2 + PHOTO_MAT / 2)),
                               ((PHOTO_MAT, ph), (-mw / 2 + PHOTO_MAT / 2, 0)), ((PHOTO_MAT, ph), (mw / 2 - PHOTO_MAT / 2, 0))):
            b.box((w, 0.003, h), loc=(cx + x, my, cz + z), mat=mat_board)
        for (w, h), (x, z) in (((pw + 0.004, 0.002), (0, ph / 2 + 0.001)), ((pw + 0.004, 0.002), (0, -ph / 2 - 0.001)),
                               ((0.002, ph), (-pw / 2 - 0.001, 0)), ((0.002, ph), (pw / 2 + 0.001, 0))):
            b.box((w, 0.0032, h), loc=(cx + x, my + 0.0002, cz + z), mat=mat_core)
        b.box((mw, 0.002, mh), loc=(cx, y_wall - 0.004, cz), mat=mat_board)
        frame = finish(b, f"props_photo_frame_{i}", smooth=30, photo_slot=i)
        found["frames"].append(frame)

        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        yp = my + 0.0005
        corners = [(cx - pw / 2, cz - ph / 2), (cx + pw / 2, cz - ph / 2), (cx + pw / 2, cz + ph / 2), (cx - pw / 2, cz + ph / 2)]
        face = bm.faces.new([bm.verts.new((x, yp, z)) for x, z in corners])
        for loop, coord in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = coord
        bm.normal_update()
        if face.normal.y > 0:
            face.normal_flip()
            for loop, coord in zip(face.loops, ((0, 0), (0, 1), (1, 1), (1, 0))):
                loop[uv].uv = coord
        art = new_object(f"photo_print_{i}", bm, "props", "props", [photo_material(i)])
        art["runtime_art"] = "photo"
        art["photo_slot"] = i
        art["aspect"] = round(pw / ph, 4)
        art["width_m"], art["height_m"] = pw, ph
        found["prints"].append(art)
    found["safelight"] = build_safelight()
    found["photo_light"] = build_photo_light(mats)
    return found


def still_photo(slug: str) -> bpy.types.Image | None:
    """A print from src/assets/photography (largest file), converted once to PNG for Cycles; stills only."""
    folder = Path(__file__).resolve().parents[2] / "src" / "assets" / "photography" / slug
    files = sorted(folder.glob("*.webp"), key=lambda f: int(f.stem) if f.stem.isdigit() else 0)
    if not files:
        return None
    png = CACHE / "photos" / f"{slug}.png"
    if not png.exists():
        png.parent.mkdir(parents=True, exist_ok=True)
        import subprocess
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(files[-1]), str(png)],
                       check=True)
    return bpy.data.images.load(str(png), check_existing=True)


def photo_material(i):
    """The print in slot i for the stills (cropped to the slot like CSS object-fit: cover), switched to white paper
    (light_probe = 1) while bake.py bakes the light that falls on it; the site draws the photograph at runtime."""
    mat, k = pl.new_material(f"photo_print_{i}")
    uv = k.node("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"]
    image = still_photo(STILL_PHOTOS[i])
    if image is not None:
        (_, _), (pw, ph) = PHOTO_SLOTS[i]
        slot_aspect, img_aspect = pw / ph, image.size[0] / max(image.size[1], 1)
        sx, sy = (slot_aspect / img_aspect, 1.0) if img_aspect > slot_aspect else (1.0, img_aspect / slot_aspect)
        crop = k.node("ShaderNodeMapping", inputs={"Vector": uv, "Scale": (sx, sy, 1.0),
                                                   "Location": ((1 - sx) / 2, (1 - sy) / 2, 0.0)})
        tex = k.node("ShaderNodeTexImage", image=image, interpolation="Linear")
        k.set(tex, "Vector", crop.outputs[0])
        color = tex.outputs["Color"]
    else:
        color = (0.32, 0.30, 0.27, 1.0)
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.35})
    white = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": (0.8, 0.8, 0.8, 1.0), "Roughness": 0.9})
    # bake.py sets light_probe to 1 while it bakes the light falling on the print into the atlas.
    probe = k.node("ShaderNodeValue", name="light_probe", label="light_probe")
    probe.outputs[0].default_value = 0.0
    mix = k.node("ShaderNodeMixShader", inputs={"Fac": probe.outputs[0], "Shader": bsdf.outputs[0],
                                                "Shader_001": white.outputs[0]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", mix.outputs[0])
    return mat


def build_safelight():
    """A darkroom safelight: a dark metal box with a deep-red filter, on a bracket beside the prints."""
    body = pl.surface("safelight_body", (0.025, 0.022, 0.02), 0.5, metallic=0.6, edge_wear=0.4,
                      edge_color=(0.18, 0.15, 0.12), dust=0.6, grime=0.5, color_var=0.05)
    filt = pl.surface("safelight_filter", (0.25, 0.01, 0.005), 0.25, emission=((1.0, 0.04, 0.015), 4.0),
                      color_var=0.0)
    b = pl.Builder("props_safelight")
    s = SAFELIGHT
    b.box((0.13, 0.065, 0.15), loc=tuple(s), mat=body, bevel=0.004)
    b.box((0.104, 0.004, 0.122), loc=tuple(s + Vector((0, -0.0335, 0))), mat=filt, bevel=0.001, bevel_seg=1)
    b.box((0.03, 0.035, 0.012), loc=tuple(s + Vector((0, 0.045, 0.08))), mat=body, bevel=0.002)
    b.cylinder(0.008, 0.03, segments=12, loc=tuple(s + Vector((0, 0.0, 0.075))), mat=body)
    cord = [s + Vector((-0.05, 0.02, -0.075))]
    for k in range(1, 8):
        t = k / 7
        cord.append(s + Vector((-0.05 - 0.012 * t, 0.025, -0.075 - 0.42 * t)))
    b.tube(cord, 0.0025, sides=6, mat=body)
    return finish(b, "props_safelight", smooth=30)


def build_photo_light(mats):
    """A small brass picture lamp over the featured print."""
    (cx, cz), (pw, ph) = PHOTO_SLOTS[0]
    top = cz + ph / 2 + PHOTO_MAT + PHOTO_FRAME
    bm = bmesh.new()
    p = Vector((cx, Y_BACK - 0.11, top + 0.055))
    add_cylinder(bm, 0.018, 0.62, p, segments=20, axis="X")
    for dx in (-0.22, 0.22):
        add_box(bm, (0.01, 0.11, 0.01), p + Vector((dx, 0.055, 0.02)), bevel=0.002)
    add_cylinder(bm, 0.024, 0.008, Vector((cx, Y_BACK - 0.004, p.z + 0.02)), segments=20, axis="Y")
    obj = new_object("env_photo_light", bm, "env", "env", [mats["brass"]])
    smooth_by_angle(obj, 50)
    return p


# ---- album and projector dial ----

def build_album():
    """A closed photo album lying on the desk: cloth boards, a rounded spine, a cream page block and a ribbon."""
    cloth = pl.surface("album_cloth", (0.16, 0.035, 0.03), 0.8, color_tex=pl.ambientcg("Fabric036")["Color"],
                       tint=(0.55, 0.16, 0.12), tile=0.08, edge_wear=0.6, edge_color=(0.30, 0.16, 0.10),
                       dust=0.4, grime=0.5, color_var=0.08)
    pages = pl.surface("album_pages", (0.62, 0.57, 0.47), 0.85, grime=0.6, dust=0.3, color_var=0.05)
    ribbon = pl.surface("album_ribbon", (0.45, 0.33, 0.12), 0.5, color_var=0.0)
    corner = pl.surface("album_corner", (0.55, 0.39, 0.17), 0.3, metallic=1.0, grime=0.6, color_var=0.05)
    w, d, h = ALBUM_SIZE
    b = pl.Builder("photo_album")
    board = 0.0035
    for z in (board / 2, h - board / 2):
        b.box((w, d, board), loc=(0, 0, z), mat=cloth, bevel=0.0012, bevel_seg=2)
    b.box((w - 0.008, d - 0.006, h - 2 * board), loc=(0.004, 0, h / 2), mat=pages, bevel=0.001, bevel_seg=1)
    b.lathe([(0.0, -d / 2), (h / 2, -d / 2), (h / 2, d / 2), (0.0, d / 2)], segments=12,
            loc=(-w / 2, 0, h / 2), rot=(90, 0, 0), mat=cloth, arc=math.pi, cap_start=False, cap_end=False)
    for sx, sy in ((1, 1), (1, -1)):
        b.box((0.018, 0.018, h + 0.001), loc=(sx * (w / 2 - 0.007), sy * (d / 2 - 0.007), h / 2), mat=corner,
              bevel=0.002)
    b.box((0.008, 0.0008, 0.05), loc=(0.03, -d / 2 - 0.001, -0.012), rot=(0, 0, 0), mat=ribbon)
    obj = finish(b, "photo_album", atlas="desk", smooth=40)
    loc, rot = ALBUM
    place(obj, loc, rot)
    return obj


def build_projector_dial(placed):
    """A program dial on the projector's room side: a brass plate with three marks (baked) and a bakelite knob
    (projector_dial, its own node; it turns about its local +Z, glTF +Y)."""
    projector = next(o for o in placed["projector_8mm"] if o.name == "props_projector_8mm")
    bpy.context.view_layer.update()
    target = Vector((-1.90, -2.08, 0.69))
    hit = raycast(projector, target + Vector((0.6, 0.0, 0.0)), (-1, 0, 0))
    if hit is None:
        raise RuntimeError("projector_dial: no projector side face found")
    point, normal = hit
    normal = Vector((normal.x, normal.y, 0)).normalized()
    orient = normal.to_track_quat("Z", "Y").to_matrix().to_4x4()
    brass = pl.surface("dial_plate", (0.55, 0.39, 0.17), 0.28, metallic=1.0, edge_wear=0.4,
                       edge_color=(0.85, 0.66, 0.38), grime=0.7, color_var=0.05)
    mark = pl.surface("dial_marks", (0.03, 0.022, 0.014), 0.6, color_var=0.0, edge_width=0.0002)
    bake = pl.surface("dial_bakelite", (0.035, 0.022, 0.016), 0.3, smudges=0.3, edge_wear=0.3,
                      edge_color=(0.12, 0.07, 0.04), color_var=0.02)
    plate = pl.Builder("props_projector_dial_plate")
    plate.cylinder(0.026, 0.0025, segments=40, mat=brass, bevel=0.0008)
    for k, label in enumerate(("REEL", "PHOTOS", "SHORTS")):
        a = math.radians(140 - 50 * k)
        plate.box((0.0012, 0.0045, 0.0006), loc=(0.0205 * math.cos(a), 0.0205 * math.sin(a), 0.0026),
                  rot=(0, 0, math.degrees(a) - 90), mat=mark)
    plate_obj = finish(plate, "props_projector_dial_plate", smooth=40)
    plate_obj.matrix_world = Matrix.Translation(point + normal * 0.0005) @ orient
    knob = pl.Builder("projector_dial")
    knob.lathe([(0.0, 0.0), (0.0145, 0.0), (0.0150, 0.004), (0.0135, 0.012), (0.0095, 0.0155), (0.0, 0.016)],
               segments=28, mat=bake, radial=lambda i, j, r: r * (0.96 if i % 2 and 0 < j < 4 else 1.0))
    knob.box((0.0022, 0.012, 0.0014), loc=(0, 0.004, 0.0158), mat=brass)
    dial = finish(knob, "projector_dial", smooth=30)
    dial.matrix_world = Matrix.Translation(point + normal * 0.003) @ orient
    return dial


# ---- shelves ----

BOOK_CLOTH = ["#5B1F1B", "#22304A", "#2E3B2A", "#8A6A2E", "#C9BC9C", "#201C1A", "#7A3A22", "#5E6E7A", "#3E2A3C",
              "#A2875A", "#6B2E2A", "#2F4A48"]


def book_materials():
    mats = []
    for i, hexc in enumerate(BOOK_CLOTH):
        h = hexc.lstrip("#")
        rgb = tuple(((int(h[j:j + 2], 16) / 255) ** 2.2) for j in (0, 2, 4))
        mats.append(pl.surface(f"book_cloth_{i}", rgb, 0.7, color_tex=pl.ambientcg("Fabric036")["Color"], tint=rgb,
                               tile=0.06, edge_wear=0.6, edge_color=tuple(min(1, c * 1.6 + 0.05) for c in rgb),
                               dust=0.8, grime=0.5, color_var=0.06))
    return mats


def add_book(b, mats, pages, gilt, rng, x, y_front, z, thick, height, depth, lean_deg=0.0, flat=False):
    """A standing hardback: cloth case, the page block showing at the top, two gilt bands on half of the spines."""
    mat = rng.choice(mats)
    rot = (0, lean_deg, 0) if not flat else (0, 90, rng.uniform(-6, 6))
    pivot = Vector((x, y_front + depth / 2, z))
    local = Matrix.Translation(pivot) @ pl.xform(rot=rot)
    faces = b.box((thick, depth, height), loc=(0, 0, height / 2), mat=mat, bevel=0.0012, bevel_seg=1)
    faces += b.box((thick - 0.004, depth - 0.006, 0.003), loc=(0, 0.002, height - 0.0005), mat=pages)
    if rng.random() < 0.5:
        for zb in (0.18, 0.86):
            faces += b.box((thick + 0.0004, 0.0006, 0.004), loc=(0, -depth / 2 - 0.0002, height * zb), mat=gilt)
    verts = list({v for f in faces for v in f.verts})
    bmesh.ops.transform(b.bm, matrix=local, verts=verts)


def build_books(rng):
    mats = book_materials()
    pages = pl.surface("book_pages", (0.62, 0.57, 0.46), 0.85, grime=0.5, dust=0.6, color_var=0.06)
    gilt = pl.surface("book_gilt", (0.62, 0.45, 0.18), 0.3, metallic=1.0, color_var=0.05)
    b = pl.Builder("props_books_top")
    x = -0.765
    while x < -0.33:
        thick = rng.uniform(0.018, 0.042)
        add_book(b, mats, pages, gilt, rng, x + thick / 2, 0.205 + rng.uniform(0, 0.02), SHELF_TOP, thick,
                 rng.uniform(0.165, 0.245), rng.uniform(0.13, 0.17))
        x += thick + 0.0015
    add_book(b, mats, pages, gilt, rng, x + 0.045, 0.21, SHELF_TOP, 0.03, 0.22, 0.15, lean_deg=-24)
    finish(b, "props_books_top", smooth=30)
    b = pl.Builder("props_books_low")
    x = -1.005
    while x < -0.86:
        thick = rng.uniform(0.02, 0.04)
        add_book(b, mats, pages, gilt, rng, x + thick / 2, 0.20, SHELF_LOW, thick, rng.uniform(0.19, 0.26),
                 rng.uniform(0.14, 0.17))
        x += thick + 0.0015
    finish(b, "props_books_low", smooth=30)


def build_fairy_lights():
    """A string of warm fairy lights along the top shelf's front edge, sagging between three hooks."""
    wire = pl.surface("fairy_wire", (0.04, 0.035, 0.025), 0.5, color_var=0.0)
    bulb = pl.surface("fairy_bulb", (0.9, 0.7, 0.4), 0.2, emission=((1.0, 0.62, 0.30), 9.0), color_var=0.0)
    b = pl.Builder("props_fairy_lights")
    hooks = [-1.00, -0.57, -0.14, 0.28]
    edge_y, edge_z = 0.172, 2.004
    pts = []
    for h0, h1 in zip(hooks, hooks[1:]):
        for k in range(12):
            t = k / 12
            sag = 0.055 * 4 * t * (1 - t)
            pts.append(Vector((h0 + (h1 - h0) * t, edge_y - 0.004 * math.sin(t * math.pi), edge_z - sag)))
    pts.append(Vector((hooks[-1], edge_y, edge_z)))
    b.tube(pts, 0.0011, sides=4, mat=wire, cap=False)
    for i, p in enumerate(pts[1:-1:2]):
        b.lathe([(0.0, -0.0075), (0.0035, -0.0055), (0.0042, -0.002), (0.0028, 0.0), (0.0, 0.0005)], segments=8,
                loc=tuple(p), mat=bulb)
    for h in hooks:
        b.box((0.006, 0.01, 0.006), loc=(h, edge_y + 0.006, edge_z + 0.002), mat=wire)
    return finish(b, "props_fairy_lights", smooth=50)


# ---- records crate ----

SLEEVES = ["#D8CDB5", "#1C1A18", "#7E2F24", "#B9A27A", "#2A3B4C", "#E3DCCB", "#556B4E", "#A5562E", "#3A2E2A",
           "#C2B59A", "#8C7A5B", "#2D2D33", "#B8A99A", "#6E4A3A"]


def build_records(rng):
    """A slatted pine crate of LPs on the floor in the window bay, sleeves leaning back."""
    wood = pl.ambientcg("Wood051")
    pine = pl.surface("crate_pine", (0.42, 0.30, 0.18), 0.7, color_tex=wood["Color"], tint=(0.95, 0.75, 0.55),
                      tile=0.35, edge_wear=0.5, edge_color=(0.55, 0.42, 0.28), dust=0.7, grime=0.6, color_var=0.12)
    sleeve_mats = []
    for i, hexc in enumerate(SLEEVES):
        h = hexc.lstrip("#")
        rgb = tuple(((int(h[j:j + 2], 16) / 255) ** 2.2) for j in (0, 2, 4))
        sleeve_mats.append(pl.surface(f"lp_sleeve_{i}", rgb, 0.75, color_tex=pl.ambientcg("Paper001")["Color"],
                                      tint=rgb, tile=0.25, edge_wear=0.8, edge_color=(0.75, 0.70, 0.60),
                                      dust=0.6, grime=0.4, color_var=0.08))
    w, d, h = 0.36, 0.34, 0.27
    b = pl.Builder("props_records")
    for sx in (-1, 1):
        for k in range(3):
            b.box((0.014, d, 0.07), loc=(sx * (w / 2 - 0.007), 0, 0.02 + 0.045 + k * 0.088), mat=pine, bevel=0.002)
    for sy in (-1, 1):
        for k in range(3):
            b.box((w - 0.028, 0.014, 0.07), loc=(0, sy * (d / 2 - 0.007), 0.02 + 0.045 + k * 0.088), mat=pine,
                  bevel=0.002)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.03, 0.03, h), loc=(sx * (w / 2 - 0.03), sy * (d / 2 - 0.03), h / 2), mat=pine, bevel=0.002)
    b.box((w - 0.03, d - 0.03, 0.012), loc=(0, 0, 0.026), mat=pine)
    n = 14
    for i in range(n):
        y = -d / 2 + 0.03 + i * (d - 0.06) / (n - 1)
        lean = 9 + rng.uniform(-3, 4)
        faces = b.box((0.312, 0.0035, 0.312), loc=(rng.uniform(-0.006, 0.006), 0, 0.156), mat=rng.choice(sleeve_mats),
                      bevel=0.0008, bevel_seg=1)
        m = Matrix.Translation((0, y, 0.034)) @ pl.xform(rot=(-lean, 0, rng.uniform(-1.5, 1.5)))
        bmesh.ops.transform(b.bm, matrix=m, verts=list({v for f in faces for v in f.verts}))
    obj = finish(b, "props_records", smooth=30)
    place(obj, Vector((2.06, 0.10, 0.0)), 8.0)
    return obj


# ---- desk clutter ----

def build_desk_clutter(rng):
    paper = pl.surface("notebook_paper", (0.70, 0.66, 0.56), 0.85, grime=0.3, color_var=0.03)
    ink_pages = notebook_page_material()
    cover = pl.surface("notebook_cover", (0.02, 0.018, 0.016), 0.6, edge_wear=0.6, edge_color=(0.12, 0.10, 0.08),
                       color_var=0.03)
    pen_body = pl.surface("pen_body", (0.015, 0.014, 0.013), 0.25, smudges=0.4, color_var=0.0)
    pen_metal = pl.surface("pen_metal", (0.62, 0.45, 0.18), 0.25, metallic=1.0, color_var=0.0)

    # An open notebook in the lamp's pool, a fountain pen across it.
    b = pl.Builder("desk_notebook")
    pw, ph = 0.105, 0.150
    for side in (-1, 1):
        b.box((pw, ph, 0.004), loc=(side * (pw / 2 + 0.002), 0, 0.002), mat=cover, bevel=0.001, bevel_seg=1)
        prof = []
        for k in range(7):
            t = k / 6
            prof.append(t)
        bm_faces = b.box((pw - 0.004, ph - 0.006, 0.006), loc=(side * (pw / 2 + 0.001), 0, 0.007), mat=paper)
        top = [f for f in bm_faces if f.normal.z > 0.9]
        for f in top:
            f.material_index = b.slot(ink_pages)
        for v in {v for f in bm_faces for v in f.verts}:
            gutter = 1.0 - min(abs(v.co.x) / pw, 1.0)
            v.co.z += 0.004 * gutter ** 2 if v.co.z > 0.006 else 0.0
    b.cylinder(0.0045, 0.135, segments=12, loc=(-0.06, -0.02, 0.016), rot=(0, 90, 18), mat=pen_body)
    b.box((0.04, 0.0025, 0.0018), loc=(0.0, -0.0275, 0.0205), rot=(0, 0, 18), mat=pen_metal)
    notebook = finish(b, "desk_notebook", atlas="desk", smooth=40)
    place(notebook, Vector((-0.40, -0.30, DESK_TOP + 0.0005)), -9.0)

    # Sticky notes: two on the CRT bezel's right edge, one by the keyboard.
    notes = [pl.surface(f"sticky_{c}", rgb, 0.8, color_var=0.04, grime=0.2)
             for c, rgb in (("yellow", (0.80, 0.62, 0.16)), ("pink", (0.78, 0.36, 0.38)))]
    scribble = pl.surface("sticky_ink", (0.04, 0.04, 0.08), 0.6, color_var=0.0)
    crt = bpy.data.objects.get("desk_crt")
    spots = []
    if crt is not None:
        for x, z, tilt in ((0.197, 1.215, -6), (0.196, 1.12, 4), (-0.115, 0.982, 3)):
            hit = raycast(crt, (x, -1.0, z), (0, 1, 0))
            if hit:
                spots.append((hit[0], hit[1], tilt))
    b = pl.Builder("desk_sticky_notes")
    for k, (point, normal, tilt) in enumerate(spots):
        orient = normal.to_track_quat("Z", "Y").to_matrix().to_4x4()
        m = Matrix.Translation(point + normal * 0.0008) @ orient @ pl.xform(rot=(0, 0, tilt))
        faces = b.box((0.042, 0.042, 0.0006), mat=notes[k % 2])
        for v in {v for f in faces for v in f.verts}:
            v.co.z += 0.004 * max(0.0, -v.co.y / 0.021) ** 2
        faces += scribble_lines(b, scribble, rng, 0.034, 0.03, 0.0004)
        bmesh.ops.transform(b.bm, matrix=m, verts=list({v for f in faces for v in f.verts}))
    faces = b.box((0.065, 0.065, 0.0006), mat=notes[0])
    faces += scribble_lines(b, scribble, rng, 0.052, 0.042, 0.0004)
    m = Matrix.Translation((0.27, -0.27, DESK_TOP + 0.0006)) @ pl.xform(rot=(0, 0, 22))
    bmesh.ops.transform(b.bm, matrix=m, verts=list({v for f in faces for v in f.verts}))
    finish(b, "desk_sticky_notes", atlas="desk", smooth=40)

    build_headphones()


def scribble_lines(b, mat, rng, w, h, lift):
    """Three handwritten-looking strokes: thin wavy strips just above a note."""
    faces = []
    for row in range(3):
        y = h / 2 - (row + 1) * h / 4
        length = w * rng.uniform(0.55, 0.9)
        pts = []
        for k in range(12):
            t = k / 11
            pts.append(Vector((-w / 2 + 0.006 + length * t, y + 0.0015 * math.sin(t * 19 + row), lift)))
        bm = b.bm
        before = set(bm.faces)
        verts = [(bm.verts.new(p + Vector((0, -0.0006, 0))), bm.verts.new(p + Vector((0, 0.0006, 0)))) for p in pts]
        for (a0, a1), (b0, b1) in zip(verts, verts[1:]):
            bm.faces.new((a0, b0, b1, a1))
        faces += b._wrap(before, None, mat)
    return faces


def notebook_page_material():
    """Ruled cream paper with lines of handwriting: wavy dark strokes along the rules, broken into words."""
    mat, k = pl.new_material("notebook_page")
    obj = k.coords("Object")
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": obj})
    rule = k.math("FRACT", k.math("DIVIDE", sep.outputs["Y"], 0.0065))
    rules = k.map_range(k.math("ABSOLUTE", k.math("SUBTRACT", rule, 0.5)), 0.47, 0.5)
    wobble = k.math("MULTIPLY", k.noise(k.coords("Object", 220.0), 1.0, detail=2.0), 0.9)
    stroke_band = k.map_range(k.math("ABSOLUTE", k.math("SUBTRACT", k.math("ADD", rule, k.math("SUBTRACT", wobble, 0.45)), 0.35)),
                              0.10, 0.03)
    words = k.map_range(k.noise(k.node("ShaderNodeMapping", inputs={"Vector": obj, "Scale": (60.0, 300.0, 60.0)}).outputs[0],
                                1.0, detail=0.0), 0.42, 0.50)
    written = k.math("MULTIPLY", stroke_band, words)
    margin = k.map_range(k.math("ABSOLUTE", sep.outputs["X"]), 0.012, 0.016)
    written = k.math("MULTIPLY", written, margin)
    color = k.mix_color(k.math("MULTIPLY", rules, 0.35), (0.72, 0.68, 0.58, 1.0), (0.42, 0.52, 0.62, 1.0))
    color = k.mix_color(written, color, (0.05, 0.06, 0.12, 1.0))
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": color, "Roughness": 0.85})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs[0])
    return mat


def build_headphones():
    """Closed-back headphones put down on the desk: padded band, two cups on swivel yokes, a coiled cable."""
    shell = pl.surface("headphone_shell", (0.02, 0.019, 0.018), 0.38, smudges=0.4, edge_wear=0.4,
                       edge_color=(0.10, 0.09, 0.08), dust=0.4, color_var=0.03)
    pad = pl.surface("headphone_pad", (0.03, 0.025, 0.022), 0.65, micro_bump=(900, 0.4), color_var=0.04)
    metal = pl.surface("headphone_metal", (0.55, 0.55, 0.54), 0.3, metallic=1.0, scratches=0.3, color_var=0.02)
    b = pl.Builder("desk_headphones")
    r_band = 0.085
    band = []
    for k in range(17):
        a = math.radians(-80 + 160 * k / 16)
        band.append(Vector((r_band * math.sin(a), -r_band * math.cos(a) + 0.02, 0.012)))
    b.tube(band, 0.011, sides=8, mat=pad)
    b.tube([p + Vector((0, 0.004, 0.008)) for p in band], 0.004, sides=6, mat=metal)
    for side in (-1, 1):
        end = band[0] if side < 0 else band[-1]
        cup = end + Vector((side * 0.012, 0.035, 0.0))
        b.cylinder(0.046, 0.032, segments=28, loc=tuple(cup + Vector((0, 0, -0.004))), mat=shell, bevel=0.006)
        b.torus(0.033, 0.011, segments=24, sides=8, loc=tuple(cup + Vector((0, 0, 0.033))), mat=pad)
        b.box((0.006, 0.05, 0.012), loc=tuple(cup + Vector((-side * 0.045, -0.02, 0.016))), mat=metal, bevel=0.002)
    cable = [band[-1] + Vector((0.02, 0.06, -0.006))]
    for k in range(1, 30):
        t = k / 29
        cable.append(cable[0] + Vector((0.11 * t + 0.008 * math.cos(t * 40), 0.06 * t * t + 0.008 * math.sin(t * 40),
                                        -0.002)))
    b.tube(cable, 0.0022, sides=5, mat=shell)
    obj = finish(b, "desk_headphones", atlas="desk", smooth=40)
    place(obj, Vector((0.37, -0.14, DESK_TOP)), -28.0)
    return obj


# ---- CC0 models ----

def import_cc0(name, asset_id, loc, rot_deg, height, target_tris):
    """Import a Poly Haven model (CC0, 1k textures), decimate it to its budget, set its base on the floor of its
    bounds, scale it to `height` and place it."""
    path = pl.polyhaven_gltf(asset_id, "1k")
    coll = collection("props")
    new = pl.import_gltf(path, coll)
    meshes = [o for o in new if o.type == "MESH"]
    bpy.context.view_layer.update()
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.data = obj.data.copy()
        obj.data.transform(world)
        obj.matrix_world = Matrix.Identity(4)
    for obj in new:
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    if asset_id == "stationery_supplies":
        meshes = pen_cup_from_supplies(meshes)
    obj = pl.join(meshes, name) if len(meshes) > 1 else meshes[0]
    obj.name = obj.data.name = name
    obj.data.calc_loop_triangles()
    tris = len(obj.data.loop_triangles)
    if tris > target_tris:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = target_tris / tris
        mod.use_collapse_triangulate = True
        pl.apply_modifier(obj, mod)
    pl.set_origin_base(obj)
    xs = [v.co for v in obj.data.vertices]
    size = max(v.z for v in xs) - min(v.z for v in xs)
    scale = (height / size) if height else 1.0
    obj.matrix_world = (Matrix.Translation(loc) @ Matrix.Rotation(math.radians(rot_deg), 4, "Z")
                        @ Matrix.Diagonal((scale, scale, scale, 1.0)))
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj["atlas"] = "props"
    obj["prop"] = name
    obj["source"] = f"Poly Haven {asset_id} (CC0)"
    smooth_by_angle(obj, 50)
    return obj


def pen_cup_from_supplies(meshes):
    """From the stationery set keep the metal cup and stand three pens and pencils in it, leaning."""
    def width(o):
        pts = [v.co for v in o.data.vertices]
        return max(p.x for p in pts) - min(p.x for p in pts), max(p.z for p in pts) - min(p.z for p in pts)

    cup = max(meshes, key=lambda o: width(o)[1] / max(width(o)[0], 1e-6))
    pens = sorted((o for o in meshes if o is not cup and width(o)[0] > 0.1), key=lambda o: -width(o)[0])[:3]
    for o in meshes:
        if o is not cup and o not in pens:
            bpy.data.objects.remove(o, do_unlink=True)
    cpts = [v.co for v in cup.data.vertices]
    centre = Vector(((min(p.x for p in cpts) + max(p.x for p in cpts)) / 2, (min(p.y for p in cpts) + max(p.y for p in cpts)) / 2,
                     min(p.z for p in cpts)))
    for k, pen in enumerate(pens):
        pts = [v.co for v in pen.data.vertices]
        mid = Vector(((min(p.x for p in pts) + max(p.x for p in pts)) / 2, (min(p.y for p in pts) + max(p.y for p in pts)) / 2,
                      (min(p.z for p in pts) + max(p.z for p in pts)) / 2))
        length = max(p.x for p in pts) - min(p.x for p in pts)
        a = math.radians(120 * k)
        stand = (Matrix.Translation(centre + Vector((0.01 * math.cos(a), 0.01 * math.sin(a), length / 2 + 0.005)))
                 @ Matrix.Rotation(math.radians(8), 4, Vector((math.cos(a + 1.2), math.sin(a + 1.2), 0)))
                 @ Matrix.Rotation(math.radians(90), 4, "Y") @ Matrix.Translation(-mid))
        pen.data.transform(stand)
    return [cup, *pens]


# ---- round six: a jacket, a pothos, floor books and a reading corner ----

def build_jacket():
    """A mustard corduroy jacket thrown over the desk chair's back: the torso folded over the top edge, longer on
    the side toward the room, sleeves hanging down the back, the collar turned up. Shaped procedurally over the
    backrest Henry's chair already has."""
    chair = bpy.data.objects.get("desk_chair_seat")
    if chair is None:
        return None
    pts = [chair.matrix_world @ v.co for v in chair.data.vertices]
    top = [p for p in pts if p.z > max(q.z for q in pts) - 0.03]
    a, b = min(top, key=lambda p: p.x), max(top, key=lambda p: p.x)
    centre = (a + b) / 2
    u = (b - a).normalized()
    u.z = 0
    u.normalize()
    n = Vector((u.y, -u.x, 0.0))
    room = Vector((3.75, -4.95, 0.0)) - centre
    if n.dot(room) < 0:
        n = -n
    half_t, width, front, back = 0.042, 0.50, 0.40, 0.56
    cord = pl.surface("jacket_corduroy", (0.26, 0.15, 0.045), 0.85, color_tex=pl.ambientcg("Fabric036")["Color"],
                      tint=(0.50, 0.32, 0.11), tile=0.05, micro_bump=(900, 0.3), edge_wear=0.4,
                      edge_color=(0.46, 0.31, 0.12), grime=0.4, color_var=0.06, sheen=0.4)
    lining = pl.surface("jacket_lining", (0.15, 0.06, 0.04), 0.6, color_var=0.04)
    b_ = pl.Builder("props_jacket")
    bm = b_.bm
    before = set(bm.faces)

    def drape(aa, ss):
        fold = 0.010 * math.sin(aa * 28 + ss * 7) * min(abs(ss) / 0.2, 1.0)
        if abs(ss) <= half_t:
            p = centre + u * aa + n * ss + Vector((0, 0, 0.012 * math.cos(math.pi * ss / (2 * half_t)) + 0.006))
        else:
            side = 1 if ss > 0 else -1
            drop = abs(ss) - half_t
            flare = 0.018 + 0.05 * drop + fold
            p = centre + u * (aa * (1 + 0.12 * drop)) + n * side * (half_t + flare) - Vector((0, 0, drop))
        return p

    na, ns = 14, 34
    grid = []
    for i in range(na + 1):
        aa = -width / 2 + width * i / na
        col = []
        for j in range(ns + 1):
            ss = -front + (front + back) * j / ns
            col.append(bm.verts.new(drape(aa, ss)))
        grid.append(col)
    for i in range(na):
        for j in range(ns):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    torso = b_._wrap(before, None, cord)
    bmesh.ops.solidify(bm, geom=torso, thickness=0.004)
    # Sleeves hang from the shoulder ends down the room side.
    for side in (-1, 1):
        start = drape(side * width / 2, half_t + 0.02)
        path = [start + u * side * 0.02]
        for k in range(1, 10):
            t = k / 9
            path.append(start + u * side * (0.035 + 0.02 * math.sin(t * 2)) + n * (0.03 + 0.04 * t)
                        - Vector((0, 0, 0.50 * t)))
        b_.tube(path, 0.05, sides=8, mat=cord, radius_fn=lambda t: 0.052 - 0.012 * t)
    # The collar: a turned-up band along the top edge, a little proud on the room side.
    before = set(bm.faces)
    band = []
    for i in range(9):
        aa = -0.13 + 0.26 * i / 8
        base = drape(aa, half_t + 0.01)
        band.append((bm.verts.new(base + n * 0.012), bm.verts.new(base + n * 0.02 + Vector((0, 0, 0.055)))))
    for (p0, p1), (q0, q1) in zip(band, band[1:]):
        bm.faces.new((p0, q0, q1, p1))
    b_._wrap(before, None, lining)
    return finish(b_, "props_jacket", atlas="desk", smooth=70)


def build_pothos(rng):
    """A golden pothos in a small glazed pot on the book stack, trailing over the shelf's edge and down."""
    pot_mat = pl.surface("pothos_pot", (0.62, 0.58, 0.50), 0.25, coat=0.5, edge_wear=0.4,
                         edge_color=(0.36, 0.28, 0.20), grime=0.5, dust=0.6, color_var=0.05)
    soil = pl.surface("pothos_soil", (0.03, 0.022, 0.015), 0.95, color_var=0.1)
    stem = pl.surface("pothos_stem", (0.08, 0.14, 0.04), 0.6, color_var=0.15)
    leaf = pl.surface("pothos_leaf", (0.07, 0.16, 0.035), 0.42, coat=0.2, color_var=0.25, translucency=0.15,
                      dust=0.3)
    b = pl.Builder("props_pothos")
    base = Vector((-0.875, 0.31, 2.112))
    b.lathe([(0.0, 0.0), (0.040, 0.0), (0.047, 0.012), (0.052, 0.072), (0.056, 0.078), (0.050, 0.080)], segments=20,
            loc=tuple(base), mat=pot_mat, cap_end=False)
    b.cylinder(0.049, 0.002, segments=20, loc=tuple(base + Vector((0, 0, 0.070))), mat=soil)
    vines = [(-20, 0.55), (15, 0.42), (60, 0.30), (-60, 0.22), (110, 0.18)]
    for az_deg, length in vines:
        az = math.radians(az_deg)
        start = base + Vector((0.02 * math.cos(az), 0.02 * math.sin(az) - 0.01, 0.074))
        path = [start]
        lip = base + Vector((0.07 * math.cos(az) * 0.6, -0.12, 0.085))
        for k in range(1, 15):
            t = k / 14
            if t < 0.25:
                p = start.lerp(lip, t / 0.25)
            else:
                drop = (t - 0.25) / 0.75 * length
                p = lip + Vector((0.025 * math.sin(t * 5 + az), -0.03 - 0.02 * math.sin(t * 3), -drop))
            path.append(p)
        b.tube(path, 0.0022, sides=4, mat=stem)
        for k, p in enumerate(path[2::2]):
            side = 1 if k % 2 else -1
            size = rng.uniform(0.028, 0.045) * (1.0 - 0.3 * k / len(path))
            heart_leaf(b, p, side, size, leaf, rng)
    for k, p in enumerate([base + Vector((0.0, -0.01, 0.09)), base + Vector((0.03, 0.02, 0.10))]):
        heart_leaf(b, p, 1 if k else -1, 0.04, leaf, rng, upright=True)
    return finish(b, "props_pothos", smooth=60)


def heart_leaf(b, at, side, size, mat, rng, upright=False):
    """One heart-shaped leaf on a short petiole: a cupped fan of quads, tip down unless upright."""
    bm = b.bm
    before = set(bm.faces)
    rot = Matrix.Rotation(rng.uniform(-0.6, 0.6), 4, "Z") @ Matrix.Rotation(math.radians(side * 35), 4, "Y")
    if upright:
        rot = Matrix.Rotation(rng.uniform(0, 6.28), 4, "Z") @ Matrix.Rotation(math.radians(40), 4, "X")
    ring = []
    n = 10
    for k in range(n + 1):
        t = k / n
        a = -math.pi + 2 * math.pi * t
        r = size * (0.62 + 0.38 * math.sin(abs(a) / 2) ** 0.6) * (1 - 0.45 * max(0.0, math.cos(a)) ** 6)
        x, y = r * math.sin(a), -r * math.cos(a) * 1.15 - size * 0.35
        if upright:
            y = -y
        ring.append(Vector((x, -0.004 * (1 - (x / size) ** 2), y)))
    centre = bm.verts.new(at + (rot @ Vector((0, -0.002, -size * 0.4 if not upright else size * 0.4))))
    verts = [bm.verts.new(at + (rot @ p)) for p in ring]
    for v0, v1 in zip(verts, verts[1:]):
        bm.faces.new((centre, v0, v1))
    return b._wrap(before, None, mat)


def build_floor_books(rng):
    """A stack of big books on the floor by the desk's left leg, the top one open-spined and askew."""
    mats = [bpy.data.materials[f"book_cloth_{i}"] for i in range(len(BOOK_CLOTH))]
    pages = bpy.data.materials["book_pages"]
    gilt = bpy.data.materials["book_gilt"]
    b = pl.Builder("props_floor_books")
    z = 0.0
    for k in range(5):
        thick = rng.uniform(0.025, 0.05)
        w, d = rng.uniform(0.22, 0.31), rng.uniform(0.17, 0.24)
        faces = b.box((w, d, thick), loc=(0, 0, thick / 2), mat=rng.choice(mats), bevel=0.0015, bevel_seg=1)
        faces += b.box((w - 0.008, d - 0.006, thick - 0.006), loc=(0.006, 0, thick / 2), mat=pages)
        m = Matrix.Translation((rng.uniform(-0.015, 0.015), rng.uniform(-0.015, 0.015), z)) @ pl.xform(
            rot=(0, 0, rng.uniform(-14, 14)))
        bmesh.ops.transform(b.bm, matrix=m, verts=list({v for f in faces for v in f.verts}))
        z += thick
    obj = finish(b, "props_floor_books", smooth=30)
    place(obj, Vector((-1.17, -0.02, 0.0)), 18.0)
    return obj


def build_reading_corner():
    """A paper lantern standing on the floor beside the lounge chair: a ribbed globe on a thin black tripod, glowing
    warm. It sits low, so from the wide framing it is a light pool in the foreground, not a shade in the middle."""
    paper = pl.surface("lantern_paper", (0.86, 0.80, 0.68), 0.9, color_tex=pl.ambientcg("Paper001")["Color"],
                       tint=(1.0, 0.94, 0.82), tile=0.3, translucency=0.6, emission=((1.0, 0.66, 0.36), 1.6),
                       color_var=0.04)
    rib = pl.surface("lantern_rib", (0.52, 0.42, 0.28), 0.7, color_var=0.05)
    steel = pl.surface("lantern_steel", (0.02, 0.02, 0.02), 0.45, metallic=0.6, edge_wear=0.3,
                       edge_color=(0.2, 0.2, 0.2), color_var=0.02)
    b = pl.Builder("props_lantern")
    r, cz, h = 0.19, 0.42, 0.40
    prof = [(0.0, cz - h / 2)]
    for k in range(1, 12):
        t = k / 12
        prof.append((r * math.sin(math.pi * t) ** 0.8, cz - h / 2 + h * t))
    prof.append((0.0, cz + h / 2))
    b.lathe(prof, segments=24, mat=paper)
    for k in range(1, 12, 1):
        t = k / 12
        rr = r * math.sin(math.pi * t) ** 0.8 + 0.0015
        b.torus(rr, 0.0012, segments=28, sides=4, loc=(0, 0, cz - h / 2 + h * t), mat=rib)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        foot = Vector((0.15 * math.cos(a), 0.15 * math.sin(a), 0.0))
        b.tube([foot, Vector((0.05 * math.cos(a), 0.05 * math.sin(a), cz - h / 2 + 0.02))], 0.004, sides=6, mat=steel)
    obj = finish(b, "props_lantern", smooth=40)
    place(obj, FLOOR_LAMP, 0.0)
    return FLOOR_LAMP + Vector((0, 0, cz))
