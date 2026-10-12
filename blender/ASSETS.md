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
| SaahilOS pixel icons (19 icons on 16 x 16, 13 x 7 and 8 x 7 grids, in src/os/assets/icons.ts; the Films clapperboard redrawn, and the oven, source, name card, camera and film-tile icons added in SaahilOS v2) | SaahilOS desktop, Start menu, taskbar and window controls | none (drawn in code) | Saahil Sanganeriya (made for this site) | own work | none |
| SaahilOS wallpaper (the room at dusk, graded to a film look) | SaahilOS desktop wallpaper | blender/renders/room_idle.png (blender/renders/window_view.png once it exists), graded by src/os/assets/wallpaper/build.mjs | Saahil Sanganeriya (made for this site) | own work | lifted blacks, warm highlights, halation, vignette and grain; 1600 x 1000 |
| samcell-napari screenshot | cover of the SAMCell project (SaahilOS and /projects/samcell) | https://github.com/saahilsanganeriya/samcell-napari/blob/main/docs/images/samcell-napari.jpg | Saahil Sanganeriya | MIT | resized to 1600 px wide |
| SAMCell paper, Figure 3 (the SAMCell pipeline) | figure in the SAMCell window in SaahilOS, credited in its caption | https://doi.org/10.1371/journal.pone.0319532.g003 | Dunnum VandeLoo et al., PLOS ONE (2025) | CC BY 4.0 | resized to 1600 px wide |
| Four-bay NAS render (`nas_4bay`) | cover of the projectionist project | blender/renders/props/nas_4bay.png | Saahil Sanganeriya (made for this site) | CC0 1.0 | flattened onto grey |
| swe-sim pipeline diagram | cover of the swe-sim project | https://github.com/saahilsanganeriya/swe-sim#readme | Saahil Sanganeriya | MIT | the README's nine Mermaid steps laid out on a three-by-three grid and typeset in IBM Plex Mono |
| travel-agent-gym episode diagram | cover of the travel-agent-gym project | https://github.com/saahilsanganeriya/travel-agent-gym#readme | Saahil Sanganeriya | MIT | the README's text diagram typeset in IBM Plex Mono, lines drawn |
| saahil-brain prompt and dream diagram | cover of the saahil-brain project | https://github.com/saahilsanganeriya/saahil-brain#readme | Saahil Sanganeriya | MIT | the README's text diagram typeset in IBM Plex Mono, lines drawn |
| projectionist architecture diagram | figure in the projectionist window in SaahilOS | https://github.com/saahilsanganeriya/projectionist#readme | Saahil Sanganeriya | MIT | the README's text diagram typeset in IBM Plex Mono, lines drawn |
| real_time_streaming pipeline diagram | cover of the real-time-streaming project | https://github.com/saahilsanganeriya/real_time_streaming#readme | Saahil Sanganeriya | own work (the repository has no licence file) | the README's text diagram typeset in IBM Plex Mono, lines drawn |
| referral-network flow example | cover of the referral-network project | https://github.com/saahilsanganeriya/referral-network#readme | Saahil Sanganeriya | MIT | the README's text diagram typeset in IBM Plex Mono, lines drawn |
| GraphML missingness heatmap | cover of the GraphML project | https://github.com/saahilsanganeriya/GraphML-imts/blob/main/Reports/eda_results/missingness_heatmap.png | Saahil Sanganeriya | own work (the repository has no licence file) | resized to 1600 px wide |
| Fireball start screen | cover of the Fireball project | https://github.com/saahilsanganeriya/Fireball-GBAGame/blob/main/images/start.png | Saahil Sanganeriya | MIT | scaled 5x with nearest-neighbour sampling |
| Lodhi Garden road, New Delhi | story reel, chapter 1 background | https://unsplash.com/photos/a-street-with-a-sign-on-the-side-of-it-p1YOV49anMQ | Siddharth Sabron | Unsplash License | resized to 2000 px wide; toned, faded and grained on the page |
| Ring-spinning hall, Vazhani, Kerala | story reel, chapter 2 background | https://unsplash.com/photos/a-large-room-with-rows-of-machines-and-spools-of-thread-pM2kkL8Vu9E | Prince Prabhakaran | Unsplash License | resized to 1600 px wide; toned, faded and grained on the page |
| Plane window at sunset | story reel, chapter 3 background (stand-in for the owner's own "first day in the US" photo) | https://unsplash.com/photos/airplane-window-view-of-white-clouds-during-daytime-1dCiPJpAWEE | Saman Tsang | Unsplash License | resized to 1600 px wide; toned, faded and grained on the page |
| Tech Tower at night, Georgia Tech | story reel, chapter 4 background | https://unsplash.com/photos/a-clock-tower-with-a-neon-sign-on-top-of-it-slr9Z9kMmPY | Sid Suratia | Unsplash License | drone light trail above the spire removed; resized to 2000 px wide; toned, faded and grained on the page |
| Desk lamp at night | story reel, chapter 5 background | https://unsplash.com/photos/lit-desk-lamp-on-top-of-desk-EH9f0TI5wco | JC Gellidon | Unsplash License | resized to 2000 px wide; toned, faded and grained on the page |
| Sapling on a windowsill | story reel, chapter 6 background and the closing frame | https://unsplash.com/photos/a-potted-plant-sitting-on-a-window-sill-vD7Mi0rDqMI | Peter Heymans | Unsplash License | resized to 1600 px wide; toned, faded and grained on the page |
| Portrait of Saahil Sanganeriya | story reel, closing frame; /about and /resume | the owner's professional headshot | Saahil Sanganeriya (his own photo) | used by the owner | resized to 640 px |
| Photographs from the 2019 photo blog "A Narrative in a Frame" (22, src/assets/photography/) | the photography collection: the SaahilOS exhibit and the room's wall prints | https://saahilsanganeriaphotography.wordpress.com/ | Saahil Sanganeriya (his own work) | all rights reserved by the owner | all metadata stripped; AVIF and WebP copies at 480, 960, 1600 px and the original size up to 2400 px |
| Photos of Saahil Sanganeriya (7, src/assets/me/) | beside the text on /about, in two chapters of The Thread, and for the SaahilOS opening window | the owner's own photos | Saahil Sanganeriya (his own photos) | all rights reserved by the owner | all metadata stripped; one cropped to remove a printed caption; AVIF and WebP copies at 480 to 2400 px; toned like film on the page |

## Fonts

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| Newsreader (variable, optical sizes) | headings and essays on the plain pages; the projector reel's intertitle cards | https://github.com/productiontype/Newsreader | The Newsreader Project Authors (Production Type) | SIL OFL 1.1 | none; self-hosted WOFF2 subsets from Fontsource (@fontsource-variable/newsreader 5.3.0) |
| IBM Plex Sans | interface text: navigation, dates, notes | https://github.com/IBM/plex | IBM Corp. | SIL OFL 1.1 | none; self-hosted WOFF2 subsets from Fontsource (@fontsource/ibm-plex-sans 5.3.0) |
| IBM Plex Mono | code | https://github.com/IBM/plex | IBM Corp. | SIL OFL 1.1 | none; self-hosted WOFF2 subsets from Fontsource (@fontsource/ibm-plex-mono 5.3.0) |
| League Gothic | titles on the room posters, hand-drawn and drawn at runtime | https://github.com/theleagueof/league-gothic | The League Gothic Project Authors (The League of Moveable Type) | SIL OFL 1.1 | outlined to SVG paths in the poster files, and to the glyph table src/lib/poster-glyphs.ts for runtime posters (@fontsource-variable/league-gothic 5.3.0, default width) |
| Newsreader (italic and roman) | credit lines on the room posters, hand-drawn and drawn at runtime | https://github.com/productiontype/Newsreader | The Newsreader Project Authors (Production Type) | SIL OFL 1.1 | outlined to SVG paths in the poster files, and to the glyph table src/lib/poster-glyphs.ts for runtime posters (@fontsource-variable/newsreader 5.3.0) |
| IBM Plex Mono SemiBold | the expiry stamp on the Chungking Express poster | https://github.com/IBM/plex | IBM Corp. | SIL OFL 1.1 | outlined to SVG paths in the poster file (@fontsource/ibm-plex-mono 5.3.0) |
| Pixel Operator (Regular, Bold) | SaahilOS window chrome, icons and menus | https://www.dafont.com/pixel-operator.font | Jayvee Enaguas (HarvettFox96) | CC0 1.0 | subset to Latin and Latin-1, converted to WOFF2 (version 2018.10.04) |

## Audio

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| Room tone (`public/room/audio/atmosphere.webm`, `.m4a`) | the room's quiet ambience on the home page, muffled as the camera nears the monitor | https://github.com/henryjeff/portfolio-website/blob/c53c5a50183655eb83d70048403a5084f5d1214c/static/audio/atmosphere/office.ogg | Henry Heffernan | MIT, used with his permission | mono, low-passed at 11 kHz, loudness-normalised to −23 LUFS, a 15.8 s loop with a 1.5 s crossfade (scripts/media/build-audio.mjs); Opus 32 kbit/s, AAC 48 kbit/s copy |
| Computer running (`computer.webm`, `.m4a`) | the computer's hum, clearer near the desk | https://github.com/henryjeff/portfolio-website/blob/c53c5a50183655eb83d70048403a5084f5d1214c/static/audio/computer/idle.wav | Henry Heffernan | MIT, used with his permission | as the room tone; a 13.8 s loop |
| Computer startup (`startup.webm`, `.m4a`) | the sound at START | https://github.com/henryjeff/portfolio-website/blob/c53c5a50183655eb83d70048403a5084f5d1214c/static/audio/startup/startup.mp3 | Henry Heffernan | MIT, used with his permission | mono, low-passed at 11 kHz, loudness-normalised to −23 LUFS, cut to 9 s with a 1.5 s fade-out |
| Key clicks (`key-1` … `key-6`) | typing in SaahilOS on the monitor | https://github.com/henryjeff/portfolio-website/tree/c53c5a50183655eb83d70048403a5084f5d1214c/static/audio/keyboard | Henry Heffernan | MIT, used with his permission | mono, low-passed at 11 kHz, silence trimmed, recorded level kept; Opus 48 kbit/s, AAC 64 kbit/s copy |
| Mouse button (`mouse-down`, `mouse-up`) | clicking in SaahilOS on the monitor | https://github.com/henryjeff/portfolio-website/tree/c53c5a50183655eb83d70048403a5084f5d1214c/static/audio/mouse | Henry Heffernan | MIT, used with his permission | as the key clicks |
| 8mm projector sound (`projector.webm`, `.m4a`) | the projector, heard up close or while Films is the front window | https://freesound.org/people/videofueralle/sounds/241886/ | videofueralle (Freesound) | CC0 1.0 | from the sound page's high-quality preview (Ogg Vorbis, 48 kHz); mono, low-passed at 11 kHz, loudness-normalised to −23 LUFS, an 11.9 s loop from 0:40 with a 1 s crossfade |

## Video

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| The Arrival of a Train (L’Arrivée d’un train en gare de La Ciotat), 1895 | 12 s of the projector's reel (`public/room/reel.mp4`) | https://commons.wikimedia.org/wiki/File:Arrival_of_a_Train_at_La_Ciotat_%28The_Lumi%C3%A8re_Brothers%2C_1895%29.webm | Auguste and Louis Lumière | public domain: published 1895, so public domain in the US; the authors died in 1948 and 1954 (Commons: PD-old-70-expired) | 0:04–0:16, cropped to 4:3, 320 × 240, 18 fps, grey, denoised, levels normalised, silent; H.264 (scripts/media/build-reel.mjs) |
| Workers Leaving the Lumière Factory (La Sortie de l’usine Lumière à Lyon, first version), 1895 | 10 s of the projector's reel | https://commons.wikimedia.org/wiki/File:La_Sortie_de_l%27Usine_Lumi%C3%A8re_%C3%A0_Lyon_I_1895.webm | Louis Lumière | public domain: published 1895 (Commons: PD-1923, US) and the author died in 1948 (Commons: PD-France) | from Commons' 480p transcode, 0:01–0:11, then as above |
| A Trip to the Moon (Le Voyage dans la Lune), 1902 | 13 s of the projector's reel: the rocket lands in the Moon's eye | https://commons.wikimedia.org/wiki/File:Le_Voyage_dans_la_Lune_%281902%29.webm | Georges Méliès | public domain: published 1902, so public domain in the US; the author died in 1938 (Commons: PD-old-auto-expired) | from Commons' 480p transcode, 6:04–6:17, then as above |
| Intertitle cards (now showing, clip titles, also lately) | the reel's cards between the clips; two show the newest films in the owner's Letterboxd diary | none (drawn at runtime by src/scene/Application/Reel.ts) | Saahil Sanganeriya (made for this site) | own work | — |

## Code

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| ENABLE word list, five-letter words only (src/os/apps/game/guesses.ts) | Daily word in SaahilOS: which guesses count as words | https://github.com/dolph/dictionary/blob/master/enable1.txt | Alan Beale and M. Cooper | public domain | its five-letter words without the four the site's trace scan rules out, plus the game's 21 answers that are not in it (DELHI, QUTUB, CHAAT …), sorted into one string |
| portfolio-website | room scene structure (camera framings, CSS3D monitor, audio model) | https://github.com/henryjeff/portfolio-website | Henry Heffernan | MIT | ported to current three.js, heavily edited |
| portfolio-inner-site | SaahilOS structure (desktop, windows, taskbar) | https://github.com/henryjeff/portfolio-inner-site | Henry Heffernan | used with permission | rebuilt in React 19, restyled, new apps |
| alanagoyal | ideas: window URLs, phone layout | https://github.com/alanagoyal/alanagoyal | Alana Goyal | MIT | ideas only |
| three.js r186 | 3D rendering, glTF loading, the CSS3D monitor | https://github.com/mrdoob/three.js | three.js authors | MIT | npm dependency, unmodified |
| meshoptimizer decoder (meshopt_decoder.module.js, shipped with three.js) | decoding the room's compressed geometry | https://github.com/zeux/meshoptimizer | Arseny Kapoulkine | MIT | bundled unmodified |
| Basis Universal transcoder (basis_transcoder.js and .wasm, shipped with three.js) | decoding the room's KTX2 textures | https://github.com/BinomialLLC/basis_universal | Binomial LLC | Apache 2.0 | copied unmodified to public/room/basis/ |
| Hash without Sine (hash12, hash13) | film grain, CRT noise, the projector beam's air and the reel's grain, flicker and gate weave in the room's shaders | https://www.shadertoy.com/view/4djSRW | Dave Hoskins | MIT | two functions, copied into the shaders |
