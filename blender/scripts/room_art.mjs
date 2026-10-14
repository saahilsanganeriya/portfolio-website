// Draws the room's typographic art as PNGs for the bake: the six book spines and covers, the Japanese-literature
// print, the Georgia Tech pennant, the Voyager record's engraved cover and its plate, and the sticky notes the stills
// show (the phrases from src/content/sticky-notes.json). Text is set as outlines (scripts/posters/type.mjs), so no font files are needed to render.
//
//   node blender/scripts/room_art.mjs [out_dir]        (default blender/.cache/art; build_room.py runs it)
//
// Every design is original type and simple geometry in the site's palette; no cover art is copied. The Voyager
// engraving is redrawn from the diagrams on the record's cover (NASA, public domain).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { capHeight, setLine } from '../../scripts/posters/type.mjs';

const OUT = path.resolve(process.argv[2] ?? new URL('../.cache/art/', import.meta.url).pathname);
const PX_PER_MM = 4; // 4000 px per metre: twice the densest bake the spines get

const INK = '#14110F';
const PAPER = '#EDE4D3';
const DUST = '#A89F91';
const THREAD = '#B4442C';

// The six books of the brief: [slug, title lines, author, year of the English edition, thickness and height in mm,
// cloth, ink, accent, motif].
export const BOOKS = [
  ['the-wind-up-bird-chronicle', ['The Wind-Up', 'Bird Chronicle'], 'Haruki Murakami', 1997, 46, 240, '#7E6029', PAPER, '#2A1F12', 'well'],
  ['kafka-on-the-shore', ['Kafka on', 'the Shore'], 'Haruki Murakami', 2005, 38, 235, '#2F4652', PAPER, '#C9B27A', 'wave'],
  ['1q84', ['1Q84'], 'Haruki Murakami', 2011, 62, 242, '#E3DACA', INK, THREAD, 'moons'],
  ['kitchen', ['Kitchen'], 'Banana Yoshimoto', 1993, 17, 200, '#9C5B45', PAPER, '#E8C9A0', 'steam'],
  ['on-earth-were-briefly-gorgeous', ['On Earth We’re', 'Briefly Gorgeous'], 'Ocean Vuong', 2019, 27, 216, '#5E2E2B', PAPER, '#D9A88F', 'line'],
  ['the-elegant-universe', ['The Elegant', 'Universe'], 'Brian Greene', 1999, 34, 236, '#1C2638', '#D8BE7E', '#D8BE7E', 'strings'],
];

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** A line of outlined text, optionally turned 90 degrees clockwise about (x, y) (spines read top to bottom). */
function text(face, str, { x, y, size, fill, anchor = 'middle', tracking = 0, rotate = 0 }) {
  const { d } = setLine(face, str, { x: 0, y: 0, size, anchor, tracking });
  return `<path d="${d}" fill="${fill}" transform="translate(${x} ${y}) rotate(${rotate})"/>`;
}

const fitSize = (face, str, size, max, tracking = 0) => {
  const { width } = setLine(face, str, { size, tracking });
  return width > max ? (size * max) / width : size;
};

function motif(kind, cx, cy, r, colour) {
  switch (kind) {
    case 'well':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.42}" fill="none" stroke="${colour}" stroke-width="${r * 0.12}"/>` +
        `<ellipse cx="${cx}" cy="${cy}" rx="${r * 0.62}" ry="${r * 0.24}" fill="${colour}"/>`;
    case 'wave':
      return `<path d="M${cx - r} ${cy} q${r / 2} ${-r * 0.5} ${r} 0 t${r} 0" fill="none" stroke="${colour}" stroke-width="${r * 0.14}" stroke-linecap="round"/>`;
    case 'moons':
      return `<circle cx="${cx - r * 0.35}" cy="${cy}" r="${r * 0.62}" fill="${colour}"/>` +
        `<circle cx="${cx + r * 0.55}" cy="${cy - r * 0.35}" r="${r * 0.3}" fill="none" stroke="${colour}" stroke-width="${r * 0.1}"/>`;
    case 'steam':
      return [-1, 0, 1].map((k) => `<path d="M${cx + k * r * 0.45} ${cy + r * 0.6} c${r * 0.3} ${-r * 0.4} ${-r * 0.3} ${-r * 0.7} 0 ${-r * 1.2}" fill="none" stroke="${colour}" stroke-width="${r * 0.12}" stroke-linecap="round"/>`).join('');
    case 'line':
      return `<line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="${colour}" stroke-width="${r * 0.1}"/>` +
        `<circle cx="${cx + r * 0.2}" cy="${cy}" r="${r * 0.16}" fill="${colour}"/>`;
    case 'strings':
      return [0, 1, 2].map((k) => `<path d="M${cx - r} ${cy + (k - 1) * r * 0.35} C${cx - r * 0.3} ${cy - r * 0.6 + k * 0.3 * r} ${cx + r * 0.3} ${cy + r * 0.6 - k * 0.3 * r} ${cx + r} ${cy + (k - 1) * r * 0.35}" fill="none" stroke="${colour}" stroke-width="${r * 0.07}"/>`).join('');
    default:
      return '';
  }
}

/** Cloth texture: faint horizontal weave lines and a darker wear band at head and foot. */
function cloth(w, h, colour, id) {
  return `<defs><pattern id="weave${id}" width="6" height="6" patternUnits="userSpaceOnUse">` +
    `<rect width="6" height="6" fill="${colour}"/><path d="M0 0.5h6M0 3.5h6" stroke="#000" stroke-opacity="0.06" stroke-width="1"/>` +
    `<path d="M1.5 0v6M4.5 0v6" stroke="#fff" stroke-opacity="0.035" stroke-width="1"/></pattern>` +
    `<linearGradient id="wear${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.22"/>` +
    `<stop offset="0.04" stop-color="#000" stop-opacity="0"/><stop offset="0.96" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity="0.25"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#weave${id})"/><rect width="${w}" height="${h}" fill="url(#wear${id})"/>`;
}

function spine([slug, title, author, year, thick, height, colour, ink, accent, kind], i) {
  const w = thick * PX_PER_MM;
  const h = height * PX_PER_MM;
  const line = title.join(' ');
  const cx = w / 2;
  // Title reads top to bottom: rotated 90 degrees, its baseline offset so the caps sit centred across the spine.
  const titleSize = fitSize('serif', line, Math.min(w * 0.42, 15 * PX_PER_MM), h * 0.56);
  const authorSize = fitSize('gothic', author.toUpperCase(), Math.min(w * 0.30, 7 * PX_PER_MM), h * 0.30, 60);
  const t = text('serif', line, { x: cx - capHeight('serif', titleSize) / 2, y: h * 0.09, size: titleSize, fill: ink, anchor: 'start', rotate: 90 });
  const a = text('gothic', author.toUpperCase(), { x: cx - capHeight('gothic', authorSize) / 2, y: h * 0.70, size: authorSize, fill: ink, anchor: 'start', tracking: 60, rotate: 90 });
  const rules = [h * 0.035, h * 0.045, h * 0.955, h * 0.965].map((y) => `<rect x="0" y="${y}" width="${w}" height="${h * 0.003}" fill="${accent}" opacity="0.85"/>`).join('');
  const mark = motif(kind, cx, h * 0.925, Math.min(w * 0.3, 5 * PX_PER_MM), accent);
  return { name: `spine_${slug}`, w, h, body: cloth(w, h, colour, i) + rules + t + a + mark, year };
}

function cover([slug, title, author, year, , height, colour, ink, accent, kind], i) {
  const h = height * PX_PER_MM;
  const w = Math.round(h * 0.66);
  const lines = title.map((l, k) => {
    const size = fitSize('serif', l, w * 0.15, w * 0.8);
    return text('serif', l, { x: w / 2, y: h * 0.2 + k * w * 0.17, size, fill: ink });
  }).join('');
  const by = text('gothic', author.toUpperCase(), { x: w / 2, y: h * 0.88, size: fitSize('gothic', author.toUpperCase(), w * 0.07, w * 0.7, 80), fill: ink, tracking: 80 });
  const art = motif(kind, w / 2, h * 0.58, w * 0.2, accent);
  const frame = `<rect x="${w * 0.06}" y="${w * 0.06}" width="${w * 0.88}" height="${h - w * 0.12}" fill="none" stroke="${accent}" stroke-width="${w * 0.006}" opacity="0.7"/>`;
  return { name: `cover_${slug}`, w, h, body: cloth(w, h, colour, `c${i}`) + frame + lines + art + by, year };
}

/** Japanese literature, read in translation: a cream print with a red sun and a second, smaller moon. */
function printJapaneseLit() {
  const w = 1200, h = 1680;
  const body = [
    `<rect width="${w}" height="${h}" fill="${PAPER}"/>`,
    text('gothic', 'JAPANESE LITERATURE', { x: w / 2, y: 150, size: 64, fill: INK, tracking: 260 }),
    `<rect x="${w / 2 - 60}" y="196" width="120" height="4" fill="${INK}"/>`,
    `<circle cx="${w / 2}" cy="${h * 0.45}" r="250" fill="${THREAD}"/>`,
    `<circle cx="${w / 2 + 300}" cy="${h * 0.45 - 260}" r="62" fill="none" stroke="${INK}" stroke-width="6"/>`,
    `<rect x="120" y="${h * 0.45 + 330}" width="${w - 240}" height="3" fill="${INK}"/>`,
    text('serifItalic', 'Murakami', { x: w / 2, y: h * 0.77, size: 168, fill: INK }),
    text('serif', 'Haruki Murakami · Banana Yoshimoto', { x: w / 2, y: h * 0.84, size: 46, fill: INK }),
    text('gothic', 'READ IN TRANSLATION', { x: w / 2, y: h * 0.92, size: 40, fill: DUST, tracking: 300 }),
  ].join('');
  return { name: 'print_japanese_lit', w, h, body };
}

/**
 * A felt pennant in Georgia Tech's colours (navy and Tech Gold), lettered in a condensed gothic; no marks. The
 * pennant mesh maps this texture's triangle (hoist on the left, the point at the right middle), so the lettering is
 * sized to stay inside the taper.
 */
function pennant() {
  const w = 2400, h = 760;
  const navy = '#003057', gold = '#B3A369';
  const size = 270;
  const body = [
    `<rect width="${w}" height="${h}" fill="${navy}"/>`,
    `<path d="M0 0 L${w} ${h / 2} L0 ${h} Z" fill="${navy}" stroke="${gold}" stroke-width="22"/>`,
    `<rect width="180" height="${h}" fill="${PAPER}"/>`,
    `<rect x="180" width="16" height="${h}" fill="${gold}"/>`,
    text('gothic', 'GEORGIA TECH', { x: 270, y: h / 2 + capHeight('gothic', size) / 2, size, fill: gold, anchor: 'start', tracking: 40 }),
  ].join('');
  return { name: 'pennant_gatech', w, h, body };
}

/**
 * The engraved cover of the Voyager Golden Record, redrawn: the record and stylus seen from above and from the
 * side with the binary rotation period, the video waveform and the first frame, the pulsar map with the Sun's
 * distance to the galactic centre, and hydrogen in its two lowest states. White lines on black, used as a mask
 * over gold.
 */
function voyagerCover() {
  const s = 2048, c = s / 2, R = s * 0.48;
  const st = 'fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"';
  const parts = [`<rect width="${s}" height="${s}" fill="#000"/>`, `<circle cx="${c}" cy="${c}" r="${R}" ${st}/>`];
  // Record from above, stylus, and the binary period around it.
  const rx = s * 0.3, ry = s * 0.3, rr = s * 0.13;
  parts.push(`<circle cx="${rx}" cy="${ry}" r="${rr}" ${st}/>`, `<circle cx="${rx}" cy="${ry}" r="${rr * 0.18}" ${st}/>`);
  parts.push(`<line x1="${rx + rr * 1.1}" y1="${ry - rr * 0.9}" x2="${rx + rr * 0.35}" y2="${ry - rr * 0.15}" ${st}/>`);
  for (let k = 0; k < 16; k += 1) {
    const a = (-150 + k * 9) * (Math.PI / 180);
    const len = k % 3 === 0 ? 34 : 18;
    parts.push(`<line x1="${rx + Math.cos(a) * (rr + 30)}" y1="${ry + Math.sin(a) * (rr + 30)}" x2="${rx + Math.cos(a) * (rr + 30 + len)}" y2="${ry + Math.sin(a) * (rr + 30 + len)}" ${st}/>`);
  }
  // Side view below it.
  parts.push(`<rect x="${rx - rr}" y="${s * 0.5}" width="${rr * 2}" height="14" ${st}/>`,
    `<line x1="${rx + rr * 0.9}" y1="${s * 0.5 - 70}" x2="${rx + rr * 0.3}" y2="${s * 0.5}" ${st}/>`);
  // Waveform and its frame, top right.
  const wx = s * 0.58, wy = s * 0.22;
  let wave = `M${wx} ${wy + 60}`;
  for (let k = 0; k < 6; k += 1) wave += ` l30 -60 l10 60 l40 0`;
  parts.push(`<path d="${wave}" ${st}/>`);
  for (let k = 0; k < 5; k += 1) parts.push(`<line x1="${wx}" y1="${wy + 110 + k * 28}" x2="${wx + 480}" y2="${wy + 110 + k * 28}" ${st}/>`);
  parts.push(`<rect x="${wx + 120}" y="${s * 0.44}" width="240" height="190" ${st}/>`, `<circle cx="${wx + 240}" cy="${s * 0.44 + 95}" r="58" ${st}/>`);
  // Pulsar map, bottom left: fourteen lines from the Sun with tick marks, and the long line to the galactic centre.
  const px = s * 0.33, py = s * 0.72;
  const pulsars = [12, 38, 61, 85, 112, 140, 165, 190, 214, 240, 266, 292, 318, 344];
  pulsars.forEach((deg, k) => {
    const a = (deg * Math.PI) / 180;
    const len = 90 + ((k * 53) % 170);
    parts.push(`<line x1="${px}" y1="${py}" x2="${px + Math.cos(a) * len}" y2="${py + Math.sin(a) * len}" stroke="#fff" stroke-width="9"/>`);
    for (let t = 0; t < 4 + (k % 4); t += 1) {
      const d = 30 + t * 14;
      const nx = -Math.sin(a), ny = Math.cos(a);
      parts.push(`<line x1="${px + Math.cos(a) * d - nx * 7}" y1="${py + Math.sin(a) * d - ny * 7}" x2="${px + Math.cos(a) * d + nx * 7}" y2="${py + Math.sin(a) * d + ny * 7}" stroke="#fff" stroke-width="7"/>`);
    }
  });
  parts.push(`<line x1="${px}" y1="${py}" x2="${px + 420}" y2="${py + 12}" stroke="#fff" stroke-width="9"/>`);
  // Hydrogen, bottom right: two small circles joined, the transition marked "1".
  const hx = s * 0.68, hy = s * 0.74;
  parts.push(`<circle cx="${hx - 60}" cy="${hy}" r="30" ${st}/>`, `<circle cx="${hx + 60}" cy="${hy}" r="30" ${st}/>`,
    `<line x1="${hx - 30}" y1="${hy}" x2="${hx + 30}" y2="${hy}" ${st}/>`, `<line x1="${hx}" y1="${hy - 60}" x2="${hx}" y2="${hy - 30}" ${st}/>`);
  return { name: 'voyager_cover', w: s, h: s, body: parts.join('') };
}

function voyagerPlate() {
  const w = 1400, h = 260;
  const body = [`<rect width="${w}" height="${h}" fill="#000"/>`,
    text('serif', 'The Sounds of Earth', { x: w / 2, y: 120, size: 96, fill: '#fff' }),
    text('gothic', 'VOYAGER GOLDEN RECORD · 1977', { x: w / 2, y: 210, size: 56, fill: '#fff', tracking: 200 })].join('');
  return { name: 'voyager_plate', w, h, body };
}

/** Wraps a phrase into lines of at most `max` characters, breaking at spaces. */
function wrap(phrase, max) {
  const lines = [];
  for (const word of phrase.split(' ')) {
    const last = lines.at(-1);
    if (last && (last + ' ' + word).length <= max) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  return lines;
}

/**
 * The stills' sticky notes: the phrases in src/content/sticky-notes.json (the site writes the same ones at runtime),
 * or the two the brief names before that file exists.
 */
async function stickyNotes() {
  let phrases = ['You win some, you lose some.', 'Cost of doing business.'];
  try {
    phrases = JSON.parse(await readFile(new URL('../../src/content/sticky-notes.json', import.meta.url), 'utf8'));
  } catch {}
  return phrases.slice(0, 6).map((phrase, k) => {
    const s = 800;
    const lines = wrap(phrase, 14);
    const size = Math.min(110, ...lines.map((l) => fitSize('serifItalic', l, 110, s * 0.84)));
    const top = s / 2 - ((lines.length - 1) * size * 1.25) / 2 + size * 0.3;
    const body = [`<rect width="${s}" height="${s}" fill="#fff"/>`,
      ...lines.map((l, j) => text('serifItalic', l, { x: s / 2, y: top + j * size * 1.25, size, fill: '#1E2A44' }))].join('');
    return { name: `sticky_note_${k}`, w: s, h: s, body };
  });
}

await mkdir(OUT, { recursive: true });
const jobs = [...BOOKS.map(spine), ...BOOKS.map(cover), printJapaneseLit(), pennant(), voyagerCover(), voyagerPlate(), ...(await stickyNotes())];
for (const { name, w, h, body } of jobs) {
  const file = path.join(OUT, `${name}.png`);
  await sharp(Buffer.from(svg(Math.round(w), Math.round(h), body))).png({ compressionLevel: 9 }).toFile(file);
}
await writeFile(path.join(OUT, 'books.json'), JSON.stringify(BOOKS.map(([slug, title, author, year, thick, height, colour]) => ({ slug, title: title.join(' '), author, year, thick_mm: thick, height_mm: height, cloth: colour })), null, 2));
console.log(`room_art: ${jobs.length} images in ${OUT}`);
