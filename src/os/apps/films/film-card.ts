import type { FilmEntry } from '../../../lib/films';

// Local stand-in for T4's src/os/apps/films/cards.ts, with the same signature: a typographic card, never poster art.
const W = 120;
const H = 180;

// The band's colour follows the rating, so a wall of cards reads at a glance; only 4½ and 5 stars get the thread.
function band(rating: number | null): { fill: string; text: string } {
  if (rating !== null && rating >= 4.5) return { fill: '#b4442c', text: '#fbf7ef' };
  if (rating !== null && rating >= 3.5) return { fill: '#7a5c32', text: '#ede4d3' };
  if (rating !== null && rating >= 2.5) return { fill: '#3f5457', text: '#ede4d3' };
  return { fill: '#a89f91', text: '#14110f' };
}

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]!);

// Greedy wrap by an average glyph width; at most `maxLines`, the last one ellipsised.
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
  return kept;
}

const STAR = 'M5 0.4 6.4 3.4 9.7 3.8 7.3 6 7.9 9.3 5 7.7 2.1 9.3 2.7 6 0.3 3.8 3.6 3.4Z';

function stars(rating: number, id: string): string {
  const full = Math.floor(rating);
  const half = rating % 1 !== 0;
  let out = '';
  for (let i = 0; i < 5; i++) {
    const x = 10 + i * 11;
    const fill = i < full ? '#14110f' : '#cfc5b3';
    out += `<path d="${STAR}" transform="translate(${x} 146)" fill="${fill}"/>`;
    if (half && i === full) {
      out += `<clipPath id="${id}-half"><rect x="${x}" y="146" width="5" height="10"/></clipPath>`;
      out += `<path d="${STAR}" transform="translate(${x} 146)" fill="#14110f" clip-path="url(#${id}-half)"/>`;
    }
  }
  return out;
}

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function cardLabel(entry: FilmEntry): string {
  const parts = [`${entry.title} (${entry.year})`];
  if (entry.rating !== null) parts.push(`rated ${entry.rating} out of 5`);
  if (entry.rewatch) parts.push('rewatch');
  parts.push(`watched ${shortDate.format(new Date(`${entry.watchedDate}T00:00:00Z`))}`);
  return parts.join(', ');
}

export function renderFilmCard(entry: FilmEntry, opts: { width?: number } = {}): string {
  const width = opts.width ?? W;
  const colours = band(entry.rating);
  const titleSize = entry.title.length > 28 ? 14 : 17;
  const lines = wrap(entry.title, titleSize === 14 ? 14 : 11, 4);
  const id = `card-${entry.slug}-${entry.watchedDate}`.replace(/[^a-z0-9-]/gi, '');
  const title = lines
    .map((line, i) => `<tspan x="10" dy="${i === 0 ? 0 : titleSize * 1.12}">${escapeXml(line)}</tspan>`)
    .join('');
  const watched = shortDate.format(new Date(`${entry.watchedDate}T00:00:00Z`));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${width}" height="${(width * H) / W}" role="img" aria-label="${escapeXml(cardLabel(entry))}">`,
    `<rect width="${W}" height="${H}" fill="#ede4d3"/>`,
    `<rect width="${W}" height="26" fill="${colours.fill}"/>`,
    `<text x="10" y="17" font-family="'IBM Plex Sans', sans-serif" font-size="11" fill="${colours.text}">${entry.year}</text>`,
    `<text x="10" y="${48 + titleSize}" font-family="'Newsreader Variable', Georgia, serif" font-size="${titleSize}" fill="#14110f">${title}</text>`,
    entry.rating !== null ? stars(entry.rating, id) : '',
    `<text x="10" y="170" font-family="'IBM Plex Sans', sans-serif" font-size="9.5" fill="#5f5145">${watched}${entry.rewatch ? ', rewatch' : ''}</text>`,
    `</svg>`,
  ].join('');
}
