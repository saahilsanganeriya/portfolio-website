# The set in Blender

`room.blend` (Git LFS) is the source of the 3D set on `/`. Four scripts rebuild, bake and export it. They run
headless with Blender 5.2 LTS, Cycles on the CPU.

```
build_room.py ──► room.blend ──► bake.py ──► .cache/bake/*.png|exr ──► export.py ──► public/room/
 Henry's desk       (scene)       four atlases (desk, art, props,        (display-ready)   room.glb (first-frame atlases,
 + the corner,                    env; 6144 px, view-independent                          KTX2 ETC1S 1024 px + meshopt)
   lights, props                  light, void fade baked in); the                         atlas/<atlas>.ktx2|avif (4096 px)
 + room_dressing.py               view's two halves by day                                atlases.json, floorplan.json
 + room_art.mjs                                                                           window_{sf,delhi}_day.ktx2
 + window_view.py                                                                         pale-blue-dot.ktx2, probe/room.hdr
                                                                                          renders/room_v4_*.png
```

## The set (v4, round eight): a corner in a void

```
                        y = 0.42  back wall (fades out at its top and past x = 3.0)
     ┌───────────────────────┬────────────────────────┬──────────────────────┐╌╌╌╌╌┐
     │ 4 posters + plaque     │ pennant                │ window, one pane     │     ╎ fades
     │ credenza, lava lamp    │ Voyager  Pale Blue Dot │ mango on the sill    │     ╎
     │                        │ desk, CRT, NAS, lamp   │                      │
   l ├ syngonium                chair                         bookcase (free-standing,
   e │ darkroom lines: 3 strings,                             turned 65°, print on top)
   f │ 17 prints on pegs                                 armchair     lantern
   t │                                                       record cabinet + turntable
     │ kitchen nook: counter, espresso,                       crate
     │ oven, shelf, pendant
     ╎ fades past y = -3.4         the floor: a rounded disc, faded out all round
```

The two walls stand 3.4 m and fade into the void toward their tops (from 2.45 m) and toward their free ends (the back
wall past x = 3.0, the left wall past y = -3.4); the floor is a rounded disc (a superellipse about the set) solid out
to `floor` and faded to the void across `floor_fade`. The void colour (`room_lib.VOID_HEX`, also `voidColor` in
`floorplan.json`) is the site's clear colour, so no edge of the set shows from any side of the orbit. There is no
ceiling, door, hallway, radiator, projector, roller screen, photo board or photo album.

## Re-bake

```sh
blender -b blender/room.blend -t 16 -P blender/scripts/bake.py
```

`room.blend` reads its downloaded textures, models and font from `blender/.cache/` (git-ignored), so on a fresh clone
run the rebuild below once before baking. Bakes the desk atlas at 6144 px (1.5 times the 4096 px it ships at), the art
and props atlases at their 4096 px, the walls and floor at 3072 px, and each half of the window view (window_sf,
window_delhi; 1280 px) by day, on 16 threads, and saves the blend with the bake UVs after each atlas. Round eight's
final bake ran as two parallel lanes, each on its own copy of `room.blend` (`-- --save-as`), merged afterwards: the desk
at 128 samples (61 min), and props at 96 (46 min), env at 64 (7 min), art at 96 and the view at 96. The atlases split the set by importance: `desk` holds only the hero
surfaces of the desk view (the desk top, the CRT's and the computer's fronts, the keyboard, mouse, mug, badge, notes
and the camera), `art` the wall art, the window's frame, the space prints, the pennant and the darkroom lines, `props`
everything else that stands in the set, and `env` the walls, the floor, the rugs and the curtains. Each object's share
of its atlas is its area times its `texel` weight (uniform within the object). The desk top is the exception: about
half of it shows from the desk view (the CRT, the computer and the keyboard cover the rest), so `build_room.py` cuts it
into 3 cm cells, ray-casts each against every framing and the orbit, and bakes it as three objects by what the most
demanding view of each cell needs (`desk_desk_top` ~2,400 texels/m where the desk views look, `desk_desk_top_mid`
~1,450 where only farther views do, `desk_desk_top_rest` ~300 where nothing does), each cut into rectangles of at most
0.6 m so they pack; `export.py` joins them back into one `desk_desk_top`. Islands sit 8 px apart (shipped sizes; the
desk atlas packs axis-aligned): the props atlas holds thousands of small islands, and a 16 px gap left it 10 % full
and the cut desk top's atlas 52 %.
Per atlas: the view-independent light (diffuse direct and indirect, emission) at 256 samples, with metals and glass
baked as diffuse in their own colour; a diffuse-colour and a normal bake that guide OIDN; the AgX view transform; then
the void fade, blended per texel from a bake of world positions. The three guide bakes (colour, normal, world position)
run in a pool of four Blender processes (`-- --guide-workers N`; 1 runs them in this process), each baking a run of
the atlas's objects on a quarter of the threads: Cycles syncs the whole scene again for every object it bakes, mostly
on one core, so in one process the 4-sample guides took as long as the light (round eight's props: 1,377 of 2,740 s).
The pooled guides are byte-identical to the serial ones (props at 1,024 px: 138 s serial, 61 s pooled). Samples:
`-- --samples N` (the default is 256). Each atlas also keeps its denoised linear light and
its fade under `.cache/bake/`, so `-- --regrade <atlas>` redoes the exposure and the fade in minutes. Glossy light is
left out on purpose: it is right from one viewpoint only, and the site draws the shine of the surfaces tagged `gloss`
live from the room probe. For a quick look, bake small: `-- --scale 0.25 --samples 32`; one atlas: `-- --atlas desk`;
the view only: `-- --atlas window_sf,window_delhi`.

## Re-export

```sh
blender -b blender/room.blend -P blender/scripts/export.py
```

Renders the stills and the room probe, writes the view's two day KTX2 files (ETC1S with mipmaps, `ktx create`) and
`pale-blue-dot.ktx2` (NASA/JPL's PIA23645, cropped square, 1024 px), exports the glb, then runs gltf-transform 4.5.1
(via `npx`): dedup, prune (empties and attributes kept), KTX2 ETC1S for the four first-frame atlases (1024 px), meshopt
geometry. Then it encodes the full atlases into `public/room/atlas/` (`FULL_PX`, `FULL_CODEC`, each picked by an A/B
of bytes, SSIM and crops: UASTC level 2 with RDO λ 1 and zstd 18 in KTX2 for the desk and the art at 4096 px, AVIF crf 14
for the props at 4096 px and the walls and floor at 3072 px) and writes
`public/room/atlases.json` and `public/room/floorplan.json` (floorplan.py). It fails if the first frame (room.glb and the
two day halves of the window) is over 5,500,000 B, the full set over 23,000,000 B, a node from the contract below is
missing, a removed one (or a night view's file) is back, or the probe is over 400 KB. Needs Node (`npx`), `ktx` from
KTX-Software 4.x and `ffmpeg` with libaom on `PATH`. `-- --no-stills` exports without the stills, `-- --low-only` skips
the full atlases, `-- --only room_v4_idle,window_view` renders some stills.

Stills: `renders/room_v4_{idle,desk,window,darkroom}.png` beside
the round-seven `renders/room_v3_*.png`, `renders/window_view.png` (the `cam_window` framing, plain) and
`public/room/poster.{avif,jpg}` (the `cam_idle` view), composited on the void colour.

## Rebuild from scratch

```sh
blender -b --factory-startup -t 16 -P blender/scripts/build_room.py
```

Downloads Henry Heffernan's three models (pinned commit, checked by sha256), the CC0 textures and models from Poly
Haven and ambientCG, Newsreader (pinned commit, sha256) and NASA's Pale Blue Dot Revisited (sha256) into
`blender/.cache/`, runs `room_art.mjs` (Node) for the typographic art, then builds the scene and overwrites
`room.blend`. Props are appended from `blender/props/<name>.blend` (root collection named after the prop; rebuild
them with `python3 blender/scripts/props_build.py --render`); the CRT's case (`crt_shell`, named `desk_crt` in the room)
and the desk chair replace Henry's (`DESK_PROPS`). `monitor_screen` is pinned to its round-eight pose and size
(`MONITOR_SCREEN`), since SaahilOS's hole on the site is sized from it: the build stops if a case's measured opening is
more than 3 mm off. Re-bake after a rebuild. `ROOM_QUICK=1` skips the
window view for layout work, and `ROOM_BLEND=<path>` writes the scene elsewhere.

`window_view.py` also renders the view alone: `blender -b --factory-startup -P blender/scripts/window_view.py --
<out_dir> day cam_window`. `preview.py` renders quick looks of `room.blend` from named or ad-hoc framings,
`texel_density.py` reports the shipped texels per metre per object and atlas, and `node blender/scripts/glb_stats.mjs`
prints the glb's bytes, draw calls, triangles and textures.

## What the glb holds

| Node | What |
|---|---|
| `wall_back`, `wall_left` | the two walls, each its own mesh and material (`wall_back`, `wall_left`, both on the env atlas), faded to the void toward the top and the free end in the bake |
| `wall_back_group`, `wall_left_group` | empties at the origin (identity) holding each wall with its art and fixtures (and, for the back wall, the window and its view), so the site can fade a whole wall when the camera is behind it; every other node stands on the floor at the root |
| `floor`, `floor_fade` | the floor's solid disc and the ring that fades it into the void |
| `orbit_center` | where the 360-degree orbit turns; extras `minDist`, `maxDist` (metres), `minPolarDeg`, `maxPolarDeg` (from straight up), chosen so every angle stays above the floor and inside the fades |
| `env_*` / `desk_*` / `props_*` | the set's baked scenery; `desk_desk_top` (the desk's top, one node: its three baked parts joined), `desk_crt_front` and `desk_computer_front` are the faces the desk view sees (desk atlas), the rest of each stays `desk_desk`, `desk_crt`, `desk_computer` |
| `keyboard`, `mouse`, `coffee_mug`, `croissant`, `crt_badge`, `pennant_gatech` | the hero props (T72's prop files once they land; Henry's keyboard, mouse and mug until then); `crt_badge` sits on the CRT's chin |
| `coffee_steam` | where the mug's steam starts, over the coffee; extras `width_m`, `height_m` |
| `crt_glow`, `lamp_bulb`, `lava_lamp_glass`, `oven_glow`, `nas_led_0..3` | runtime meshes, each with its own unlit material (`nas_led` is shared by the four LEDs) so the site can tint, flicker or replace them |
| `plant_sway_0..2` | the swaying leaves of the mango plant, the syngonium and the pothos, one material `plant_sway` (double-sided, props atlas), with a vertex colour (COLOR_0) whose red is the sway weight: 0 where a leaf joins its stem (the pothos: at the pot), 1 at the tips |
| `window_glass` | the window's one pane, 0-1 UVs, its own material, clear (white at zero opacity, blended); extras `width_m`, `height_m`, `gloss` |
| `window_view_sf`, `window_view_delhi` | the view's halves: land, water and landmarks by day (the seam runs at x = 1.85 m, behind the middle of the pane; the water reaches back to the wall); material = that half's day texture by URI; extras `texture_day` |
| `window_sky`, `window_sky_centre`, `window_sky_eye` | the sky over both cities, one mesh with a plain unlit material (the site draws one continuous gradient on it); the dome's centre, where sky directions start; and the window framing's eye, from which the sky and the city line blend from one city to the other |
| `window_view_mask` | an open-fronted box of panels in the void colour round the city diorama behind the window (left, right, top, back), facing out: from the side or above, the orbit sees the void instead of the diorama past the walls; the window still shows it. While this box holds the whole view, the site shows the view whenever the back wall is whole (`src/scene/World/Diorama.ts`). Unlit, `baseColorFactor` = the void colour; never seen by Blender's rays |
| `window_motif` | an empty spanning the sky just behind the glass, local +Z toward the room; extras `width_m`, `height_m`, `from_city` (delhi, right), `to_city` (sf, left): where the site draws the small plane on its dotted arc |
| `darkroom_line_0..2` | the three strings with their pegs and screw eyes on the left wall (baked) |
| `darkroom_clip_<line>_<k>` | an empty per peg at the middle of its print's top edge; local +Z out of the wall, +Y up; extras `maxW_m`, `maxH_m` (the print's largest size), `tiltDeg` (its turn about the wall's normal, already in the empty's rotation), `hero` on the one hero print; the site hangs each print below its empty |
| `poster_art_0..3`, `poster_plaque` | the poster pictures on the back wall, slot 0 leftmost seen from the room (art scheme below); the plaque "Four favourites — from Letterboxd", engraved and baked |
| `voyager_record`, `print_pale_blue_dot` | the space prints over the desk: the Voyager record's shadow box (baked) and the Pale Blue Dot, art scheme, extras `texture` = `pale-blue-dot.ktx2` |
| `sticky_note_0..2` | paper notes on the CRT's bezel, art scheme (the site writes the note); extras `paper` (hex), `where` |
| `kitchen_counter`, `espresso_machine`, `espresso_cup`, `espresso_coffee` | the kitchen nook's counter and the machine; the cup and the coffee's surface are their own nodes (the surface at the full level, extras `fill_depth_m` 0.026) |
| `countertop_oven`, `oven_door`, `croissant` | the oven body; `oven_door` is a pivot on the bottom hinge axis holding `oven_door_mesh` (extras `turn_axis` +X, `open_angle_deg` 82); the croissant on the rack inside |
| `lava_lamp` | the lamp's baked body, alone on the credenza under the posters |
| `record_player`, `platter`, `tonearm`, `record_crate`, `record_sleeve_0..5` | the turntable on the record cabinet (baked); `platter` is a pivot at the spindle (extras `turn_axis` +Y, `rpm` 33.333); `tonearm` a pivot at the arm's base (extras `turn_axis` +Y and, in degrees counterclockwise seen from above, `rest_angle_deg` 0, `play_angle_deg`, `end_angle_deg`); the crate of six LPs whose sleeve fronts are quads with the art scheme |
| `bookshelf`, `book_spine_<slug>`, `print_japanese_lit` | the free-standing bookcase, the six books on its middle shelf (typographic spines and covers baked, extras `title`, `author`, `year`), the print on its top |
| `mango_fruit` | the mango on the plant on the window sill |
| `hit_*` | invisible click boxes (material `proxy`): `hit_mango`, `hit_nas`, `hit_window`, `hit_fujifilm_a`, `hit_lava_lamp`, `hit_espresso`, `hit_oven`, `hit_croissant`, `hit_books`, `hit_voyager`, `hit_pale_blue_dot`, `hit_print_japanese_lit`, `hit_pennant`, `hit_crt_badge`, `hit_darkroom` (the strings and where the prints hang), `hit_record_player`, `hit_plaque`; `hit_poster_<id>` carry extras `poster_slot` |
| `monitor_screen` | centre of the CRT glass; local +Z out of the glass; extras `width_m`, `height_m` |
| `lava_lamp_light`, `espresso_spout`, `espresso_steam` | the lamp's light centre; where the coffee stream starts; where steam rises over the cup |
| `cam_*` + `cam_*_target` | camera framings with look-at empties, extras `fov_deg` (35, vertical): `cam_loading`, `cam_idle` (the wide view, the whole corner inside it), `cam_desk` (the landing frame, monitor readable), `cam_monitor`, `cam_arrival_0..2` (past the window, past the mango plant, onto the desk), `cam_tour_0..7` (the tour's stops, below), `cam_window`, `cam_shelf` (the bookcase), `cam_photos` (the darkroom lines), `cam_record_player`, `cam_espresso`, `cam_oven` |

Glossy surfaces carry an extra `gloss` (their roughness) for the live shine: `crt_glow`, `coffee_mug`, `desk_desk_top`,
`window_glass`, `lava_lamp_glass`, `desk_lamp_shade`, `espresso_machine`, `voyager_record`, `platter`.

The tour's stops, in order (also in `floorplan.json`, each with its camera): 0 desk, 1 window, 2 space prints, 3 books
and armchair, 4 kitchen nook, 5 darkroom prints, 6 posters and lava lamp, 7 record player.

Units are metres, +Y up. Every material is `KHR_materials_unlit` with the baked light as its base colour, already
tone-mapped (AgX, exposure 2.45, the same as the stills), so the site shows it with no tone mapping and sRGB output.
The atlas materials are `room_desk`, `room_art`, `room_props` and `room_env` (with `wall_back` and `wall_left` on the
env atlas); `room_props_leaves` (the mango plant's soil and branches) and `plant_sway` are double-sided.

The art scheme: the light on the picture is baked on white paper, so the site can draw art × light: put the runtime
art in `map` (TEXCOORD_0, 0–1 over the picture), move the baked texture to `lightMap` (GLTFLoader already gives it
channel 1) and set `lightMapIntensity` to π.

`public/room/atlases.json` lists, per atlas, the glb materials that sample it, its first-frame copy (`low`: the image
inside room.glb, 1024 px, bytes) and its full file (`full`: `atlas/<name>.ktx2|avif`, 4096 px, bytes, format), for the
site to stream in after the first frame. `public/room/floorplan.json` holds `voidColor`, the `corner` (the two walls as
one polyline), the floor's solid `outline` and its `fadeOutline`, `walls`, `windows`, `furniture` (labelled
footprints), `stops` (id, label, camera node, position), the `orbit` and the `probe`, in glTF world X and Z (metres).

## Lights

Each light has a source in the set: the desk lamp (tungsten, about 2700 K, its shadows softened to the shade's mouth),
daylight through the window (a camera-invisible emissive card behind it and a pane-sized soft area light; both
cities are by day), the brass picture light over the posters, the darkroom's brass strip light over the strings, the
lava lamp's glow on the posters, the kitchen pendant and the light bar under the kitchen shelf, the oven's elements, the
CRT glass, the brass picture light over the desk wall (the pennant, the Voyager record and the Pale Blue Dot), and the
paper lantern beside the record cabinet (kept below the desk lamp and the CRT). There is no ceiling
light and no ceiling: light falls off into the void. The view has its own day lights (sun and sky) in
`window_lights`, switched on only while its halves bake. The suns do not light the bay water (light linking,
`window_view.keep_suns_off_water`): the view bakes without the room's wall, so the sun made the water behind the window
white.

## Budget

See `public/room/atlases.json` and the export's byte report (`blender/.cache/export/bytes.json`) for the current
sizes. The props' prop files keep their full detail, and `build_room.py` decimates the densest ones for the set only
(`DECIMATE`). The view keeps only faces some framing, or a glide the site makes, can see through the window.
Credits for every downloaded model, texture, HDRI and font are in `ASSETS.md`.
