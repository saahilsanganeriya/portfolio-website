// Sets text as SVG outlines so each poster SVG renders the same anywhere (no font files needed to view it).
import { openSync } from 'fontkit';
import { fileURLToPath } from 'node:url';

const fontsource = (pkg, file) =>
  fileURLToPath(new URL(`../../node_modules/${pkg}/files/${file}`, import.meta.url));

// Variable faces are used at their default instance (League Gothic width 100; Newsreader weight 400, optical
// size 18): fontkit's WOFF2 decoder fails on composite glyphs once variation coordinates are set.
const FACES = {
  gothic: fontsource('@fontsource-variable/league-gothic', 'league-gothic-latin-wdth-normal.woff2'),
  serif: fontsource('@fontsource-variable/newsreader', 'newsreader-latin-opsz-normal.woff2'),
  serifItalic: fontsource('@fontsource-variable/newsreader', 'newsreader-latin-standard-italic.woff2'),
  mono: fontsource('@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-600-normal.woff2'),
};

const loaded = new Map();
function face(name) {
  if (!loaded.has(name)) {
    loaded.set(name, openSync(FACES[name]));
  }
  return loaded.get(name);
}

const round = (d) => d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 100) / 100));

/**
 * Lays out one line and returns its outline path and advance width, in poster units.
 * `tracking` is in thousandths of an em; `anchor` aligns the advance box like SVG text-anchor.
 */
export function setLine(faceName, text, { x = 0, y = 0, size, anchor = 'start', tracking = 0, features = [] }) {
  const font = face(faceName);
  const scale = size / font.unitsPerEm;
  const run = font.layout(text, features);
  const track = (tracking / 1000) * size;
  const width = run.positions.reduce((sum, p) => sum + p.xAdvance * scale + track, 0) - track;
  let pen = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const parts = run.glyphs.map((glyph, i) => {
    const p = run.positions[i];
    const d = glyph.path.scale(scale, -scale).translate(pen + p.xOffset * scale, y - p.yOffset * scale).toSVG();
    pen += p.xAdvance * scale + track;
    return d;
  });
  return { d: round(parts.join('')), width };
}

/** Cap height of a face at a size, for vertical placement. */
export function capHeight(faceName, size) {
  const font = face(faceName);
  return (font.capHeight / font.unitsPerEm) * size;
}
