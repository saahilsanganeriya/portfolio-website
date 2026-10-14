import gochiHand from '@fontsource/gochi-hand/files/gochi-hand-latin-400-normal.woff2?url';

// His handwriting in the room: the sticky notes and the marker captions on the Instax prints are one hand, Gochi Hand
// (HT Fonts, SIL OFL 1.1), drawn glyph by glyph with a small turn, lift and size change on each, a slant per line and a
// heavier stroke for marker, so no two prints carry the same letters and nothing reads as typed. Every jitter comes
// from a seed, so a note or a print looks the same on every visit.

const FAMILY = 'Room Hand';
const FALLBACK = '"Segoe Print", "Bradley Hand", "Comic Neue", cursive';
let loading: Promise<boolean> | null = null;

/** Loads the hand once (19.9 KB); resolves false if it cannot, and the room then writes in a fallback cursive. */
export function loadHand(): Promise<boolean> {
  loading ??= (async () => {
    try {
      const face = new FontFace(FAMILY, `url(${gochiHand}) format("woff2")`);
      document.fonts.add(await face.load());
      return true;
    } catch (error) {
      console.warn('room: the handwriting font did not load; writing in a fallback cursive', error);
      return false;
    }
  })();
  return loading;
}

/** A small seeded generator (mulberry32): the same seed draws the same letters. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from a string (a photo's slug, a phrase). */
export function seedOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface HandStyle {
  /** The largest letter size (px); the text shrinks until it fits. */
  size: number;
  /** Horizontal shear of the letters (tan of the slant angle; positive leans right). */
  slant: number;
  /** Turn of the whole block (radians). */
  turn: number;
  colour: string;
  /** Extra stroke on each letter, as a share of its size: about 0.03 for a felt tip, 0.05 for a marker. */
  weight: number;
  maxWidth: number;
  maxLines: number;
  lineHeight: number;
  seed: number;
}

const font = (size: number) => `${size}px "${FAMILY}", ${FALLBACK}`;

/** Splits `text` into at most `maxLines` lines no wider than `maxWidth` at `size`, or null if it does not fit. */
function wrap(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number, maxLines: number): string[] | null {
  ctx.font = font(size);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      if (!line || ctx.measureText(word).width > maxWidth) return null;
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : null;
}

/** Writes `text` centred on (x, y) in the room's hand. Returns the size it settled on. */
export function writeHand(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: HandStyle) {
  const random = seeded(style.seed);
  let size = style.size;
  let lines = wrap(ctx, text, size, style.maxWidth, style.maxLines);
  while (!lines && size > 8) {
    size *= 0.94;
    lines = wrap(ctx, text, size, style.maxWidth, style.maxLines);
  }
  lines ??= [text];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(style.turn);
  ctx.transform(1, 0, -style.slant, 1, 0, 0);
  ctx.font = font(size);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.colour;
  ctx.strokeStyle = style.colour;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const lead = size * style.lineHeight;
  const top = -((lines.length - 1) * lead) / 2;
  lines.forEach((line, row) => {
    // A hand drifts along a line: each line starts a little off centre and wanders up or down as it goes.
    const width = ctx.measureText(line).width;
    let cursor = -width / 2 + (random() - 0.5) * size * 0.25;
    const drift = (random() - 0.5) * 0.05;
    for (const glyph of line) {
      const advance = ctx.measureText(glyph).width;
      const scale = 1 + (random() - 0.5) * 0.09;
      ctx.save();
      ctx.translate(cursor + advance / 2, top + row * lead + cursor * drift + (random() - 0.5) * size * 0.07);
      ctx.rotate((random() - 0.5) * 0.09);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 0.86 + random() * 0.14;
      ctx.lineWidth = size * style.weight;
      if (style.weight > 0) ctx.strokeText(glyph, -advance / 2, 0);
      ctx.fillText(glyph, -advance / 2, 0);
      ctx.restore();
      cursor += advance * (1 + (random() - 0.5) * 0.06);
    }
  });
  ctx.restore();
  return size;
}
