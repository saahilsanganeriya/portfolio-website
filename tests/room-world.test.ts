import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_FILM, chapterAt, readFilm } from '../src/scene/World/film';
import { boardOrder, captionOf } from '../src/scene/World/Instax';
import type { Photograph } from '../src/scene/World/photographs';

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

const photo = (slug: string, onWall: boolean, extra: Partial<Photograph> = {}): Photograph => ({
  slug,
  title: slug,
  year: 2022,
  series: '2022',
  caption: '',
  featured: false,
  onWall,
  order: 0,
  small: { src: '', width: 480, height: 320 },
  medium: { src: '', width: 960, height: 640 },
  ...extra,
});

/** Catches the board hanging photographs off the wall first, or a print captioned with something he did not write. */
describe('the Instax board', () => {
  it('hangs the wall’s photographs first, in the collection’s order, one per slot', () => {
    const photos = [photo('a', true), photo('b', false), photo('c', true), photo('d', true)];
    expect(boardOrder(photos, 2).map((p) => p.slug)).toEqual(['a', 'c']);
    expect(boardOrder(photos, 4).map((p) => p.slug)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('writes his marker caption, else the title, else the day he posted it', () => {
    expect(captionOf(photo('x', true, { sharpie: 'diner, kodak gold 200', title: 'diner' }))).toBe('diner, kodak gold 200');
    expect(captionOf(photo('x', true, { title: 'brownstone' }))).toBe('brownstone');
    expect(captionOf(photo('x', true, { title: ' ', date: '2022-01-24' }))).toBe('2022-01-24');
  });
});
