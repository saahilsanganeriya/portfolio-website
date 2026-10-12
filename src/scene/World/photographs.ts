// The owner's photography (src/content/photography, written by `npm run photos:ingest`) for the room's prints,
// album and projector. This module is its own chunk, imported only once the room is interactive; the pictures
// themselves load later still, a few at a time.
import type { ImageMetadata } from 'astro';

export interface Picture {
  src: string;
  width: number;
  height: number;
}

export interface Photograph {
  slug: string;
  title: string;
  year: number;
  place?: string;
  series: string;
  caption: string;
  featured: boolean;
  onWall: boolean;
  order: number;
  /** 480 px on the long edge: prints on the wall. */
  small: Picture;
  /** 960 px: album pages and the projector. */
  medium: Picture;
}

/** A section of the collection: the owner's favourites first, then each series without them (as in SaahilOS). */
export interface PhotoSection {
  title: string;
  photos: Photograph[];
}

const entries = import.meta.glob<string>('/src/content/photography/*.{yaml,yml}', { query: '?raw', import: 'default', eager: true });
const pictures = import.meta.glob<ImageMetadata>('/src/assets/photography/*/{480,960}.webp', { import: 'default', eager: true });

/** The ingest script writes one `key: <JSON value>` per line. */
function parseEntry(text: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z]+):\s*(.+)$/.exec(line.trim());
    if (match) fields[match[1]] = JSON.parse(match[2]);
  }
  return fields;
}

const picture = (slug: string, edge: 480 | 960): Picture | null => {
  const image = pictures[`/src/assets/photography/${slug}/${edge}.webp`];
  return image ? { src: image.src, width: image.width, height: image.height } : null;
};

export const PHOTOGRAPHS: Photograph[] = Object.entries(entries)
  .filter(([path]) => !/\/_[^/]*$/.test(path))
  .flatMap(([path, text]) => {
    const slug = path.split('/').pop()!.replace(/\.ya?ml$/, '');
    const data = parseEntry(text);
    const small = picture(slug, 480);
    const medium = picture(slug, 960) ?? small;
    if (!small || !medium) return [];
    return [
      {
        slug,
        title: String(data.title),
        year: Number(data.year),
        place: typeof data.place === 'string' ? data.place : undefined,
        series: String(data.series),
        caption: String(data.caption),
        featured: data.featured === true,
        onWall: data.onWall === true,
        order: Number(data.order ?? Number.MAX_SAFE_INTEGER),
        small,
        medium,
      },
    ];
  })
  .sort((a, b) => Number(b.featured) - Number(a.featured) || a.series.localeCompare(b.series) || a.order - b.order);

export function sections(photos: Photograph[] = PHOTOGRAPHS): PhotoSection[] {
  const result: PhotoSection[] = [];
  const favourites = photos.filter((p) => p.featured);
  if (favourites.length) result.push({ title: 'Favourites', photos: favourites });
  for (const photo of photos.filter((p) => !p.featured)) {
    const section = result.find((s, i) => (i > 0 || !favourites.length) && s.title === photo.series);
    if (section) section.photos.push(photo);
    else result.push({ title: photo.series, photos: [photo] });
  }
  return result;
}
