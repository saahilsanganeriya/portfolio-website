import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectFilms, createFilmsSource, fetchFeed } from '../src/lib/films/live.ts';
import { buildFilmsData, mergeEntries, type FilmEntry } from '../src/lib/films/merge.ts';
import { createPacer, FLOOR_MS } from '../src/lib/films/pace.ts';
import { parseArchive, parseFeed } from '../src/lib/films/parse.ts';
import { renderFilmCard } from '../src/os/apps/films/cards.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const feed = read('./fixtures/rss.xml');
const instant = { wait: async () => {} };
const noSleep = async () => {};

const entry = (over: Partial<FilmEntry>): FilmEntry => ({
  title: 'La La Land', year: 2016, rating: 4, rewatch: false, liked: false, watchedDate: '2026-08-22',
  review: null, url: 'https://boxd.it/x', slug: 'la-la-land', ...over,
});
const archive = buildFilmsData(
  [entry({}), entry({ title: 'Chungking Express', year: 1994, slug: 'chungking-express', watchedDate: '2023-08-12' })],
  '2026-10-01T00:00:00.000Z',
);

afterEach(() => {
  vi.useRealTimers();
});

describe('parsing', () => {
  // Catches list posts entering the diary (their titles can name people) and the poster <img> or the
  // "Watched on …" line leaking into review text.
  it('reads the 50 diary entries of the feed and skips its 50 list posts', () => {
    const { entries, skipped } = parseFeed(feed);
    expect([entries.length, skipped]).toEqual([50, 50]);
    expect(entries.find((e) => e.slug === 'la-la-land')).toMatchObject({
      watchedDate: '2026-08-22', rating: 5, rewatch: true, url: 'https://letterboxd.com/saahilsan/film/la-la-land/4/',
    });
    expect(entries.find((e) => e.title === 'Ad Astra')?.review).toBe('sad astra');
    expect(entries.filter((e) => e.review !== null)).toHaveLength(1);
  });

  // Catches a CSV reader that splits a quoted multi-line review into bogus rows, and a re-export that brings back
  // the Tags column (diary tags name a private companion) or a withheld review.
  it('reads the committed archive: multi-line reviews whole, no tags, withheld reviews empty', () => {
    const diary = read('../src/data/letterboxd/diary.csv');
    const reviews = read('../src/data/letterboxd/reviews.csv');
    expect(`${diary.split('\n')[0]}${reviews.split('\n')[0]}`).not.toMatch(/Tags/);
    const entries = parseArchive({ diary, reviews });
    expect(entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.watchedDate) && e.year > 1880)).toBe(true);
    const oppenheimer = entries.find((e) => e.title === 'Oppenheimer' && e.review);
    expect(oppenheimer?.review?.split('\n\n').length).toBeGreaterThan(3);
    expect(entries.find((e) => e.title === 'About Time')?.review).toBeNull();
  });
});

describe('merging', () => {
  // Catches the archive overwriting a newer feed entry, and duplicate rows for one watch.
  it('keeps one entry per film and watched date, the feed winning, newest first', () => {
    const live = [entry({ rating: 5, rewatch: true, url: 'https://letterboxd.com/saahilsan/film/la-la-land/4/' })];
    const merged = mergeEntries(archive.entries, live);
    expect(merged.map((e) => [e.title, e.rating])).toEqual([['La La Land', 5], ['Chungking Express', 4]]);
  });

  // Catches a live review that names a private person reaching the page.
  it('withholds the text of a live review that names a listed private name', async () => {
    const { data } = await collectFilms(archive, { readFeed: async () => feed, privateNames: ['Astra'] });
    expect(data.entries.find((e) => e.title === 'Ad Astra')?.review).toBeNull();
  });
});

describe('failure', () => {
  // Network down: one retry, then the archive (or cached copy) unchanged, with the reason; never a throw.
  it('keeps the archive when the feed cannot be fetched', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const result = await collectFilms(archive, {
      readFeed: () => fetchFeed({ fetchImpl, pacer: instant, sleep: noSleep }),
    });
    expect(result).toEqual({ data: archive, failure: 'fetch failed' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // Catches a failed read replacing the last good merge with the bare archive, a warning per request, and more
  // than one read an hour.
  it('serves the last good copy with one warning when a later read fails', async () => {
    let clock = Date.parse('2026-10-12T00:00:00Z');
    const readFeed = vi.fn().mockResolvedValueOnce(feed).mockRejectedValueOnce(new Error('HTTP 503 from Letterboxd'));
    const warn = vi.fn();
    const films = createFilmsSource(archive, { readFeed, now: () => new Date(clock), warn });
    const first = await films();
    expect(first.entries.length).toBeGreaterThan(50);
    clock += 61 * 60 * 1000;
    expect(await films()).toBe(first);
    expect(await films()).toBe(first);
    expect(readFeed).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/last good copy \(HTTP 503 from Letterboxd\)/);
  });
});

describe('pacing', () => {
  // The politeness promise: concurrent readers and retries together never send two requests within 2 s.
  it('never issues two Letterboxd requests within 2 s', async () => {
    vi.useFakeTimers();
    const sentAt: number[] = [];
    const fetchImpl = vi.fn(async () => {
      sentAt.push(Date.now());
      return sentAt.length === 1 ? new Response('busy', { status: 503 }) : new Response(feed);
    });
    const pacer = createPacer();
    const reads = Promise.all([1, 2, 3].map(() => fetchFeed({ fetchImpl, pacer })));
    await vi.advanceTimersByTimeAsync(20_000);
    await reads;
    expect(sentAt).toHaveLength(4);
    const gaps = sentAt.slice(1).map((t, i) => t - sentAt[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(FLOOR_MS);
  });
});

describe('cards', () => {
  // The Films app inserts this string as markup; an unescaped title from the feed would run as HTML.
  it('escapes feed text in the card', () => {
    const svg = renderFilmCard(entry({ title: '<img src=x onerror=alert(1)> & Co', rating: 4.5, rewatch: true }));
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; Co');
    expect(svg).toContain('aria-label="&lt;img src=x onerror=alert(1)&gt; &amp; Co, 2016. Rated 4.5 out of 5. Rewatch."');
  });
});
