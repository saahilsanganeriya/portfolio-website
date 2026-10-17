# portfolio-website

Saahil Sanganeriya's personal site, at https://saahilsanganeriya.com. On a desktop, it opens on a vintage room built in
Blender: the camera glides to the desk and into the CRT, which runs SaahilOS, a small retro desktop, with About open.
"Take the tour" shows a map of the room and visits its stops. Every post, project and app has its own address, and
opening one loads the room straight at the monitor with that window open; there are no plain pages. Phones get the room at a lighter tier; a browser without
WebGL gets SaahilOS on a drawn monitor. The site is built with Astro, MDX content collections, React (SaahilOS) and
three.js (the room), and deploys to Vercel.

Based on Henry Heffernan's portfolio, heavily edited. Ideas from Alana Goyal's site. See [Credits](#credits).

## Run it

Node 22.12 or later.

```sh
npm install
npm run dev        # http://localhost:4321
```

### Preview on the devbox

The devbox keeps a dev server of `main` running at `127.0.0.1:4321` (systemd user unit
`personal-website-preview.service`). To see it from a laptop, open a tunnel and keep it running:

```sh
ssh -N -L 4321:127.0.0.1:4321 saahil-devbox
```

Then open http://localhost:4321.

## Add a post in one step

Create `src/content/blog/<slug>.mdx` with this frontmatter and commit. The file name is the address: `/blog/<slug>`
opens the post in its own window on the monitor, and the post joins the Writing window and `/rss.xml`.

```mdx
---
title: The title of the post
date: 2026-10-12          # the day it is first published; never backdate
summary: One or two sentences for the post list, RSS and link previews.
tags: [film]
draft: false              # true: shows in `npm run dev` only
# film:                   # only for a film review
#   title: La La Land
#   year: 2016
#   rating: 5             # 0.5 to 5, in halves
#   letterboxd: https://letterboxd.com/saahilsan/film/la-la-land/
---

The post, in Markdown. An `<aside>` becomes a sidenote in the margin.
```


## Add a project

Create `src/content/projects/<slug>.mdx`. It appears in the Projects window, and `/projects/<slug>` opens it.

```mdx
---
title: An example project
summary: One line, 140 characters at most.
year: 2026
years: 2025–2026          # optional, shown instead of year
status: shipped           # shipped | research | archived
role: Designer and engineer
team: solo                # or "team of 4; I built the ingest service"
stack: [TypeScript, Astro]
featured: true            # featured projects come first, by `order`
order: 3
links:                    # each optional: repo, paper, demo, page, pypi
  repo: https://github.com/saahilsanganeriya/portfolio-website
# cover: ../../assets/projects/example.jpg
# coverAlt: What the image shows.
---

The write-up.
```

## Add photos in one step

The set is photography only: what I shot on my film or digital camera and posted, with the camera line from the post
as the evidence. Put the photos in a folder (JPEG, PNG, WebP, AVIF or TIFF; export HEIC as JPEG first) and run:

```sh
npm run photos:ingest -- path/to/photos --year 2022    # --year optional
```

For each photo it applies the camera's rotation, strips every metadata block (EXIF with GPS location, XMP, IPTC, ICC),
writes AVIF and WebP copies at 480, 960 and 1600 px and the original size (up to 2400 px) on the long edge into
`src/assets/photography/<name>/`, and writes `src/content/photography/<name>.yaml`. The file name is the `<name>`.
Running it again skips photos already in, and never overwrites an entry, so edit the entries freely. The build refuses
an entry without its camera:

```yaml
file: "../../assets/photography/the-varsity/1200.webp"   # written by the script
title: "the varsity"
year: 2022                # the year it was taken; default: --year, else the photo's own capture year, else this year
place: "Atlanta"          # optional
caption: "The Varsity's glass doors at dusk, the red sign lit from inside."   # one line; it is also the alt text, so say what is in it
camera: "Canon A-1, 50mm f/1.4"   # camera and lens, as the post names them
film: "Kodak Gold 200"    # optional; none for digital
order: 8                  # the set's one order: the room's darkroom line (first = the hero clip) and SaahilOS
sharpie: "the varsity, atlanta · kodak gold 200"   # optional; written on the print's border in marker: place, then film or camera
date: "2022-02-05"        # optional; the day it was posted
igCaption: "-\nKodak gold 200\nCanon A-1, 50mm f/1.4"   # optional; my own Instagram caption, as posted
```

The room hangs the set on the darkroom lines in `order`, one print per clip, so keep about as many photographs as the
lines have clips (17 on set v4).

`src/content/photography/` is for photography only, never photos of me. Those go through `--me`:

```sh
npm run photos:ingest -- ~/photos/me --me
```

which writes the sizes into `src/assets/me/<name>/` and adds `{ "file": "<name>", "alt": "", "use": "about" }` to
`src/content/me.json`. Write the alt text before building: an empty alt fails the build. A photo of me appears only
where it is placed beside text, in an `.mdx` page with `<MePhoto file="<name>" side="right" />` (About has four).

## Update the favourite films (the posters) in one step

With a Letterboxd export unzipped, run `npm run favorites -- <export folder>` and commit `src/content/favorites.json`.

The posters in the room are the four favourite films on the Letterboxd profile, in profile order. They are also the
"Four favourites" at the top of the Films window. Letterboxd answers a request for a profile page with HTTP 403, and
the RSS feed does not include the favourites. So the source is the account export: its `profile.csv` has a "Favorite
Films" column with four `boxd.it` links. In full, after a change on Letterboxd:

1. Export the data (Letterboxd, Settings, Data, Export your data) and unzip it.
2. Run `npm run favorites -- <export folder>`. The script follows each `boxd.it` link to its film page (browser
   User-Agent, 10 s timeout, one request each 2 s, about 15 s in total) and writes `src/content/favorites.json`:
   `{ source, updated, films: [{ slug, title, year, director, poster }] }`. If a request fails, the file does not
   change and the script exits 1.
3. Commit `src/content/favorites.json`.

A favourite with hand-drawn art has `poster: "/room/posters/<slug>.avif"`. A `.ktx2` file with the same name is next
to it for three.js. A favourite without art has `poster: null`, and the room draws a typographic poster for it with
`renderPoster(film)` from `src/lib/posters.ts`. That function returns a self-contained SVG string (the text is in
outlines, so an `<img>` or a texture shows it without web fonts). To add hand-drawn art, add a design to
`scripts/posters/designs.mjs` with the film's slug as its id. Then run `npm run posters -- <slug>`,
`npm run posters:runtime -- <slug>` and `npm run favorites -- <export folder>`. The art for films that are no longer
favourites stays in `blender/posters/`.

## Add a book or a recipe

Books are one list, `src/content/books.json`, in shelf order: add `{ "title", "author", "year", "line" }` (the line is
one sentence in my voice). A recipe is one file, `src/content/recipes/<slug>.mdx`; copy `src/content/recipes/_template.mdx`
(fields in the table below) and commit. The bookshelf opens Books; the croissant in the oven opens the Kitchen.

## Refresh the Code window

SaahilOS's Code window reads a snapshot of the public repositories committed in `src/os/apps/code/snapshot/`, so it
shows what was pushed when the snapshot was taken. After pushing to any of them, run the `npm run repos` line in the
Scripts table below, scan the result as for any commit, and commit it.

## Content

| Collection | Files | Addresses (each opens its window on the monitor) |
|---|---|---|
| `projects` | `src/content/projects/<slug>.mdx` | `/projects`, `/projects/<slug>` |
| `blog` | `src/content/blog/<slug>.mdx` | `/blog`, `/blog/<slug>`, `/rss.xml` |
| `pages` | `src/content/pages/{about,resume}.mdx` | `/about`, `/resume` |
| `photography` | `src/content/photography/<name>.yaml` (`npm run photos:ingest`) | the photography exhibit (SaahilOS, the room) |
| `books` | `src/content/books.json`: `[{ title, author, year, line }]`, in shelf order | `/#books` (the bookshelf) |
| `recipes` | `src/content/recipes/<slug>.mdx`: `title, date, summary, yield, time, ingredients` (lines, or `{ group, items }`), optional `photo` + `photoAlt`; body `## Method`, `## Notes` | `/#recipes`, `/#recipes/<slug>` (the oven) |
| `voyager` | `src/content/voyager.mdx`: `title, summary`, then the text | `/#voyager` (the Golden Record) |

The schemas are in `src/content.config.ts`. Books, recipes and the Voyager page may be absent or empty; the build
passes and the window says so. Every entry is also served as static JSON at `/content/<collection>/<slug>.json`
(`{ data, html }`), which SaahilOS reader windows load; `/content/books.json`, `/content/recipes.json` and
`/content/credits.json` (from `blender/ASSETS.md`) hold the lists. The room's sticky notes are `src/content/sticky-notes.json`
(his own phrases, at most six), and the projector's film is `public/room/story-film.*` with its manifest in
`src/scene/reel.json`.

SaahilOS's Code window reads the owner's public GitHub repositories from a snapshot committed in
`src/os/apps/code/snapshot/` (README and Markdown files as GitHub renders them, the file tree, the last 30 commits),
and each file's text from raw.githubusercontent.com when it is opened. Links to github.com inside SaahilOS open that
window; links to the few sites that allow framing (`FRAMEABLE_HOSTS` in `src/os/routes.ts`) open its browser window;
every other link opens a new tab, so nothing takes the visitor out of the room.

Films come from the Letterboxd diary of `saahilsan`. The archive is the export in `src/data/letterboxd/` (diary,
ratings, reviews, watched; the Tags column is removed). `/api/films.json`, the only server route, merges the public RSS
feed over it per film and watched date, at most once an hour (Vercel ISR), at most one Letterboxd request per 2 s. When
the feed fails, it serves the archive and the last good copy. `src/content/films.json` is the same merge, written by
each build as the static fallback. Set `FILMS_PRIVATE_NAMES` (comma-separated, in Vercel) to drop the text of any live
review that names one of those people.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:4321. |
| `npm run build` | Writes `src/content/films.json` (archive + Letterboxd feed), then builds into `dist/` and `.vercel/output/`. |
| `npm run preview` | Serves the last build from `.vercel/output/`, `/api/films.json` included (`astro preview` does not support the Vercel adapter). |
| `npm run check` | Type-checks the project (`astro check`). |
| `npm run test:e2e` | Playwright tests in `tests/*.spec.ts`. They build with `SAMPLES=1` (draft posts included) and serve the build themselves. |
| `node scripts/check-routes.mjs` | Builds, then checks every address: each entry's page is the room opening its window, with its JSON body; no page exists beyond those, `/os` (framed inside the room) and `/404`; each page has a title, description, `og:title`, `og:image` and one `<h1>`; no internal link is broken; no built file except the résumé PDF holds an email address or a `mailto:` link (example domains pass). `--samples` includes draft posts. |
| `npm run photos:ingest -- <folder>` | Strips all metadata from the photos in a folder, writes AVIF and WebP sizes, and adds an entry per photo (see "Add photos in one step"). |
| `npm run films` | Writes `src/content/films.json`: the archive and the cached copy, with the Letterboxd feed merged over them. When the feed fails, it keeps the cached copy and exits 0. |
| `npm run posters [-- <slug> ...]` | Draws the hand-drawn posters into `blender/posters/` (SVG and 2048-px PNG). |
| `npm run posters:runtime [-- <slug> ...]` | Writes the runtime copies of the favourites' posters to `public/room/posters/` (AVIF 683×1024 and KTX2 512×768, 120 KB or less each). |
| `npm run favorites -- <export folder>` | Writes `src/content/favorites.json` from a Letterboxd export's `profile.csv`. |
| `GH_TOKEN=$(gh auth token --user saahilsanganeriya) REPOS_WITHHOLD='<pattern>' npm run repos [-- <repo> ...]` | Refreshes the Code window's snapshot of the public repositories (local only: it needs a token, and refuses to run on Vercel). Email addresses are removed; any file, doc or commit line matching `REPOS_WITHHOLD` (the trace-scan pattern and anything kept off the site, held outside this repo) is left out and counted. Commit the result. |
| `node scripts/posters/glyphs.mjs` | Writes `src/lib/poster-glyphs.ts`, the glyph outlines `renderPoster` uses. Run it again only when the fonts or the character sets change. |
| `node scripts/media/build-audio.mjs`, `node scripts/media/build-records.mjs` | Rebuild the room's sounds and the record crate from their recorded sources (listed in `blender/ASSETS.md`). |
| `npm run measure:payload`, `npm run measure:fps` | Measure the room's payload (the first room frame: everything until the room is interactive, budget 6,000,000 B; `-- --full` also waits for the streamed atlases and checks the full room, budget 25,000,000 B) and its frame rate in each framing with the full atlases loaded (2020-laptop profile; run it only when the machine's 1-minute load is under 16). |
| `node scripts/capture-crawl.mjs`, `node scripts/capture-sheet.mjs` | The crawl check and the side-by-side sheet against Henry's live site; see "Measure the render". |

## Measure the render

The room draws into a multisampled target (MSAA ×4) at up to 2 device pixels per CSS pixel, and the finishing pass
resolves it onto the canvas. The quality ladder (`src/scene/Application/Quality.ts`) starts at the top tier and steps
down only when the measured frame rate stays under 50 fps.

**Crawl check.** `node scripts/capture-crawl.mjs --out <dir> [--viewports 1440x900@1,1280x720@2] [--seconds 5]
[--video] [--variants file.json]` drives the room to the wide view with page time under the script's control
(Playwright's clock, `Math.random` seeded, the tier pinned), so two builds draw the same moments of the idle drift.
`WxH@d` is CSS pixels at a device pixel ratio: `1280x720@2` is a 2560×1440 frame. Four crops (the desk's front edge,
the monitor, the window frame, the wall art) are placed from the room's own anchors. Per crop, on luma 0–255:

| Number | Formula | Reads as |
|---|---|---|
| motion | mean \|Y(t) − Y(t−1)\| on edge pixels | how far the edges move (the drift itself) |
| crawl | mean \|Y(t+1) − 2·Y(t) + Y(t−1)\| / 2 on edge pixels | what does not move smoothly: an aliased edge stepping from pixel to pixel, grain, flicker. A clean edge drifting at an even speed scores about 0 |
| flat | the crawl formula on the other pixels | grain and flicker on flat surfaces |

Edge pixels are those whose gradient in the capture's mean image is at least 10 levels per pixel. Out come
`crawl.json`, the first frame, the crops, eight-frame strips of each crop (×3, nearest) and, with `--video`, an MP4.
A variants file maps names to render switches (below), one capture each.

**Texel density.** Add `?debug=texels` to any room address (or run `window.__roomDebug.texels(true)`): each baked
surface is drawn in the band of texels per screen pixel it gets, from the UV derivatives × the atlas size: red < 1
(the bake is magnified, soft), green 1–2, blue > 2. `window.__roomDebug.texelStats()` returns, per mesh, its pixels,
median, 10th percentile and share below 1.

**Side-by-side sheet.** `node scripts/capture-sheet.mjs --out <dir> [--label "ours (main)"]` screenshots our wide
and desk views and Henry Heffernan's live site (landing and monitor views) at the same viewports and composes a
labelled sheet with 1:1 crops of the desk edge, keyboard, monitor bezel and wall. `--gl swiftshader|egl|default`
picks Chromium's WebGL switches; the sheet records the renderer the page got (on the devbox, every mode is
SwiftShader).

**Switches and stats in the page.** `window.__roomDebug.set({ samples, dprCap, anisotropy, grade, bloom, vignette, halos,
motes })` overrides the tier for an A/B; `reset()` returns to it; `setClock(s)` sets the ambient
clock. `window.__roomStats` reports the streamed atlases (`skipped`, `done`, `atlases[]`) and the GPU memory the room
holds (`gpu`: each texture's size and format, render targets, total).

**Streamed atlases.** `room.glb` embeds a small first-frame set. Once the room is interactive, the runtime reads
`public/room/atlases.json` (`[{ name, materials[], low: {uri, px, bytes}, full: {uri, px, bytes, format}, hero? }]`),
loads each full atlas one at a time (`hero: true` first, then file order; KTX2 through the Basis transcoder, AVIF,
WebP or JPEG through `createImageBitmap`), uploads it, and swaps it in for every material and uniform that showed the
small one on the next frame; the small texture is then freed. Phones (the light tier) keep the first-frame set
(Save-Data visitors get the drawn monitor, never the 3D room). The clear colour behind the set is `voidColor` in
`public/room/floorplan.json`.

## Deploy

Vercel, through `@astrojs/vercel`. Every page is prerendered. A route that must run on request sets
`export const prerender = false`; Vercel then caches it with ISR for at most an hour.

The Vercel project (`portfolio-website`) is connected to this GitHub repository, but a push deploys only when it
publishes a new résumé: `scripts/vercel-ignore-build.sh` (the `ignoreCommand` in `vercel.json`) builds a push to `main`
only when its top commit changes `public/resume/`, and skips every other push. Deploy everything else by hand: from a
checkout, `npx vercel link --yes --project portfolio-website` once, then `npx vercel deploy --prod --yes`; Vercel runs
`npm run build` itself. Production answers on saahilsanganeriya.com, www.saahilsanganeriya.com and
portfolio-website-sandy-five-70.vercel.app.

### The résumé

The private repository `resume-builder` holds the résumé, as one YAML file. Do not edit the PDF here. A push to its
`main` publishes the PDF to this site:

```
resume-builder main ─► publish-resume workflow ─► commit public/resume/saahil-sanganeriya-resume.pdf to main
  (YAML changed)        render without the phone,          │
                        refuse a phone or a 2nd email      ▼
                                                 Vercel builds (public/resume/ changed) ─► production
```

`/resume.pdf` (`src/pages/resume.pdf.ts`) is the one link to share: the build copies the published PDF to it. The
Résumé window and the About window's Résumé button use it too.

## Design

Warm light in a dark room, and one thread. Colours: ink `#14110F` (background), walnut `#3B2A1E`, paper `#EDE4D3`
(text), dust `#A89F91` (secondary text), thread `#B4442C` (the one accent; never for text), projector `#9DB4C0` (the beam
and the CRT only). Type: Newsreader for headings and essays, IBM Plex Sans for the interface, IBM Plex Mono for code.
Reading windows have no effects over the text.

## Credits

Based on Henry Heffernan's portfolio, heavily edited: the room scene comes from
[portfolio-website](https://github.com/henryjeff/portfolio-website) (MIT) and SaahilOS from
[portfolio-inner-site](https://github.com/henryjeff/portfolio-inner-site) (used with his permission). Ideas from
[Alana Goyal's site](https://github.com/alanagoyal/alanagoyal) (MIT). The licence texts are in [NOTICE](NOTICE).
Every third-party asset, with its source and licence, is listed in [blender/ASSETS.md](blender/ASSETS.md) and on
`/credits`.
