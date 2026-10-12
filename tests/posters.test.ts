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
