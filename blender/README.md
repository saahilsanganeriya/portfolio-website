# The room in Blender

`room.blend` (Git LFS) is the source of the 3D room on `/`. Four scripts rebuild, bake and export it. They run
headless with Blender 5.2 LTS, Cycles on the CPU.

```
build_room.py ──► room.blend ──► bake.py ──► .cache/bake/{env,desk,props,posters}.png ──► export.py ──► public/room/
 Henry's layout     (scene)       Cycles bake,                (display-ready atlases)       room.glb (KTX2 + meshopt)
 + room, lights,                  OIDN denoise,                                             poster.avif, poster.jpg
 props, posters                   bake UVs saved                                            renders/room_*.png
```

## Re-bake

```sh
blender -b blender/room.blend -P blender/scripts/bake.py
```

Bakes all four atlases at full size (env and desk 4096², props and posters 2048²) with 512 samples, 24 threads,
and saves the bake UVs into `room.blend`. It took 32 minutes on 24 threads of a shared 32-core machine
(2026-10-12). For a quick look, bake small:
`-- --scale 0.25 --samples 32` (same UV layout, a quarter of the size), or one atlas: `-- --atlas desk`.

## Re-export

```sh
blender -b blender/room.blend -P blender/scripts/export.py
```

Renders the stills (`renders/room_{idle,desk,shelf}.png`, `public/room/poster.{avif,jpg}` from `cam_idle`), exports
the glb, then runs gltf-transform 4.5.1 (via `npx`): dedup, prune (empties kept), KTX2 ETC1S textures, meshopt
geometry; about 8 minutes in all. It fails if `room.glb` is over 4.5 MB or a node from the contract below is missing.
Needs Node (`npx`), `ktx` from KTX-Software 4.x and `ffmpeg` with libaom on `PATH`. Add `-- --no-stills` to export
only the glb.

## Rebuild from scratch

```sh
blender -b --factory-startup -P blender/scripts/build_room.py
```

Downloads Henry Heffernan's three models (pinned commit, checked by sha256) and the CC0 textures and HDRI from
Poly Haven into `blender/.cache/`, then builds the scene and overwrites `room.blend`. Props are appended from
`blender/props/<name>.blend` (root collection named after the prop) and posters read from
`blender/posters/<id>.png`; a missing file gets a placeholder of the same size (set `ROOM_PROPS_DIR` to read
props from another checkout). Re-bake after a rebuild.

## What the glb holds

| Node | What |
|---|---|
| `env_*` | walls, floor, window, curtains, sill, radiator, shelf, fixtures, rug, side table; `env_sky` (the city card) sits 15 cm behind the window and every framing sees it only through the window |
| `desk_*` | desk, chair, computer, CRT, keyboard, mouse, cables, lamp, papers, mug |
| `props_*` | props from `blender/props/`, the poster art and frames, the projected picture |
| `crt_glow`, `lamp_bulb`, `nas_led_0..3` | runtime meshes with their own unlit materials (`crt_glow`, `lamp_bulb`, `nas_led` shared by the four LEDs); `crt_glow` bulges up to 8 mm in front of `monitor_screen`, so hide it or draw it additively while the iframe shows |
| `hit_*` | invisible click boxes (material `proxy`) |
| `monitor_screen` | centre of the CRT glass; local +Z out of the glass; extras `width_m`, `height_m` |
| `projector_lens`, `projector_screen_center` | beam origin (local −Z along the beam) and its target |
| `cam_loading`, `cam_idle`, `cam_desk`, `cam_monitor`, `cam_shelf`, `cam_projector` | camera framings, each with a `<name>_target` look-at empty; extras `fov_deg` (vertical) |

Units are metres, +Y up. Every material is `KHR_materials_unlit` with the baked light as its base colour, already
tone-mapped (AgX, the same as the stills), so the site shows it with no tone mapping and sRGB output.

## Lights

Each light has a source in the room: the desk lamp (tungsten, about 2700 K), the projector (cool `#9DB4C0` spot from
`projector_lens`, plus the lit picture on the screen), the CRT glass, dusk through the window (the city HDRI on an
emissive card outside, and a soft area light), a brass picture light over the posters and a brass strip light under
the top shelf. A camera-invisible ceiling and front and right walls bounce light like a closed room; they are never
baked or exported.

Credits for every downloaded model, texture and HDRI are in `ASSETS.md`.
