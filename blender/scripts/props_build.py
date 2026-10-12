"""Build every prop, and optionally render its review stills, one Blender process per prop.

    python3 blender/scripts/props_build.py [--render] [prop ...]

Uses `blender` from PATH (Blender 5.2 LTS) unless BLENDER is set. Renders run with 16 threads.
"""
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER = os.environ.get("BLENDER", "blender")
PROPS = ["poster_frame", "projector_screen", "projector_8mm", "mango_plant", "nas_4bay", "books_stack",
         "film_canister", "fujifilm_x100", "fujifilm_xt", "fujica_st", "super8_camera"]


def run(cmd):
    t0 = time.monotonic()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    lines = [ln for ln in proc.stdout.splitlines() if ln.startswith(("PROP_REPORT", "RENDER_DONE", "saved"))]
    for ln in lines:
        print(ln)
    if proc.returncode != 0:
        print(proc.stdout[-4000:], proc.stderr[-4000:], sep="\n")
        sys.exit(f"failed ({proc.returncode}): {' '.join(cmd)}")
    print(f"  ok in {time.monotonic() - t0:.0f}s: {os.path.basename(cmd[-1]) if '--' not in cmd else cmd[-1]}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    render = "--render" in sys.argv
    for name in args or PROPS:
        if name not in PROPS:
            sys.exit(f"unknown prop {name}")
        run([BLENDER, "-b", "--factory-startup", "--python-exit-code", "1", "-P",
             os.path.join(HERE, f"props_{name}.py")])
        if render:
            run([BLENDER, "-b", "-t", "16", "--python-exit-code", "1", "-P", os.path.join(HERE, "props_render.py"),
                 "--", name])


main()
