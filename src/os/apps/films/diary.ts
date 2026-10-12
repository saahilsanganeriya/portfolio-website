import type { FilmEntry, FilmsData } from '../../../lib/films';
import type { OsFavourite } from '../../types';

/** Diary cards the Films window shows; the whole archive is on /films. */
export const DIARY_CARDS = 60;

type FilmRef = Pick<OsFavourite, 'slug' | 'title' | 'year'>;

// Export entries get their slug from the title, so a favourite is also found by title and year.
export const latestEntry = (entries: readonly FilmEntry[], film: FilmRef): FilmEntry | undefined =>
  entries.find((e) => e.slug === film.slug) ?? entries.find((e) => e.title === film.title && e.year === film.year);

// The latest entries plus each favourite's latest watch, so the island never carries the 600-entry archive.
export function windowDiary(data: FilmsData, favourites: readonly FilmRef[]): FilmsData {
  const recent = data.entries.slice(0, DIARY_CARDS);
  const pinned = favourites.flatMap((film) => {
    const entry = latestEntry(data.entries, film);
    return entry && !recent.includes(entry) ? [entry] : [];
  });
  return { ...data, entries: [...recent, ...pinned] };
}
