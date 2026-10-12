import type { ImageMetadata } from 'astro';
import { z } from 'astro/zod';
import entries from '../content/me.json';

// Photos of the owner: written by `npm run photos:ingest -- <folder> --me`, described in src/content/me.json, and only
// ever shown beside the text they belong to (About, The Thread, the OS opening window, the résumé), never as a gallery.

const mePhotoSchema = z.object({
  file: z.string().regex(/^[a-z0-9-]+$/),
  alt: z.string().min(1, 'every photo in src/content/me.json needs alt text'),
  use: z.enum(['opening', 'about', 'thread', 'resume']),
  caption: z.string().optional(),
});

type MePhotoEntry = z.infer<typeof mePhotoSchema>;

const photos = z.array(mePhotoSchema).parse(entries);

const files = import.meta.glob<ImageMetadata>('/src/assets/me/*/*.{avif,webp}', { eager: true, import: 'default' });

export interface MePhoto extends MePhotoEntry {
  avifSrcset: string;
  webpSrcset: string;
  /** The largest WebP within `maxEdge`, for the <img> fallback and its intrinsic size. */
  fallback: ImageMetadata;
}

/** A photo from me.json with srcsets built from its ingested sizes up to `maxEdge` px on the long edge. */
export function mePhoto(file: string, maxEdge = 960): MePhoto {
  const entry = photos.find((photo) => photo.file === file);
  if (!entry) throw new Error(`no photo "${file}" in src/content/me.json`);

  const sizes = (format: 'avif' | 'webp') =>
    Object.entries(files)
      .map(([path, image]) => ({ match: path.match(/^\/src\/assets\/me\/([^/]+)\/(\d+)\.(avif|webp)$/), image }))
      .filter(({ match }) => match && match[1] === file && match[3] === format && Number(match[2]) <= maxEdge)
      .map(({ image }) => image)
      .sort((a, b) => a.width - b.width);

  const avif = sizes('avif');
  const webp = sizes('webp');
  if (webp.length === 0) throw new Error(`no ingested sizes for "${file}" in src/assets/me/${file}/`);
  const srcset = (images: ImageMetadata[]) => images.map((image) => `${image.src} ${image.width}w`).join(', ');

  return { ...entry, avifSrcset: srcset(avif), webpSrcset: srcset(webp), fallback: webp.at(-1)! };
}
