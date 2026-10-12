/** A diary entry as the room's projector reel shows it on an intertitle card. */
export interface ReelFilm {
  title: string;
  year: number;
  rating: number | null;
}

/** The newest `count` diary entries of a films payload (the build's or /api/films.json); [] for anything else. */
export function latestFilms(data: unknown, count = 3): ReelFilm[] {
  const entries = (data as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(
      (e): e is ReelFilm & { watchedDate: string } =>
        typeof e?.title === 'string' && typeof e.year === 'number' && typeof e.watchedDate === 'string',
    )
    .sort((a, b) => b.watchedDate.localeCompare(a.watchedDate))
    .slice(0, count)
    .map(({ title, year, rating }) => ({ title, year, rating: typeof rating === 'number' ? rating : null }));
}
