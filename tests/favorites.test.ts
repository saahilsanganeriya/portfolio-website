import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import favorites from '../src/content/favorites.json' with { type: 'json' };
import { buildFavorites, parseFavoriteLinks, parseFilmPage, resolveFavorite, type Favorites } from '../src/lib/favorites.ts';

// Synthetic export row: the real profile.csv also holds the member's name, location and links.
const PROFILE_CSV =
  'Date Joined,Username,Given Name,Family Name,Email Address,Location,Website,Bio,Pronoun,Favorite Films\n' +
  '2021-08-28,testuser,Test,User,user@example.com,"Somewhere, CA",https://example.com,"I said ""hi"", once",They / them,' +
  '"https://boxd.it/a5fa, https://boxd.it/1vCw, https://boxd.it/q2VY, https://boxd.it/Sw0"\n';

const filmPage = (title: string, director: string) =>
  `<html><head><meta property="og:title" content="${title}"><meta name="twitter:label1" content="Directed by">` +
  `<meta name="twitter:data1" content="${director}"></head></html>`;

describe('reading the export', () => {
  // Catches a CSV split that breaks the quoted favourites cell (or a quoted bio) into columns, and lost profile
  // order, which is the order the room hangs the posters in.
  it('reads the four boxd.it links from profile.csv in profile order', () => {
    expect(parseFavoriteLinks(PROFILE_CSV)).toEqual([
      'https://boxd.it/a5fa', 'https://boxd.it/1vCw', 'https://boxd.it/q2VY', 'https://boxd.it/Sw0',
    ]);
    expect(() => parseFavoriteLinks(PROFILE_CSV.replace('https://boxd.it/Sw0', 'Black Swan'))).toThrow(/not a boxd\.it link/);
    expect(() => parseFavoriteLinks('Username\ntestuser\n')).toThrow(/no Favorite Films column/);
  });

  // Catches a title that keeps its year or loses an entity-encoded apostrophe, and a second director dropped.
  it('reads title, year and directors from a film page', () => {
    expect(parseFilmPage(filmPage('Normal People (2020)', 'Lenny Abrahamson, Hettie Macdonald'))).toEqual({
      title: 'Normal People', year: 2020, director: 'Lenny Abrahamson and Hettie Macdonald',
    });
    expect(parseFilmPage(filmPage('Ferris Bueller&#039;s Day Off (1986)', 'John Hughes')).title).toBe("Ferris Bueller's Day Off");
    expect(() => parseFilmPage('<html></html>')).toThrow(/og:title/);
  });
});

describe('resolving a link', () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const respond = (byUrl: Record<string, Response>) =>
    (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return byUrl[url] ?? new Response('missing', { status: 404 });
    }) as typeof fetch;

  // Catches a fetch that follows redirects itself (losing the slug), skips the pacer, or drops the browser
  // User-Agent that Letterboxd needs to answer at all.
  it('follows the boxd.it redirect to the film page, every request paced', async () => {
    calls.length = 0;
    let waits = 0;
    const film = await resolveFavorite('https://boxd.it/1vCw', {
      pacer: { wait: async () => { waits += 1; } },
      fetchImpl: respond({
        'https://boxd.it/1vCw': new Response(null, { status: 302, headers: { location: 'https://letterboxd.com/film/yi-yi/' } }),
        'https://letterboxd.com/film/yi-yi/': new Response(filmPage('Yi Yi (2000)', 'Edward Yang')),
      }),
    });
    expect(film).toEqual({ slug: 'yi-yi', title: 'Yi Yi', year: 2000, director: 'Edward Yang' });
    expect(waits).toBe(2);
    expect(calls.map((c) => [c.init?.redirect, (c.init?.headers as Record<string, string>)['User-Agent']])).toEqual([
      ['manual', expect.stringMatching(/^Mozilla\/5\.0 /)],
      ['manual', expect.stringMatching(/^Mozilla\/5\.0 /)],
    ]);
  });

  // Catches a 403 being read as "no redirect" or retried into a block, instead of stopping with the reason.
  it('stops at a 403 and names it', async () => {
    calls.length = 0;
    const blocked = resolveFavorite('https://boxd.it/a5fa', {
      pacer: { wait: async () => {} },
      fetchImpl: respond({ 'https://boxd.it/a5fa': new Response('blocked', { status: 403 }) }),
    });
    await expect(blocked).rejects.toThrow(/HTTP 403 from boxd\.it/);
    expect(calls).toHaveLength(1);
  });
});

describe('favorites.json', () => {
  // Catches a re-run with the same favourites rewriting `updated`, which makes every rebuild a new commit.
  it('moves `updated` only when the list changes', () => {
    const previous = favorites as Favorites;
    const films = previous.films;
    expect(buildFavorites([...films], previous, new Date('2030-01-01T00:00:00Z'))).toBe(previous);
    const changed = buildFavorites(films.slice(0, 3), previous, new Date('2030-01-01T00:00:00Z'));
    expect(changed.updated).toBe('2030-01-01T00:00:00.000Z');
  });

  // Catches a rebuild from the Letterboxd export (which lists series as films) dropping the hand-set kind: the room's
  // card and poster would call Normal People a film again.
  it('keeps a hand-set kind across a rebuild', () => {
    const previous = favorites as Favorites;
    expect(previous.films.some((film) => film.kind)).toBe(true);
    const resolved = previous.films.map(({ kind: _kind, ...film }) => film);
    expect(buildFavorites(resolved, previous, new Date('2030-01-01T00:00:00Z'))).toBe(previous);
  });

  // Catches a poster path that points at nothing (a blank poster in the room), a missing texture beside it, a
  // runtime copy over the 120 KB cap, or art with no source sheet to redraw it from.
  it('points every hand-drawn poster at small runtime copies and a source sheet', () => {
    const root = new URL('../', import.meta.url);
    for (const { slug, poster } of favorites.films) {
      if (poster === null) continue;
      expect(poster).toBe(`/room/posters/${slug}.avif`);
      for (const copy of [`public${poster}`, `public/room/posters/${slug}.ktx2`]) {
        expect(statSync(new URL(copy, root)).size, copy).toBeLessThanOrEqual(120_000);
      }
      expect(existsSync(new URL(`blender/posters/${slug}.svg`, root)), slug).toBe(true);
    }
  });
});
