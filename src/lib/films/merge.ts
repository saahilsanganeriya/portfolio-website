import favorites from '../../content/favorites.json' with { type: 'json' };

export interface FilmEntry {
  title: string;
  year: number;
  rating: number | null;
  rewatch: boolean;
  liked: boolean;
  watchedDate: string;
  review: string | null;
  url: string;
  slug: string;
}

export interface FilmsData {
  fetchedAt: string;
  profile: string;
  entries: FilmEntry[];
  posters: string[];
}

const PROFILE_URL = 'https://letterboxd.com/saahilsan/';
export const FEED_URL = `${PROFILE_URL}rss/`;

// The films whose posters hang in the room: the member's Letterboxd favourites; each id is the film's slug.
export const POSTER_FILMS = favorites.films.map(({ slug, title, year }) => ({ id: slug, title, year }));
// Exported films whose Letterboxd slug is not the plain title slug: the favourites, and The Odyssey (2026), whose
// slug carries its year.
const KNOWN_SLUGS = [...POSTER_FILMS, { id: 'the-odyssey-2026', title: 'The Odyssey', year: 2026 }];

const normalise = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// The export names films by title and year only (no slug), so a film is identified by both.
const filmKey = (title: string, year: number) => `${normalise(title)}|${year}`;
const entryKey = (entry: FilmEntry) => `${filmKey(entry.title, entry.year)}|${entry.watchedDate}`;

/** Letterboxd slug for an exported film: the known slug where there is one, else the plain title slug. */
export function slugFor(title: string, year: number): string {
  const key = filmKey(title, year);
  return KNOWN_SLUGS.find((film) => filmKey(film.title, film.year) === key)?.id ?? normalise(title);
}

/**
 * Union of two diaries, one entry per (film, watched date); `newer` wins over `older` for the same pair.
 * Returns newest watch first; same-day entries keep `newer` first, then input order.
 */
export function mergeEntries(older: readonly FilmEntry[], newer: readonly FilmEntry[]): FilmEntry[] {
  const merged = new Map<string, FilmEntry>();
  for (const entry of [...newer, ...older]) {
    const key = entryKey(entry);
    if (!merged.has(key)) merged.set(key, entry);
  }
  return [...merged.values()].sort((a, b) => b.watchedDate.localeCompare(a.watchedDate));
}

/** Drops the review text of any entry that names one of `names` (whole words, any case). */
export function withholdNamedReviews(entries: readonly FilmEntry[], names: readonly string[]): FilmEntry[] {
  const patterns = names.filter(Boolean).map((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
  if (patterns.length === 0) return [...entries];
  return entries.map((entry) =>
    entry.review && patterns.some((pattern) => pattern.test(entry.review ?? '')) ? { ...entry, review: null } : entry,
  );
}

export function buildFilmsData(entries: FilmEntry[], fetchedAt: string): FilmsData {
  return { fetchedAt, profile: PROFILE_URL, entries, posters: POSTER_FILMS.map((film) => film.id) };
}
