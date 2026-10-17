import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_FILM, chapterAt, readFilm } from '../src/scene/World/film';

/** Catches the projector reading the retired reel's timeline as a film, or dropping a real manifest's video. */
describe('the projector reads its film from the manifest', () => {
  it('takes the film manifest’s sources, poster, duration and chapters, chapters in time order', () => {
    const film = readFilm({
      sources: [{ src: '/room/story-film.webm', type: 'video/webm; codecs="vp9"' }, { src: '/room/story-film.mp4', type: 'video/mp4' }],
      poster: '/room/story-film.avif',
      duration: 72,
      chapters: [{ t: 30, title: 'Atlanta' }, { t: 0, title: 'Delhi' }],
      credits: ['photographs: his own'],
    });
    expect(film.sources).toHaveLength(2);
    expect(film.poster).toBe('/room/story-film.avif');
    expect(film.chapters.map((c) => c.title)).toEqual(['Delhi', 'Atlanta']);
    expect(chapterAt(film, 31).title).toBe('Atlanta');
  });

  it('shows the placeholder while the manifest still holds the reel’s timeline', () => {
    expect(readFilm({ duration: 55, segments: [{ start: 0, end: 5 }] })).toBe(PLACEHOLDER_FILM);
    expect(readFilm({ sources: [], chapters: [], duration: 10 })).toBe(PLACEHOLDER_FILM);
  });
});
