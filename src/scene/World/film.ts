import manifest from '../reel.json';

// The projector's film: his story, a short silent film built from his own photographs (public/room/story-film.*),
// described by the manifest in src/scene/reel.json:
//   { sources: [{ src, type }], poster, duration, chapters: [{ t, title }], credits?: [string] }
// Until that manifest is in the repo (the file still holds the retired Letterboxd reel's timeline), the projector shows
// the placeholder below: title cards and no video.

export interface FilmSource {
  src: string;
  type: string;
}

export interface FilmChapter {
  /** Seconds from the start. */
  t: number;
  title: string;
}

export interface Film {
  sources: FilmSource[];
  poster: string | null;
  duration: number;
  chapters: FilmChapter[];
  credits: string[];
}

export const PLACEHOLDER_FILM: Film = {
  sources: [],
  poster: null,
  duration: 10,
  chapters: [{ t: 0, title: 'The story so far' }],
  credits: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The manifest's film, or the placeholder when it has no film's shape (no sources list or no chapters). */
export function readFilm(data: unknown): Film {
  if (!isRecord(data) || !Array.isArray(data.sources) || !Array.isArray(data.chapters)) return PLACEHOLDER_FILM;
  const sources = data.sources.filter(
    (s): s is FilmSource => isRecord(s) && typeof s.src === 'string' && typeof s.type === 'string',
  );
  const chapters = data.chapters
    .filter((c): c is FilmChapter => isRecord(c) && typeof c.t === 'number' && typeof c.title === 'string')
    .sort((a, b) => a.t - b.t);
  const duration = Number(data.duration);
  if (!chapters.length || !(duration > 0)) return PLACEHOLDER_FILM;
  return {
    sources,
    poster: typeof data.poster === 'string' ? data.poster : null,
    duration,
    chapters,
    credits: Array.isArray(data.credits) ? data.credits.filter((c): c is string => typeof c === 'string') : [],
  };
}

export const FILM: Film = readFilm(manifest);

/** The chapter playing at `t` seconds. */
export function chapterAt(film: Film, t: number): FilmChapter {
  let current = film.chapters[0];
  for (const chapter of film.chapters) if (chapter.t <= t) current = chapter;
  return current;
}
