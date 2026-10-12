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

## Images

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| The Odyssey poster (twelve axe heads, one arrow) | framed poster on the room wall (baked texture); typographic design, no studio art | blender/posters/the-odyssey-2026.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | none |
| La La Land poster (a street lamp on the hill at magic hour) | framed poster on the room wall (baked texture); typographic design, no studio art | blender/posters/la-la-land.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | none |
| Chungking Express poster (a tin of pineapple stamped 1 May) | framed poster on the room wall (baked texture); typographic design, no studio art | blender/posters/chungking-express.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | none |
| Marty Supreme poster (a pimpled hardbat, the ball and the net) | framed poster on the room wall (baked texture); typographic design, no studio art | blender/posters/marty-supreme.svg, drawn by scripts/posters/ | Saahil Sanganeriya (made for this site) | own work | none |
| SaahilOS pixel icons (14 icons on 16 x 16 and 8 x 7 grids, in src/os/assets/icons.ts) | SaahilOS desktop, Start menu, taskbar and window controls | none (drawn in code) | Saahil Sanganeriya (made for this site) | own work | none |

## Fonts

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| Newsreader (variable, optical sizes) | headings and essays on the plain pages | https://github.com/productiontype/Newsreader | The Newsreader Project Authors (Production Type) | SIL OFL 1.1 | none; self-hosted WOFF2 subsets from Fontsource (@fontsource-variable/newsreader 5.3.0) |
| IBM Plex Sans | interface text: navigation, dates, notes | https://github.com/IBM/plex | IBM Corp. | SIL OFL 1.1 | none; self-hosted WOFF2 subsets from Fontsource (@fontsource/ibm-plex-sans 5.3.0) |
| IBM Plex Mono | code | https://github.com/IBM/plex | IBM Corp. | SIL OFL 1.1 | none; self-hosted WOFF2 subsets from Fontsource (@fontsource/ibm-plex-mono 5.3.0) |
| League Gothic | titles on the four room posters | https://github.com/theleagueof/league-gothic | The League Gothic Project Authors (The League of Moveable Type) | SIL OFL 1.1 | outlined to SVG paths in the poster files (@fontsource-variable/league-gothic 5.3.0, default width) |
| Newsreader (italic and roman) | credit lines on the four room posters | https://github.com/productiontype/Newsreader | The Newsreader Project Authors (Production Type) | SIL OFL 1.1 | outlined to SVG paths in the poster files (@fontsource-variable/newsreader 5.3.0) |
| IBM Plex Mono SemiBold | the expiry stamp on the Chungking Express poster | https://github.com/IBM/plex | IBM Corp. | SIL OFL 1.1 | outlined to SVG paths in the poster file (@fontsource/ibm-plex-mono 5.3.0) |
| Pixel Operator (Regular, Bold) | SaahilOS window chrome, icons and menus | https://www.dafont.com/pixel-operator.font | Jayvee Enaguas (HarvettFox96) | CC0 1.0 | subset to Latin and Latin-1, converted to WOFF2 (version 2018.10.04) |

## Audio

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|

## Code

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| portfolio-website | room scene structure (camera framings, CSS3D monitor, audio model) | https://github.com/henryjeff/portfolio-website | Henry Heffernan | MIT | ported to current three.js, heavily edited |
| portfolio-inner-site | SaahilOS structure (desktop, windows, taskbar) | https://github.com/henryjeff/portfolio-inner-site | Henry Heffernan | used with permission | rebuilt in React 19, restyled, new apps |
| alanagoyal | ideas: window URLs, phone layout | https://github.com/alanagoyal/alanagoyal | Alana Goyal | MIT | ideas only |
