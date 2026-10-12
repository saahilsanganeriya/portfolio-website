"""Build blender/room.blend from scratch: Henry's layout, the room, materials, lights, props, posters and empties.

    blender -b --factory-startup -P blender/scripts/build_room.py

Every object that gets baked carries a custom property "atlas" (env, desk, props, posters); bake.py and export.py
read it. Props come from blender/props/<name>.blend and posters from blender/posters/<id>.png when they exist;
otherwise a placeholder block or card of the same size stands in.
"""

import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_henry  # noqa: E402
from import_henry import CACHE, REPO, fetch_cached  # noqa: E402

BLEND = REPO / "blender" / "room.blend"
# ROOM_PROPS_DIR points at another checkout's props while they are on an unmerged branch.
PROPS_DIR = Path(os.environ.get("ROOM_PROPS_DIR", REPO / "blender" / "props"))
POSTERS_DIR = REPO / "blender" / "posters"

# ---- Room dimensions (metres, Blender Z up; the viewer stands at -Y looking toward +Y) ----
X_LEFT, X_RIGHT = -2.55, 2.35  # left wall inner face, open right end of the back wall
Y_FRONT, Y_BACK = -2.75, 0.42  # open front edge, back wall inner face
WALL_T, WALL_H, FLOOR_T = 0.12, 2.62, 0.06
WIN_X0, WIN_X1, WIN_Z0, WIN_Z1 = 0.88, 1.78, 0.92, 2.12
DADO_Z = 0.88

POLYHAVEN = "https://dl.polyhaven.org/file/ph-assets"
TEXTURES = {
    # name: (real-world tile size in metres, {map: sha256})
    "black_walnut_veneer_02": (1.0, {
        "diff": "ac4cd64753a55684efe4ccaf6f81b465e237a8a885fffb95377cc371924c0f88",
        "rough": "172832f6fa42e539e35b04f321c067b61962da7aebe106fcd7934b84aa5dc204"}),
    "old_wooden_floor_03": (1.2, {
        "diff": "ac22acdda58999a150b6053794e017a943f1cbaf92e9840650b02fde1fa61151",
        "rough": "8bd31321d891f0eb7c73adfb2c0c7b4b0256af002ea204c32accd2c09da2451b"}),
    "plastered_wall_04": (3.2, {
        "diff": "aaf0e693291d51d13531480625a942f950fed23f6b1d1008ee0e91f2a23a7b1e",
        "rough": "37302048eb2e60be2a73a7f803965097681e652b80b93d6d701cfc7fabc1e0a7"}),
    "fabric_leather_02": (0.5, {
        "diff": "d2cd2e14face20b152dffd1d59a48d91bbef7b516242bc39c401c09d018e7eb8",
        "rough": "36af9f3299a221608de05e4a7e2eac59c70f7a725e7de690361d2e1478d1e16f"}),
    "poly_wool_herringbone": (0.27, {
        "diff": "ca21de8e2e7f43178f8290361bfb2271eb264af0d2887c7c93e76a113ff3cc64",
        "rough": "8678dfb7f474440c12a5f317fe01802dd1aabbb205a6c947bb044ade72294fa7"}),
}
HDRI = ("sunset_jhbcentral_4k.hdr", "eb388d9816eaf79db2f3e8bd391117ae24f10437ea9e00d1a9a24e083150cf97")
HDRI_ROTATION_Z = math.radians(-14)

# Props from blender/props/<name>.blend (each faces -Y with its origin at the base): placement in metres,
# z-rotation in degrees or the name of the prop its front should face, and a placeholder size for a missing file.
PROPS = {
    "fujifilm_x100": ((-0.60, -0.29, 0.7345), 18, (0.128, 0.055, 0.075)),
    "fujifilm_xt": ((-0.62, 0.30, 1.6475), -12, (0.135, 0.065, 0.095)),
    "fujica_st": ((-0.25, 0.31, 1.6475), 8, (0.145, 0.09, 0.095)),
    "super8_camera": ((0.12, 0.30, 1.6475), -20, (0.07, 0.24, 0.17)),
    "film_canister": ((-0.42, 0.30, 2.0075), 0, (0.18, 0.18, 0.06)),
    "books_stack": ((-0.88, 0.30, 2.0075), 90, (0.16, 0.24, 0.20)),
    "projector_8mm": ((-1.95, -2.08, 0.55), "projector_screen", (0.21, 0.33, 0.33)),
    "projector_screen": ((-1.86, -0.12, 0.0), "projector_8mm", (1.09, 0.92, 1.80)),
    "nas_4bay": ((0.585, 0.15, 0.7325), -14, (0.20, 0.23, 0.17)),
    "mango_plant": ((1.10, 0.36, 0.92), 0, (0.38, 0.41, 0.41)),
}
POSTER_IDS = ["the-odyssey-2026", "la-la-land", "chungking-express", "marty-supreme"]
POSTER_SIZE = (0.40, 0.60)  # visible art, 2:3
POSTER_Y = [-0.95, -1.43, -1.91, -2.39]
POSTER_Z = 1.66

CAMERAS = {
    # name: (position, target) in metres; vertical field of view is 35 degrees for every framing.
    "cam_loading": ((6.6, -8.8, 5.2), (-0.2, -0.8, 0.7)),
    "cam_idle": ((4.05, -5.35, 2.85), (-0.2, -0.85, 0.95)),
    "cam_desk": ((0.0, -1.59, 1.38), (0.0, 0.0, 1.01)),
    "cam_monitor": ((0.0, -0.58, 1.137), (0.0, 0.0, 1.137)),
    "cam_shelf": ((-0.25, -1.05, 1.62), (-0.30, 0.30, 1.72)),
    "cam_projector": ((-0.55, -2.65, 1.25), (-1.80, -1.05, 0.95)),
}
CAMERA_FOV_DEG = 35.0


# ---- Small helpers ----

def collection(name: str) -> bpy.types.Collection:
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    return coll


def new_object(name: str, bm: bmesh.types.BMesh, coll: str, atlas: str | None, materials=()) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in materials:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection(coll).objects.link(obj)
    if atlas:
        obj["atlas"] = atlas
    return obj


def add_box(bm, size, center, bevel=0.0, segments=2, mat=0):
    """Add an axis-aligned box (optionally bevelled) to bm; returns its faces."""
    geom = bmesh.ops.create_cube(bm, size=1.0)
    verts = geom["verts"]
    for v in verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + Vector(center)
    faces = list({f for v in verts for f in v.link_faces})
    if bevel > 0:
        edges = list({e for f in faces for e in f.edges})
        result = bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=segments, profile=0.5,
                                 affect="EDGES", clamp_overlap=True)
        faces = list(set(faces) | set(result["faces"]))
        faces = [f for f in faces if f.is_valid]
    for f in faces:
        f.material_index = mat
    return faces


def add_cylinder(bm, radius, depth, center, segments=32, mat=0, radius_top=None, axis="Z"):
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius,
                                 radius2=radius if radius_top is None else radius_top, depth=depth)
    rot = {"Z": Matrix.Identity(3), "X": Matrix.Rotation(math.pi / 2, 3, "Y"),
           "Y": Matrix.Rotation(math.pi / 2, 3, "X")}[axis]
    for v in geom["verts"]:
        v.co = rot @ v.co + Vector(center)
    faces = list({f for v in geom["verts"] for f in v.link_faces})
    for f in faces:
        f.material_index = mat
    return faces


def smooth_by_angle(obj, degrees=35.0):
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=math.radians(degrees))


def socket(node, name, kind=None, output=False):
    sockets = node.outputs if output else node.inputs
    for s in sockets:
        if s.name == name and (kind is None or s.type == kind) and s.enabled:
            return s
    for s in sockets:
        if s.name == name and (kind is None or s.type == kind):
            return s
    raise KeyError(f"{node.bl_idname} has no socket {name} ({kind})")


def srgb(hex_colour: str, alpha=1.0):
    """Hex sRGB -> linear RGBA for node colour inputs."""
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = hex_colour.lstrip("#")
    return (lin(int(h[0:2], 16)), lin(int(h[2:4], 16)), lin(int(h[4:6], 16)), alpha)


# ---- Materials ----

class Mat:
    """Thin builder over a node material with a Principled BSDF."""

    def __init__(self, name: str):
        self.mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.out = self.node("ShaderNodeOutputMaterial", (600, 0))
        self.bsdf = self.node("ShaderNodeBsdfPrincipled", (300, 0))
        self.link(self.bsdf.outputs["BSDF"], self.out.inputs["Surface"])

    def node(self, kind, loc=(0, 0), **props):
        n = self.nt.nodes.new(kind)
        n.location = loc
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def set(self, **inputs):
        names = {"base": "Base Color", "rough": "Roughness", "metal": "Metallic", "coat": "Coat Weight",
                 "coat_rough": "Coat Roughness", "emit": "Emission Color", "emit_strength": "Emission Strength",
                 "spec": "Specular IOR Level", "sheen": "Sheen Weight"}
        for key, value in inputs.items():
            self.bsdf.inputs[names[key]].default_value = value
        return self

    def image(self, path: Path, non_color=False, scale=1.0, loc=(-700, 0)):
        """Box-projected image texture on object coordinates; scale = real-world tile size in metres."""
        coords = self.node("ShaderNodeTexCoord", (loc[0] - 400, loc[1]))
        mapping = self.node("ShaderNodeMapping", (loc[0] - 200, loc[1]))
        mapping.inputs["Scale"].default_value = (1 / scale, 1 / scale, 1 / scale)
        tex = self.node("ShaderNodeTexImage", loc)
        tex.image = bpy.data.images.load(str(path), check_existing=True)
        tex.image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
        tex.projection = "BOX"
        tex.projection_blend = 0.2
        self.link(coords.outputs["Object"], mapping.inputs["Vector"])
        self.link(mapping.outputs["Vector"], tex.inputs["Vector"])
        return tex

    def mix(self, a, b, blend="MULTIPLY", fac=1.0, loc=(-200, 0)):
        m = self.node("ShaderNodeMix", loc, data_type="RGBA", blend_type=blend)
        socket(m, "Factor", "VALUE").default_value = fac
        for slot, value in (("A", a), ("B", b)):
            target = socket(m, slot, "RGBA")
            if isinstance(value, bpy.types.NodeSocket):
                self.link(value, target)
            else:
                target.default_value = value
        return socket(m, "Result", "RGBA", output=True)

    def bump(self, height_socket, strength=0.2, distance=0.002):
        b = self.node("ShaderNodeBump", (100, -400))
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.link(height_socket, b.inputs["Height"])
        self.link(b.outputs["Normal"], self.bsdf.inputs["Normal"])

    def remap(self, value_socket, lo, hi, loc=(-200, -300)):
        r = self.node("ShaderNodeMapRange", loc)
        self.link(value_socket, r.inputs["Value"])
        r.inputs["To Min"].default_value = lo
        r.inputs["To Max"].default_value = hi
        return r.outputs["Result"]

    def grime(self, colour_socket, grime_colour, distance=0.03, amount=0.6):
        """Darken crevices with an AO-driven dirt colour (Cycles evaluates AO during the bake)."""
        ao = self.node("ShaderNodeAmbientOcclusion", (-500, 300), samples=8)
        ao.inputs["Distance"].default_value = distance
        inv = self.node("ShaderNodeMath", (-300, 300), operation="SUBTRACT")
        inv.inputs[0].default_value = 1.0
        self.link(ao.outputs["AO"], inv.inputs[1])
        fac = self.node("ShaderNodeMath", (-150, 300), operation="MULTIPLY")
        self.link(inv.outputs["Value"], fac.inputs[0])
        fac.inputs[1].default_value = amount
        m = self.node("ShaderNodeMix", (0, 300), data_type="RGBA", blend_type="MIX")
        self.link(fac.outputs["Value"], socket(m, "Factor", "VALUE"))
        self.link(colour_socket, socket(m, "A", "RGBA"))
        socket(m, "B", "RGBA").default_value = grime_colour
        return socket(m, "Result", "RGBA", output=True)

    def noise(self, scale=8.0, detail=4.0, loc=(-700, -500)):
        coords = self.node("ShaderNodeTexCoord", (loc[0] - 200, loc[1]))
        n = self.node("ShaderNodeTexNoise", loc)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        self.link(coords.outputs["Object"], n.inputs["Vector"])
        return n


def texture_path(name: str, kind: str) -> Path:
    size, hashes = TEXTURES[name]
    filename = f"{name}_{kind}_2k.jpg"
    return fetch_cached(f"{POLYHAVEN}/Textures/jpg/2k/{name}/{filename}", CACHE / "polyhaven" / filename,
                        hashes[kind])


def wood_material(name, texture, tint, value=1.0, rough=(0.35, 0.6), coat=0.0, bump=0.15):
    size = TEXTURES[texture][0]
    m = Mat(name)
    diff = m.image(texture_path(texture, "diff"), scale=size, loc=(-900, 100))
    rough_tex = m.image(texture_path(texture, "rough"), non_color=True, scale=size, loc=(-900, -300))
    hsv = m.node("ShaderNodeHueSaturation", (-600, 100))
    hsv.inputs["Value"].default_value = value
    m.link(diff.outputs["Color"], hsv.inputs["Color"])
    colour = m.mix(hsv.outputs["Color"], tint, "MULTIPLY", 1.0, (-400, 100))
    colour = m.grime(colour, (0.01, 0.007, 0.005, 1), distance=0.02, amount=0.5)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.link(m.remap(rough_tex.outputs["Color"], *rough), m.bsdf.inputs["Roughness"])
    m.bump(diff.outputs["Color"], strength=bump, distance=0.001)
    m.set(coat=coat, coat_rough=0.25)
    return m.mat


def build_materials() -> dict[str, bpy.types.Material]:
    mats = {}
    mats["walnut"] = wood_material("walnut", "black_walnut_veneer_02", (0.34, 0.21, 0.13, 1), value=0.62,
                                   rough=(0.32, 0.55), coat=0.25)
    mats["floor"] = wood_material("floor", "old_wooden_floor_03", (0.42, 0.34, 0.29, 1), value=0.4,
                                  rough=(0.45, 0.8), bump=0.25)

    m = Mat("wall_paint")
    size = TEXTURES["plastered_wall_04"][0]
    plaster = m.image(texture_path("plastered_wall_04", "diff"), non_color=True, scale=size)
    ramp = m.node("ShaderNodeValToRGB", (-400, 0))
    m.link(plaster.outputs["Color"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.25, srgb("#203D3A")
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.75, srgb("#30544F")
    geo = m.node("ShaderNodeNewGeometry", (-700, 300))
    sep = m.node("ShaderNodeSeparateXYZ", (-550, 300))
    m.link(geo.outputs["Position"], sep.inputs["Vector"])
    below = m.node("ShaderNodeMath", (-400, 300), operation="LESS_THAN")
    m.link(sep.outputs["Z"], below.inputs[0])
    below.inputs[1].default_value = DADO_Z
    two_tone = m.node("ShaderNodeMix", (-250, 100), data_type="RGBA", blend_type="MULTIPLY")
    m.link(below.outputs["Value"], socket(two_tone, "Factor", "VALUE"))
    m.link(ramp.outputs["Color"], socket(two_tone, "A", "RGBA"))
    socket(two_tone, "B", "RGBA").default_value = (0.62, 0.66, 0.68, 1)
    colour = m.grime(socket(two_tone, "Result", "RGBA", output=True), srgb("#0E1A19"), distance=0.12, amount=0.55)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.set(rough=0.82, spec=0.3)
    m.bump(plaster.outputs["Color"], strength=0.25, distance=0.002)
    mats["wall_paint"] = m.mat

    mats["section"] = Mat("section").set(base=srgb("#14110F"), rough=0.95).mat

    m = Mat("cream_plastic")
    n = m.noise(scale=3.0, detail=3.0)
    ramp = m.node("ShaderNodeValToRGB", (-400, 0))
    m.link(n.outputs["Fac"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = srgb("#CBBC9C")
    ramp.color_ramp.elements[1].color = srgb("#DCD0B6")
    colour = m.grime(ramp.outputs["Color"], srgb("#6E6250"), distance=0.015, amount=0.55)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.set(rough=0.48, spec=0.45)
    fine = m.noise(scale=400.0, detail=2.0, loc=(-700, -800))
    m.bump(fine.outputs["Fac"], strength=0.04, distance=0.0005)
    mats["cream_plastic"] = m.mat

    m = Mat("cream_paint")
    colour = m.grime(m.mix(srgb("#D6CBB6"), srgb("#D6CBB6"), "MIX", 0.0), srgb("#7A6F5E"), 0.02, 0.6)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.set(rough=0.5)
    mats["cream_paint"] = m.mat

    m = Mat("brass")
    n = m.noise(scale=40.0, detail=6.0)
    m.link(m.remap(n.outputs["Fac"], 0.22, 0.42), m.bsdf.inputs["Roughness"])
    colour = m.grime(m.mix(srgb("#B8945C"), srgb("#B8945C"), "MIX", 0.0), srgb("#4A3A22"), 0.015, 0.7)
    m.link(colour, m.bsdf.inputs["Base Color"])
    m.set(metal=1.0)
    mats["brass"] = m.mat

    m = Mat("leather")
    size = TEXTURES["fabric_leather_02"][0]
    diff = m.image(texture_path("fabric_leather_02", "diff"), scale=size, loc=(-900, 100))
    rough_tex = m.image(texture_path("fabric_leather_02", "rough"), non_color=True, scale=size, loc=(-900, -300))
    colour = m.mix(diff.outputs["Color"], srgb("#7A3A2A"), "MULTIPLY", 0.85, (-400, 100))
    m.link(m.grime(colour, (0.01, 0.005, 0.004, 1), 0.03, 0.5), m.bsdf.inputs["Base Color"])
    m.link(m.remap(rough_tex.outputs["Color"], 0.35, 0.7), m.bsdf.inputs["Roughness"])
    m.bump(diff.outputs["Color"], strength=0.2, distance=0.001)
    mats["leather"] = m.mat

    mats["black_metal"] = Mat("black_metal").set(base=srgb("#1D1B19"), rough=0.45, metal=0.3).mat
    mats["rubber"] = Mat("rubber").set(base=srgb("#3A352E"), rough=0.7).mat
    mats["paper"] = Mat("paper").set(base=srgb("#E6DECD"), rough=0.85).mat

    m = Mat("paper_stack")
    coords = m.node("ShaderNodeTexCoord", (-900, 0))
    wave = m.node("ShaderNodeTexWave", (-700, 0), wave_type="BANDS", bands_direction="Z")
    wave.inputs["Scale"].default_value = 260.0
    wave.inputs["Distortion"].default_value = 2.0
    wave.inputs["Detail"].default_value = 3.0
    m.link(coords.outputs["Object"], wave.inputs["Vector"])
    geo = m.node("ShaderNodeNewGeometry", (-700, -300))
    sep = m.node("ShaderNodeSeparateXYZ", (-550, -300))
    m.link(geo.outputs["Normal"], sep.inputs["Vector"])
    side = m.node("ShaderNodeMath", (-400, -300), operation="LESS_THAN")
    m.link(sep.outputs["Z"], side.inputs[0])
    side.inputs[1].default_value = 0.7
    lines = m.node("ShaderNodeMath", (-400, 0), operation="MULTIPLY")
    m.link(wave.outputs["Fac"], lines.inputs[0])
    m.link(side.outputs["Value"], lines.inputs[1])
    mix = m.node("ShaderNodeMix", (-200, 0), data_type="RGBA", blend_type="MIX")
    m.link(lines.outputs["Value"], socket(mix, "Factor", "VALUE"))
    socket(mix, "A", "RGBA").default_value = srgb("#E3DACA")
    socket(mix, "B", "RGBA").default_value = srgb("#B5AA97")
    m.link(m.grime(socket(mix, "Result", "RGBA", output=True), srgb("#6B6253"), 0.01, 0.5), m.bsdf.inputs["Base Color"])
    m.set(rough=0.85)
    mats["paper_stack"] = m.mat

    m = Mat("linen")
    n = m.noise(scale=60.0, detail=8.0)
    ramp = m.node("ShaderNodeValToRGB", (-400, 0))
    m.link(n.outputs["Fac"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = srgb("#A89C86")
    ramp.color_ramp.elements[1].color = srgb("#C2B6A0")
    m.link(ramp.outputs["Color"], m.bsdf.inputs["Base Color"])
    m.set(rough=0.9, sheen=0.5)
    mats["linen"] = m.mat
    mats["ceramic"] = Mat("ceramic").set(base=srgb("#E3DACA"), rough=0.22, spec=0.6).mat
    mats["placeholder"] = Mat("placeholder").set(base=srgb("#8A8378"), rough=0.6).mat

    m = Mat("rug")
    size = TEXTURES["poly_wool_herringbone"][0]
    wool = m.image(texture_path("poly_wool_herringbone", "diff"), non_color=True, scale=size)
    ramp = m.node("ShaderNodeValToRGB", (-400, 0))
    m.link(wool.outputs["Color"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = srgb("#2C1612")
    ramp.color_ramp.elements[1].color = srgb("#6A3329")
    # A plain border band in dust, 9-12 cm in from the rug's edge, from the rug's generated coordinates.
    coords = m.node("ShaderNodeTexCoord", (-900, -400))
    sep = m.node("ShaderNodeSeparateXYZ", (-700, -400))
    m.link(coords.outputs["Generated"], sep.inputs["Vector"])
    bands = []
    for axis, length in (("X", 2.1), ("Y", 1.45)):
        edge = m.node("ShaderNodeMath", (-500, -400), operation="PINGPONG")
        m.link(sep.outputs[axis], edge.inputs[0])
        edge.inputs[1].default_value = 0.5
        dist = m.node("ShaderNodeMath", (-350, -400), operation="MULTIPLY")
        m.link(edge.outputs["Value"], dist.inputs[0])
        dist.inputs[1].default_value = length
        inside = m.node("ShaderNodeMath", (-200, -400), operation="COMPARE")
        m.link(dist.outputs["Value"], inside.inputs[0])
        inside.inputs[1].default_value = 0.105
        inside.inputs[2].default_value = 0.015
        bands.append(inside)
    band = m.node("ShaderNodeMath", (-50, -400), operation="MAXIMUM")
    m.link(bands[0].outputs["Value"], band.inputs[0])
    m.link(bands[1].outputs["Value"], band.inputs[1])
    mixed = m.node("ShaderNodeMix", (0, 0), data_type="RGBA", blend_type="MULTIPLY")
    m.link(band.outputs["Value"], socket(mixed, "Factor", "VALUE"))
    m.link(ramp.outputs["Color"], socket(mixed, "A", "RGBA"))
    socket(mixed, "B", "RGBA").default_value = (2.2, 1.9, 1.6, 1)
    m.link(socket(mixed, "Result", "RGBA", output=True), m.bsdf.inputs["Base Color"])
    m.set(rough=0.95, sheen=0.4)
    m.bump(wool.outputs["Color"], strength=0.35, distance=0.002)
    mats["rug"] = m.mat

    m = Mat("crt_glass")
    coords = m.node("ShaderNodeTexCoord", (-900, 0))
    grad = m.node("ShaderNodeTexGradient", (-700, 0), gradient_type="SPHERICAL")
    shift = m.node("ShaderNodeMapping", (-800, 0))
    shift.inputs["Location"].default_value = (-0.5, -0.5, 0)
    shift.inputs["Scale"].default_value = (1.6, 2.0, 1)
    m.link(coords.outputs["UV"], shift.inputs["Vector"])
    m.link(shift.outputs["Vector"], grad.inputs["Vector"])
    glow = m.remap(grad.outputs["Fac"], 0.05, 0.28, loc=(-500, 0))
    m.link(glow, m.bsdf.inputs["Emission Strength"])
    m.set(base=srgb("#0D1110"), rough=0.12, emit=srgb("#9DB4C0"), spec=0.6)
    mats["crt_glass"] = m.mat

    m = Mat("lamp_bulb")
    m.set(base=(1, 0.9, 0.7, 1), emit=(1.0, 0.45, 0.14, 1), emit_strength=40.0, rough=0.3)
    mats["lamp_bulb"] = m.mat

    m = Mat("nas_led")
    m.set(base=(0.2, 0.25, 0.27, 1), emit=srgb("#B8D4E0"), emit_strength=6.0)
    mats["nas_led"] = m.mat

    m = Mat("projection")
    m.set(base=(0.9, 0.9, 0.9, 1), emit=srgb("#9DB4C0"), emit_strength=0.75, rough=0.9)
    mats["projection"] = m.mat

    proxy = Mat("proxy").set(base=(1, 0, 1, 1))
    proxy.mat.diffuse_color = (1, 0, 1, 0.2)
    mats["proxy"] = proxy.mat

    mats["sky"] = sky_material()
    return mats


def sky_material() -> bpy.types.Material:
    """Emission that looks up the dusk HDRI by direction from a point inside the room, so the window shows the
    city at dusk and the sky card lights the room through the opening."""
    m = Mat("sky")
    m.nt.nodes.remove(m.bsdf)
    emission = m.node("ShaderNodeEmission", (300, 0))
    m.link(emission.outputs["Emission"], m.out.inputs["Surface"])
    geo = m.node("ShaderNodeNewGeometry", (-900, 0))
    eye = m.node("ShaderNodeVectorMath", (-700, 0), operation="SUBTRACT")
    eye.inputs[1].default_value = ((WIN_X0 + WIN_X1) / 2, Y_BACK - 1.6, 0.85)
    m.link(geo.outputs["Position"], eye.inputs[0])
    norm = m.node("ShaderNodeVectorMath", (-550, 0), operation="NORMALIZE")
    m.link(eye.outputs["Vector"], norm.inputs[0])
    rot = m.node("ShaderNodeVectorRotate", (-400, 0), rotation_type="Z_AXIS")
    rot.inputs["Angle"].default_value = HDRI_ROTATION_Z
    m.link(norm.outputs["Vector"], rot.inputs["Vector"])
    env = m.node("ShaderNodeTexEnvironment", (-200, 0))
    env.image = bpy.data.images.load(str(hdri_path()), check_existing=True)
    m.link(rot.outputs["Vector"], env.inputs["Vector"])
    m.link(env.outputs["Color"], emission.inputs["Color"])
    emission.inputs["Strength"].default_value = 0.34
    return m.mat


def hdri_path() -> Path:
    name, sha = HDRI
    return fetch_cached(f"{POLYHAVEN}/HDRIs/hdr/4k/{name}", CACHE / "polyhaven" / name, sha)


# ---- Henry's layout, re-materialled ----

HENRY_MATERIALS = {
    "desk_desk": ["walnut"],
    "desk_chair_base": ["black_metal"],
    "desk_chair_seat": ["leather"],
    "desk_computer": ["cream_plastic"],
    "desk_crt": ["cream_plastic"],
    "desk_keyboard": ["cream_plastic"],
    "desk_mouse": ["cream_plastic"],
    "desk_cables": ["rubber"],
    "desk_mug": ["ceramic"],
    "desk_paper": ["paper"],
    "desk_tray_bottom": ["walnut"],
    "desk_tray_top": ["walnut"],
    "desk_papers_a": ["paper_stack"],
    "desk_papers_b": ["paper_stack"],
}


def place_henry(mats):
    for obj in import_henry.import_layout():
        for coll in obj.users_collection:
            coll.objects.unlink(obj)
        collection("desk").objects.link(obj)
        for name in HENRY_MATERIALS[obj.name]:
            obj.data.materials.append(mats[name])
        if obj.name in ("desk_tray_bottom", "desk_tray_top", "desk_papers_b"):
            obj.data.transform(Matrix.Translation((0.0, -0.05, 0.0)))
        smooth_by_angle(obj, 40)


# ---- The room shell ----

def build_shell(mats):
    wall, section, floor, walnut = mats["wall_paint"], mats["section"], mats["floor"], mats["walnut"]

    bm = bmesh.new()
    add_box(bm, (X_RIGHT - X_LEFT + WALL_T, Y_BACK - Y_FRONT + WALL_T, FLOOR_T),
            ((X_LEFT - WALL_T + X_RIGHT) / 2, (Y_FRONT + Y_BACK + WALL_T) / 2, -FLOOR_T / 2))
    for f in list(bm.faces):
        if f.normal.z < -0.5:
            bm.faces.remove(f)
        elif f.normal.z < 0.5:
            f.material_index = 1
    new_object("env_floor", bm, "env", "env", [floor, section])

    # Back wall with the window opening; the outside face and the hidden bottom are removed.
    bm = bmesh.new()
    add_box(bm, (X_RIGHT - X_LEFT + WALL_T, WALL_T, WALL_H),
            ((X_LEFT - WALL_T + X_RIGHT) / 2, Y_BACK + WALL_T / 2, WALL_H / 2))
    back = new_object("env_wall_back", bm, "env", "env", [wall, section])
    cut_window(back)
    tidy_wall(back, outward=Vector((0, 1, 0)))

    bm = bmesh.new()
    add_box(bm, (WALL_T, Y_BACK - Y_FRONT + WALL_T, WALL_H),
            (X_LEFT - WALL_T / 2, (Y_FRONT + Y_BACK + WALL_T) / 2, WALL_H / 2))
    left = new_object("env_wall_left", bm, "env", "env", [wall, section])
    tidy_wall(left, outward=Vector((-1, 0, 0)))

    # Walnut skirting along both walls, with a rounded top edge.
    bm = bmesh.new()
    add_box(bm, (X_RIGHT - X_LEFT, 0.016, 0.095), ((X_LEFT + X_RIGHT) / 2, Y_BACK - 0.008, 0.0475), bevel=0.004)
    add_box(bm, (0.016, Y_BACK - Y_FRONT, 0.095), (X_LEFT + 0.008, (Y_FRONT + Y_BACK) / 2, 0.0475), bevel=0.004)
    # Dado rail: a small walnut moulding where the lower, deeper paint begins.
    add_box(bm, (X_RIGHT - X_LEFT, 0.02, 0.04), ((X_LEFT + X_RIGHT) / 2, Y_BACK - 0.01, DADO_Z + 0.01), bevel=0.006)
    add_box(bm, (0.02, Y_BACK - Y_FRONT, 0.04), (X_LEFT + 0.01, (Y_FRONT + Y_BACK) / 2, DADO_Z + 0.01), bevel=0.006)
    smooth_by_angle(new_object("env_skirting", bm, "env", "env", [walnut]))


def build_ghosts(mats):
    """Camera-invisible ceiling, front and right walls: the room bounces light like a closed room while every
    camera sees an open cutaway. Ghosts carry no atlas, so they are never baked or exported."""
    ceiling = Mat("ghost_ceiling").set(base=srgb("#D8D0C2"), rough=0.9).mat
    for name, size, centre, mat in (
        ("ghost_ceiling", (X_RIGHT - X_LEFT + 0.4, Y_BACK - Y_FRONT + 0.4, 0.1),
         ((X_LEFT + X_RIGHT) / 2, (Y_FRONT + Y_BACK) / 2, WALL_H + 0.05), ceiling),
        ("ghost_wall_front", (X_RIGHT - X_LEFT + 0.4, WALL_T, WALL_H),
         ((X_LEFT + X_RIGHT) / 2, Y_FRONT - WALL_T / 2 - 0.3, WALL_H / 2), mats["wall_paint"]),
        ("ghost_wall_right", (WALL_T, Y_BACK - Y_FRONT + 0.4, WALL_H),
         (X_RIGHT + WALL_T / 2 + 0.3, (Y_FRONT + Y_BACK) / 2, WALL_H / 2), mats["wall_paint"]),
    ):
        bm = bmesh.new()
        add_box(bm, size, centre)
        obj = new_object(name, bm, "ghosts", None, [mat])
        obj.visible_camera = False


def cut_window(wall):
    cutter_bm = bmesh.new()
    add_box(cutter_bm, (WIN_X1 - WIN_X0, 1.0, WIN_Z1 - WIN_Z0),
            ((WIN_X0 + WIN_X1) / 2, Y_BACK, (WIN_Z0 + WIN_Z1) / 2))
    cutter = new_object("cutter", cutter_bm, "env", None)
    mod = wall.modifiers.new("window", "BOOLEAN")
    mod.operation, mod.solver, mod.object = "DIFFERENCE", "EXACT", cutter
    bpy.context.view_layer.objects.active = wall
    with bpy.context.temp_override(object=wall, active_object=wall):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def tidy_wall(obj, outward: Vector):
    """Drop faces nobody sees (outside, bottom) and give the cut edges the section material."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for f in list(bm.faces):
        n = f.normal
        if n.dot(outward) > 0.9 or n.z < -0.9 and f.calc_center_median().z < 0.01:
            bm.faces.remove(f)
            continue
        c = f.calc_center_median()
        is_top = n.z > 0.9 and c.z > WALL_H - 0.01
        is_end = (abs(n.x) > 0.9 and c.x > X_RIGHT - 0.01) or (abs(n.y) > 0.9 and c.y < Y_FRONT + 0.01)
        f.material_index = 1 if (is_top or is_end) else 0
    bm.to_mesh(obj.data)
    bm.free()


# ---- Window, sill, sky ----

def build_window(mats):
    paint, walnut = mats["cream_paint"], mats["walnut"]
    bm = bmesh.new()
    depth_mid = Y_BACK + WALL_T * 0.55
    w, h = WIN_X1 - WIN_X0, WIN_Z1 - WIN_Z0
    cx, cz = (WIN_X0 + WIN_X1) / 2, (WIN_Z0 + WIN_Z1) / 2
    # Architrave on the room face.
    t, a = 0.022, 0.07
    add_box(bm, (w + 2 * a, t, a), (cx, Y_BACK - t / 2, WIN_Z1 + a / 2), bevel=0.005)
    for x in (WIN_X0 - a / 2, WIN_X1 + a / 2):
        add_box(bm, (a, t, h), (x, Y_BACK - t / 2, cz), bevel=0.005)
    # Frame in the reveal, two sashes, glazing bars (a 2 x 3 grid per sash).
    f = 0.05
    add_box(bm, (w, 0.06, f), (cx, depth_mid, WIN_Z1 - f / 2), bevel=0.004)
    add_box(bm, (w, 0.06, f), (cx, depth_mid, WIN_Z0 + f / 2), bevel=0.004)
    for x in (WIN_X0 + f / 2, WIN_X1 - f / 2):
        add_box(bm, (f, 0.06, h), (x, depth_mid, cz), bevel=0.004)
    meet = cz + 0.05
    add_box(bm, (w - 2 * f, 0.07, 0.045), (cx, depth_mid, meet), bevel=0.004)
    bar = 0.018
    for x in (cx,):
        add_box(bm, (bar, 0.03, h - 2 * f), (x, depth_mid - 0.012, cz), bevel=0.003)
    for z in ((WIN_Z0 + f + meet) / 2, (meet + WIN_Z1 - f) / 2):
        add_box(bm, (w - 2 * f, 0.03, bar), (cx, depth_mid - 0.012, z), bevel=0.003)
    frame = new_object("env_window_frame", bm, "env", "env", [paint])
    smooth_by_angle(frame)

    build_curtains(mats, cx, w)

    # Interior sill: a walnut board resting on the reveal, standing 6 cm proud of the wall.
    bm = bmesh.new()
    sill_front, sill_back = Y_BACK - 0.16, Y_BACK + WALL_T * 0.55
    add_box(bm, (w + 0.16, sill_back - sill_front, 0.028), (cx, (sill_front + sill_back) / 2, WIN_Z0 - 0.014),
            bevel=0.006)
    smooth_by_angle(new_object("env_window_sill", bm, "env", "env", [walnut]))

    # Sky card: a flat panel 0.5 m outside the wall, below the wall top and inside its right end, so it is
    # only ever seen through the window.
    bm = bmesh.new()
    y = Y_BACK + WALL_T + 0.5
    quad = [bm.verts.new((x, y, z)) for x, z in ((0.45, 0.6), (X_RIGHT - 0.05, 0.6), (X_RIGHT - 0.05, 2.42),
                                                 (0.45, 2.42))]
    bm.faces.new(quad)
    bm.normal_update()
    for face in bm.faces:
        if face.normal.y > 0:
            face.normal_flip()
    sky = new_object("env_sky", bm, "env", "env", [mats["sky"]])
    sky.visible_shadow = False


def build_curtains(mats, cx, w):
    """A brass rod over the window and two pleated linen panels drawn to the sides."""
    bm = bmesh.new()
    rod_z, rod_y = WIN_Z1 + 0.16, Y_BACK - 0.09
    add_cylinder(bm, 0.011, w + 0.62, (cx, rod_y, rod_z), segments=16, axis="X")
    for side in (-1, 1):
        add_cylinder(bm, 0.02, 0.03, (cx + side * (w / 2 + 0.31), rod_y, rod_z), segments=16, axis="X")
        add_box(bm, (0.014, 0.09, 0.014), (cx + side * (w / 2 + 0.22), Y_BACK - 0.045, rod_z), mat=0)
    smooth_by_angle(new_object("env_curtain_rod", bm, "env", "env", [mats["brass"]]), 50)

    bm = bmesh.new()
    pleats, width, top, bottom = 7, 0.30, rod_z - 0.03, WIN_Z0 - 0.12
    for side in (-1, 1):
        x_outer = cx + side * (w / 2 + 0.3)
        cols = pleats * 4 + 1
        grid = []
        for i in range(cols):
            t = i / (cols - 1)
            x = x_outer - side * t * width
            depth = 0.035 * math.sin(t * pleats * 2 * math.pi)
            column = []
            for k in range(9):
                z = top - (top - bottom) * k / 8
                sway = 0.012 * math.sin(k * 0.9 + side) * t
                column.append(bm.verts.new((x, rod_y + depth + sway, z)))
            grid.append(column)
        for i in range(cols - 1):
            for k in range(8):
                quad = (grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k])
                bm.faces.new(quad if side > 0 else tuple(reversed(quad)))
    bm.normal_update()
    for face in bm.faces:
        if face.normal.y > 0:
            face.normal_flip()
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.004)
    curtain = new_object("env_curtains", bm, "env", "env", [mats["linen"]])
    smooth_by_angle(curtain, 60)


def build_radiator(mats):
    paint = mats["cream_paint"]
    bm = bmesh.new()
    sections, pitch = 11, 0.062
    x0 = (WIN_X0 + WIN_X1) / 2 - (sections - 1) * pitch / 2
    y = Y_BACK - 0.075
    for i in range(sections):
        x = x0 + i * pitch
        add_box(bm, (0.048, 0.075, 0.56), (x, y, 0.42), bevel=0.012, segments=3)
    add_box(bm, (sections * pitch, 0.04, 0.04), ((WIN_X0 + WIN_X1) / 2, y, 0.68), bevel=0.01)
    add_box(bm, (sections * pitch, 0.04, 0.04), ((WIN_X0 + WIN_X1) / 2, y, 0.16), bevel=0.01)
    for x in (x0, x0 + (sections - 1) * pitch):
        add_box(bm, (0.05, 0.08, 0.13), (x, y, 0.065), bevel=0.01)
    add_cylinder(bm, 0.012, 0.16, (x0 - 0.06, y, 0.08), segments=12)
    add_cylinder(bm, 0.012, 0.07, (x0 - 0.03, y, 0.155), segments=12, axis="X")
    smooth_by_angle(new_object("env_radiator", bm, "env", "env", [paint]), 50)


def build_shelf(mats):
    walnut, brass = mats["walnut"], mats["brass"]
    bm = bmesh.new()
    x0, x1, depth, thick = -1.02, 0.30, 0.24, 0.026
    for z in (1.62, 1.98):
        add_box(bm, (x1 - x0, depth, thick), ((x0 + x1) / 2, Y_BACK - depth / 2, z + thick / 2),
                bevel=0.004, mat=0)
        for x in (x0 + 0.16, x1 - 0.16):
            add_box(bm, (0.018, 0.006, 0.17), (x, Y_BACK - 0.003, z - 0.085), mat=1)
            add_box(bm, (0.018, depth - 0.04, 0.006), (x, Y_BACK - (depth - 0.04) / 2, z - 0.003), mat=1)
    obj = new_object("env_shelf", bm, "env", "env", [walnut, brass])
    smooth_by_angle(obj)
    return obj


PICTURE_LIGHT = Vector((X_LEFT + 0.13, sum(POSTER_Y) / len(POSTER_Y), POSTER_Z + POSTER_SIZE[1] / 2 + 0.16))
SHELF_LIGHT = Vector((-0.36, Y_BACK - 0.205, 1.962))


def build_fixtures(mats):
    """Brass picture light over the posters and a brass strip light under the top shelf."""
    brass = mats["brass"]
    bm = bmesh.new()
    p = PICTURE_LIGHT
    add_cylinder(bm, 0.022, 1.6, p, segments=24, axis="Y")
    add_box(bm, (0.012, 1.58, 0.012), p + Vector((0.01, 0, -0.022)))
    for dy in (-0.45, 0.45):
        add_box(bm, (0.13, 0.012, 0.012), Vector((X_LEFT + 0.065, p.y + dy, p.z + 0.03)), bevel=0.003)
        add_cylinder(bm, 0.03, 0.012, Vector((X_LEFT + 0.006, p.y + dy, p.z + 0.03)), segments=24, axis="X")
    smooth_by_angle(new_object("env_picture_light", bm, "env", "env", [brass]), 50)

    bm = bmesh.new()
    add_cylinder(bm, 0.011, 1.1, SHELF_LIGHT, segments=16, axis="X")
    smooth_by_angle(new_object("env_shelf_light", bm, "env", "env", [brass]), 50)


def build_side_table(mats):
    walnut = mats["walnut"]
    bm = bmesh.new()
    cx, cy, top = -1.95, -2.08, 0.55
    add_cylinder(bm, 0.21, 0.03, (cx, cy, top - 0.015), segments=48)
    add_cylinder(bm, 0.17, 0.022, (cx, cy, 0.20), segments=48)
    for i in range(3):
        ang = math.radians(90 + 120 * i)
        foot = Vector((cx + 0.2 * math.cos(ang), cy + 0.2 * math.sin(ang), 0.0))
        head = Vector((cx + 0.13 * math.cos(ang), cy + 0.13 * math.sin(ang), top - 0.03))
        leg = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.012, radius2=0.018,
                                    depth=(head - foot).length)
        mid = (head + foot) / 2
        rot = (head - foot).to_track_quat("Z", "Y").to_matrix()
        for v in leg["verts"]:
            v.co = rot @ v.co + mid
    smooth_by_angle(new_object("env_side_table", bm, "env", "env", [walnut]), 45)


def build_rug(mats):
    bm = bmesh.new()
    add_box(bm, (2.1, 1.45, 0.008), (-0.15, -0.55, 0.004), bevel=0.003)
    rug = new_object("env_rug", bm, "env", "env", [mats["rug"]])
    smooth_by_angle(rug)


# ---- Desk lamp ----

LAMP_BASE = Vector((-0.90, 0.25, 0.732))
LAMP_BULB = Vector((-0.64, -0.06, 1.13))


def build_lamp(mats):
    brass, bulb_mat = mats["brass"], mats["lamp_bulb"]
    bm = bmesh.new()
    b = LAMP_BASE
    add_cylinder(bm, 0.075, 0.022, b + Vector((0, 0, 0.011)), segments=48)
    add_cylinder(bm, 0.06, 0.012, b + Vector((0, 0, 0.028)), segments=48, radius_top=0.05)
    add_cylinder(bm, 0.009, 0.26, b + Vector((0, 0, 0.16)), segments=16)
    obj = new_object("desk_lamp", bm, "desk", "desk", [brass])

    # Gooseneck from the stem top to the shade, as a curve converted to a mesh.
    curve = bpy.data.curves.new("lamp_neck", "CURVE")
    curve.dimensions, curve.bevel_depth, curve.bevel_resolution = "3D", 0.008, 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(1)
    p0, p1 = spline.bezier_points
    p0.co = b + Vector((0, 0, 0.29))
    p0.handle_left = p0.co - Vector((0, 0, 0.1))
    p0.handle_right = p0.co + Vector((0, 0, 0.16))
    p1.co = LAMP_BULB + Vector((-0.06, 0.06, 0.09))
    p1.handle_left = p1.co + Vector((-0.10, 0.10, 0.06))
    p1.handle_right = p1.co + Vector((0.05, -0.05, -0.03))
    neck = bpy.data.objects.new("lamp_neck", curve)
    collection("desk").objects.link(neck)

    # Shade: an open brass cone aimed at the front-left of the desk, with the bulb inside.
    aim = (Vector((-0.58, -0.24, 0.732)) - LAMP_BULB).normalized()
    rot = aim.to_track_quat("Z", "Y").to_matrix()
    sbm = bmesh.new()
    cone = bmesh.ops.create_cone(sbm, cap_ends=False, segments=48, radius1=0.035, radius2=0.085, depth=0.15)
    bmesh.ops.solidify(sbm, geom=list(sbm.faces), thickness=0.0025)
    cap = bmesh.ops.create_cone(sbm, cap_ends=True, segments=48, radius1=0.04, radius2=0.03, depth=0.04)
    for v in cap["verts"]:
        v.co.z -= 0.09
    for v in sbm.verts:
        v.co = rot @ (v.co + Vector((0, 0, 0.03))) + LAMP_BULB
    shade = new_object("desk_lamp_shade", sbm, "desk", "desk", [brass])
    smooth_by_angle(shade, 50)

    bbm = bmesh.new()
    bmesh.ops.create_uvsphere(bbm, u_segments=24, v_segments=12, radius=0.024)
    for v in bbm.verts:
        v.co += LAMP_BULB
    bulb = new_object("lamp_bulb", bbm, "desk", "desk", [bulb_mat])
    smooth_by_angle(bulb, 180)

    bpy.context.view_layer.update()
    neck_mesh = bpy.data.meshes.new_from_object(neck.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(neck, do_unlink=True)
    neck_obj = bpy.data.objects.new("desk_lamp_neck", neck_mesh)
    neck_obj.data.materials.append(brass)
    neck_obj["atlas"] = "desk"
    collection("desk").objects.link(neck_obj)
    smooth_by_angle(neck_obj, 60)
    return obj


# ---- CRT screen ----

def crt_opening():
    """Measure the CRT bezel opening by casting rays into the screen hole; returns (centre, width, height).

    A ray is inside the opening when it passes the bezel and hits the tube interior; the opening is the run of
    inside rays connected to the screen centre along each axis (so the gap under the chin is not counted).
    """
    crt = bpy.data.objects["desk_crt"]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    step, cz = 0.002, 1.137

    def inside(x, z):
        hit, loc, *_ = crt.ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)), depsgraph=depsgraph)
        return hit and loc.y > -0.09

    def run(axis):
        ends = []
        for sign in (-1, 1):
            k = 0
            while inside(*((sign * (k + 1) * step, cz) if axis == "x" else (0.0, cz + sign * (k + 1) * step))):
                k += 1
            ends.append(sign * k * step)
        return ends

    (x0, x1), (z0, z1) = run("x"), run("z")
    return Vector(((x0 + x1) / 2, -0.085, cz + (z0 + z1) / 2)), x1 - x0, z1 - z0


def build_crt_glass(mats):
    centre, width, height = crt_opening()
    tilt = Matrix.Rotation(math.radians(-3), 4, "X")
    bm = bmesh.new()
    nx, nz = 16, 12
    gw, gh = width + 0.02, height + 0.02
    uv_layer = bm.loops.layers.uv.new("UVMap")
    grid = [[None] * (nz + 1) for _ in range(nx + 1)]
    for i in range(nx + 1):
        for j in range(nz + 1):
            u, v = i / nx, j / nz
            x, z = (u - 0.5) * gw, (v - 0.5) * gh
            bulge = 0.008 * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
            grid[i][j] = bm.verts.new(Vector((x, -bulge, z)))
    for i in range(nx):
        for j in range(nz):
            face = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            for loop, (di, dj) in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                loop[uv_layer].uv = ((i + di) / nx, (j + dj) / nz)
    bm.transform(Matrix.Translation(centre) @ tilt)
    bm.normal_update()
    glass = new_object("crt_glow", bm, "desk", "desk", [mats["crt_glass"]])
    smooth_by_angle(glass, 180)

    screen = bpy.data.objects.new("monitor_screen", None)
    screen.empty_display_type, screen.empty_display_size = "ARROWS", 0.1
    screen.location = centre
    screen.rotation_euler = Euler((math.radians(-3), 0, 0))
    screen["width_m"] = round(width, 4)
    screen["height_m"] = round(height, 4)
    collection("markers").objects.link(screen)
    return glass


# ---- Props and posters ----

def append_prop(name: str) -> list[bpy.types.Object]:
    path = PROPS_DIR / f"{name}.blend"
    with bpy.data.libraries.load(str(path), link=False) as (src, dst):
        if name not in src.collections:
            raise RuntimeError(f"{path} has no root collection '{name}'")
        dst.collections = [name]
    coll = dst.collections[0]
    objs = list(coll.all_objects)
    for obj in objs:
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
    bpy.data.collections.remove(coll)
    return objs


def prop_rotation(name: str) -> float:
    """Z rotation in radians: a fixed angle, or the angle that turns the prop's front (-Y) toward another prop."""
    loc, facing, _ = PROPS[name]
    if not isinstance(facing, str):
        return math.radians(facing)
    d = Vector(PROPS[facing][0]) - Vector(loc)
    return math.atan2(d.x, -d.y)


def flatten(objs):
    """Clear parents, keeping world transforms, so every node is a direct child of the scene in the glb."""
    bpy.context.view_layer.update()
    for obj in objs:
        if obj.parent is not None:
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = world


def place_one(name, root, coll, atlas, mats):
    """Append a prop (or a placeholder block) at root; returns its objects and the world position of each empty."""
    _, _, size = PROPS.get(name, (None, None, None))
    if (PROPS_DIR / f"{name}.blend").exists():
        objs = append_prop(name)
        for obj in objs:
            collection(coll).objects.link(obj)
            if obj.parent is None:
                obj.matrix_world = root @ obj.matrix_world
        flatten(objs)
    else:
        bm = bmesh.new()
        add_box(bm, size, (0, 0, size[2] / 2), bevel=min(size) * 0.08)
        obj = new_object(name, bm, coll, None, [mats["placeholder"]])
        obj.matrix_world = root
        objs = [obj]
        if name == "nas_4bay":
            for i in range(4):
                lbm = bmesh.new()
                add_box(lbm, (0.008, 0.003, 0.004), (-0.05 + i * 0.022, -size[1] / 2 - 0.0015, 0.14))
                led = new_object(f"nas_led_{i}", lbm, coll, None, [mats["nas_led"]])
                led.matrix_world = root
                objs.append(led)
    anchors = {o.name.split(".")[0]: o.matrix_world.translation.copy() for o in objs if o.type == "EMPTY"}
    meshes = [o for o in objs if o.type == "MESH"]
    for empty in [o for o in objs if o.type == "EMPTY"]:
        bpy.data.objects.remove(empty, do_unlink=True)
    for obj in meshes:
        obj["atlas"] = atlas
        obj["prop"] = name
    return meshes, anchors


def place_props(mats):
    placed, anchors = {}, {}
    for name, (loc, _, _) in PROPS.items():
        root = Matrix.Translation(loc) @ Matrix.Rotation(prop_rotation(name), 4, "Z")
        meshes, found = place_one(name, root, "props", "props", mats)
        for obj in meshes:
            if not obj.name.startswith(("nas_led_", "props_")):
                obj.name = f"props_{obj.name.split('.')[0]}"
        placed[name] = meshes
        anchors[name] = {"root": root, **found}
    return placed, anchors


def poster_material(poster_id: str, template: bpy.types.Material | None) -> bpy.types.Material:
    """Single-user art material per poster: T2's 'poster_art' with its 'poster_image' node, or a plain one."""
    png = POSTERS_DIR / f"{poster_id}.png"
    image = bpy.data.images.load(str(png), check_existing=True) if png.exists() else None
    if template is not None:
        mat = template.copy()
        mat.name = f"poster_{poster_id}"
        node = mat.node_tree.nodes.get("poster_image")
        if image is not None and node is not None:
            node.image = image
        return mat
    m = Mat(f"poster_{poster_id}")
    if image is not None:
        tex = m.node("ShaderNodeTexImage", (-400, 0))
        tex.image = image
        m.link(tex.outputs["Color"], m.bsdf.inputs["Base Color"])
    else:
        m.set(base=srgb("#D9CDB6"))
    return m.set(rough=0.7).mat


def build_posters(mats):
    """Four framed posters on the left wall, facing +X; T2's frame when it exists, else a walnut placeholder."""
    w, h = POSTER_SIZE
    frame_materials = None
    for poster_id, y in zip(POSTER_IDS, POSTER_Y):
        # The frame's front is -Y; a +90 degree turn about Z points it at the room (+X).
        root = Matrix.Translation((X_LEFT, y, POSTER_Z - 0.319)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
        if (PROPS_DIR / "poster_frame.blend").exists():
            meshes, _ = place_one("poster_frame", root, "posters", "posters", mats)
            for obj in meshes:
                base = obj.name.split(".")[0]
                if base == "poster_frame_glass":
                    bpy.data.objects.remove(obj, do_unlink=True)
                    continue
                if base == "poster_frame_art":
                    obj.name = f"props_poster_{poster_id}"
                    obj.data = obj.data.copy()
                    template = obj.data.materials[0]
                    obj.data.materials[0] = poster_material(poster_id, template)
                else:
                    obj.name = f"props_poster_frame_{poster_id}"
                    if frame_materials is None:
                        frame_materials = list(obj.data.materials)
                    else:
                        for i, mat in enumerate(frame_materials):
                            obj.data.materials[i] = mat
                obj["poster"] = poster_id
            continue
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        x = X_LEFT + 0.02
        # Seen from the room (looking toward -X) +Y is to the right, so this order faces +X, unmirrored.
        corners = [(y - w / 2, POSTER_Z - h / 2), (y + w / 2, POSTER_Z - h / 2),
                   (y + w / 2, POSTER_Z + h / 2), (y - w / 2, POSTER_Z + h / 2)]
        face = bm.faces.new([bm.verts.new((x, cy, cz)) for cy, cz in corners])
        for loop, coord in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = coord
        art = new_object(f"props_poster_{poster_id}", bm, "posters", "posters", [poster_material(poster_id, None)])
        art["poster"] = poster_id
        fbm = bmesh.new()
        fw, d = 0.032, 0.025
        for cz in (POSTER_Z - h / 2 - fw / 2, POSTER_Z + h / 2 + fw / 2):
            add_box(fbm, (d, w + 2 * fw, fw), (X_LEFT + d / 2, y, cz), bevel=0.004)
        for cy in (y - w / 2 - fw / 2, y + w / 2 + fw / 2):
            add_box(fbm, (d, fw, h), (X_LEFT + d / 2, cy, POSTER_Z), bevel=0.004)
        frame = new_object(f"props_poster_frame_{poster_id}", fbm, "posters", "posters", [mats["walnut"]])
        frame["poster"] = poster_id
        smooth_by_angle(frame)


def screen_frame(anchors):
    """The projector screen's picture area in the screen's own frame: (root matrix, centre, width, height)."""
    root = anchors["projector_screen"]["root"]
    surface = bpy.data.objects.get("props_projector_screen_surface")
    if surface is not None:
        to_root = root.inverted() @ surface.matrix_world
        pts = [to_root @ v.co for v in surface.data.vertices]
        lo = Vector([min(p[i] for p in pts) for i in range(3)])
        hi = Vector([max(p[i] for p in pts) for i in range(3)])
        centre = Vector(((lo.x + hi.x) / 2, lo.y - 0.003, (lo.z + hi.z) / 2))
        return root, centre, hi.x - lo.x, hi.z - lo.z
    _, _, size = PROPS["projector_screen"]
    return root, Vector((0, -size[1] / 2 - 0.004, 1.2)), 0.8, 0.8


def build_projection(mats, anchors):
    """The lit picture on the projector screen: a 4:3 cool rectangle just in front of the screen surface."""
    root, centre, sw, sh = screen_frame(anchors)
    w = min(sw * 0.72, sh * 0.72 * 4 / 3)
    h = w * 3 / 4
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    face = bm.faces.new([bm.verts.new(centre + Vector((cx, 0, cz))) for cx, cz in corners])
    for loop, coord in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = coord
    obj = new_object("props_projection", bm, "props", "props", [mats["projection"]])
    obj.matrix_world = root
    return root @ centre, (w, h)


# ---- Proxies, markers, cameras ----

HOTSPOTS = {
    "hit_fujifilm_a": "fujifilm_x100",
    "hit_fujifilm_b": "fujifilm_xt",
    "hit_fujifilm_c": "fujica_st",
    "hit_super8": "super8_camera",
    "hit_projector": "projector_8mm",
    "hit_nas": "nas_4bay",
    "hit_mango": "mango_plant",
}


def world_bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def add_proxy(name, lo, hi, mats, pad=0.02):
    bm = bmesh.new()
    size = (hi - lo) + Vector((2 * pad,) * 3)
    add_box(bm, size, (lo + hi) / 2)
    obj = new_object(name, bm, "proxies", None, [mats["proxy"]])
    obj.hide_render = True
    obj.display_type = "WIRE"
    return obj


def build_proxies(placed, mats):
    bpy.context.view_layer.update()
    for hit, prop in HOTSPOTS.items():
        add_proxy(hit, *world_bounds(placed[prop]), mats)
    for poster_id in POSTER_IDS:
        objs = [o for o in bpy.data.objects if o.name.startswith(("props_poster_", "props_poster_frame_"))
                and o.name.endswith(poster_id)]
        lo, hi = world_bounds(objs)
        add_proxy(f"hit_poster_{poster_id}", lo, hi, mats, pad=0.01)


def add_empty(name, location, rotation=None, coll="markers", **props):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type, empty.empty_display_size = "PLAIN_AXES", 0.08
    empty.location = location
    if rotation is not None:
        empty.rotation_mode = "QUATERNION"
        empty.rotation_quaternion = rotation
    for k, v in props.items():
        empty[k] = v
    collection(coll).objects.link(empty)
    return empty


def build_markers(placed, anchors, screen_centre):
    # Projector: glTF -Z along the beam is Blender local +Y (the exporter converts Z-up to Y-up).
    bpy.context.view_layer.update()
    lens = anchors["projector_8mm"].get("projector_lens")
    if lens is None:
        lo, hi = world_bounds(placed["projector_8mm"])
        lens = Vector(((lo.x + hi.x) / 2, hi.y + 0.005, lo.z + (hi.z - lo.z) * 0.55))
    beam = (screen_centre - lens).normalized()
    add_empty("projector_lens", lens, beam.to_track_quat("Y", "Z"))
    add_empty("projector_screen_center", screen_centre)
    for name, (pos, target) in CAMERAS.items():
        add_empty(name, pos, coll="cameras", fov_deg=CAMERA_FOV_DEG)
        add_empty(f"{name}_target", target, coll="cameras")
    return lens, beam


# ---- Lights, world, render settings ----

def build_lights(lens, beam, picture, screen_centre, mats):
    lights = collection("lights")

    lamp = bpy.data.lights.new("lamp_tungsten", "POINT")
    lamp.color = (1.0, 0.56, 0.24)  # ~2700 K blackbody
    lamp.energy = 150.0
    lamp.shadow_soft_size = 0.02
    obj = bpy.data.objects.new("light_lamp", lamp)
    obj.location = LAMP_BULB
    lights.objects.link(obj)

    proj = bpy.data.lights.new("projector", "SPOT")
    proj.color = srgb("#9DB4C0")[:3]
    proj.energy = 12.0
    half_diag = math.hypot(*picture) / 2
    proj.spot_size = 2 * math.atan(half_diag / (screen_centre - lens).length) * 1.15
    proj.spot_blend = 0.25
    proj.shadow_soft_size = 0.01
    obj = bpy.data.objects.new("light_projector", proj)
    obj.location = lens
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = beam.to_track_quat("-Z", "Y")
    lights.objects.link(obj)

    for name, loc, size, tilt, energy in (
        ("picture_light", PICTURE_LIGHT + Vector((0, 0, -0.03)), (0.04, 1.55), Euler((0, math.radians(-38), 0)), 28.0),
        ("shelf_light", SHELF_LIGHT + Vector((0, 0, -0.014)), (1.05, 0.02), Euler((0, 0, 0)), 9.0),
    ):
        light = bpy.data.lights.new(name, "AREA")
        light.shape, light.size, light.size_y = "RECTANGLE", *size
        light.color = (1.0, 0.62, 0.32)  # ~2900 K
        light.energy = energy
        light.spread = math.radians(120)
        obj = bpy.data.objects.new(f"light_{name}", light)
        obj.location = loc
        obj.rotation_euler = tilt
        lights.objects.link(obj)

    # Dusk through the window: the sky card is emissive; this soft area light adds the same colour.
    win = bpy.data.lights.new("window_dusk", "AREA")
    win.shape, win.size, win.size_y = "RECTANGLE", WIN_X1 - WIN_X0, WIN_Z1 - WIN_Z0
    win.color = (0.78, 0.62, 0.72)
    win.energy = 35.0
    win.spread = math.radians(110)
    obj = bpy.data.objects.new("light_window", win)
    obj.location = ((WIN_X0 + WIN_X1) / 2, Y_BACK + WALL_T + 0.01, (WIN_Z0 + WIN_Z1) / 2)
    obj.rotation_euler = Euler((math.radians(-90), 0, 0))
    lights.objects.link(obj)


def setup_world_and_render():
    scene = bpy.context.scene
    world = bpy.data.worlds.new("ink")
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = srgb("#14110F")
    bg.inputs["Strength"].default_value = 0.6
    scene.world = world

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 5
    scene.cycles.glossy_bounces = 3
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.blur_glossy = 1.0
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 16
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 1.3

    cam = bpy.data.objects.new("render_cam", bpy.data.cameras.new("render_cam"))
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle = math.radians(CAMERA_FOV_DEG)
    cam.data.clip_start = 0.02
    collection("cameras").objects.link(cam)
    scene.camera = cam
    aim_camera("cam_idle")


def aim_camera(name: str):
    cam = bpy.context.scene.camera
    pos = bpy.data.objects[name].location
    target = bpy.data.objects[f"{name}_target"].location
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()


# Share of its atlas per object relative to its surface area (1 = by area): the poster type, the city view and
# the CRT get more texels, the large dark walls fewer.
TEXEL_WEIGHTS = {
    "env_wall_back": 0.6, "env_wall_left": 0.6, "env_floor": 0.7, "env_rug": 0.8, "env_curtains": 0.8,
    "env_sky": 2.5, "env_window_frame": 1.3,
    "desk_chair_base": 0.5, "desk_chair_seat": 0.7, "desk_crt": 1.6, "crt_glow": 2.0, "desk_keyboard": 1.6,
    "desk_computer": 1.3, "desk_lamp_shade": 1.3,
    "props_projector_screen": 0.6, "props_projector_screen_surface": 0.35, "props_projection": 0.15,
    "props_mango_plant_leaves": 1.4,
}
SUPPORT_Z = (0.0, 0.732, 0.55, 0.92, 1.6475, 2.0075)


def tune_atlas_objects():
    """Set texel weights, and drop faces no framing can see: downward faces below 0.8 m (every camera is above
    1.1 m) and bottoms resting on the floor, desk, side table, sill or shelves."""
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "atlas" not in obj:
            continue
        name = obj.name
        weight = TEXEL_WEIGHTS.get(name)
        if weight is None and name.startswith("props_poster_frame_"):
            weight = 0.6
        elif weight is None and name.startswith("props_poster_"):
            weight = 3.0
        elif weight is None and obj.get("prop") in ("fujifilm_x100", "fujifilm_xt", "fujica_st", "super8_camera"):
            weight = 1.6
        if weight is not None:
            obj["texel"] = weight
        if name in ("lamp_bulb", "crt_glow", "env_sky") or name.startswith("nas_led_"):
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        world = obj.matrix_world
        normal_matrix = world.to_3x3().inverted().transposed()
        doomed = []
        for face in bm.faces:
            n = (normal_matrix @ face.normal).normalized()
            if n.z > -0.95:
                continue
            z = (world @ face.calc_center_median()).z
            if z < 0.8 or any(abs(z - s) < 0.004 for s in SUPPORT_Z):
                doomed.append(face)
        if doomed and len(doomed) < len(bm.faces):
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bm.to_mesh(obj.data)
        bm.free()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = build_materials()
    place_henry(mats)
    build_shell(mats)
    build_ghosts(mats)
    build_window(mats)
    build_radiator(mats)
    build_shelf(mats)
    build_fixtures(mats)
    build_side_table(mats)
    build_rug(mats)
    build_lamp(mats)
    build_crt_glass(mats)
    placed, anchors = place_props(mats)
    build_posters(mats)
    screen_centre, picture = build_projection(mats, anchors)
    build_proxies(placed, mats)
    lens, beam = build_markers(placed, anchors, screen_centre)
    build_lights(lens, beam, picture, screen_centre, mats)
    tune_atlas_objects()
    setup_world_and_render()
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    for img in bpy.data.images:
        if img.filepath and not img.packed_file:
            img.filepath = bpy.path.relpath(img.filepath, start=str(BLEND.parent))
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True, relative_remap=True)
    print(f"saved {BLEND}")


if __name__ == "__main__":
    main()
