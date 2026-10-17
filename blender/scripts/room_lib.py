"""Helpers shared by the room scripts: collections, mesh building, node materials, colours, room dimensions."""

import math
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# ---- Set dimensions (metres, Blender Z up; the viewer stands at -Y looking toward +Y) ----
# A corner in a void: the back wall and the left wall meet at a plain corner and carry the wall art; both rise and
# fade into the void toward their tops and toward their free ends, and the floor fades out all round, so no edge of
# the set shows from any side.
X_LEFT, Y_BACK = -3.15, 0.42  # left wall inner face, back wall inner face (they meet at the corner)
BACK_X1 = 3.45  # where the back wall ends on the right, faded out
LEFT_Y0 = -3.90  # where the left wall ends at the front, faded out
WALL_T, WALL_H, FLOOR_T = 0.12, 3.40, 0.06
WIN_X0, WIN_X1, WIN_Z0, WIN_Z1 = 1.10, 2.60, 0.86, 2.30
DADO_Z = 0.88
# The void: one colour (sRGB) for the site's clear colour, the walls' fade and the floor's fade. The fades are baked
# into the atlases (bake.py): a texel blends toward VOID_HEX by void_fade() of its world position.
VOID_HEX = "#14110F"
FADE_Z = (2.45, 3.30)  # the walls fade out between these heights
FADE_BACK_X = (2.98, 3.42)  # the back wall's free end fades out across these x
FADE_LEFT_Y = (-3.42, -3.86)  # the left wall's free end fades out across these y
# The floor: a rounded disc under the set (superellipse about FLOOR_CENTRE with half-axes FLOOR_AXES), solid out to
# FLOOR_SOLID and faded to the void at FLOOR_EDGE (in units of the half-axes).
FLOOR_CENTRE, FLOOR_AXES, FLOOR_POWER = (0.05, -1.40), (3.70, 2.30), 4.0
FLOOR_SOLID, FLOOR_EDGE = 0.92, 1.30


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def floor_metric(x, y):
    """The floor's superellipse distance (scalars or arrays): 1 on the curve through FLOOR_AXES."""
    (cx, cy), (ax, ay) = FLOOR_CENTRE, FLOOR_AXES
    return (np.abs((np.asarray(x) - cx) / ax) ** FLOOR_POWER + np.abs((np.asarray(y) - cy) / ay) ** FLOOR_POWER) \
        ** (1 / FLOOR_POWER)


def void_fade(x, y, z, floor=False):
    """How far a surface point has faded into the void, 0 solid to 1 gone (scalars or arrays): the walls' tops and
    free ends, and on the floor its rounded outer edge."""
    x, y, z = (np.asarray(v, dtype=np.float64) for v in (x, y, z))
    walls = smoothstep(*FADE_Z, z)
    walls = np.maximum(walls, np.where(y > Y_BACK - 0.6, smoothstep(*FADE_BACK_X, x), 0.0))
    walls = np.maximum(walls, np.where(x < X_LEFT + 0.6, smoothstep(-FADE_LEFT_Y[0], -FADE_LEFT_Y[1], -y), 0.0))
    return np.where(floor, smoothstep(FLOOR_SOLID, FLOOR_EDGE, floor_metric(x, y)), walls)


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
