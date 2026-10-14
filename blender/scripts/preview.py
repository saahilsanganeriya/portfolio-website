"""Quick look renders of room.blend (or another blend) from named framings, for layout and lighting work.

    blender -b <file.blend> -P blender/scripts/preview.py -- <out_dir> [--engine eevee|cycles] [--samples N]
        [--size 960x600] [cam_name | name=x,y,z:tx,ty,tz ...]

Cycles previews run on 24 threads at low samples with denoising; EEVEE previews are faster and show the lights
roughly (EEVEE ignores camera ray visibility, so the ghost walls and the sky card are hidden for it). A
name=x,y,z:tx,ty,tz argument tries a framing that is not in the blend. Nothing is saved back to the blend.
"""
import argparse
import sys
import time
from pathlib import Path

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_room  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="preview.py")
    ap.add_argument("out")
    ap.add_argument("cams", nargs="*")
    ap.add_argument("--engine", default="eevee")
    ap.add_argument("--samples", type=int, default=24)
    ap.add_argument("--size", default="960x600")
    ap.add_argument("--view", choices=("day", "night"), help="light the window view for that state")
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    w, h = (int(v) for v in args.size.split("x"))
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = w, h, 100
    if args.engine == "cycles":
        scene.render.engine = "CYCLES"
        scene.cycles.samples = args.samples
        scene.cycles.use_denoising = True
        scene.render.threads_mode, scene.render.threads = "FIXED", 24
    else:
        scene.render.engine = "BLENDER_EEVEE"
        scene.eevee.taa_render_samples = args.samples
        for obj in scene.objects:
            if obj.name.startswith("ghost_") or obj.name == "env_sky":
                obj.hide_render = True
    if args.view:
        import window_view
        window_view.set_night(1.0 if args.view == "night" else 0.0)
        for light in bpy.data.collections["window_lights"].objects:
            light.hide_render = light["window_mode"] != args.view
    scene.render.film_transparent = False
    cams = args.cams or sorted(o.name for o in scene.objects if o.name.startswith("cam_") and not o.name.endswith("_target"))
    for cam in cams:
        t = time.monotonic()
        if "=" in cam:
            cam, spec = cam.split("=")
            pos, target = ([float(v) for v in part.split(",")] for part in spec.split(":"))
            for name, loc in ((cam, pos), (f"{cam}_target", target)):
                empty = bpy.data.objects.get(name) or bpy.data.objects.new(name, None)
                if empty.name not in scene.collection.objects:
                    scene.collection.objects.link(empty)
                empty.location = loc
        build_room.aim_camera(cam)
        scene.render.filepath = str(out / f"{cam}.png")
        bpy.ops.render.render(write_still=True)
        print(f"PREVIEW {cam} {time.monotonic() - t:.1f}s")


main()
