// Build-time data for /os that is not in a content collection: the "In the oven" list, the favourite films, the
// project figures and the wallpaper. Imported by src/pages/os.astro only, so zod and astro:assets stay out of the island.
import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import { getCollection } from 'astro:content';
import { z } from 'astro/zod';
import headshot from '../assets/headshot/saahil-sanganeriya.webp';
import projectionistArchitecture from '../assets/projects/projectionist-architecture.png';
import samcellPipeline from '../assets/projects/samcell-paper-figure-3.jpg';
import favouritesFile from '../content/favorites.json';
import ovenFile from '../content/oven.json';
import wallpaper from './assets/wallpaper/wallpaper.jpg';
import type {
  OsFavourite,
  OsFigure,
  OsImage,
  OsPhotograph,
  OsPicture,
  OsWallpaper,
  OvenList,
} from './types';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

const ovenSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1),
        note: z.string().min(1),
        link: z
          .string()
          .regex(/^(\/|https?:\/\/)/, 'a site path or an http(s) URL')
          .optional(),
      }),
    )
    .min(1),
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

export const ovenList = (): OvenList => ovenSchema.parse(ovenFile);

export const favourites = (): OsFavourite[] => favouritesSchema.parse(favouritesFile).films;

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

// ---- The owner's portrait and his photography (sizes made ahead of time by `npm run photos:ingest`) ----

/** The About window's portrait: the owner's professional headshot, small enough for a 112 px circle at 2x. */
export async function aboutPortrait(): Promise<{ portrait: OsImage }> {
  const image = await getImage({ src: headshot, widths: [128, 256], format: 'webp', quality: 78 });
  return {
    portrait: {
      src: image.src,
      srcset: image.srcSet.attribute,
      width: headshot.width,
      height: headshot.height,
      alt: 'Saahil Sanganeriya',
    },
  };
}

const photographSizes = import.meta.glob<ImageMetadata>('/src/assets/photography/*/*.{avif,webp}', {
  eager: true,
  import: 'default',
});

// Each photograph's folder holds the same picture at several long edges (480, 960, 1600 and the largest).
function picture(slug: string, maxEdge: number): OsPicture | null {
  const sizes = (format: 'avif' | 'webp') =>
    Object.entries(photographSizes)
      .filter(([path]) => path.startsWith(`/src/assets/photography/${slug}/`) && path.endsWith(`.${format}`))
      .map(([, image]) => image)
      .filter((image) => Math.max(image.width, image.height) <= maxEdge)
      .sort((a, b) => a.width - b.width);
  const webp = sizes('webp');
  if (webp.length === 0) return null;
  const srcset = (images: ImageMetadata[]) => images.map((image) => `${image.src} ${image.width}w`).join(', ');
  const largest = webp.at(-1)!;
  return { avif: srcset(sizes('avif')), webp: srcset(webp), src: largest.src, width: largest.width, height: largest.height };
}

export async function photographs(): Promise<OsPhotograph[]> {
  const entries = await getCollection('photography');
  return entries
    .map(({ id, data }) => {
      const thumb = picture(id, 960);
      const full = picture(id, Infinity);
      if (!thumb || !full) throw new Error(`photography/${id}: no ingested sizes in src/assets/photography/${id}/`);
      return {
        slug: id,
        title: data.title,
        year: data.year,
        place: data.place,
        series: data.series,
        caption: data.caption,
        featured: data.featured,
        order: data.order ?? Number.MAX_SAFE_INTEGER,
        thumb,
        full,
      };
    })
    .sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) || a.series.localeCompare(b.series) || a.order - b.order,
    )
    .map(({ order: _order, ...photo }) => photo);
}
