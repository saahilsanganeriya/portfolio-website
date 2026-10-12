"""Import Henry Heffernan's three room models as the starting layout, in metres, materials stripped.

Run alone to inspect the layout:  blender -b --factory-startup -P blender/scripts/import_henry.py
build_room.py calls import_layout() as its first step.
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

import bpy
from mathutils import Matrix

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / "blender" / ".cache"

# Pinned to the upstream commit that last changed the models (MIT, henryjeff/portfolio-website).
HENRY_RAW = "https://raw.githubusercontent.com/henryjeff/portfolio-website/b49482d6da1133cac0c7291a06dbedf89cb3a15f/static/models"
HENRY_MODELS = {
    "World/environment.glb": "817a3daf8da639268bcd57327277919888432e6e53a75a4201e7c2788b329672",
    "Computer/computer_setup.glb": "5b7ecb5d0d1c21ab1253fc57b64f235f4040ba0751cfe0ff204141deb1dbc236",
    "Decor/decor.glb": "b25f99d3fbf42cb54009c398b61eed86b78679f426800237daa5077c7a46c832",
}

# Henry's models are in his own units (the desk is 2.81 units tall; three.js scales them by 900).
# One unit = 0.26 m puts the desk top at 0.73 m and the keyboard at 0.46 m wide.
METRES_PER_UNIT = 0.26
FLOOR_Z_UNITS = -3.316

# Henry's mesh name -> our name and atlas. His background backdrop and floor plant are dropped.
KEEP = {
    "desk": ("desk_desk", "desk"),
    "chair_base": ("desk_chair_base", "desk"),
    "chair_seat": ("desk_chair_seat", "desk"),
    "computer": ("desk_computer", "desk"),
    "monitor_base": ("desk_crt", "desk"),
    "keyboard": ("desk_keyboard", "desk"),
    "mouse": ("desk_mouse", "desk"),
    "cables": ("desk_cables", "desk"),
    "coffee": ("desk_mug", "desk"),
    "paper": ("desk_paper", "desk"),
    "paper_holder_bottom": ("desk_tray_bottom", "desk"),
    "paper_holder_top": ("desk_tray_top", "desk"),
    "paper_stack_1": ("desk_papers_a", "desk"),
    "paper_stack_2": ("desk_papers_b", "desk"),
    "binder_1": ("desk_binder_a", "desk"),
    "binder_2": ("desk_binder_b", "desk"),
}


def fetch_cached(url: str, dest: Path, sha256: str) -> Path:
    """Download url to dest once; refuse a file whose sha256 differs from the pinned one."""
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        request = urllib.request.Request(url, headers={"User-Agent": "portfolio-website-blender/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response, open(tmp, "wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
        tmp.rename(dest)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    if digest != sha256:
        raise RuntimeError(f"{dest}: sha256 {digest} != pinned {sha256}")
    return dest


def import_layout() -> list[bpy.types.Object]:
    """Import, rename, rescale to metres (floor at z=0) and strip materials; returns the kept objects."""
    to_metres = Matrix.Scale(METRES_PER_UNIT, 4) @ Matrix.Translation((0, 0, -FLOOR_Z_UNITS))
    existing = set(bpy.data.meshes) | set(bpy.data.materials) | set(bpy.data.images)
    kept = []
    for rel, sha in HENRY_MODELS.items():
        path = fetch_cached(f"{HENRY_RAW}/{rel}", CACHE / "henry" / rel, sha)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        for obj in [o for o in bpy.data.objects if o not in before]:
            if obj.type != "MESH" or obj.name not in KEEP:
                bpy.data.objects.remove(obj, do_unlink=True)
                continue
            name, atlas = KEEP[obj.name]
            obj.name = obj.data.name = name
            obj.data.transform(to_metres @ obj.matrix_world)
            obj.matrix_world = Matrix.Identity(4)
            obj.data.materials.clear()
            for uv in list(obj.data.uv_layers)[1:]:
                obj.data.uv_layers.remove(uv)
            obj["atlas"] = atlas
            kept.append(obj)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in [b for b in datablocks if b.users == 0 and b not in existing]:
            datablocks.remove(block)
    return kept


if __name__ == "__main__":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for obj in import_layout():
        lo = [min(v.co[i] for v in obj.data.vertices) for i in range(3)]
        hi = [max(v.co[i] for v in obj.data.vertices) for i in range(3)]
        print(f"{obj.name:20s} tris={sum(len(p.vertices) - 2 for p in obj.data.polygons):5d} "
              f"min={tuple(round(x, 3) for x in lo)} max={tuple(round(x, 3) for x in hi)}")
    sys.stdout.flush()
