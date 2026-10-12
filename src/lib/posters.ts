// The room's poster sheet, shared by the hand-drawn set (scripts/posters/designs.mjs) and renderPoster(), which
// draws a typographic poster at runtime for a favourite with no hand-drawn art: the year as the picture, the title
// in League Gothic, the credit line in Newsreader, all outlined from poster-glyphs.ts so the SVG needs no fonts.
// For a texture: img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderPoster(film))}`.
import { GLYPHS, type GlyphFace } from './poster-glyphs.ts';

export const SHEET = {
  width: 600,
  height: 900,
  margin: 40,
  titleSize: 150,
  titleBase: 702,
  titleLead: 122,
  creditBase: 866,
  creditSize: 19,
} as const;

export const INKS = { paper: '#EDE4D3', ink: '#14110F', thread: '#B4442C', dust: '#A89F91' } as const;

// Letterpress: one warp field roughens every printed edge and one speckle field lets the sheet show through
// the ink at the same pits on every layer, as it does on a hand-inked press.
export const POSTER_DEFS = `
<filter id="press" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="warp"/>
  <feDisplacementMap in="SourceGraphic" in2="warp" scale="2" xChannelSelector="R" yChannelSelector="G" result="rough"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="11" result="speck"/>
  <feColorMatrix in="speck" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -9 0 0 0 6.1" result="mask"/>
  <feComposite in="rough" in2="mask" operator="arithmetic" k1="0.3" k2="0.7"/>
</filter>
<filter id="stamp" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="23" result="warp"/>
  <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="3" seed="5" result="speck"/>
  <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -6 0 0 0 3.7" result="mask"/>
  <feComposite in="rough" in2="mask" operator="in"/>
</filter>
<filter id="fibre" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.6 0.9" numOctaves="3" seed="3" stitchTiles="stitch"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.36  0 0 0 0 0.3  0 0 0 -1.6 1.05"/>
</filter>`;

const hexToRgb = (hex: string) => {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** `a` moved toward `b` by `t` (0–1), as #rrggbb. */
export function mix(a: string, b: string, t: number): string {
  const [ra, ga, ba] = hexToRgb(a);
  const [rb, gb, bb] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(ra, rb)}${c(ga, gb)}${c(ba, bb)}`;
}

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/** The printed sheet: art and type under the press filter, an optional overlay above it, paper fibre on top. */
export function composeSheet({ id, label, ground, art, type, overlay = '' }: {
  id: string; label: string; ground: string; art: string; type: string; overlay?: string;
}): string {
  const { width: W, height: H } = SHEET;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-poster="${escapeXml(id)}">
<title>${escapeXml(label)}</title>
<defs>${POSTER_DEFS}</defs>
<rect width="${W}" height="${H}" fill="${INKS.paper}"/>
<g filter="url(#press)">
<rect width="${W}" height="${H}" fill="${ground}"/>
${art}
${type}
</g>
${overlay}
<rect width="${W}" height="${H}" filter="url(#fibre)" opacity="0.5" style="mix-blend-mode:multiply"/>
</svg>
`;
}

// ---- Type from the outline table ----

const TITLE_TRACKING = 8;
const TITLE_WIDTH = SHEET.width - 2 * SHEET.margin;
const TITLE_BOTTOM = SHEET.titleBase + SHEET.titleLead;
const TITLE_TOP_LIMIT = 470;
const LEAD = SHEET.titleLead / SHEET.titleSize;
const FALLBACK_FAMILY = {
  gothic: "'League Gothic Variable','League Gothic',Impact,'Arial Narrow',sans-serif",
  serif: "'Newsreader Variable',Newsreader,Georgia,serif",
};

const stripMarks = (ch: string) => ch.normalize('NFKD').replace(/\p{M}/gu, '');

/** The table's spelling of `text` (accents dropped where the face lacks the accented glyph), or null. */
function spell(face: GlyphFace, text: string): string[] | null {
  const chars = [...text].map((ch) => (face.glyphs[ch] ? ch : stripMarks(ch)));
  return chars.every((ch) => [...ch].every((c) => face.glyphs[c])) ? chars.flatMap((ch) => [...ch]) : null;
}

/** Advance width in em at size 1, or an estimate when the face cannot set the text (CJK and wider at 1 em). */
function widthEm(face: GlyphFace, text: string, tracking = 0): number {
  const chars = spell(face, text);
  if (!chars) return [...text].reduce((sum, ch) => sum + (ch.codePointAt(0)! >= 0x2e80 ? 1 : 0.42), 0);
  const units = chars.reduce((sum, ch, i) => sum + face.glyphs[ch][0] + (face.kern[ch + (chars[i + 1] ?? '')] ?? 0), 0);
  return units / face.unitsPerEm + (tracking / 1000) * Math.max(0, chars.length - 1);
}

// fontkit paths hold only absolute M/L/Q/C/Z commands, so the numbers alternate x, y.
function place(d: string, scale: number, dx: number, dy: number): string {
  let i = 0;
  return d.replace(/-?\d+(?:\.\d+)?/g, (v) => {
    const out = i++ % 2 === 0 ? dx + Number(v) * scale : dy - Number(v) * scale;
    return String(Math.round(out * 100) / 100);
  });
}

/** One line of type as an SVG element: outlined when the table covers it, else a <text> fallback. */
function setLine(
  faceName: 'gothic' | 'serif',
  text: string,
  { x, y, size, fill, anchor = 'start', tracking = 0 }: {
    x: number; y: number; size: number; fill: string; anchor?: 'start' | 'end'; tracking?: number;
  },
): string {
  const face = GLYPHS[faceName];
  const width = widthEm(face, text, tracking) * size;
  let pen = anchor === 'end' ? x - width : x;
  const chars = spell(face, text);
  if (!chars) {
    return `<text x="${Math.round(pen * 100) / 100}" y="${y}" font-family="${FALLBACK_FAMILY[faceName]}" font-size="${size}" ` +
      `letter-spacing="${(tracking / 1000) * size}" fill="${fill}">${escapeXml(text)}</text>`;
  }
  const scale = size / face.unitsPerEm;
  const parts = chars.map((ch, i) => {
    const [advance, d] = face.glyphs[ch];
    const placed = place(d, scale, pen, y);
    pen += (advance + (face.kern[ch + (chars[i + 1] ?? '')] ?? 0)) * scale + (tracking / 1000) * size;
    return placed;
  });
  return `<path fill="${fill}" d="${parts.join('')}"/>`;
}

// Every way to cut `words` into `lines` consecutive runs.
function* partitions(words: string[], lines: number): Generator<string[]> {
  if (lines === 1) {
    yield [words.join(' ')];
    return;
  }
  for (let cut = 1; cut <= words.length - lines + 1; cut += 1) {
    for (const rest of partitions(words.slice(cut), lines - 1)) yield [words.slice(0, cut).join(' '), ...rest];
  }
}

/**
 * The title cut into 1–4 lines at the largest size that fits. On a tie two lines win, as on the hand-drawn sheets,
 * then the most even cut ("LA LA / LAND", not "LA / LA LAND").
 */
export function layoutTitle(title: string): { lines: string[]; size: number } {
  const face = GLYPHS.gothic;
  const cap = face.capHeight / face.unitsPerEm;
  const words = title.toLocaleUpperCase('en-US').split(/\s+/).filter(Boolean);
  let best = { lines: [words.join(' ')], size: 0, rank: -1 };
  for (let count = 1; count <= Math.min(4, words.length); count += 1) {
    const tallest = (TITLE_BOTTOM - TITLE_TOP_LIMIT) / (cap + (count - 1) * LEAD);
    for (const lines of partitions(words, count)) {
      const widest = Math.max(...lines.map((line) => widthEm(face, line, TITLE_TRACKING)));
      const size = Math.min(SHEET.titleSize, TITLE_WIDTH / widest, tallest);
      const rank = size + (count === 2 ? 0.5 : 0) - count * 0.01 - widest * 0.001;
      if (rank > best.rank) best = { lines, size, rank };
    }
  }
  return { lines: best.lines, size: Math.round(best.size * 100) / 100 };
}

// ---- The runtime poster ----

const GROUNDS = [
  { ground: '#21141A', type: INKS.paper },
  { ground: '#202C39', type: INKS.paper },
  { ground: '#16201C', type: INKS.paper },
  { ground: '#3B2A1E', type: INKS.paper },
  { ground: '#7A2026', type: INKS.paper },
  { ground: INKS.paper, type: INKS.ink },
] as const;

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return h;
}

export interface PosterFilm {
  slug: string;
  title: string;
  year: number;
  director: string;
}

/** A 600 x 900 typographic poster for `film` as a self-contained SVG string; the same film always draws the same. */
export function renderPoster(film: PosterFilm): string {
  const { margin: M, width: W, creditBase, creditSize } = SHEET;
  const { ground, type } = GROUNDS[hash(film.slug) % GROUNDS.length];
  const credit = type === INKS.ink ? INKS.ink : mix(INKS.paper, INKS.dust, 0.45);
  const gothic = GLYPHS.gothic;
  const cap = gothic.capHeight / gothic.unitsPerEm;

  const { lines, size } = layoutTitle(film.title);
  const lead = size * LEAD;
  const title = lines
    .map((line, i) => setLine('gothic', line, {
      x: M - 2, y: TITLE_BOTTOM - (lines.length - 1 - i) * lead, size, fill: type, tracking: TITLE_TRACKING,
    }))
    .join('\n');

  // The year fills the space above the title, edge to edge, a shade off the ground.
  const year = String(film.year);
  const titleTop = TITLE_BOTTOM - (lines.length - 1) * lead - cap * size;
  const yearSize = Math.min(TITLE_WIDTH / widthEm(gothic, year), (titleTop - 110) / cap);
  const yearBase = (50 + titleTop - 40 + cap * yearSize) / 2;
  const art =
    setLine('gothic', year, { x: M, y: Math.round(yearBase), size: yearSize, fill: mix(ground, type, 0.14) }) +
    `<rect x="${M}" y="${Math.round(yearBase + 22)}" width="${TITLE_WIDTH}" height="3" fill="${INKS.thread}"/>`;

  // Credit line: "a film by" in italic, the director, the year flush right; it shrinks to fit a long name.
  const yearWidth = widthEm(GLYPHS.serif, year) * creditSize;
  const byline = GLYPHS.byline;
  const nameRoom = TITLE_WIDTH - yearWidth - 16;
  const nameEm = byline.advance / byline.unitsPerEm + 7 / creditSize + widthEm(GLYPHS.serif, film.director);
  const nameSize = Math.min(creditSize, nameRoom / nameEm);
  const bylinePath = `<path fill="${credit}" d="${place(byline.d, nameSize / byline.unitsPerEm, M, creditBase)}"/>`;
  const name = setLine('serif', film.director, {
    x: M + (byline.advance / byline.unitsPerEm) * nameSize + 7 * (nameSize / creditSize), y: creditBase, size: nameSize, fill: credit,
  });
  const yearLine = setLine('serif', year, { x: W - M, y: creditBase, size: creditSize, fill: credit, anchor: 'end' });

  return composeSheet({
    id: film.slug,
    label: `${film.title} (${film.year}), directed by ${film.director}: a typographic poster`,
    ground,
    art,
    type: `${title}\n${bylinePath}${name}${yearLine}`,
  });
}
