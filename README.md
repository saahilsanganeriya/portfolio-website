# portfolio-website

Saahil Sanganeriya's personal site. On a desktop, it opens on a vintage room built in Blender; the CRT on the desk runs
SaahilOS, a small retro desktop. Every post and project also has a plain, fast page with its own URL. The site is built
with Astro, MDX content collections, React (SaahilOS) and three.js (the room), and deploys to Vercel.

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

Create `src/content/blog/<slug>.mdx` with this frontmatter and commit. The file name is the URL: `/blog/<slug>`.

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

Create `src/content/projects/<slug>.mdx`. It appears on `/projects` and at `/projects/<slug>`.

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

Put the photos in a folder (JPEG, PNG, WebP, AVIF or TIFF; export HEIC as JPEG first) and run:

```sh
npm run photos:ingest -- path/to/photos --series 2019 --year 2019    # both optional
```

For each photo it applies the camera's rotation, strips every metadata block (EXIF with GPS location, XMP, IPTC, ICC),
writes AVIF and WebP copies at 480, 960 and 1600 px and the original size (up to 2400 px) on the long edge into
`src/assets/photography/<name>/`, and writes `src/content/photography/<name>.yaml`. The file name is the `<name>`.
Running it again skips photos already in, and never overwrites an entry, so edit the entries freely:

```yaml
file: "../../assets/photography/amer-fort/2400.webp"   # written by the script
title: "amer fort"
year: 2019                # default: --year, else the photo's own capture year, else this year
place: "Amer Fort"        # optional
series: "2019"            # default: --series, else the year; name a series by year, place or what the photos share
caption: "Amer Fort beyond a wall, in black and white."   # one line; it is also the alt text, so say what is in it
featured: false           # the favourites
onWall: false             # framed on the wall of the room
order: 20                 # optional; lower comes first
```

`src/content/photography/` is for photography only, never photos of me. Those go through `--me`:

```sh
npm run photos:ingest -- ~/photos/me --me
```

which writes the sizes into `src/assets/me/<name>/` and adds `{ "file": "<name>", "alt": "", "use": "about" }` to
`src/content/me.json`. Write the alt text and set `use` (`opening`, `about`, `thread` or `resume`) before building:
an empty alt fails the build. A photo of me appears only where it is placed beside text: in an `.mdx` page with
`<MePhoto file="<name>" side="right" />`, or in a story chapter with `photo: "<name>"`.

## Content

| Collection | Files | Pages |
|---|---|---|
| `projects` | `src/content/projects/<slug>.mdx` | `/projects`, `/projects/<slug>` |
| `blog` | `src/content/blog/<slug>.mdx` | `/blog`, `/blog/<slug>`, `/rss.xml` |
| `pages` | `src/content/pages/{about,resume}.mdx` | `/about`, `/resume` |
| `story` | `src/content/story/<nn>-<slug>.mdx` | `/story` |
| `photography` | `src/content/photography/<name>.yaml` (`npm run photos:ingest`) | the photography exhibit (SaahilOS, the room) |

The schemas are in `src/content.config.ts`. Every entry is also served as static JSON at
`/content/<collection>/<slug>.json` (`{ data, html }`), which SaahilOS reader windows load.

Films come from the Letterboxd diary of `saahilsan`. The archive is the export in `src/data/letterboxd/` (diary,
ratings, reviews, watched; the Tags column is removed). `/api/films.json`, the only server route, merges the public RSS
feed over it per film and watched date, at most once an hour (Vercel ISR), at most one Letterboxd request per 2 s. When
the feed fails, it serves the archive and the last good copy. `src/content/films.json` is the same merge, written by
each build as the static fallback. Set `FILMS_PRIVATE_NAMES` (comma-separated, in Vercel) to drop the text of any live
review that names one of those people.

The posters in the room are the four favourite films on the Letterboxd profile, in profile order. They are also the
"On the wall" list on `/films`. Letterboxd answers a request for a profile page with HTTP 403, and the RSS feed does
not include the favourites. So the source is the account export: its `profile.csv` has a "Favorite Films" column with
four `boxd.it` links. To update the posters after a change on Letterboxd:

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

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:4321. |
| `npm run build` | Writes `src/content/films.json` (archive + Letterboxd feed), then builds into `dist/` and `.vercel/output/`. |
| `npm run preview` | Serves the last build from `.vercel/output/`, `/api/films.json` included (`astro preview` does not support the Vercel adapter). |
| `npm run check` | Type-checks the project (`astro check`). |
| `npm run test:e2e` | Playwright tests in `tests/*.spec.ts`. They build with `SAMPLES=1` (draft posts included) and serve the build themselves. |
| `node scripts/check-routes.mjs` | Builds, then checks every route: each entry has its page and JSON body, each page has a title, description, `og:title`, `og:image` and one `<h1>`, and no internal link is broken. `--samples` includes draft posts. |
| `npm run photos:ingest -- <folder>` | Strips all metadata from the photos in a folder, writes AVIF and WebP sizes, and adds an entry per photo (see "Add photos in one step"). |
| `npm run films` | Writes `src/content/films.json`: the archive and the cached copy, with the Letterboxd feed merged over them. When the feed fails, it keeps the cached copy and exits 0. |
| `npm run posters [-- <slug> ...]` | Draws the hand-drawn posters into `blender/posters/` (SVG and 2048-px PNG). |
| `npm run posters:runtime [-- <slug> ...]` | Writes the runtime copies of the favourites' posters to `public/room/posters/` (AVIF 683×1024 and KTX2 512×768, 120 KB or less each). |
| `npm run favorites -- <export folder>` | Writes `src/content/favorites.json` from a Letterboxd export's `profile.csv`. |
| `node scripts/posters/glyphs.mjs` | Writes `src/lib/poster-glyphs.ts`, the glyph outlines `renderPoster` uses. Run it again only when the fonts or the character sets change. |
| `npm run measure:payload`, `npm run measure:fps` | Measure the room's 3D payload and frame rate. |

## Deploy

Vercel, through `@astrojs/vercel`. Every page is prerendered. A route that must run on request sets
`export const prerender = false`; Vercel then caches it with ISR for at most an hour.

## Design

Warm light in a dark room, and one thread. Colours: ink `#14110F` (background), walnut `#3B2A1E`, paper `#EDE4D3`
(text), dust `#A89F91` (secondary text), thread `#B4442C` (the one accent; never for text), projector `#9DB4C0` (the beam
and the CRT only). Type: Newsreader for headings and essays, IBM Plex Sans for the interface, IBM Plex Mono for code.
Reading pages have no effects over the text.

## Credits

Based on Henry Heffernan's portfolio, heavily edited: the room scene comes from
[portfolio-website](https://github.com/henryjeff/portfolio-website) (MIT) and SaahilOS from
[portfolio-inner-site](https://github.com/henryjeff/portfolio-inner-site) (used with his permission). Ideas from
[Alana Goyal's site](https://github.com/alanagoyal/alanagoyal) (MIT). The licence texts are in [NOTICE](NOTICE).
Every third-party asset, with its source and licence, is listed in [blender/ASSETS.md](blender/ASSETS.md) and on
`/credits`.
