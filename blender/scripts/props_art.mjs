// Draws the flat artwork of the desk's hero props as SVG and PNG: the keyboard's key legends, the CRT bezel badge and
// the Georgia Tech pennant. Text is set as outlines with fontkit, so the SVGs render the same anywhere.
//
//   node blender/scripts/props_art.mjs legends <layout.json> <out.png>   (props_keyboard.py writes the layout)
//   node blender/scripts/props_art.mjs badge <out_dir>                    crt_badge.svg + crt_badge.png (2048 px)
//   node blender/scripts/props_art.mjs pennant <gt_logo.svg> <out_dir>    pennant_gatech.svg + .png
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSync } from 'fontkit';
import sharp from 'sharp';

const fontsource = (pkg, file) => fileURLToPath(new URL(`../../node_modules/${pkg}/files/${file}`, import.meta.url));
const FACES = {
  sans: fontsource('@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff2'),
  sansBold: fontsource('@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-700-normal.woff2'),
  gothic: fontsource('@fontsource-variable/league-gothic', 'league-gothic-latin-wdth-normal.woff2'),
};
const fonts = new Map();
const font = (name) => {
  if (!fonts.has(name)) fonts.set(name, openSync(FACES[name]));
  return fonts.get(name);
};

const INK = '#1E1B18';
const THREAD = '#B4442C';
const GT_NAVY = '#003057';
const GT_GOLD = '#B3A369';
const FELT_WHITE = '#EFEBE1';

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const n = (v) => Math.round(v * 1000) / 1000;

/** One line of outlined text: its path and advance width. `tracking` is in thousandths of an em. */
function setLine(face, text, { x = 0, y = 0, size, anchor = 'start', tracking = 0 }) {
  const f = font(face);
  const scale = size / f.unitsPerEm;
  const run = f.layout(text);
  const track = (tracking / 1000) * size;
  const width = run.positions.reduce((sum, p) => sum + p.xAdvance * scale + track, 0) - track;
  let pen = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const parts = run.glyphs.map((glyph, i) => {
    const p = run.positions[i];
    const d = glyph.path.scale(scale, -scale).translate(pen + p.xOffset * scale, y - p.yOffset * scale).toSVG();
    pen += p.xAdvance * scale + track;
    return d;
  });
  return { d: parts.join(''), width };
}
const capHeight = (face, size) => (font(face).capHeight / font(face).unitsPerEm) * size;

async function writePng(svgText, out, width, height) {
  await sharp(Buffer.from(svgText), { density: 72 }).resize(width, height).png({ compressionLevel: 9 }).toFile(out);
}

// ---- keyboard legends ----

/** An arrow pointing `dir` (up, down, left, right) of length `len`, centred on (cx, cy), in SVG units. */
function arrow(dir, cx, cy, len) {
  const shaft = len * 0.12;
  const head = len * 0.42;
  const pts = [
    [-len / 2, -shaft / 2], [len / 2 - head, -shaft / 2], [len / 2 - head, -head * 0.55], [len / 2, 0],
    [len / 2 - head, head * 0.55], [len / 2 - head, shaft / 2], [-len / 2, shaft / 2],
  ];
  const turn = { right: 0, down: 90, left: 180, up: 270 }[dir];
  const a = (turn * Math.PI) / 180;
  const p = pts.map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
  return `<path d="M${p.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z"/>`;
}

/**
 * White legends on black. The layout is in metres on the keyboard's flat key plane (x right, y toward the back),
 * origin at the region's lower left; each key gives its top's rectangle and its legends: { t, size_mm, at: tl|bl|c,
 * line } or { arrow, size_mm, at }.
 */
async function legends(layoutFile, out) {
  const layout = JSON.parse(await readFile(layoutFile, 'utf8'));
  const ppm = layout.px_per_m;
  const W = Math.round(layout.width_m * ppm);
  const H = Math.round(layout.height_m * ppm);
  const X = (m) => m * ppm;
  const Y = (m) => (layout.height_m - m) * ppm;
  const inset = layout.inset_mm / 1000;
  const parts = [];
  for (const key of layout.keys) {
    const left = key.x - key.w / 2 + inset;
    const top = key.y + key.h / 2 - inset;
    const bottom = key.y - key.h / 2 + inset;
    for (const item of key.legends) {
      const size = (item.size_mm / 1000) * ppm;
      if (item.arrow) {
        const len = size * 0.9;
        const cx = item.at === 'c' ? X(key.x) : X(left) + len / 2;
        const cy = item.at === 'c' ? Y(key.y) : item.at === 'bl' ? Y(bottom) - len * 0.3 : Y(top) + len * 0.3;
        parts.push(arrow(item.arrow, cx, cy, len));
        continue;
      }
      const cap = capHeight('sansBold', size);
      const lead = size * 1.12 * (item.line ?? 0);
      let x = X(left);
      let anchor = 'start';
      let y;
      if (item.at === 'c') {
        x = X(key.x);
        anchor = 'middle';
        y = Y(key.y) + cap / 2 + lead;
      } else if (item.at === 'bl') {
        y = Y(bottom) - lead;
      } else {
        y = Y(top) + cap + lead;
      }
      parts.push(`<path d="${setLine('sansBold', item.t, { x, y, size, anchor }).d}"/>`);
    }
  }
  for (const mark of layout.marks ?? []) {
    const size = (mark.size_mm / 1000) * ppm;
    parts.push(`<path d="${setLine('sans', mark.t, { x: X(mark.x), y: Y(mark.y), size, anchor: 'middle' }).d}"/>`);
  }
  const body = `<rect width="${W}" height="${H}" fill="#000"/><g fill="#fff">${parts.join('')}</g>`;
  await writePng(svg(W, H, body), out, W, H);
  console.log(`legends ${W}x${H} ${layout.keys.length} keys -> ${out}`);
}

// ---- CRT bezel badge: a thread-spool mark and the "SANGANERIYA" wordmark ----

/** The spool, side on, in a box `s` high whose top left is (x, y): two flanges and a barrel wound with thread. */
function spool(x, y, s) {
  const flangeW = s * 0.86;
  const flangeH = s * 0.14;
  const barrelW = s * 0.58;
  const cx = x + flangeW / 2;
  const r = flangeH * 0.42;
  const top = `<rect x="${n(x)}" y="${n(y)}" width="${n(flangeW)}" height="${n(flangeH)}" rx="${n(r)}" fill="${INK}"/>`;
  const bottom = `<rect x="${n(x)}" y="${n(y + s - flangeH)}" width="${n(flangeW)}" height="${n(flangeH)}" rx="${n(r)}" fill="${INK}"/>`;
  const by = y + flangeH;
  const bh = s - 2 * flangeH;
  const barrel = `<rect x="${n(cx - barrelW / 2)}" y="${n(by)}" width="${n(barrelW)}" height="${n(bh)}" fill="${THREAD}"/>`;
  // Wraps of thread across the barrel, slightly slanted as wound thread lies.
  const wraps = [];
  const count = 6;
  for (let i = 1; i < count; i += 1) {
    const yy = by + (bh * i) / count;
    wraps.push(`<line x1="${n(cx - barrelW / 2)}" y1="${n(yy + bh * 0.03)}" x2="${n(cx + barrelW / 2)}" y2="${n(yy - bh * 0.03)}"/>`);
  }
  const wrapGroup = `<g stroke="#7E2C1C" stroke-width="${n(s * 0.022)}" stroke-linecap="butt">${wraps.join('')}</g>`;
  return { body: top + barrel + wrapGroup + bottom, width: flangeW };
}

async function badge(outDir) {
  await mkdir(outDir, { recursive: true });
  // Drawn at 2048 x 320 units (6.4 : 1, the plate's face); the PNG is the same size, transparent around the ink.
  const W = 2048;
  const H = 320;
  const markH = 236;
  const markY = (H - markH) / 2;
  const mark = spool(64, markY, markH);
  const size = 196;
  const cap = capHeight('sans', size);
  const wordX = 64 + mark.width + 72;
  const word = setLine('sans', 'SANGANERIYA', { x: wordX, y: H / 2 + cap / 2, size, tracking: 165 });
  const right = wordX + word.width + 64;
  const shift = (W - right) / 2;
  const body =
    `<g transform="translate(${n(shift)} 0)">${mark.body}<path d="${word.d}" fill="${INK}"/></g>`;
  const text = svg(W, H, body);
  await writeFile(path.join(outDir, 'crt_badge.svg'), `${text}\n`);
  await writePng(text, path.join(outDir, 'crt_badge.png'), W, H);
  console.log(`badge ${W}x${H} wordmark ${Math.round(word.width)} units -> ${outDir}`);
}

// ---- Georgia Tech pennant: navy felt, a gold header, the interlocking GT and the name ----

async function pennant(logoFile, outDir) {
  await mkdir(outDir, { recursive: true });
  // A 30 x 12 inch dorm pennant, 762 x 305 mm, at 2.6875 units per mm -> 2048 x 819.
  const W = 2048;
  const H = 819;
  const header = W * 0.085;
  const half = (x) => (H / 2) * (1 - x / W) + 3;
  const logo = await readFile(logoFile, 'utf8');
  const view = logo.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  // On navy felt the logo's navy outline becomes white felt; the gold stays Tech Gold.
  const onNavy = inner.replace(/#003057/gi, FELT_WHITE).replace(/#b3a369/gi, GT_GOLD);
  const logoH = H * 0.5;
  const logoW = (logoH * view[2]) / view[3];
  const logoX = header + W * 0.035;
  const logoY = H / 2 - logoH / 2;
  const tri = `M${header} ${H / 2 - half(header)}L${W} ${H / 2 - 3}L${W} ${H / 2 + 3}L${header} ${H / 2 + half(header)}Z`;
  // The name in gold block letters, each one as tall as the pennant allows at its right edge, so they taper smoothly.
  const name = 'GEORGIA TECH';
  const capRatio = font('gothic').capHeight / font('gothic').unitsPerEm;
  const glyphs = [];
  let x = logoX + logoW + W * 0.04;
  for (const ch of name) {
    if (ch === ' ') {
      x += half(x) * 0.34;
      continue;
    }
    let size = (half(x) * 2 * 0.56) / capRatio;
    for (let i = 0; i < 6; i += 1) {
      const right = x + setLine('gothic', ch, { size }).width;
      size = (half(right) * 2 * 0.56) / capRatio;
    }
    const g = setLine('gothic', ch, { x, y: H / 2 + capHeight('gothic', size) / 2, size });
    glyphs.push(`<path d="${g.d}"/>`);
    x += g.width + size * 0.05;
  }
  const inset = 16;
  const stitchPath = `M${n(header + inset)} ${n(H / 2 - half(header + inset) + inset)}L${n(W - inset * 3)} ${n(H / 2)}L${n(header + inset)} ${n(H / 2 + half(header + inset) - inset)}`;
  const stitch = `<path d="${stitchPath}" fill="none" stroke="#2A4B70" stroke-width="5" stroke-dasharray="14 9"/>`;
  const body =
    `<path d="${tri}" fill="${GT_NAVY}"/>` +
    stitch +
    `<rect x="0" y="0" width="${n(header)}" height="${H}" fill="${GT_GOLD}"/>` +
    `<line x1="${n(header - 10)}" y1="0" x2="${n(header - 10)}" y2="${H}" stroke="#8A7D4B" stroke-width="5" stroke-dasharray="14 9"/>` +
    `<g transform="translate(${n(logoX)} ${n(logoY)}) scale(${n(logoH / view[3])})">${onNavy}</g>` +
    `<g fill="${GT_GOLD}">${glyphs.join('')}</g>`;
  const text = svg(W, H, body);
  await writeFile(path.join(outDir, 'pennant_gatech.svg'), `${text}\n`);
  await writePng(text, path.join(outDir, 'pennant_gatech.png'), W, H);
  console.log(`pennant ${W}x${H}, name ends at ${Math.round(x)} -> ${outDir}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'legends') await legends(args[0], args[1]);
else if (command === 'badge') await badge(args[0]);
else if (command === 'pennant') await pennant(args[0], args[1]);
else {
  console.error('usage: props_art.mjs legends <layout.json> <out.png> | badge <out_dir> | pennant <gt_logo.svg> <out_dir>');
  process.exit(2);
}
