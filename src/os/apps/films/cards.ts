// A typographic card for one diary entry (no poster art from the feed): a colour band with the year, a thread
// rule, the title, then rating and rewatch. Pure string output, shared by the Films app and plain pages.
import type { FilmEntry } from '../../../lib/films/merge.ts';

const INK = '#14110F';
const PAPER = '#EDE4D3';
const DUST = '#A89F91';
const THREAD = '#B4442C';
const SERIF = "'Newsreader Variable', 'Iowan Old Style', Georgia, serif";
const SANS = "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif";
// Muted printing inks; ink text on each is at least 4.5:1. A film keeps its band colour across entries.
const BANDS = ['#9DB4C0', '#B4864F', '#CFA24A', '#C4A287', '#9FAE95'];

const VIEW_W = 200;
const VIEW_H = 300;
const PAD = 16;

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch] ?? ch);

function bandFor(slug: string): string {
  let hash = 0x811c9dc5;
  for (const ch of slug) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return BANDS[hash % BANDS.length];
}

// Greedy wrap by an average glyph width (Newsreader is about 0.47 em per character); at most `maxLines`.
function wrap(text: string, size: number, maxLines: number): string[] {
  const perLine = Math.floor((VIEW_W - 2 * PAD) / (size * 0.47));
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} ${word}`.length <= perLine) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, perLine - 1).trimEnd()}…`;
  return kept;
}

function stars(rating: number): string {
  return '★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : '');
}

/** The entry as a 2:3 SVG card, `opts.width` px wide (default 200); every feed string is escaped. */
export function renderFilmCard(entry: FilmEntry, opts: { width?: number } = {}): string {
  const width = opts.width ?? VIEW_W;
  const height = Math.round(width * (VIEW_H / VIEW_W));
  const label = [
    `${entry.title}, ${entry.year}.`,
    entry.rating !== null ? `Rated ${entry.rating} out of 5.` : '',
    entry.rewatch ? 'Rewatch.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const size = entry.title.length > 34 ? 19 : 23;
  const titleLines = wrap(entry.title, size, 4)
    .map((line, i) => `<tspan x="${PAD}" dy="${i === 0 ? 0 : size * 1.12}">${escapeXml(line)}</tspan>`)
    .join('');
  const meta = [entry.rating !== null ? stars(entry.rating) : '', entry.rewatch ? 'rewatch' : '']
    .filter(Boolean)
    .map(escapeXml)
    .join('   ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(label)}">
<title>${escapeXml(label)}</title>
<rect width="${VIEW_W}" height="${VIEW_H}" rx="3" fill="${INK}"/>
<path d="M0 3a3 3 0 0 1 3-3h${VIEW_W - 6}a3 3 0 0 1 3 3v101H0z" fill="${bandFor(entry.slug)}"/>
<text x="${PAD}" y="92" font-family="${SERIF}" font-size="46" font-weight="300" fill="${INK}">${entry.year}</text>
<rect y="104" width="${VIEW_W}" height="2" fill="${THREAD}"/>
<text x="${PAD}" y="${138 + size * 0.2}" font-family="${SERIF}" font-size="${size}" fill="${PAPER}">${titleLines}</text>
<text x="${PAD}" y="${VIEW_H - PAD}" font-family="${SANS}" font-size="13" letter-spacing="0.06em" fill="${DUST}">${meta}</text>
</svg>`;
}
