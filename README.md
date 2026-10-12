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

`src/content/blog/sample-post.mdx` is a draft that shows every element a post can use.

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

## Content

| Collection | Files | Pages |
|---|---|---|
| `projects` | `src/content/projects/<slug>.mdx` | `/projects`, `/projects/<slug>` |
| `blog` | `src/content/blog/<slug>.mdx` | `/blog`, `/blog/<slug>`, `/rss.xml` |
| `pages` | `src/content/pages/{about,resume}.mdx` | `/about`, `/resume` |
| `story` | `src/content/story/<nn>-<slug>.mdx` | `/story` |

The schemas are in `src/content.config.ts`. Every entry is also served as static JSON at
`/content/<collection>/<slug>.json` (`{ data, html }`), which SaahilOS reader windows load.

Samples for projects, pages and the story are in `src/content/_samples/`. They load only in `npm run dev` or in a build
with `SAMPLES=1`; a production build never contains them.

Films come from `src/content/films.json` (from the Letterboxd diary of `saahilsan`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:4321. |
| `npm run build` | Production build into `dist/` and `.vercel/output/`. |
| `npm run preview` | Serves the last build. |
| `npm run check` | Type-checks the project (`astro check`). |
| `npm run test:e2e` | Playwright tests in `tests/*.spec.ts`. They build with `SAMPLES=1` and serve the build themselves. |
| `node scripts/check-routes.mjs` | Builds, then checks every route: each entry has its page and JSON body, each page has a title, description, `og:title`, `og:image` and one `<h1>`, and no internal link is broken. `--samples` includes the samples. |
| `npm run films` | Refreshes `src/content/films.json` from Letterboxd. |
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
