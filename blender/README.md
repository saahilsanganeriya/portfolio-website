# The room in Blender

`room.blend` (Git LFS) is the source of the 3D room on `/`. Four scripts rebuild, bake and export it. They run
headless with Blender 5.2 LTS, Cycles on the CPU.

```
build_room.py ──► room.blend ──► bake.py ──► .cache/bake/*.png|exr ──► export.py ──► public/room/
 Henry's layout     (scene)       room atlases (env 4096,               (display-ready)   room.glb (KTX2 + meshopt)
 + room, lights                   desk and props 6144) without the                       window_{sf,delhi}_{day,night}.ktx2
 + room_dressing.py               view; the view's halves alone,                         pale-blue-dot.ktx2, floorplan.json
 + room_art.mjs                   by day and by night                                    poster.avif, poster.jpg
 + window_view.py                                                                        renders/room_v3_*.png, window_view.png
```

## The room (v3, round seven)

```
                          back wall
   ┌──────────────────────┬──────────────────┬──────────────────────┐
   │ posters + plaque      │ desk, monitor,   │ window 1.5 x 1.44 m  │  right return wall
   │ credenza, lava lamp   │ shelf, pennant   │ mango on the sill    │  (ends at y = -2.0)
 d ├┐                                                               │ bookcase, Voyager,
 o ││ hallway                                                       │ Pale Blue Dot,
 o ├┘                                                               │ Japanese-lit print
 r │ photo wall                                         armchair, lantern, reading table
   │ projection wall ◄──── projector on its table
   │ kitchen nook: counter, espresso machine, oven, tiles, shelf, pendant
   └── open front ───────────────────────────────────────────────────
```

The floor is 6.4 x 4.4 m and the walls 2.85 m. A ceiling band, the ceiling cut 0.42 m from the walls with a
cornice, runs along all three walls, so from the wide framing the room has a ceiling edge instead of bare wall tops;
the right return wall ends in a painted wall end, and a doorway near the back of the left wall opens onto a dim
hallway lit by a sconce.

## Re-bake

```sh
blender -b blender/room.blend -P blender/scripts/bake.py
```

`room.blend` reads its downloaded textures, models and font from `blender/.cache/` (git-ignored), so on a fresh clone
run the rebuild below once before baking. Bakes the three room atlases (env 4096², desk and props 6144²) at 128
samples with OIDN denoising, then each half of the window view (window_sf, window_delhi; 1280² each) by day and by
night, on 24 threads, and saves the bake UVs into `room.blend`. The desk and props atlases bake larger than they ship
(export.py resamples them), so each shipped texel averages several baked ones. The room atlases bake without the view
(a camera-invisible card behind the window, lit by Poly Haven's dusk HDRI, lights the room); the view bakes alone
with its own sun, sky and night lights. For a quick look, bake small: `-- --scale 0.25 --samples 32`, one atlas:
`-- --atlas desk`, or the view only: `-- --atlas window_sf,window_delhi`. The final bake took 71 minutes on 24 threads of
the shared devbox (env 9, desk 30, props 31, the view 1.5).

## Re-export

```sh
blender -b blender/room.blend -P blender/scripts/export.py
```

Renders the stills, writes the view's four KTX2 files (ETC1S with mipmaps, `ktx create`) and
`pale-blue-dot.ktx2` (NASA/JPL's PIA23645, cropped square, 1024 px), exports the glb, then runs gltf-transform 4.5.1
(via `npx`): dedup, prune (empties and attributes kept), KTX2 ETC1S atlases, meshopt geometry. The atlases ship
resampled from their bakes (`EXPORT_SIZES`: env 2560, desk 3584, props 3072; the view's halves
ship at their 1280 px bake). It then points each view half's material at its day
texture by URI and writes `public/room/floorplan.json` (floorplan.py). It fails if `room.glb` is over 4.6 MB, the two
day textures are over 560 KB together, a node from the contract below is missing, or a removed one is back. Needs Node
(`npx`), `ktx` from KTX-Software 4.x and `ffmpeg` with libaom on `PATH`. `-- --no-stills` exports only the glb and
textures; `-- --only room_v3_idle,window_view` renders some stills.

Stills: `renders/room_v3_{idle,desk,window,kitchen,oven,shelf,space,armchair,projector,photos,posters}.png` beside
the round-two `renders/room_*.png`, `renders/window_view.png` (the `cam_window` framing, plain) and
`public/room/poster.{avif,jpg}` (the `cam_idle` view). They show San Francisco at dusk and Delhi by day, the four
Letterboxd favourites from `public/room/posters/`, the photographs the photography collection holds
(`src/assets/photography/`) and the two phrases the brief names on two sticky notes. In the glb those pictures are
runtime textures, so re-export the stills when the favourites or the wall's photographs change.

## Rebuild from scratch

```sh
blender -b --factory-startup -P blender/scripts/build_room.py
```

Downloads Henry Heffernan's three models (pinned commit, checked by sha256), the CC0 textures, HDRI and models from
Poly Haven and ambientCG, Newsreader (pinned commit, sha256) and NASA's Pale Blue Dot Revisited (sha256) into
`blender/.cache/`, runs `room_art.mjs` (Node) for the typographic art, then builds the scene and overwrites
`room.blend`. Props are appended from `blender/props/<name>.blend` (root collection named after the prop; rebuild
them with `python3 blender/scripts/props_build.py --render`). Re-bake after a rebuild. `ROOM_QUICK=1` skips the
window view for layout work, and `ROOM_BLEND=<path>` writes the scene elsewhere.

`window_view.py` also renders the view alone for quick work on it:
`blender -b --factory-startup -P blender/scripts/window_view.py -- <out_dir> day cam_window`. `preview.py` renders
quick looks of `room.blend` from named or ad-hoc framings, `texel_density.py` reports the shipped texels per metre per
atlas, and `node blender/scripts/glb_stats.mjs` prints the glb's bytes, draw calls, triangles and textures.

## What the glb holds

| Node | What |
|---|---|
| `env_*` | walls (`env_wall_back`, `env_wall_left`, `env_wall_right`), floor, ceiling band and cornice, doorway, door, hallway, window, curtains, sill, radiator, desk shelf, fixtures, rugs, side and reading tables, credenza, kitchen tiles, top and shelf, photo lamp |
| `desk_*` | desk, chair, computer, CRT, keyboard, mouse, cables, lamp, papers, mug, notebook, headphones; `photo_album` |
| `props_*` | props from `blender/props/` and the dressing (books, records, plants, frames, lantern, jacket, jars …) |
| `crt_glow`, `lamp_bulb`, `lava_lamp_glass`, `oven_glow`, `nas_led_0..3` | runtime meshes, each with its own unlit material (`nas_led` is shared by the four LEDs) so the site can tint, flicker or replace them |
| `window_view_sf`, `window_view_delhi` | the view's halves (the seam runs behind the window's central mullion, x = 1.85 m); material = that half's day texture by URI; extras `texture_day`, `texture_night` |
| `poster_art_0..3`, `poster_plaque` | the poster pictures on the back wall, slot 0 leftmost seen from the room (art scheme below); the plaque "Four favourites — from Letterboxd", engraved and baked |
| `photo_print_0..4` | the photo wall's pictures on the left wall, art scheme; extras `photo_slot`, `aspect`, `width_m`, `height_m` (slots 0–2 are 1:1, 4:3, 16:9; 3 is 3:2, 4 is 4:5) |
| `projection_surface` | the clear patch of the left wall the projector throws onto: 16:9, 1.0 x 0.5625 m, art scheme (the film plays on it); extras `width_m`, `height_m`, `aspect` |
| `print_pale_blue_dot` | the square Pale Blue Dot print, art scheme; extras `texture` = `pale-blue-dot.ktx2` |
| `sticky_note_0..5` | paper notes, art scheme (the site writes the phrase); 0–2 on the monitor bezel, 3–5 on the wall right of the monitor; extras `paper` (hex), `where` |
| `kitchen_counter`, `espresso_machine`, `espresso_cup`, `espresso_coffee` | the kitchen nook's counter and the machine; the cup (with its saucer) and the coffee's surface are their own nodes: the surface sits at the full level, extras `fill_depth_m` 0.026 (lower it that far, raise it while pouring) |
| `countertop_oven`, `oven_door`, `croissant` | the oven body; `oven_door` is a pivot on the bottom hinge axis holding `oven_door_mesh` (extras `turn_axis` +X, `open_angle_deg` 82: turn about local +X, the top swings toward the room); the croissant on the rack inside |
| `lava_lamp` | the lamp's baked body, alone on the credenza under the posters |
| `projector`, `projector_reel_front`, `projector_reel_rear`, `projector_dial` | the projector on its side table, facing the projection wall; the reels and the program dial are pivots (empties on their axles) holding `<name>_mesh`, extras `turn_axis` (glTF axes); the dial's `program_angles_deg` as before |
| `bookshelf`, `book_spine_<slug>` | the bookcase on the right return wall, and the six books standing together on its middle shelf (typographic spines and covers baked), extras `title`, `author`, `year`; slugs `the-wind-up-bird-chronicle`, `kafka-on-the-shore`, `1q84`, `kitchen`, `on-earth-were-briefly-gorgeous`, `the-elegant-universe` |
| `print_japanese_lit`, `pennant_gatech`, `voyager_record` | the Japanese-literature print leaning on the bookcase, the Georgia Tech pennant over the desk shelf, the Voyager record in its shadow box on the space wall (all baked) |
| `mango_fruit` | the mango on the plant on the window sill |
| `hit_*` | invisible click boxes (material `proxy`): `hit_mango`, `hit_nas`, `hit_window`, `hit_fujifilm_a` (the camera on the desk; the shelf cameras have none), `hit_projector`, `hit_projector_dial`, `hit_lava_lamp`, `hit_espresso`, `hit_oven`, `hit_croissant`, `hit_books`, `hit_voyager`, `hit_pale_blue_dot`, `hit_print_japanese_lit`, `hit_pennant_gatech`, `hit_photo_wall`, `hit_album`, `hit_plaque`; `hit_poster_<id>` keep their T3 names and carry extras `poster_slot` |
| `monitor_screen` | centre of the CRT glass; local +Z out of the glass; extras `width_m`, `height_m` |
| `projector_lens`, `projector_screen_center` | beam origin (local −Z along the beam) and the centre of the picture on the projection wall |
| `lava_lamp_light`, `espresso_spout`, `espresso_steam` | the lamp's light centre; where the coffee stream starts (it falls straight down); where steam rises over the cup |
| `album_open_anchor` | where the opened album floats, 0.55 m in front of `cam_desk`, local +Z toward the camera; extras `width_m`, `height_m` |
| `cam_*` + `cam_*_target` | camera framings with look-at empties, extras `fov_deg` (35, vertical): `cam_loading`, `cam_idle` (the wide view), `cam_desk` (the landing frame, monitor readable), `cam_monitor`, `cam_arrival_0..2` (the arrival glide: past the window, past the mango plant, onto the desk), `cam_tour_0..9` (the tour's stops, below), `cam_window`, `cam_shelf` (the books), `cam_photos`, `cam_projector`, `cam_espresso`, `cam_oven` |

The tour's stops, in order (also in `floorplan.json`): 0 desk, 1 window, 2 bookshelf, 3 space wall, then 4 kitchen
nook, 5 lava lamp, 6 projector wall, 7 photo wall, 8 posters, 9 armchair corner.

Units are metres, +Y up. Every material is `KHR_materials_unlit` with the baked light as its base colour, already
tone-mapped (AgX, exposure 2.3, the same as the stills), so the site shows it with no tone mapping and sRGB output.
The atlas materials are `room_env`, `room_desk` and `room_props`; only `room_props_leaves` (the mango leaves, same
texture as `room_props`) is double-sided, because thin closed shells z-fight through a double-sided material.

The art scheme: the light on the picture is baked on white paper, so the site can draw art × light: put the runtime
art in `map` (TEXCOORD_0, 0–1 over the picture), move the baked texture to `lightMap` (GLTFLoader already gives it
channel 1) and set `lightMapIntensity` to π. For the view, blend `window_<half>_day.ktx2` and `window_<half>_night.ktx2`
by that city's local time; to soften the seam, blend by world x across the seam instead of per mesh (both halves'
textures match at the seam in each state).

`public/room/floorplan.json` is the room's plan for the tour map, in glTF world X and Z (metres): `outline` (the
floor), `walls`, `doors`, `windows` (segments), `furniture` (labelled footprints) and `stops` (id, label, camera node,
position), written from the blend by `floorplan.py`.

## Lights

Each light has a source in the room: the desk lamp (tungsten, about 2700 K), dusk through the window (an emissive card
behind the window and a soft area light), the brass picture light over the posters, the lava lamp's glow on them, the
strip light under the desk shelf, the photo wall's picture lamp, the projector (cool `#9DB4C0` spot from
`projector_lens` onto the projection wall), the kitchen pendant over the counter, the oven's elements, the CRT glass,
the paper lantern in the reading corner, and a sconce in the hallway beyond the door. A camera-invisible ceiling,
front wall and the open stretch of the right side bounce light like a closed room; they are never baked or exported.
The view has its own lights (sun and sky by day; moon, floodlights on the monuments and the bridge, city glow by
night) in `window_lights`, switched on only while its halves bake.

## Budget

The glb holds about 122k triangles in 145 draw calls (round two: 112k in 108); the renderer culls per
object, so a close framing submits 13 to 68 calls. Shipped density: desk 798 texels per metre, props 284, env
118 (the room's surfaces grew from 66 to 175 m² inside the same byte budget). `-- --merge-static` joins the plain
scenery per atlas (fewer calls, coarser culling); it is off. The props' prop files keep their full detail, and `build_room.py` decimates the densest ones for the
room only (`DECIMATE`). The view keeps only faces some framing, or a glide the site makes, can see through the window.
Credits for every downloaded model, texture, HDRI and font are in `ASSETS.md`.
