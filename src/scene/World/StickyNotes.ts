import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';
import { ArtSurface, type LampUniforms } from './art';
import { handFont, loadHand, seeded, seedOf, writeHand } from './handwriting';
import type { StickyNode } from './nodes';
import { STICKY_NOTES, todoItem, type PlacedNote, type StickyKind } from './stickyContent';
import { canvasTexture } from './textures';

// The three sticky notes on the monitor's bezel (src/content/sticky-notes.json): his two phrases and a to-do list in
// his marker, and a few equations set neatly in the site's serif on graph-ruled paper. The room has more note slots
// than notes; the spare ones come off the wall. They hang in the first view, so the hand loads with the room and the
// notes are written before it is shown.

const EDGE_PX = 512;
const MARKER = ['#1c2340', '#20202a', '#1a2f4a'];
const PEN = '#1b2846';
// Under the room's warm lamps a blue or green paper turns grey, so the pad for the equations is a warm white.
const PAPER: Record<StickyKind, string> = { text: '#F0CB4A', equations: '#F4EFDF', todo: '#F4B0C0' };
// A standard 76 mm (3 in) note: the room's 64 mm ones left the to-do and the equations too small to read at the monitor.
const NOTE_EDGE_M = 0.076;
// Of the growth, the share it slides away from the monitor (half would keep its inner edge where it was), and how far
// it stands off the bezel (metres).
const SLIDE_SHARE = 0.25;
const STAND_OFF_M = 0.004;
const PROXY_REACH_M = 0.004;
const SERIF_FAMILY = '"Newsreader Variable"';
const SERIF = `${SERIF_FAMILY}, Georgia, "Times New Roman", serif`;
// Stuck on by hand: each note turns a few degrees about its face.
const MAX_TURN_DEG = 4;
// The writing stays inside this share of the note (the glued strip at the top and the curl at the bottom stay clear).
const MARGIN = { width: 0.86, height: 0.8 };
// Equations: letters lean like a math italic; a fraction's parts are a little smaller than the line.
const MATH_SLANT = 0.2;
const FRACTION_SCALE = 0.86;
const MATH_SPACE_EM = 0.24;
// A felt-tip marker, drawn on a canvas the note shows at about a third of its size, needs a heavy stroke to stay a
// marker; the fineliner for the equations, a lighter one.
const MARKER_WEIGHT = 0.06;
const PEN_WEIGHT = 0.04;
const SET_OPS = { '∩': 'cap', '∪': 'cup' } as const;

export interface WrittenNote {
  slot: number;
  kind: StickyKind;
  lines: readonly string[];
  shown: boolean;
}

/** The paper each kind of note is cut from. */
export const paperFor = (kind: StickyKind) => new THREE.Color(PAPER[kind]);

export class StickyNotes {
  private readonly notes: { note: PlacedNote; node: StickyNode; surface: ArtSurface }[];

  constructor(nodes: StickyNode[], lamp: LampUniforms, proxies: THREE.Object3D[], monitor: THREE.Vector3) {
    this.notes = STICKY_NOTES.flatMap((note) => {
      const node = nodes.find((n) => n.slot === note.slot);
      if (!node) return [];
      const random = seeded(seedOf(`note-${node.slot}`));
      node.mesh.rotateZ(THREE.MathUtils.degToRad((random() * 2 - 1) * MAX_TURN_DEG));
      growNote(node, proxies.find((p) => p.name === `hit_sticky_note_${node.slot}`), monitor);
      node.paper.copy(paperFor(note.kind));
      return [{ note, node, surface: new ArtSurface(node, lamp, { ambient: 0.55, top: 0.5, lightAbove: 0.2, fall: 0.4 }, node.paper) }];
    });
    for (const node of nodes) {
      if (this.notes.some((n) => n.node === node)) continue;
      node.mesh.visible = false;
      const proxy = proxies.findIndex((p) => p.name === `hit_sticky_note_${node.slot}`);
      if (proxy >= 0) proxies.splice(proxy, 1)[0].removeFromParent();
    }
  }

  /** Writes every note (after the hand and the serif have loaded, or in fallback faces). */
  async load() {
    await Promise.all([loadHand(), loadSerif()]);
    for (const { note, node, surface } of this.notes) surface.show(canvasTexture(drawNote(note, node.aspect, node.paper)), true);
  }

  /** What each note says, by slot (tests and measurement). */
  get written(): WrittenNote[] {
    return this.notes.map(({ note, surface }) => ({ slot: note.slot, kind: note.kind, lines: note.lines, shown: surface.shown === 1 }));
  }

  dispose() {
    for (const { surface } of this.notes) surface.dispose();
  }
}

/**
 * Grows a note to a standard size about its middle, so it still covers the shadow the room baked under it. It slides a
 * little away from the monitor to keep off the screen and stands a few millimetres off the bezel, which curves forward
 * toward its edge: slid further, the bezel came through the note (its baked shadow in front of the writing).
 */
function growNote(node: StickyNode, proxy: THREE.Object3D | undefined, monitor: THREE.Vector3) {
  const width = Number(node.mesh.userData.width_m);
  if (!(width > 0) || width >= NOTE_EDGE_M) return;
  const scale = NOTE_EDGE_M / width;
  const before = new THREE.Box3().setFromObject(node.mesh);
  const size = before.getSize(new THREE.Vector3());
  const faceAlongX = size.x >= size.z;
  const along = faceAlongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const side = Math.sign(before.getCenter(new THREE.Vector3()).sub(monitor).dot(along)) || 1;
  const grown = (scale - 1) * Math.max(size.x, size.z);
  const front = node.mesh.getWorldDirection(new THREE.Vector3());
  const shift = along.multiplyScalar(side * grown * SLIDE_SHARE).addScaledVector(front, (STAND_OFF_M * grown) / (NOTE_EDGE_M - width));
  node.mesh.scale.multiplyScalar(scale);
  moveBy(node.mesh, shift);
  if (proxy instanceof THREE.Mesh) fitProxy(proxy, node.mesh, faceAlongX ? 'z' : 'x', front);
}

/**
 * The hover box covers the whole note, front to back, and reaches a few millimetres in front of it: a bezel note is
 * tilted with the bezel, and the room's thin box in front of its middle neither covered it nor let the hover lift claim it.
 */
function fitProxy(proxy: THREE.Mesh, note: THREE.Mesh, depthAxis: 'x' | 'z', front: THREE.Vector3) {
  const box = new THREE.Box3().setFromObject(note);
  if (front[depthAxis] >= 0) box.max[depthAxis] += PROXY_REACH_M * WORLD_SCALE;
  else box.min[depthAxis] -= PROXY_REACH_M * WORLD_SCALE;
  const parent = proxy.parent!;
  const size = box.getSize(new THREE.Vector3()).divide(parent.getWorldScale(new THREE.Vector3()));
  proxy.geometry.dispose();
  proxy.geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  proxy.scale.set(1, 1, 1);
  proxy.position.copy(parent.worldToLocal(box.getCenter(new THREE.Vector3())));
  proxy.updateMatrixWorld(true);
}

/** Moves an object by a world-space offset, whatever its parent's transform. */
function moveBy(object: THREE.Object3D, shift: THREE.Vector3) {
  const parent = object.parent!;
  const at = object.getWorldPosition(new THREE.Vector3());
  object.position.add(parent.worldToLocal(at.clone().add(shift)).sub(parent.worldToLocal(at)));
  object.updateMatrixWorld(true);
}

async function loadSerif() {
  try {
    await document.fonts.load(`48px ${SERIF_FAMILY}`, 'P(A|B) = J ∩ ∪ s² − x');
  } catch (error) {
    console.warn('room: the serif for the equations did not load; setting them in a fallback face', error);
  }
}

/** A note's face: its paper and what is written on it, on a canvas `aspect` (width over height) in shape. */
export function drawNote(note: Pick<PlacedNote, 'kind' | 'lines' | 'slot'>, aspect: number, paper: THREE.Color) {
  const canvas = document.createElement('canvas');
  canvas.width = EDGE_PX;
  canvas.height = Math.round(EDGE_PX / aspect);
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  // The paper: its own colour, a touch darker toward the bottom where it lifts off, the glued strip a touch lighter.
  ctx.fillStyle = `#${paper.getHexString()}`;
  ctx.fillRect(0, 0, w, h);
  const shade = ctx.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, 'rgba(255,255,255,0.10)');
  shade.addColorStop(0.18, 'rgba(255,255,255,0)');
  shade.addColorStop(0.75, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(60,40,0,0.12)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);

  if (note.kind === 'equations') graphRule(ctx, w, h);

  const random = seeded(seedOf(note.lines.join('\n')));
  const box = { width: w * MARGIN.width, height: h * MARGIN.height };
  // The whole block turns a little about the note's middle, as a hand writes slightly off square; the pen, less so.
  ctx.save();
  ctx.translate(w / 2, h * 0.53);
  ctx.rotate((random() - 0.5) * (note.kind === 'equations' ? 0.03 : 0.07));
  if (note.kind === 'equations') setEquations(ctx, note.lines, box);
  else if (note.kind === 'todo') writeTodo(ctx, note.lines, box, random, note.slot);
  else writeLines(ctx, note.lines, box, random, note.slot);
  ctx.restore();
  return canvas;
}

// ---- Marker: his phrases and the to-do list ----

const handStyle = (size: number, colour: string, seed: number, slant: number) => ({
  size,
  slant,
  turn: 0,
  colour,
  weight: MARKER_WEIGHT,
  maxWidth: Infinity,
  maxLines: 1,
  lineHeight: 1,
  seed,
  solid: true,
});

/** The largest size at which every line fits the box, `lead` line heights apart (the hand's jitter needs a little room). */
function handSize(ctx: CanvasRenderingContext2D, lines: readonly string[], box: { width: number; height: number }, lead: number) {
  ctx.font = handFont(100);
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width / 100));
  return Math.min((box.width * 0.94) / widest, box.height / (lines.length * lead));
}

function writeLines(ctx: CanvasRenderingContext2D, lines: readonly string[], box: { width: number; height: number }, random: () => number, seed: number) {
  const lead = 1.08;
  const size = handSize(ctx, lines, box, lead);
  const colour = MARKER[Math.floor(random() * MARKER.length)];
  const slant = 0.04 + random() * 0.1;
  const top = (-(lines.length - 1) * size * lead) / 2;
  lines.forEach((line, i) => writeHand(ctx, line, (random() - 0.5) * size * 0.2, top + i * size * lead, handStyle(size, colour, seed * 31 + i, slant)));
}

function writeTodo(ctx: CanvasRenderingContext2D, lines: readonly string[], box: { width: number; height: number }, random: () => number, seed: number) {
  const items = lines.map(todoItem);
  const lead = 1.12;
  // A box is about an x-height and a half wide, with a gap after it; a long item wraps once, under its own words.
  const square = 0.5;
  const gap = 0.32;
  const rows = wrapItems(ctx, items.map((item) => item.text), box, lead, square + gap);
  const size = rows.size;
  const colour = MARKER[Math.floor(random() * MARKER.length)];
  const slant = 0.03 + random() * 0.06;
  ctx.font = handFont(size);
  const indent = (square + gap) * size;
  const left = -(Math.max(...rows.lines.flat().map((row) => ctx.measureText(row).width)) + indent) / 2;
  let y = (-(rows.lines.flat().length - 1) * size * lead) / 2;
  items.forEach((item, i) => {
    const x = left + (random() - 0.5) * size * 0.12;
    const s = square * size;
    checkbox(ctx, x, y - s * 0.05, s, colour, random);
    if (item.done) tick(ctx, x, y - s * 0.05, s, colour, random);
    rows.lines[i].forEach((row, r) => {
      writeHand(ctx, row, x + indent + ctx.measureText(row).width / 2, y, handStyle(size, colour, seed * 31 + i * 7 + r, slant));
      ctx.font = handFont(size);
      y += size * lead;
    });
  });
}

/** The largest size at which the items fit the box, each on one row or wrapped once (a break only where it helps). */
function wrapItems(ctx: CanvasRenderingContext2D, texts: readonly string[], box: { width: number; height: number }, lead: number, indent: number) {
  ctx.font = handFont(100);
  const em = (text: string) => ctx.measureText(text).width / 100;
  // Each item's best break: the split into two rows whose wider row is narrowest.
  const splits = texts.map((text) => {
    const words = text.split(' ');
    let best: [string, string] | null = null;
    for (let k = 1; k < words.length; k++) {
      const pair: [string, string] = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      if (!best || Math.max(em(pair[0]), em(pair[1])) < Math.max(em(best[0]), em(best[1]))) best = pair;
    }
    return best;
  });
  const sizeFor = (lines: string[][]) =>
    Math.min((box.width * 0.94) / (Math.max(...lines.flat().map(em)) + indent), box.height / (lines.flat().length * lead));
  let lines = texts.map((text) => [text]);
  // Wrap the widest item, one at a time, while that makes the writing bigger.
  for (;;) {
    const widest = lines.reduce((w, rows, i) => (rows.length === 1 && splits[i] && (w < 0 || em(rows[0]) > em(lines[w][0])) ? i : w), -1);
    if (widest < 0) break;
    const next = lines.map((rows, i) => (i === widest ? [...splits[i]!] : rows));
    if (sizeFor(next) <= sizeFor(lines)) break;
    lines = next;
  }
  return { lines, size: sizeFor(lines) };
}

/** A box drawn in four strokes, its corners a little off and the last stroke running past the first corner. */
function checkbox(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, colour: string, random: () => number) {
  const jitter = () => (random() - 0.5) * s * 0.1;
  const corners = [
    [x + jitter(), y - s / 2 + jitter()],
    [x + s + jitter(), y - s / 2 + jitter()],
    [x + s + jitter(), y + s / 2 + jitter()],
    [x + jitter(), y + s / 2 + jitter()],
  ];
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = s * 0.13;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (const [cx, cy] of corners.slice(1)) ctx.lineTo(cx, cy);
  ctx.lineTo(corners[0][0], corners[0][1] - s * 0.12);
  ctx.stroke();
  ctx.restore();
}

/** A tick that starts inside the box and flicks out past its top corner, as a quick hand makes it. */
function tick(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, colour: string, random: () => number) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = s * 0.14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.12, y + s * 0.02);
  ctx.lineTo(x + s * 0.42, y + s * 0.34);
  ctx.quadraticCurveTo(x + s * 0.75, y - s * 0.2, x + s * (1.1 + random() * 0.15), y - s * (0.75 + random() * 0.15));
  ctx.stroke();
  ctx.restore();
}

// ---- Pen: the equations, set like a careful hand on an engineering pad ----

/** Faint graph rules, a pad's 5 mm squares. */
function graphRule(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const step = w / 13;
  ctx.save();
  ctx.strokeStyle = 'rgba(47, 93, 80, 0.2)';
  ctx.lineWidth = Math.max(1, w / 400);
  ctx.beginPath();
  for (let x = step / 2; x < w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = step; y < h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.restore();
}

type MathPart = { kind: 'text'; text: string } | { kind: 'fraction'; numerator: string; denominator: string };

/** "lhs = a / b" (a spaced slash) is the left side and a stacked fraction; any other line is set inline. */
export function parseEquation(line: string): MathPart[] {
  const slash = line.indexOf(' / ');
  if (slash < 0) return [{ kind: 'text', text: line }];
  const equals = line.lastIndexOf(' = ', slash);
  const fraction: MathPart = { kind: 'fraction', numerator: line.slice(equals < 0 ? 0 : equals + 3, slash), denominator: line.slice(slash + 3) };
  return equals < 0 ? [fraction] : [{ kind: 'text', text: line.slice(0, equals + 3) }, fraction];
}

// Vertical metrics in ems of the line's size: where the fraction bar sits above the baseline, the gap from it to either
// part, and how far a line of text reaches above and below its baseline.
const AXIS = 0.27;
const BAR_GAP = 0.2;
const ASCENT = 0.74;
const DESCENT = 0.24;

function mathWidth(ctx: CanvasRenderingContext2D, text: string, size: number) {
  ctx.font = `${size}px ${SERIF}`;
  let width = 0;
  for (const ch of text) width += ch === ' ' ? MATH_SPACE_EM * size : ch in SET_OPS ? 0.74 * size : ctx.measureText(ch).width;
  return width;
}

function partWidth(ctx: CanvasRenderingContext2D, part: MathPart, size: number) {
  if (part.kind === 'text') return mathWidth(ctx, part.text, size);
  const f = size * FRACTION_SCALE;
  return Math.max(mathWidth(ctx, part.numerator, f), mathWidth(ctx, part.denominator, f)) + 0.3 * size;
}

/** How far a line reaches above and below its baseline, in ems. */
function lineExtent(parts: MathPart[]) {
  if (!parts.some((p) => p.kind === 'fraction')) return { above: ASCENT, below: DESCENT };
  return { above: AXIS + BAR_GAP + DESCENT * FRACTION_SCALE + ASCENT * FRACTION_SCALE, below: BAR_GAP - AXIS + ASCENT * FRACTION_SCALE + DESCENT * FRACTION_SCALE };
}

function setEquations(ctx: CanvasRenderingContext2D, lines: readonly string[], box: { width: number; height: number }) {
  const parsed = lines.map(parseEquation);
  const gap = 0.42;
  const extents = parsed.map(lineExtent);
  const height = extents.reduce((sum, e) => sum + e.above + e.below, 0) + gap * (lines.length - 1);
  const widest = Math.max(...parsed.map((parts) => parts.reduce((sum, p) => sum + partWidth(ctx, p, 100), 0) / 100));
  const size = Math.min(box.width / widest, box.height / height);
  ctx.fillStyle = PEN;
  ctx.strokeStyle = PEN;
  let y = -(height * size) / 2;
  parsed.forEach((parts, i) => {
    const baseline = y + extents[i].above * size;
    let x = -parts.reduce((sum, p) => sum + partWidth(ctx, p, size), 0) / 2;
    for (const part of parts) {
      const width = partWidth(ctx, part, size);
      if (part.kind === 'text') setRun(ctx, part.text, x, baseline, size);
      else {
        const f = size * FRACTION_SCALE;
        const bar = baseline - AXIS * size;
        ctx.fillRect(x + 0.08 * size, bar - 0.026 * size, width - 0.16 * size, 0.052 * size);
        setRun(ctx, part.numerator, x + (width - mathWidth(ctx, part.numerator, f)) / 2, bar - BAR_GAP * size - DESCENT * f, f);
        setRun(ctx, part.denominator, x + (width - mathWidth(ctx, part.denominator, f)) / 2, bar + BAR_GAP * size + ASCENT * f, f);
      }
      x += width;
    }
    y += (extents[i].above + extents[i].below + gap) * size;
  });
}

/** One run of math on a baseline: letters lean as a math italic, figures and signs stand upright, ∩ and ∪ are drawn. */
function setRun(ctx: CanvasRenderingContext2D, text: string, x: number, baseline: number, size: number) {
  ctx.font = `${size}px ${SERIF}`;
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = size * PEN_WEIGHT;
  ctx.lineJoin = 'round';
  for (const ch of text) {
    if (ch === ' ') {
      x += MATH_SPACE_EM * size;
      continue;
    }
    if (ch in SET_OPS) {
      setOperator(ctx, SET_OPS[ch as keyof typeof SET_OPS], x + 0.12 * size, baseline, 0.5 * size, 0.6 * size, size);
      x += 0.74 * size;
      continue;
    }
    ctx.save();
    ctx.translate(x, baseline);
    if (/[A-Za-z]/.test(ch)) ctx.transform(1, 0, -MATH_SLANT, 1, 0, 0);
    ctx.fillText(ch, 0, 0);
    ctx.strokeText(ch, 0, 0);
    ctx.restore();
    x += ctx.measureText(ch).width;
  }
}

/** The set signs, a cup or a cap, drawn so they never fall back to another face. */
function setOperator(ctx: CanvasRenderingContext2D, shape: 'cup' | 'cap', x: number, baseline: number, width: number, height: number, size: number) {
  const r = width / 2;
  ctx.save();
  ctx.lineWidth = size * 0.065;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (shape === 'cup') {
    ctx.moveTo(x, baseline - height);
    ctx.lineTo(x, baseline - r);
    ctx.arc(x + r, baseline - r, r, Math.PI, 0, true);
    ctx.lineTo(x + width, baseline - height);
  } else {
    ctx.moveTo(x, baseline);
    ctx.lineTo(x, baseline - height + r);
    ctx.arc(x + r, baseline - height + r, r, Math.PI, 0, false);
    ctx.lineTo(x + width, baseline);
  }
  ctx.stroke();
  ctx.restore();
}
