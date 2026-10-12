# Assets and licences

Every third-party file the site ships, or that the room bake uses, has a row here. Hand-made assets are listed too.
The `/credits` page and the SaahilOS Credits app render this file.

The site is based on Henry Heffernan's portfolio (portfolio-website, MIT; portfolio-inner-site, used with his
permission), heavily edited. Ideas from Alana Goyal's site (MIT). See NOTICE.

## 3D models

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| Projector Screen (`projector_screen`) | prop `projector_screen` (tripod screen) | https://polyhaven.com/a/projector_screen | PeterM (Poly Haven) | CC0 1.0 | fabric split into its own object, turned to face −Y, origin moved to the base, centre empty added |
| Filmstrip Projector 8mm (`filmstrip_projector_8mm`) | prop `projector_8mm` (Super 8 projector, two reels) | https://polyhaven.com/a/filmstrip_projector_8mm | PeterM (Poly Haven) | CC0 1.0 | mains cable and plug removed, parts decimated from 27.1k to 13.9k triangles, reels split out, red reel muted to oxide red, lens empty added |
| Poster frame (`poster_frame`) | prop `poster_frame` (40 × 60 cm print, walnut moulding, glass) | blender/scripts/props_poster_frame.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | — |
| Planter Pot Clay (`planter_pot_clay`) | pot of prop `mango_plant` | https://polyhaven.com/a/planter_pot_clay | Amal Kumar (Poly Haven) | CC0 1.0 | scaled to 72 % (a 19 cm pot), origin moved to the base |
| Mango seedling (`mango_plant_leaves`) | prop `mango_plant` (stone, stem, leaves, soil) | blender/scripts/props_mango_plant.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | — |
| Four-bay NAS (`nas_4bay`) | prop `nas_4bay` with `nas_led_0..3` | blender/scripts/props_nas_4bay.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | unbranded; label text set in Blender's built-in font, Inter (SIL OFL 1.1) |
| Book stack (`books_stack`) | prop `books_stack` | blender/scripts/props_books_stack.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | — |
| Film canisters (`film_canister_a/_b/_c`) | prop `film_canister` | blender/scripts/props_film_canister.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | — |
| Silver rangefinder-style camera (`fujifilm_x100`) | prop `fujifilm_x100` | blender/scripts/props_fujifilm_x100.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | lettering set in Blender's built-in font, Inter (SIL OFL 1.1), not the maker's logo |
| Black SLR-style digital camera (`fujifilm_xt`) | prop `fujifilm_xt` | blender/scripts/props_fujifilm_xt.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | lettering set in Blender's built-in font, Inter (SIL OFL 1.1), not the maker's logo |
| 1970s film SLR (`fujica_st`) | prop `fujica_st` | blender/scripts/props_fujica_st.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | lettering set in Blender's built-in font, Inter (SIL OFL 1.1), not the maker's logo |
| Super 8 cine camera (`super8_camera`) | prop `super8_camera` | blender/scripts/props_super8_camera.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | unbranded; "SUPER 8" set in Blender's built-in font, Inter (SIL OFL 1.1) |
| Desk, chair, computer, CRT, keyboard, mouse, cables, mug, papers, letter tray (`environment.glb`, `computer_setup.glb`, `decor.glb`) | room desk group (`desk_*` in `public/room/room.glb`) | https://github.com/henryjeff/portfolio-website/tree/b49482d6da1133cac0c7291a06dbedf89cb3a15f/static/models | Henry Heffernan | MIT | geometry only: rescaled to metres (0.26 m per unit), every material rebuilt, relit and rebaked; his baked textures, backdrop, floor plant and binders not used |
| The room: walls, floor, window and curtains, radiator, shelf, picture and shelf lights, desk lamp, rug, side table, CRT glass | `blender/room.blend`, `public/room/room.glb` | blender/scripts/build_room.py | Saahil Sanganeriya (made for this site) | CC0 1.0 | — |

## Textures and HDRIs

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| Wood 051 | walnut moulding of `poster_frame` | https://ambientcg.com/view?id=Wood051 | ambientCG (Lennart Demes) | CC0 1.0 | 1K colour, roughness and height maps, tinted warmer |
| Paper 001 | paper grain on poster prints and book pages | https://ambientcg.com/view?id=Paper001 | ambientCG (Lennart Demes) | CC0 1.0 | 1K height map as bump |
| Fingerprints 002 | fingerprints on glass, chrome and glossy plastic | https://ambientcg.com/view?id=Fingerprints002 | ambientCG (Lennart Demes) | CC0 1.0 | 1K roughness map as a roughness overlay |
| Surface Imperfections 003 | fine scratches and smears on metal and glass | https://ambientcg.com/view?id=SurfaceImperfections003 | ambientCG (Lennart Demes) | CC0 1.0 | 1K map as a roughness overlay |
| Plastic 012 B | black plastic shell of `nas_4bay` | https://ambientcg.com/view?id=Plastic012B | ambientCG (Lennart Demes) | CC0 1.0 | 1K roughness map, box-projected |
| Fabric 036 | book cloth of `books_stack` | https://ambientcg.com/view?id=Fabric036 | ambientCG (Lennart Demes) | CC0 1.0 | 1K colour and height maps, tinted per book |
| Leather 026 | camera leatherette | https://ambientcg.com/view?id=Leather026 | ambientCG (Lennart Demes) | CC0 1.0 | 1K height and roughness maps, box-projected |
| Metal 009 | satin aluminium of the camera plates | https://ambientcg.com/view?id=Metal009 | ambientCG (Lennart Demes) | CC0 1.0 | 1K roughness map, box-projected |
| Studio Small 09 (HDRI) | lighting of the prop review renders in `blender/renders/props/` only; not shipped, not in the bake | https://polyhaven.com/a/studio_small_09 | Sergej Majboroda (Poly Haven) | CC0 1.0 | 1K, rotated |
| Joburg Central Sunset (`sunset_jhbcentral`, 4K HDR) | the city at dusk through the room's window, and the window's light in the bake | https://polyhaven.com/a/sunset_jhbcentral | Dimitrios Savva (photography), Greg Zaal (processing) | CC0 1.0 | shown on a card outside the window, turned −14°; baked into the room atlas |
| Black Walnut Veneer 02 | walnut desk, shelf, skirting, dado rail, sill, letter tray, side table | https://polyhaven.com/a/black_walnut_veneer_02 | Jenelle van Heerden | CC0 1.0 | 2K colour and roughness, darkened and tinted; baked into the room atlases |
| Old Wooden Floor 03 | floorboards | https://polyhaven.com/a/old_wooden_floor_03 | Charlotte Baglioni (scanning), Jenelle van Heerden (processing) | CC0 1.0 | 2K colour and roughness, darkened; baked |
| Plastered Wall 04 | texture under the teal wall paint | https://polyhaven.com/a/plastered_wall_04 | Rob Tuytel | CC0 1.0 | 2K colour as a value map for the paint and its bump; baked |
| Fabric Leather 02 | chair seat | https://polyhaven.com/a/fabric_leather_02 | Rob Tuytel | CC0 1.0 | 2K colour and roughness, tinted toward oxblood; baked |
| Poly Wool Herringbone | rug weave | https://polyhaven.com/a/poly_wool_herringbone | colormass (photography), Rico Cilliers (processing) | CC0 1.0 | 2K colour as a value map, recoloured oxblood with a plain border; baked |

## Images

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| The Odyssey poster (twelve axe heads, one arrow) | former room poster (retired from the room on 2026-10-12, when the posters became the Letterboxd favourites; kept for the Films app); typographic design, no studio art | blender/posters/the-odyssey-2026.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | none |
| La La Land poster (a street lamp on the hill at magic hour) | room poster, one of the four Letterboxd favourites (src/content/favorites.json); typographic design, no studio art | blender/posters/la-la-land.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | runtime copies resized to public/room/posters/la-la-land.avif (683 × 1024) and .ktx2 (512 × 768) |
| Yi Yi poster (a Taipei apartment block at night; two warm windows spell 一一) | room poster, one of the four Letterboxd favourites (src/content/favorites.json); typographic design, no studio art | blender/posters/yi-yi.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | runtime copies resized to public/room/posters/yi-yi.avif (683 × 1024) and .ktx2 (512 × 768) |
| Normal People poster (a silver chain in a loop that does not close) | room poster, one of the four Letterboxd favourites (src/content/favorites.json); typographic design, no studio art | blender/posters/normal-people-2020.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | runtime copies resized to public/room/posters/normal-people-2020.avif (683 × 1024) and .ktx2 (512 × 768) |
| Black Swan poster (a swan feather, white at the quill and black at the tip) | room poster, one of the four Letterboxd favourites (src/content/favorites.json); typographic design, no studio art | blender/posters/black-swan.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | runtime copies resized to public/room/posters/black-swan.avif (683 × 1024) and .ktx2 (512 × 768) |
| Typographic posters drawn at runtime (the year, the title and the credit) | room poster for a favourite with no hand-drawn art | src/lib/posters.ts (`renderPoster`) | Saahil Sanganeriya (made for this site) | own work | none |
| Chungking Express poster (a tin of pineapple stamped 1 May) | former room poster (retired from the room on 2026-10-12, when the posters became the Letterboxd favourites; kept for the Films app); typographic design, no studio art | blender/posters/chungking-express.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | none |
| Marty Supreme poster (a pimpled hardbat, the ball and the net) | former room poster (retired from the room on 2026-10-12, when the posters became the Letterboxd favourites; kept for the Films app); typographic design, no studio art | blender/posters/marty-supreme.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | none |
| SaahilOS pixel icons (14 icons on 16 x 16 and 8 x 7 grids, in src/os/assets/icons.ts) | SaahilOS desktop, Start menu, taskbar and window controls | none (drawn in code) | Saahil Sanganeriya (made for this site) | own work | none |
| Lodhi Garden road, New Delhi | story reel, chapter 1 background | https://unsplash.com/photos/a-street-with-a-sign-on-the-side-of-it-p1YOV49anMQ | Siddharth Sabron | Unsplash License | resized to 2000 px wide; toned, faded and grained on the page |
| Ring-spinning hall, Vazhani, Kerala | story reel, chapter 2 background | https://unsplash.com/photos/a-large-room-with-rows-of-machines-and-spools-of-thread-pM2kkL8Vu9E | Prince Prabhakaran | Unsplash License | resized to 1600 px wide; toned, faded and grained on the page |
| Plane window at sunset | story reel, chapter 3 background (stand-in for the owner's own "first day in the US" photo) | https://unsplash.com/photos/airplane-window-view-of-white-clouds-during-daytime-1dCiPJpAWEE | Saman Tsang | Unsplash License | resized to 1600 px wide; toned, faded and grained on the page |
| Tech Tower at night, Georgia Tech | story reel, chapter 4 background | https://unsplash.com/photos/a-clock-tower-with-a-neon-sign-on-top-of-it-slr9Z9kMmPY | Sid Suratia | Unsplash License | drone light trail above the spire removed; resized to 2000 px wide; toned, faded and grained on the page |
| Desk lamp at night | story reel, chapter 5 background | https://unsplash.com/photos/lit-desk-lamp-on-top-of-desk-EH9f0TI5wco | JC Gellidon | Unsplash License | resized to 2000 px wide; toned, faded and grained on the page |
| Sapling on a windowsill | story reel, chapter 6 background and the closing frame | https://unsplash.com/photos/a-potted-plant-sitting-on-a-window-sill-vD7Mi0rDqMI | Peter Heymans | Unsplash License | resized to 1600 px wide; toned, faded and grained on the page |
| Portrait of Saahil Sanganeriya | story reel, closing frame; /about and /resume | the owner's professional headshot | Saahil Sanganeriya (his own photo) | used by the owner | resized to 640 px |

## Fonts

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| Newsreader (variable, optical sizes) | headings and essays on the plain pages | https://github.com/productiontype/Newsreader | The Newsreader Project Authors (Production Type) | SIL OFL 1.1 | none; self-hosted WOFF2 subsets from Fontsource (@fontsource-variable/newsreader 5.3.0) |
| IBM Plex Sans | interface text: navigation, dates, notes | https://github.com/IBM/plex | IBM Corp. | SIL OFL 1.1 | none; self-hosted WOFF2 subsets from Fontsource (@fontsource/ibm-plex-sans 5.3.0) |
| IBM Plex Mono | code | https://github.com/IBM/plex | IBM Corp. | SIL OFL 1.1 | none; self-hosted WOFF2 subsets from Fontsource (@fontsource/ibm-plex-mono 5.3.0) |
| League Gothic | titles on the room posters, hand-drawn and drawn at runtime | https://github.com/theleagueof/league-gothic | The League Gothic Project Authors (The League of Moveable Type) | SIL OFL 1.1 | outlined to SVG paths in the poster files, and to the glyph table src/lib/poster-glyphs.ts for runtime posters (@fontsource-variable/league-gothic 5.3.0, default width) |
| Newsreader (italic and roman) | credit lines on the room posters, hand-drawn and drawn at runtime | https://github.com/productiontype/Newsreader | The Newsreader Project Authors (Production Type) | SIL OFL 1.1 | outlined to SVG paths in the poster files, and to the glyph table src/lib/poster-glyphs.ts for runtime posters (@fontsource-variable/newsreader 5.3.0) |
| IBM Plex Mono SemiBold | the expiry stamp on the Chungking Express poster | https://github.com/IBM/plex | IBM Corp. | SIL OFL 1.1 | outlined to SVG paths in the poster file (@fontsource/ibm-plex-mono 5.3.0) |
| Pixel Operator (Regular, Bold) | SaahilOS window chrome, icons and menus | https://www.dafont.com/pixel-operator.font | Jayvee Enaguas (HarvettFox96) | CC0 1.0 | subset to Latin and Latin-1, converted to WOFF2 (version 2018.10.04) |

## Audio

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| Room sound: CRT mains hum and 15.7 kHz line whine, projector motor and shutter, room tone, key and mouse clicks, CRT power-on | the room on the home page | none: synthesised in the browser by src/scene/Application/Audio.ts | Saahil Sanganeriya (made for this site) | original | procedural WebAudio, no recordings; pink noise uses Paul Kellet's published economy filter |

## Code

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| portfolio-website | room scene structure (camera framings, CSS3D monitor, audio model) | https://github.com/henryjeff/portfolio-website | Henry Heffernan | MIT | ported to current three.js, heavily edited |
| portfolio-inner-site | SaahilOS structure (desktop, windows, taskbar) | https://github.com/henryjeff/portfolio-inner-site | Henry Heffernan | used with permission | rebuilt in React 19, restyled, new apps |
| alanagoyal | ideas: window URLs, phone layout | https://github.com/alanagoyal/alanagoyal | Alana Goyal | MIT | ideas only |
| three.js r186 | 3D rendering, glTF loading, the CSS3D monitor | https://github.com/mrdoob/three.js | three.js authors | MIT | npm dependency, unmodified |
| meshoptimizer decoder (meshopt_decoder.module.js, shipped with three.js) | decoding the room's compressed geometry | https://github.com/zeux/meshoptimizer | Arseny Kapoulkine | MIT | bundled unmodified |
| Basis Universal transcoder (basis_transcoder.js and .wasm, shipped with three.js) | decoding the room's KTX2 textures | https://github.com/BinomialLLC/basis_universal | Binomial LLC | Apache 2.0 | copied unmodified to public/room/basis/ |
| Hash without Sine (hash12, hash13) | film grain, CRT noise and the projector beam's air in the room's shaders | https://www.shadertoy.com/view/4djSRW | Dave Hoskins | MIT | two functions, copied into the shaders |
