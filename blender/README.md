# The room in Blender

`room.blend` (Git LFS) is the source of the 3D room on `/`. Four scripts rebuild, bake and export it. They run
headless with Blender 5.2 LTS, Cycles on the CPU.

```
build_room.py ──► room.blend ──► bake.py ──► .cache/bake/*.png|exr ──► export.py ──► public/room/
 Henry's layout     (scene)       room atlases (env,                   (display-ready)   room.glb (KTX2 + meshopt)
 + room, lights     desk, props) without the view;                                    window_{sf,delhi}_{day,night}.ktx2
 + room_dressing.py               the view's halves alone,                            poster.avif, poster.jpg
 + window_view.py                 by day and by night                                 renders/room_*.png, window_view.png
```

## Re-bake

```sh
blender -b blender/room.blend -P blender/scripts/bake.py
```

`room.blend` reads its downloaded textures, models and font from `blender/.cache/` (git-ignored), so on a fresh clone
run the rebuild below once before baking. Bakes the three room atlases (env, desk, props; 4096² each) at 512 samples, then each half of the window view
(window_sf, window_delhi; 1024² each) by day and by night, on 24 threads, and saves the bake UVs into `room.blend`.
The room atlases bake without the view (a camera-invisible card behind the window, lit by Poly Haven's dusk HDRI,
lights the room); the view bakes alone with its own sun, sky and night lights. For a quick look, bake small:
`-- --scale 0.25 --samples 32`, one atlas: `-- --atlas desk`, or the view only: `-- --atlas window_sf,window_delhi`.

## Re-export

```sh
blender -b blender/room.blend -P blender/scripts/export.py
```

Renders the stills, writes the view's four KTX2 files (ETC1S with mipmaps, `ktx create`), exports the glb, then runs
gltf-transform 4.5.1 (via `npx`): dedup, prune (empties and attributes kept), KTX2 ETC1S atlases, meshopt geometry.
The atlases ship resampled from their 4096² bakes (`EXPORT_SIZES`: desk 3584, props 2944, env 2560), which keeps
the glb inside 4.3 MB.
It then points each view half's material at its day texture by URI. It fails if `room.glb` is over 4.3 MB, the two
day textures are over 400 KB together, or a node from the contract below is missing. Needs Node (`npx`), `ktx`
from KTX-Software 4.x and `ffmpeg` with libaom on `PATH`. `-- --no-stills` exports only the glb and textures;
`-- --only room_idle,window_view` renders some stills.

Stills: `renders/room_{idle,desk,shelf,window,projector,photos}.png`, `renders/window_view.png` (the `cam_window`
framing with a film look, the SaahilOS wallpaper) and `public/room/poster.{avif,jpg}` (the `cam_idle` view). They
show San Francisco at dusk and Delhi by day, the four Letterboxd favourites from `public/room/posters/` and the
photographs the photography collection puts on the wall (`src/assets/photography/`). In the glb those pictures are
runtime textures, so re-export the stills when the favourites or the wall's photographs change.

## Rebuild from scratch

```sh
blender -b --factory-startup -P blender/scripts/build_room.py
```

Downloads Henry Heffernan's three models (pinned commit, checked by sha256), the CC0 textures, HDRI and models from
Poly Haven and ambientCG, and Newsreader (pinned commit, sha256) into `blender/.cache/`, then builds the scene and
overwrites `room.blend`. Props are appended from `blender/props/<name>.blend` (root collection named after the prop;
rebuild them with `python3 blender/scripts/props_build.py --render`). Re-bake after a rebuild.

`window_view.py` also renders the view alone for quick work on it:
`blender -b --factory-startup -P blender/scripts/window_view.py -- <out_dir> day cam_window`.

## What the glb holds

| Node | What |
|---|---|
| `env_*` | walls, floor, window, curtains, sill, radiator, shelf, fixtures, rug, side table, sideboard, photo lamp |
| `desk_*` | desk, chair, computer, CRT, keyboard, mouse, cables, lamp, papers, mug, notebook, sticky notes, headphones; `photo_album` |
| `props_*` | props from `blender/props/` and the dressing (books, records, plants, frames, lantern, jacket …) |
| `crt_glow`, `lamp_bulb`, `lava_lamp_glass`, `oven_glow`, `nas_led_0..3` | runtime meshes, each with its own unlit material (`nas_led` is shared by the four LEDs) so the site can tint, flicker or replace them |
| `window_view_sf`, `window_view_delhi` | the view's halves (the seam is x = 1.33 m, behind the window's central bar); material = that half's day texture by URI; extras `texture_day`, `texture_night` |
| `poster_art_0..3` | the poster pictures, slot 0 leftmost seen from the room; TEXCOORD_0 = 0–1 over the 2:3 picture for the art; material `poster_art_<slot>` holds the baked light on the picture on TEXCOORD_1 |
| `photo_print_0..4` | the photo wall's pictures, same scheme; extras `photo_slot`, `aspect`, `width_m`, `height_m` (slots 0–2 are 1:1, 4:3, 16:9 for the three prints marked for the wall; 3 is 3:2, 4 is 4:5) |
| `poster_plaque` | "Four favourites — from Letterboxd", engraved and baked |
| `lava_lamp`, `espresso_machine`, `countertop_oven`, `ceiling_fan`, `mango_fruit` | baked bodies of the round-two props |
| `ceiling_fan_blades`, `projector_dial` | pivots (empties at the hub / dial axis) holding `<name>_mesh`; turn them about their local +Y |
| `hit_*` | invisible click boxes (material `proxy`): the T3 set plus `hit_window`, `hit_projector_screen`, `hit_lava_lamp`, `hit_fan`, `hit_espresso`, `hit_oven`, `hit_plaque`, `hit_photo_wall`, `hit_album`, `hit_projector_dial`; `hit_poster_<id>` keep their T3 names and carry extras `poster_slot` |
| `monitor_screen` | centre of the CRT glass; local +Z out of the glass; extras `width_m`, `height_m` |
| `projector_lens`, `projector_screen_center` | beam origin (local −Z along the beam) and its target |
| `lava_lamp_light`, `espresso_steam` | the lamp's light centre; the steam's start at the portafilter spouts |
| `album_open_anchor` | where the opened album floats, 0.55 m in front of `cam_desk`, local +Z toward the camera; extras `width_m`, `height_m` |
| `cam_loading`, `cam_idle`, `cam_desk`, `cam_monitor`, `cam_shelf`, `cam_projector`, `cam_window`, `cam_photos` | camera framings, each with a `<name>_target` look-at empty; extras `fov_deg` (vertical) |

Units are metres, +Y up. Every material is `KHR_materials_unlit` with the baked light as its base colour, already
tone-mapped (AgX, exposure 2.15, the same as the stills), so the site shows it with no tone mapping and sRGB output.
The atlas materials are `room_env`, `room_desk` and `room_props`; only `room_props_leaves` (the mango leaves, same
texture as `room_props`) is double-sided, because thin closed shells z-fight through a double-sided material.

For the art meshes the light on the picture is baked on white paper, so the site can draw art × light: put the
runtime art in `map` (TEXCOORD_0), move the baked texture to `lightMap` (GLTFLoader already gives it channel 1) and
set `lightMapIntensity` to π. For the view, blend `window_<half>_day.ktx2` and `window_<half>_night.ktx2` by that
city's local time; to soften the seam, blend by world x across the seam instead of per mesh (both halves' textures
match at the seam in each state).

## Lights

Each light has a source in the room: the desk lamp (tungsten, about 2700 K), the projector (cool `#9DB4C0` spot from
`projector_lens`, plus the lit picture on the screen), the CRT glass, dusk through the window (an emissive card behind
the window and a soft area light), the brass picture light over the posters, the strip light under the top shelf and
the fairy lights along it, the lava lamp's glow on the posters and plaque, the oven's elements, the photo wall's
picture lamp, a red darkroom safelight, and a paper lantern in the reading corner. A camera-invisible ceiling and
front and right walls bounce light like a closed room; they are never baked or exported. The view has its own lights
(sun and sky by day; moon, floodlights on the monuments and the bridge, city glow by night) in `window_lights`,
switched on only while its halves bake.

## Budget

The glb holds about 100k vertices: the props' prop files keep their full detail, and `build_room.py` decimates the
densest ones for the room only (`DECIMATE`). The view keeps only faces some framing, or a glide between two framings,
can see through the window. Credits for every downloaded model, texture, HDRI and font are in `ASSETS.md`.
