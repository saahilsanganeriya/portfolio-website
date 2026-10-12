// Build-time data for /os that is not in a content collection: the "In the oven" list, the favourite films, the
// project figures and the wallpaper. Imported by src/pages/os.astro only, so zod and astro:assets stay out of the island.
import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import { z } from 'astro/zod';
import projectionistArchitecture from '../assets/projects/projectionist-architecture.png';
import ovenFile from '../content/oven.json';
import samcellPipeline from '../assets/projects/samcell-paper-figure-3.jpg';
import wallpaper from './assets/wallpaper/wallpaper.jpg';
import type { OsFavourite, OsFigure, OsImage, OsWallpaper, OvenList } from './types';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

const ovenSchema = z.object({
  items: z.array(z.object({ title: z.string().min(1), note: z.string().min(1), link: z.string().regex(/^(\/|https?:\/\/)/, 'a site path or an http(s) URL').optional() })).min(1),
  updated: isoDay,
});

// src/content/favorites.json, rebuilt from each Letterboxd export (scripts/favorites.mjs).
const favouritesSchema = z.object({
  films: z
    .array(
      z.object({
        slug: z.string().min(1),
        title: z.string().min(1),
        year: z.number().int(),
        director: z.string(),
        poster: z.string().nullable(),
      }),
    )
    .min(1),
});

// The stand-in until favorites.json is written; it matches that file's schema.
// From the profile's Favorite Films in the Letterboxd export of 2026-10-12.
const FAVOURITES_FALLBACK: OsFavourite[] = [
  { slug: 'la-la-land', title: 'La La Land', year: 2016, director: 'Damien Chazelle', poster: null },
  { slug: 'yi-yi', title: 'Yi Yi', year: 2000, director: 'Edward Yang', poster: null },
  {
    slug: 'normal-people-2020',
    title: 'Normal People',
    year: 2020,
    director: 'Lenny Abrahamson and Hettie Macdonald',
    poster: null,
  },
  { slug: 'black-swan', title: 'Black Swan', year: 2010, director: 'Darren Aronofsky', poster: null },
];

// A literal glob matches nothing until the file exists, so the build passes either way.
const favouritesFile = Object.values(
  import.meta.glob('../content/favorites.json', { eager: true, import: 'default' }),
)[0];

export const ovenList = (): OvenList => ovenSchema.parse(ovenFile);

export const favourites = (): OsFavourite[] =>
  favouritesFile === undefined ? FAVOURITES_FALLBACK : favouritesSchema.parse(favouritesFile).films;

type FigureSource = Omit<OsFigure, keyof OsImage> & { src: ImageMetadata; alt: string };

const EXTRA_FIGURES: Record<string, FigureSource[]> = {
  samcell: [
    {
      src: samcellPipeline,
      alt: 'Three panels: phase-contrast cells and their labels become a distance map; SAM is fine-tuned with a frozen prompt encoder to predict that map; at inference the map is thresholded into masks and cell centres and split by watershed.',
      caption: 'The SAMCell pipeline, Figure 3 of the paper.',
      credit: {
        text: 'Dunnum VandeLoo et al., PLOS ONE (2025), CC BY 4.0',
        url: 'https://doi.org/10.1371/journal.pone.0319532.g003',
      },
    },
  ],
  projectionist: [
    {
      src: projectionistArchitecture,
      alt: 'Architecture diagram: inside one container on a Synology NAS, a scheduler starts each stage through a Runner, stages share Plex, Jellyfin, TMDB and LLM clients, state is in SQLite and health and metrics are served on loopback; the container reaches the GPU, Plex and Jellyfin, the media volume and Plex app data.',
      caption: 'How projectionist runs on the NAS.',
      credit: { text: 'From the projectionist README', url: 'https://github.com/saahilsanganeriya/projectionist#readme' },
    },
  ],
};

const COVER_WIDTHS = [160, 320, 720, 1280];

export async function osImage(src: ImageMetadata, alt: string): Promise<OsImage> {
  const image = await getImage({ src, widths: COVER_WIDTHS, format: 'webp', quality: 78 });
  return { src: image.src, srcset: image.srcSet.attribute, width: src.width, height: src.height, alt };
}

export const projectFigures = (slug: string): Promise<OsFigure[]> =>
  Promise.all(
    (EXTRA_FIGURES[slug] ?? []).map(async ({ src, alt, ...text }) => ({ ...(await osImage(src, alt)), ...text })),
  );

export async function osWallpaper(): Promise<OsWallpaper> {
  const widths = [960, 1600];
  const [avif, webp] = await Promise.all([
    getImage({ src: wallpaper, widths, format: 'avif', quality: 55 }),
    getImage({ src: wallpaper, widths, format: 'webp', quality: 70 }),
  ]);
  return { avif: avif.srcSet.attribute, webp: webp.srcSet.attribute, src: webp.src };
}
