import type { FilmsData } from '../../../lib/films';

/** Diary cards the Films window shows; the whole archive is on /films. */
export const DIARY_CARDS = 60;

// The latest entries plus each poster film's latest watch, so the island never carries the 600-entry archive.
export function windowDiary(data: FilmsData): FilmsData {
  const recent = data.entries.slice(0, DIARY_CARDS);
  const wall = data.posters.flatMap((slug) => {
    const entry = data.entries.find((e) => e.slug === slug);
    return entry && !recent.includes(entry) ? [entry] : [];
  });
  return { ...data, entries: [...recent, ...wall] };
}
