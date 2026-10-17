// The owner's photography (src/content/photography, written by `npm run photos:ingest`) for the room's darkroom line,
// in the set's one order (`order`), the order SaahilOS shows it in too. This module is its own chunk, imported only once
// the room is interactive; the pictures themselves load later still.
import type { ImageMetadata } from 'astro';

export interface Picture {
  /** The WebP copy, and the same size as AVIF (about 40% smaller) when the ingest made one. */
  src: string;
  avif?: string;
  width: number;
  height: number;
}

export interface Photograph {
  slug: string;
  title: string;
  year: number;
  place?: string;
  caption: string;
  /** Camera and lens as his post names them; the film stock, when it was film. */
  camera: string;
  film?: string;
  order: number;
  /** His marker line for the print's border; the date he posted it (YYYY-MM-DD). */
  sharpie?: string;
  date?: string;
  /** 480 px on the long edge: the prints from across the room. */
  small: Picture;
  /** 960 px: the prints close up. */
  medium: Picture;
  /** The largest size up to 1600 px: the hero print close up. */
  large: Picture;
}

/** A section of the collection (the album's pages; the album leaves the room with round 8's set). */
export interface PhotoSection {
  title: string;
  photos: Photograph[];
}

const LARGE_EDGE_PX = 1600;

const entries = import.meta.glob<string>('/src/content/photography/*.{yaml,yml}', { query: '?raw', import: 'default', eager: true });
const pictures = import.meta.glob<ImageMetadata>('/src/assets/photography/*/*.webp', { import: 'default', eager: true });
const avifs = import.meta.glob<ImageMetadata>('/src/assets/photography/*/*.avif', { import: 'default', eager: true });

/** The ingest script writes one `key: <JSON value>` per line. */
function parseEntry(text: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z]+):\s*(.+)$/.exec(line.trim());
    if (match) fields[match[1]] = JSON.parse(match[2]);
  }
  return fields;
}

/** Every ingested size of a photograph, smallest first. */
function sizesOf(slug: string): Picture[] {
  return Object.entries(pictures)
    .filter(([path]) => path.startsWith(`/src/assets/photography/${slug}/`))
    .map(([path, image]) => ({ src: image.src, avif: avifs[path.replace(/\.webp$/, '.avif')]?.src, width: image.width, height: image.height }))
    .sort((a, b) => a.width - b.width);
}

const longEdge = (picture: Picture) => Math.max(picture.width, picture.height);
const optional = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export const PHOTOGRAPHS: Photograph[] = Object.entries(entries)
  .filter(([path]) => !/\/_[^/]*$/.test(path))
  .flatMap(([path, text]) => {
    const slug = path.split('/').pop()!.replace(/\.ya?ml$/, '');
    const data = parseEntry(text);
    const sizes = sizesOf(slug);
    const small = sizes.find((p) => longEdge(p) === 480) ?? sizes[0];
    const medium = sizes.find((p) => longEdge(p) === 960) ?? small;
    const large = sizes.filter((p) => longEdge(p) <= LARGE_EDGE_PX).at(-1) ?? medium;
    if (!small) return [];
    return [
      {
        slug,
        title: String(data.title),
        year: Number(data.year),
        place: optional(data.place),
        caption: String(data.caption),
        camera: String(data.camera),
        film: optional(data.film),
        order: Number(data.order ?? Number.MAX_SAFE_INTEGER),
        sharpie: optional(data.sharpie),
        date: optional(data.date),
        small,
        medium,
        large,
      },
    ];
  })
  .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

/** The album's one section: the set in its order. */
export function sections(photos: Photograph[] = PHOTOGRAPHS): PhotoSection[] {
  return photos.length ? [{ title: 'Photographs', photos }] : [];
}
