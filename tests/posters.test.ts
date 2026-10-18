import { describe, expect, it } from 'vitest';
import { layoutTitle, renderPoster, SHEET } from '../src/lib/posters.ts';

const film = { slug: 'everything-everywhere-all-at-once', title: 'Everything Everywhere All at Once', year: 2022, director: 'Daniel Kwan and Daniel Scheinert' };
const pathData = (svg: string) => [...svg.matchAll(/<path[^>]*\sd="([^"]*)"/g)].map((m) => m[1]);

describe('renderPoster', () => {
  // Catches a layout drifting from the hand-drawn set: the four favourites' titles break as their sheets do.
  it('breaks titles the way the hand-drawn sheets do', () => {
    expect(['La La Land', 'Yi Yi', 'Normal People', 'Black Swan'].map((title) => layoutTitle(title))).toEqual([
      { lines: ['LA LA', 'LAND'], size: 150 },
      { lines: ['YI', 'YI'], size: 150 },
      { lines: ['NORMAL', 'PEOPLE'], size: 150 },
      { lines: ['BLACK', 'SWAN'], size: 150 },
    ]);
  });

  // Catches type that depends on a web font or an outside file: inside an <img> or a texture it would draw blank.
  it('outlines Latin text, so the SVG needs no fonts or files', () => {
    const svg = renderPoster(film);
    expect(svg).not.toMatch(/<text|href=|<image/);
    expect([...svg.matchAll(/url\(#([a-z]+)\)/g)].map((m) => m[1]).sort()).toEqual(['fibre', 'press']);
  });

  // Catches a long title or a two-director credit running off the sheet.
  it('keeps every outline inside the margins', () => {
    const xs = pathData(renderPoster(film)).flatMap((d) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).filter((_, i) => i % 2 === 0).map(Number));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(SHEET.margin - 4);
    expect(Math.max(...xs)).toBeLessThanOrEqual(SHEET.width - SHEET.margin + 4);
  });

  // Catches Letterboxd text injected as markup, and a script the outline table lacks being dropped silently.
  it('escapes film text and sets uncovered scripts as escaped <text>', () => {
    const svg = renderPoster({ slug: 'x"y', title: '花樣年華 <b>&', year: 2000, director: 'Wong Kar-wai' });
    expect(svg).toContain('data-poster="x&quot;y"');
    expect(svg).toContain('<title>花樣年華 &lt;b&gt;&amp; (2000)');
    expect(svg).toMatch(/<text [^>]*>花樣年華<\/text>/);
    expect(svg).toMatch(/<text [^>]*>&lt;B&gt;&amp;<\/text>/);
    expect(svg).not.toContain('<b>');
  });
});

describe('the hand-drawn poster sheets', () => {
  // Each title's type and year as checked against Wikipedia and Letterboxd on 2026-10-18. Normal People is a twelve-part
  // series (BBC Three and Hulu, 2020), not a film.
  const CHECKED: Record<string, { kind: 'film' | 'series'; year: number }> = {
    'the-odyssey-2026': { kind: 'film', year: 2026 },
    'la-la-land': { kind: 'film', year: 2016 },
    'chungking-express': { kind: 'film', year: 1994 },
    'marty-supreme': { kind: 'film', year: 2025 },
    'yi-yi': { kind: 'film', year: 2000 },
    'normal-people-2020': { kind: 'series', year: 2020 },
    'black-swan': { kind: 'film', year: 2010 },
  };

  // Catches a sheet whose drawn credit line calls a series "a film by" (or a film a series), or prints the wrong year.
  it('print each title as what it is, and its year', async () => {
    const { POSTERS } = await import('../scripts/posters/designs.mjs');
    type SetLine = (face: string, text: string, options: Record<string, unknown>) => { d: string };
    const { setLine } = (await import('../scripts/posters/type.mjs')) as unknown as { setLine: SetLine };
    const at = { x: SHEET.margin, y: SHEET.creditBase, size: SHEET.creditSize };
    const film = setLine('serifItalic', 'a film by', at).d;
    const series = setLine('serifItalic', 'a series directed by', at).d;
    const sheets = POSTERS.map((draw: () => string) => draw());
    expect(sheets.map((svg: string) => svg.match(/data-poster="([^"]+)"/)![1]).sort()).toEqual(Object.keys(CHECKED).sort());
    for (const svg of sheets) {
      const { kind, year } = CHECKED[svg.match(/data-poster="([^"]+)"/)![1]];
      expect(svg.includes(film), `${kind}: "a film by"`).toBe(kind === 'film');
      expect(svg.includes(series), `${kind}: "a series directed by"`).toBe(kind === 'series');
      const yearLine = setLine('serif', String(year), { ...at, x: SHEET.width - SHEET.margin, anchor: 'end', features: ['onum'] }).d;
      expect(svg.includes(yearLine), `the year ${year}`).toBe(true);
    }
  });
});
