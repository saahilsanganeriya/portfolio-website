"""Shared helpers for the prop build scripts (Blender 5.2, run headless with `blender -b -P`).

Every prop script builds one prop from scratch and saves `blender/props/<name>.blend` with one root
collection named after the prop. Units are metres, +Z up, the prop faces -Y, origin at the base.
"""
import json
import math
import os
import urllib.request
import zipfile

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

BLENDER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BLENDER_DIR, ".cache")
PROPS_DIR = os.path.join(BLENDER_DIR, "props")
RENDERS_DIR = os.path.join(BLENDER_DIR, "renders", "props")
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) portfolio-website-prop-build"


# ---- scene ----

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "CYCLES"
    return scene


def root_collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def empty(name, collection, location, rotation_deg=(0, 0, 0), size=0.05, parent=None, display="ARROWS"):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = display
    ob.empty_display_size = size
    ob.location = location
    ob.rotation_euler = Euler([math.radians(a) for a in rotation_deg], "XYZ")
    collection.objects.link(ob)
    if parent is not None:
        parent_keep_transform(ob, parent)
    return ob


def parent_keep_transform(child, parent):
    bpy.context.view_layer.update()
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = world


def save_prop(name):
    os.makedirs(PROPS_DIR, exist_ok=True)
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    path = os.path.join(PROPS_DIR, f"{name}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print(f"saved {path}")
    return path


def mesh_objects(collection):
    return [o for o in collection.all_objects if o.type == "MESH"]


def triangle_count(objects):
    total = 0
    for ob in objects:
        ob.data.calc_loop_triangles()
        total += len(ob.data.loop_triangles)
    return total


def report(name, collection, budget):
    bpy.context.view_layer.update()
    objs = mesh_objects(collection)
    tris = triangle_count(objs)
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        for corner in ob.bound_box:
            w = ob.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    size_mm = [round((hi[i] - lo[i]) * 1000, 1) for i in range(3)]
    line = {
        "prop": name, "triangles": tris, "budget": budget, "within_budget": tris <= budget,
        "objects": sorted(o.name for o in collection.all_objects), "size_mm_xyz": size_mm,
        "min_z_mm": round(lo.z * 1000, 2),
    }
    print("PROP_REPORT " + json.dumps(line))
    for ob in objs:
        ob["triangles"] = triangle_count([ob])
    return line


# ---- CC0 downloads (cached in blender/.cache, which git ignores) ----

def _download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=180) as resp, open(dest + ".part", "wb") as fh:
        fh.write(resp.read())
    os.replace(dest + ".part", dest)


def ambientcg(asset_id, res="1K-JPG"):
    """Return {map: path} for an ambientCG material (e.g. Color, Roughness, Displacement)."""
    folder = os.path.join(CACHE_DIR, "ambientcg", asset_id)
    prefix = f"{asset_id}_{res}_"
    if not os.path.isdir(folder) or not any(f.startswith(prefix) for f in os.listdir(folder)):
        zpath = os.path.join(folder, "asset.zip")
        _download(f"https://ambientcg.com/get?file={asset_id}_{res}.zip", zpath)
        with zipfile.ZipFile(zpath) as zf:
            for member in zf.namelist():
                if member.startswith(prefix) and member.lower().endswith((".jpg", ".png")):
                    zf.extract(member, folder)
        os.remove(zpath)
    maps = {}
    for fname in os.listdir(folder):
        if fname.startswith(prefix):
            maps[fname[len(prefix):].rsplit(".", 1)[0]] = os.path.join(folder, fname)
    return maps


def polyhaven_gltf(asset_id, res="2k"):
    folder = os.path.join(CACHE_DIR, "polyhaven", asset_id)
    gltf = os.path.join(folder, f"{asset_id}_{res}.gltf")
    if not os.path.exists(gltf):
        req = urllib.request.Request(f"https://api.polyhaven.com/files/{asset_id}", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as resp:
            entry = json.load(resp)["gltf"][res]["gltf"]
        for rel, inc in entry.get("include", {}).items():
            _download(inc["url"], os.path.join(folder, rel))
        _download(entry["url"], gltf)
    return gltf


def polyhaven_hdri(asset_id, res="1k"):
    path = os.path.join(CACHE_DIR, "polyhaven", "hdri", f"{asset_id}_{res}.hdr")
    if not os.path.exists(path):
        _download(f"https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/{res}/{asset_id}_{res}.hdr", path)
    return path


def import_gltf(path, collection):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for ob in new:
        for col in list(ob.users_collection):
            col.objects.unlink(ob)
        collection.objects.link(ob)
    return new


# ---- mesh building ----

def xform(loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    m = Matrix.Translation(Vector(loc)) @ Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()
    if scale is not None:
        m = m @ Matrix.Diagonal(Vector((*scale, 1.0)))
    return m


def round_polygon(points, radius, segments=4):
    """Fillet every corner of a closed 2D polygon; radius may be a float or a per-corner list."""
    n = len(points)
    radii = radius if isinstance(radius, (list, tuple)) else [radius] * n
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(points[i - 1]), Vector(points[i]), Vector(points[(i + 1) % n])
        r = radii[i]
        if r <= 0:
            out.append(tuple(p1))
            continue
        d0, d1 = (p0 - p1).normalized(), (p2 - p1).normalized()
        half = d0.angle(d1) / 2
        dist = min(r / math.tan(half), (p0 - p1).length * 0.49, (p2 - p1).length * 0.49)
        a, b = p1 + d0 * dist, p1 + d1 * dist
        for k in range(segments + 1):
            t = k / segments
            q = (1 - t) ** 2 * a + 2 * (1 - t) * t * p1 + t ** 2 * b
            out.append((q.x, q.y))
    return out


class Builder:
    """Accumulates parts into one bmesh with material slots; `finish` turns it into a finished object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.materials = []

    def slot(self, mat):
        if mat is None:
            return 0
        if mat not in self.materials:
            self.materials.append(mat)
        return self.materials.index(mat)

    def _wrap(self, before, matrix, mat):
        new_faces = [f for f in self.bm.faces if f not in before]
        verts = list({v for f in new_faces for v in f.verts})
        if matrix is not None:
            bmesh.ops.transform(self.bm, matrix=matrix, verts=verts)
        mi = self.slot(mat)
        for f in new_faces:
            f.material_index = mi
        return new_faces

    def _bevel_sharp(self, faces, width, segments, min_angle_deg=30):
        if width <= 0:
            return faces
        edges = {e for f in faces for e in f.edges}
        sharp = [e for e in edges if e.is_manifold and e.calc_face_angle(0) > math.radians(min_angle_deg)]
        before = set(self.bm.faces)
        bmesh.ops.bevel(self.bm, geom=sharp, offset=width, offset_type="OFFSET", segments=segments,
                        profile=0.5, affect="EDGES", clamp_overlap=True)
        return [f for f in self.bm.faces if f not in before] + [f for f in faces if f.is_valid]

    def box(self, size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.0, bevel_seg=2,
            corner=0.0, corner_seg=4, corner_axis="Z"):
        """Box centred on loc; `corner` fillets the edges parallel to corner_axis, `bevel` softens the rest."""
        before = set(self.bm.faces)
        geom = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = geom["verts"]
        bmesh.ops.scale(self.bm, vec=Vector(size), verts=verts)
        faces = [f for f in self.bm.faces if f not in before]
        if corner > 0:
            axis = {"X": 0, "Y": 1, "Z": 2}[corner_axis]
            edges = {e for v in verts for e in v.link_edges}
            along = [e for e in edges if abs((e.verts[0].co - e.verts[1].co).normalized()[axis]) > 0.99]
            bmesh.ops.bevel(self.bm, geom=along, offset=corner, offset_type="OFFSET", segments=corner_seg,
                            profile=0.5, affect="EDGES", clamp_overlap=True)
            faces = [f for f in self.bm.faces if f not in before]
        self._bevel_sharp(faces, bevel, bevel_seg)
        return self._wrap(before, xform(loc, rot), mat)

    def frustum(self, bottom, top, height, loc=(0, 0, 0), rot=(0, 0, 0), top_offset=(0, 0), mat=None, bevel=0.0,
                bevel_seg=2):
        """Tapered block: bottom (w, d) rectangle at z=0, top (w, d) rectangle at z=height shifted by top_offset."""
        before = set(self.bm.faces)
        (bw, bd), (tw, td) = bottom, top
        ox, oy = top_offset
        lo = [self.bm.verts.new((sx * bw / 2, sy * bd / 2, 0.0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        hi = [self.bm.verts.new((ox + sx * tw / 2, oy + sy * td / 2, height)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        self.bm.faces.new(list(reversed(lo)))
        self.bm.faces.new(hi)
        for i in range(4):
            j = (i + 1) % 4
            self.bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        faces = [f for f in self.bm.faces if f not in before]
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self._bevel_sharp(faces, bevel, bevel_seg)
        return self._wrap(before, xform(loc, rot), mat)

    def extrude(self, pts2d, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.0, bevel_seg=2, center=True):
        """Extrude a closed CCW polygon drawn in the XZ plane along +Y (centred on y=0 when center)."""
        before = set(self.bm.faces)
        y0 = -depth / 2 if center else 0.0
        verts = [self.bm.verts.new((u, y0, v)) for (u, v) in pts2d]
        face = self.bm.faces.new(verts)
        face.normal_update()
        if face.normal.y > 0:
            face.normal_flip()
        res = bmesh.ops.extrude_face_region(self.bm, geom=[face])
        moved = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.translate(self.bm, vec=(0, depth, 0), verts=moved)
        faces = [f for f in self.bm.faces if f not in before]
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self._bevel_sharp(faces, bevel, bevel_seg)
        return self._wrap(before, xform(loc, rot), mat)

    def lathe(self, profile, segments=32, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, cap_start=True, cap_end=True,
              radial=None, phase=0.0, arc=None):
        """Revolve (radius, z) points around +Z. Walk the outside upward so normals face out.

        `radial(i_seg, j_profile, r)` may return a new radius (knurls, flutes). `arc` limits the sweep (radians).
        """
        bm = self.bm
        before = set(bm.faces)
        full = arc is None
        steps = segments if full else segments + 1
        sweep = 2 * math.pi if full else arc
        rings = []
        for j, (r, z) in enumerate(profile):
            if r <= 1e-9:
                rings.append([bm.verts.new((0.0, 0.0, z))])
                continue
            ring = []
            for i in range(steps):
                a = phase + sweep * i / segments
                rr = radial(i, j, r) if radial else r
                ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
            rings.append(ring)
        span = segments if full else segments
        for j in range(len(rings) - 1):
            ra, rb = rings[j], rings[j + 1]
            for i in range(span):
                i1 = (i + 1) % steps
                if len(ra) == 1 and len(rb) == 1:
                    break
                if len(ra) == 1:
                    bm.faces.new((ra[0], rb[i1], rb[i]))
                elif len(rb) == 1:
                    bm.faces.new((ra[i], ra[i1], rb[0]))
                else:
                    bm.faces.new((ra[i], ra[i1], rb[i1], rb[i]))
        center = Vector((0, 0, sum(z for _, z in profile) / len(profile)))
        for flag, ring in ((cap_start, rings[0]), (cap_end, rings[-1])):
            if flag and full and len(ring) > 2:
                f = bm.faces.new(ring)
                f.normal_update()
                if f.normal.dot(f.calc_center_median() - center) < 0:
                    f.normal_flip()
        for ring in rings:
            if len(ring) > 1:
                for e in ring[0].link_edges:
                    other = e.other_vert(ring[0])
                    if any(other is rr[0] for rr in rings if len(rr) > 1):
                        e.seam = True
        return self._wrap(before, xform(loc, rot), mat)

    def cylinder(self, radius, depth, segments=24, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.0):
        prof = [(radius, 0.0), (radius, depth)]
        if bevel > 0:
            b = min(bevel, radius * 0.4, depth * 0.4)
            prof = [(radius - b, 0.0), (radius - b * 0.3, b * 0.3), (radius, b), (radius, depth - b),
                    (radius - b * 0.3, depth - b * 0.3), (radius - b, depth)]
        return self.lathe(prof, segments, loc, rot, mat)

    def tube(self, points, radius, sides=8, mat=None, cap=True, radius_fn=None):
        """Sweep a circle along a polyline with parallel-transport frames."""
        bm = self.bm
        before = set(bm.faces)
        pts = [Vector(p) for p in points]
        tangents = []
        for k in range(len(pts)):
            a = pts[max(k - 1, 0)]
            b = pts[min(k + 1, len(pts) - 1)]
            tangents.append((b - a).normalized())
        ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
        normal = tangents[0].cross(ref).normalized()
        rings = []
        for k, p in enumerate(pts):
            if k > 0:
                axis = tangents[k - 1].cross(tangents[k])
                if axis.length > 1e-8:
                    ang = tangents[k - 1].angle(tangents[k])
                    normal = Matrix.Rotation(ang, 3, axis.normalized()) @ normal
            binormal = tangents[k].cross(normal)
            r = radius_fn(k / max(len(pts) - 1, 1)) if radius_fn else radius
            rings.append([bm.verts.new(p + r * (math.cos(2 * math.pi * s / sides) * normal +
                                                  math.sin(2 * math.pi * s / sides) * binormal))
                          for s in range(sides)])
        for k in range(len(rings) - 1):
            for s in range(sides):
                s1 = (s + 1) % sides
                bm.faces.new((rings[k][s], rings[k][s1], rings[k + 1][s1], rings[k + 1][s]))
        if cap:
            for ring, sign in ((rings[0], -1), (rings[-1], 1)):
                f = bm.faces.new(ring)
                f.normal_update()
                tang = tangents[0] if sign < 0 else tangents[-1]
                if f.normal.dot(tang) * sign < 0:
                    f.normal_flip()
        for k in range(len(rings) - 1):
            for e in rings[k][0].link_edges:
                if e.other_vert(rings[k][0]) is rings[k + 1][0]:
                    e.seam = True
        return self._wrap(before, None, mat)

    def torus(self, major, minor, segments=16, sides=6, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, arc=None):
        n = segments
        sweep = 2 * math.pi if arc is None else arc
        closed = arc is None
        pts = [(major * math.cos(sweep * i / n), major * math.sin(sweep * i / n), 0.0)
               for i in range(n if closed else n + 1)]
        if closed:
            pts.append(pts[0])
        before = set(self.bm.faces)
        self.tube(pts, minor, sides=sides, mat=None, cap=not closed)
        if closed:
            bmesh.ops.remove_doubles(self.bm, verts=list({v for f in self.bm.faces if f not in before for v in f.verts}),
                                     dist=1e-7)
        return self._wrap(before, xform(loc, rot), mat)

    def text(self, body, size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, align="CENTER", resolution=3,
             spacing=1.0, extrude=0.0, font_weight=None, matrix=None, font=None):
        """Flat (or slightly extruded) lettering in the XY plane, facing +Z before `rot`."""
        cu = bpy.data.curves.new("tmp_text", "FONT")
        if font is not None:
            cu.font = font
        cu.body = body
        cu.size = size
        cu.align_x = align
        cu.align_y = "CENTER"
        cu.resolution_u = resolution
        cu.space_character = spacing
        cu.extrude = extrude
        if font_weight == "BOLD":
            cu.body_format.foreach_set("use_bold", [True] * len(cu.body_format))
        ob = bpy.data.objects.new("tmp_text", cu)
        bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        before = set(self.bm.faces)
        self.append_mesh(me)
        bpy.data.meshes.remove(me)
        faces = [f for f in self.bm.faces if f not in before]
        bmesh.ops.triangulate(self.bm, faces=[f for f in faces if len(f.verts) > 4], quad_method="BEAUTY",
                              ngon_method="BEAUTY")
        return self._wrap(before, matrix if matrix is not None else xform(loc, rot), mat)

    def append_mesh(self, me, matrix=None, mat=None):
        before = set(self.bm.faces)
        verts = [self.bm.verts.new(v.co) for v in me.vertices]
        for p in me.polygons:
            try:
                self.bm.faces.new([verts[i] for i in p.vertices])
            except ValueError:
                pass
        return self._wrap(before, matrix, mat)

    def finish(self, collection, smooth_angle=32.0, seam_angle=48.0, weighted=True, unwrap=True,
               margin=0.004, keep_uv=False):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-7)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.materials:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        collection.objects.link(ob)
        finish_object(ob, smooth_angle=smooth_angle, seam_angle=seam_angle, weighted=weighted,
                      unwrap=unwrap and not keep_uv, margin=margin)
        return ob


def _activate(ob):
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def apply_modifier(ob, mod):
    _activate(ob)
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def finish_object(ob, smooth_angle=32.0, seam_angle=48.0, weighted=True, unwrap=True, margin=0.004):
    """Shade smooth with sharp edges by angle, weighted normals, then seams on hard edges and an angle-based unwrap."""
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    if weighted:
        mod = ob.modifiers.new("weighted_normal", "WEIGHTED_NORMAL")
        mod.keep_sharp = True
        mod.mode = "FACE_AREA"
        mod.weight = 50
        apply_modifier(ob, mod)
    if unwrap:
        unwrap_object(ob, seam_angle=seam_angle, margin=margin)


def unwrap_object(ob, seam_angle=48.0, margin=0.004, method="ANGLE_BASED"):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        if not e.is_manifold:
            continue
        if e.calc_face_angle(0) > math.radians(seam_angle):
            e.seam = True
    bm.to_mesh(me)
    bm.free()
    me.uv_layers.active = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    _activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method=method, margin=margin)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def pack_uv(ob, margin=0.004):
    """Average island scale and pack an object's existing UVMap islands into 0-1 without rotating them."""
    ob.data.uv_layers.active = ob.data.uv_layers["UVMap"]
    _activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=margin, rotate=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def planar_uv(faces, uv_layer):
    """Project each face onto its dominant axis plane (metres); every face becomes its own island."""
    for f in faces:
        n = f.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][axis]
        for loop in f.loops:
            loop[uv_layer].uv = (loop.vert.co[a], loop.vert.co[b])


def uv_density(ob):
    """Metres of surface per UV unit (for reporting texel density)."""
    me = ob.data
    uv = me.uv_layers.active.data
    area3d = sum(p.area for p in me.polygons)
    area_uv = 0.0
    for p in me.polygons:
        loops = list(p.loop_indices)
        a = uv[loops[0]].uv
        for k in range(1, len(loops) - 1):
            b, c = uv[loops[k]].uv, uv[loops[k + 1]].uv
            area_uv += abs((b - a).cross(c - a)) / 2
    return math.sqrt(area3d / area_uv) if area_uv > 0 else 0.0


def set_origin_base(ob):
    """Move the mesh so the object origin sits at the bottom centre of its bounds."""
    me = ob.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    offset = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    me.transform(Matrix.Translation(-offset))
    ob.location += offset


def join(objects, name):
    _activate(objects[0])
    for o in objects:
        o.select_set(True)
    with bpy.context.temp_override(active_object=objects[0], selected_editable_objects=objects,
                                   selected_objects=objects, object=objects[0]):
        bpy.ops.object.join()
    objects[0].name = name
    objects[0].data.name = name
    return objects[0]


def apply_transforms(ob):
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)


# ---- seating: lofts, a five-star swivel base, CC0 textures ----

def polyhaven_texture(name, kind, res="2k"):
    """Path of one map of a Poly Haven texture (kind as its API lists it: Diffuse, Rough, nor_gl, Displacement,
    coll1 ...), downloaded once into the cache."""
    marker = os.path.join(CACHE_DIR, "polyhaven", f"{name}_{kind}_{res}.path")
    if os.path.exists(marker):
        return open(marker).read().strip()
    req = urllib.request.Request(f"https://api.polyhaven.com/files/{name}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        url = json.load(resp)[kind][res]["jpg"]["url"]
    path = os.path.join(CACHE_DIR, "polyhaven", url.rsplit("/", 1)[1])
    if not os.path.exists(path):
        _download(url, path)
    with open(marker, "w") as fh:
        fh.write(path)
    return path


def loft_rings(b, rings, mat, seams=(0,), caps=True, closed=True):
    """Quads between consecutive rings of equal length (closed loops unless closed=False), ngon caps at both ends;
    marks seams along the ring indices in `seams`. Returns (faces, verts)."""
    bm = b.bm
    n = len(rings[0])
    verts = [[bm.verts.new(p) for p in ring] for ring in rings]
    mi = b.slot(mat)
    faces = []
    for k in range(len(verts) - 1):
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            f = bm.faces.new((verts[k][i], verts[k][j], verts[k + 1][j], verts[k + 1][i]))
            f.material_index = mi
            faces.append(f)
    if caps and closed:
        for ring in (verts[0], verts[-1]):
            f = bm.faces.new(ring)
            f.material_index = mi
            faces.append(f)
    for i in seams:
        for k in range(len(verts) - 1):
            e = bm.edges.get((verts[k][i], verts[k + 1][i]))
            if e:
                e.seam = True
    return faces, verts


def orient_outward(bm, faces, centre):
    """Flip a closed part's faces when most of its area faces toward `centre`."""
    bm.normal_update()
    out = sum(f.normal.dot(f.calc_center_median() - centre) * f.calc_area() for f in faces)
    if out < 0:
        for f in faces:
            f.normal_flip()
    bm.normal_update()


def twin_caster(b, tip, heading_deg, hood, wheel, stem):
    """A twin-wheel caster under a socket at `tip` (floor at z 0), its wheels trailing the stem along heading."""
    b.cylinder(0.009, 0.020, segments=12, loc=(tip.x, tip.y, 0.046), mat=stem)
    back = Vector((math.cos(math.radians(heading_deg + 90)), math.sin(math.radians(heading_deg + 90)), 0)) * 0.018
    hub = tip + back
    b.box((0.014, 0.040, 0.034), loc=(hub.x, hub.y, 0.034), rot=(0, 0, heading_deg), mat=hood, bevel=0.002,
          corner=0.010, corner_axis="X")
    axle = Vector((math.cos(math.radians(heading_deg)), math.sin(math.radians(heading_deg)), 0))
    for side in (-1, 1):
        w = hub + axle * (side * 0.0135 - 0.0055)
        b.cylinder(0.025, 0.011, segments=18, loc=(w.x, w.y, 0.025), rot=(0, 90, heading_deg), mat=wheel, bevel=0.003)


def five_star_base(b, arm_mat, black, chrome, reach=0.29, legs=5):
    """A gas-lift swivel base: chrome rod in a black shroud, a cast hub and `legs` tapering cast arms, each on a twin
    caster turned a little differently (as a chair left standing has them)."""
    b.cylinder(0.0145, 0.12, segments=20, loc=(0, 0, 0.21), mat=chrome, bevel=0.001)
    b.cylinder(0.026, 0.13, segments=24, loc=(0, 0, 0.085), mat=black, bevel=0.003)
    b.cylinder(0.050, 0.056, segments=32, loc=(0, 0, 0.058), mat=arm_mat, bevel=0.007)
    s = reach / 0.29
    secs = [(0.030, 0.029, 0.026, 0.087), (0.100 * s, 0.027, 0.023, 0.083), (0.200 * s, 0.023, 0.019, 0.077),
            (0.268 * s, 0.021, 0.016, 0.073), (reach, 0.021, 0.016, 0.072)]  # (r, half width, half height, centre z)
    for k in range(legs):
        ang = math.radians(90 + 360 / legs * k)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        side = Vector((-d.y, d.x, 0))
        rings = []
        for r, hw, hh, cz in secs:
            rings.append([d * r + side * sx + Vector((0, 0, cz + sz))
                          for sx, sz in round_polygon([(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)], min(hw, hh) * 0.75, 3)])
        faces, _ = loft_rings(b, rings, arm_mat)
        orient_outward(b.bm, faces, d * reach * 0.55 + Vector((0, 0, 0.08)))
        twin_caster(b, d * reach, math.degrees(ang) + 90 + (25 - 17 * k), black, black, chrome)


# ---- materials ----

def _sock(sockets, key):
    for s in sockets:
        if s.identifier == key:
            return s
    return sockets[key]


class NodeKit:
    def __init__(self, tree):
        self.nt = tree
        self.x = 0

    def node(self, kind, inputs=None, **attrs):
        n = self.nt.nodes.new(kind)
        for k, v in attrs.items():
            setattr(n, k, v)
        for k, v in (inputs or {}).items():
            self.set(n, k, v)
        return n

    def set(self, n, key, value):
        s = _sock(n.inputs, key)
        if isinstance(value, bpy.types.NodeSocket):
            self.nt.links.new(value, s)
        else:
            s.default_value = value

    def out(self, n, key=0):
        return n.outputs[key] if isinstance(key, int) else _sock(n.outputs, key)

    def math(self, op, a, b=0.0, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(n, "Value", a)
        self.set(n, "Value_001", b)
        return n.outputs[0]

    def map_range(self, value, from_min, from_max, to_min=0.0, to_max=1.0, smooth=True):
        n = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP" if smooth else "LINEAR", clamp=True)
        for k, v in (("Value", value), ("From Min", from_min), ("From Max", from_max), ("To Min", to_min),
                     ("To Max", to_max)):
            self.set(n, k, v)
        return n.outputs["Result"]

    def mix_color(self, fac, a, b, blend="MIX"):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend, clamp_result=True)
        self.set(n, "Factor_Float", fac)
        self.set(n, "A_Color", a)
        self.set(n, "B_Color", b)
        return _sock(n.outputs, "Result_Color")

    def mix_float(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type="FLOAT")
        self.set(n, "Factor_Float", fac)
        self.set(n, "A_Float", a)
        self.set(n, "B_Float", b)
        return _sock(n.outputs, "Result_Float")

    def coords(self, kind="Object", scale=1.0):
        tc = self.node("ShaderNodeTexCoord")
        if scale == 1.0:
            return tc.outputs[kind]
        mp = self.node("ShaderNodeMapping")
        self.set(mp, "Vector", tc.outputs[kind])
        self.set(mp, "Scale", (scale, scale, scale) if isinstance(scale, (int, float)) else scale)
        return mp.outputs[0]

    def noise(self, vector, scale, detail=4.0, roughness=0.55, distortion=0.0):
        n = self.node("ShaderNodeTexNoise", inputs={"Vector": vector, "Scale": scale, "Detail": detail,
                                                   "Roughness": roughness, "Distortion": distortion})
        return n.outputs["Fac"]

    def image(self, path, vector, non_color=False, box=True, blend=0.25):
        img = load_image(path, non_color)
        n = self.node("ShaderNodeTexImage", image=img, interpolation="Linear")
        if box:
            n.projection = "BOX"
            n.projection_blend = blend
        self.set(n, "Vector", vector)
        return n


def load_image(path, non_color=False):
    for img in bpy.data.images:
        if img.filepath and os.path.abspath(bpy.path.abspath(img.filepath)) == os.path.abspath(path):
            return img
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def _wear_group():
    """Masks shared by every material: convex edges, cavities, up-facing (dust) and two noise scales."""
    name = "pl_wear_masks"
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    iface = ng.interface
    iface.new_socket("Edge Width", in_out="INPUT", socket_type="NodeSocketFloat").default_value = 0.0015
    for out in ("Edge", "Cavity", "Top", "Broad", "Fine"):
        iface.new_socket(out, in_out="OUTPUT", socket_type="NodeSocketFloat")
    k = NodeKit(ng)
    gi = k.node("NodeGroupInput")
    go = k.node("NodeGroupOutput")
    obj = k.coords("Object")
    broad = k.noise(obj, 9.0, detail=3.0)
    fine = k.noise(obj, 160.0, detail=5.0, roughness=0.6)
    ao_in = k.node("ShaderNodeAmbientOcclusion", inside=True, only_local=True, samples=8)
    k.set(ao_in, "Distance", gi.outputs["Edge Width"])
    convex = k.math("SUBTRACT", 1.0, ao_in.outputs["AO"])
    edge = k.map_range(convex, 0.02, 0.22)
    breakup = k.map_range(fine, 0.30, 0.58)
    edge = k.math("MULTIPLY", edge, breakup, clamp=True)
    ao_out = k.node("ShaderNodeAmbientOcclusion", inside=False, only_local=True, samples=8)
    k.set(ao_out, "Distance", k.math("MULTIPLY", gi.outputs["Edge Width"], 4.0))
    cavity = k.map_range(k.math("SUBTRACT", 1.0, ao_out.outputs["AO"]), 0.15, 0.85)
    geo = k.node("ShaderNodeNewGeometry")
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": geo.outputs["Normal"]})
    top = k.map_range(sep.outputs["Z"], 0.55, 0.97)
    k.set(go, "Edge", edge)
    k.set(go, "Cavity", cavity)
    k.set(go, "Top", top)
    k.set(go, "Broad", broad)
    k.set(go, "Fine", fine)
    return ng


def new_material(name):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    mat.node_tree.nodes.clear()
    return mat, NodeKit(mat.node_tree)


def surface(name, base, roughness, metallic=0.0, *, color_tex=None, tint=None, rough_tex=None, rough_amount=0.25,
            height_tex=None, height_strength=0.3, tile=0.1, micro_bump=None, edge_wear=0.0, edge_color=None,
            edge_roughness=None, edge_metallic=None, edge_width=0.0015, dust=0.0, dust_color=(0.36, 0.33, 0.29),
            grime=0.0, smudges=0.0, scratches=0.0, color_var=0.06, coat=0.0, coat_roughness=0.08, thin_film=0.0,
            transmission=0.0, ior=1.5, sheen=0.0, specular=0.5, emission=None, translucency=0.0,
            subsurface=0.0, alpha=1.0, uv_map=None):
    """Principled material with layered wear: convex edge wear, cavity grime, dust on up-facing faces,
    fingerprints and fine scratches on the roughness. Tiling textures are box-projected in object space
    (metres), so the look does not depend on UV island scale; everything is Cycles-bakeable."""
    mat, k = new_material(name)
    bsdf = k.node("ShaderNodeBsdfPrincipled")
    out = k.node("ShaderNodeOutputMaterial")
    wear = k.node("ShaderNodeGroup", node_tree=_wear_group())
    k.set(wear, "Edge Width", edge_width)
    if uv_map:
        vec = k.node("ShaderNodeUVMap", uv_map=uv_map).outputs["UV"]
    else:
        vec = k.coords("Object", 1.0 / tile)
    box = uv_map is None

    color = base + (1.0,) if len(base) == 3 else base
    if color_tex:
        img = k.image(color_tex, vec, box=box)
        col = img.outputs["Color"]
        if tint is not None:
            col = k.mix_color(1.0, col, tint + (1.0,), blend="MULTIPLY")
        color = col
    if color_var > 0:
        hsv = k.node("ShaderNodeHueSaturation")
        k.set(hsv, "Color", color)
        k.set(hsv, "Value", k.math("ADD", 1.0 - color_var, k.math("MULTIPLY", wear.outputs["Broad"], 2 * color_var)))
        color = hsv.outputs["Color"]
    if grime > 0:
        dirty = k.mix_color(0.55, color, (0.05, 0.04, 0.03, 1.0), blend="MULTIPLY")
        color = k.mix_color(k.math("MULTIPLY", wear.outputs["Cavity"], grime), color, dirty)
    if edge_wear > 0:
        ec = (edge_color or tuple(min(1.0, c * 1.8 + 0.05) for c in base[:3])) + (1.0,)
        color = k.mix_color(k.math("MULTIPLY", wear.outputs["Edge"], edge_wear, clamp=True), color, ec)

    rough = roughness
    if rough_tex:
        rimg = k.image(rough_tex, vec, non_color=True, box=box)
        rough = k.math("ADD", roughness - rough_amount / 2, k.math("MULTIPLY", rimg.outputs["Color"], rough_amount))
    if smudges > 0:
        fvec = k.coords("Object", 1.0 / 0.14)
        prints = k.image(ambientcg("Fingerprints002")["Roughness"], fvec, non_color=True)
        rough = k.math("ADD", rough, k.math("MULTIPLY", prints.outputs["Color"], smudges))
    if scratches > 0:
        svec = k.coords("Object", 1.0 / 0.2)
        scr = k.image(ambientcg("SurfaceImperfections003")["Color"], svec, non_color=True)
        rough = k.math("ADD", rough, k.math("MULTIPLY", scr.outputs["Color"], scratches))
    if edge_wear > 0 and edge_roughness is not None:
        rough = k.mix_float(k.math("MULTIPLY", wear.outputs["Edge"], edge_wear, clamp=True), rough, edge_roughness)
    metal = metallic
    if edge_wear > 0 and edge_metallic is not None:
        metal = k.mix_float(k.math("MULTIPLY", wear.outputs["Edge"], edge_wear, clamp=True), metallic, edge_metallic)

    if dust > 0:
        # a fine haze on up-facing faces, a little heavier in crevices, broken up at two scales
        haze = k.math("MULTIPLY", wear.outputs["Top"], k.map_range(wear.outputs["Fine"], 0.2, 0.8, 0.45, 1.0))
        haze = k.math("MULTIPLY", haze, k.map_range(wear.outputs["Broad"], 0.3, 0.7, 0.7, 1.0))
        haze = k.math("ADD", haze, k.math("MULTIPLY", wear.outputs["Cavity"], 0.35))
        dmask = k.math("MULTIPLY", haze, dust * 0.38, clamp=True)
        color = k.mix_color(dmask, color, dust_color + (1.0,))
        rough = k.mix_float(dmask, rough, 0.92)
        metal = k.mix_float(dmask, metal, 0.0)

    normal = None
    if height_tex:
        himg = k.image(height_tex, vec, non_color=True, box=box)
        bump = k.node("ShaderNodeBump", inputs={"Strength": height_strength, "Distance": tile * 0.02,
                                               "Height": himg.outputs["Color"]})
        normal = bump.outputs["Normal"]
    if micro_bump:
        scale, strength = micro_bump
        mb = k.node("ShaderNodeBump", inputs={"Strength": strength, "Distance": 0.0004,
                                             "Height": k.noise(k.coords("Object"), scale, detail=6.0)})
        if normal is not None:
            k.set(mb, "Normal", normal)
        normal = mb.outputs["Normal"]

    k.set(bsdf, "Base Color", color)
    k.set(bsdf, "Roughness", rough if not isinstance(rough, float) else max(0.0, min(1.0, rough)))
    k.set(bsdf, "Metallic", metal)
    k.set(bsdf, "IOR", ior)
    k.set(bsdf, "Specular IOR Level", specular)
    if normal is not None:
        k.set(bsdf, "Normal", normal)
    if coat > 0:
        k.set(bsdf, "Coat Weight", coat)
        k.set(bsdf, "Coat Roughness", coat_roughness)
    if thin_film > 0:
        k.set(bsdf, "Thin Film Thickness", thin_film)
        k.set(bsdf, "Thin Film IOR", 1.38)
    if transmission > 0:
        k.set(bsdf, "Transmission Weight", transmission)
    if sheen > 0:
        k.set(bsdf, "Sheen Weight", sheen)
        k.set(bsdf, "Sheen Roughness", 0.6)
    if subsurface > 0:
        k.set(bsdf, "Subsurface Weight", subsurface)
        k.set(bsdf, "Subsurface Radius", (0.004, 0.006, 0.002))
    if emission is not None:
        ecol, estr = emission
        k.set(bsdf, "Emission Color", ecol + (1.0,))
        k.set(bsdf, "Emission Strength", estr)
    if alpha < 1.0:
        k.set(bsdf, "Alpha", alpha)
    shader = bsdf.outputs["BSDF"]
    if translucency > 0:
        tr = k.node("ShaderNodeBsdfTranslucent", inputs={"Color": k.mix_color(0.5, color, (0.35, 0.55, 0.12, 1.0))})
        mix = k.node("ShaderNodeMixShader", inputs={"Fac": translucency, "Shader": shader,
                                                   "Shader_001": tr.outputs["BSDF"]})
        shader = mix.outputs["Shader"]
    k.set(out, "Surface", shader)
    mat["pl_recipe"] = "surface"
    return mat


# ---- pastry (the oven's croissant, the kitchen board) ----

def croissant(name, col, base, scale=1.0):
    """A plain, well-made croissant: a crescent of seven laminated rolls swept along an arc, thickest in the middle
    and curling to tapered tips, its cross-section flattened underneath; UVMap carries (along the crescent, around
    it), which the material uses for the rolls' darker crests and paler, flaky grooves."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    n_s, n_t = 56, 20
    span = math.radians(150)
    radius = 0.050
    rows = []
    for i in range(n_s + 1):
        s = i / n_s
        a = -span / 2 + span * s
        centre = Vector((radius * math.sin(a), -radius * math.cos(a) + radius * 0.55, 0.0))
        outward = Vector((math.sin(a), -math.cos(a), 0.0))
        taper = math.sin(math.pi * s) ** 0.7
        rolls = 1.0 + 0.13 * math.cos(2 * math.pi * 7 * s) * taper
        r = (0.0055 + 0.021 * taper) * rolls
        ring = []
        for j in range(n_t):
            t = 2 * math.pi * j / n_t
            ox, oz = math.cos(t), math.sin(t)
            w = r * 1.25 * ox
            h = r * (0.95 * oz if oz > 0 else 0.35 * oz)
            p = centre + outward * w + Vector((0, 0, h + r * 0.36))
            ring.append(bm.verts.new(p))
        rows.append((ring, s))
    for i in range(n_s):
        (ra, sa), (rb, sb) = rows[i], rows[i + 1]
        for j in range(n_t):
            j2 = (j + 1) % n_t
            face = bm.faces.new((ra[j], rb[j], rb[j2], ra[j2]))
            for loop, (s_, t_) in zip(face.loops, ((sa, j / n_t), (sb, j / n_t), (sb, (j + 1) / n_t), (sa, (j + 1) / n_t))):
                loop[uv].uv = (s_, t_)
    for ring, _ in (rows[0], rows[-1]):
        cap = bm.faces.new(list(reversed(ring)) if ring is rows[0][0] else ring)
        for loop in cap.loops:
            loop[uv].uv = (0.0 if ring is rows[0][0] else 1.0, 0.5)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials.get("croissant") or croissant_material())
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    me.shade_smooth()
    obj.location = base
    obj.scale = (scale, scale, scale)
    obj["source"] = "made for this site"
    return obj


def croissant_material():
    """Golden laminated dough: deep brown on the crests of the rolls, paler and flaky in the grooves, an egg-wash
    sheen, a little subsurface."""
    mat, k = new_material("croissant")
    uvn = k.node("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"]
    sep = k.node("ShaderNodeSeparateXYZ", inputs={"Vector": uvn})
    rolls = k.math("COSINE", k.math("MULTIPLY", sep.outputs["X"], 2 * math.pi * 7))
    crest = k.map_range(rolls, -0.2, 1.0)
    flakes = k.noise(k.coords("Object", 1.0), 900.0, detail=4.0)
    top = k.map_range(k.math("SINE", k.math("MULTIPLY", sep.outputs["Y"], 2 * math.pi)), -0.3, 0.6)
    base = k.mix_color(crest, (0.78, 0.52, 0.22, 1.0), (0.42, 0.20, 0.06, 1.0))
    base = k.mix_color(k.math("MULTIPLY", top, 0.5), base, (0.36, 0.16, 0.04, 1.0))
    base = k.mix_color(k.map_range(flakes, 0.45, 0.62, 0.0, 0.35), base, (0.88, 0.70, 0.42, 1.0))
    bump = k.node("ShaderNodeBump", inputs={"Strength": 0.35, "Distance": 0.0008, "Height": k.math("ADD", crest, k.math("MULTIPLY", flakes, 0.4))})
    bsdf = k.node("ShaderNodeBsdfPrincipled", inputs={"Base Color": base, "Roughness": 0.5, "Coat Weight": 0.35,
                                                      "Coat Roughness": 0.25, "Subsurface Weight": 0.08,
                                                      "Normal": bump.outputs[0]})
    k.set(k.node("ShaderNodeOutputMaterial"), "Surface", bsdf.outputs[0])
    return mat
