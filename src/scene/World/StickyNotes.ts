import * as THREE from 'three';
import phrases from '../../content/sticky-notes.json';
import { ArtSurface, type LampUniforms } from './art';
import { loadHand, seeded, seedOf, writeHand } from './handwriting';
import type { StickyNode } from './nodes';
import { canvasTexture } from './textures';

// The sticky notes on the monitor's bezel and the wall beside it, each with one of his phrases
// (src/content/sticky-notes.json) in his hand, stuck on a little askew. They hang in the first view, so the hand loads
// with the room and the notes are written before it is shown.

const EDGE_PX = 256;
const INK = ['#1c2340', '#20202a', '#1a2f4a'];
// Stuck on by hand: each note turns a few degrees about its face.
const MAX_TURN_DEG = 4;

export const STICKY_PHRASES: readonly string[] = phrases;

export class StickyNotes {
  private readonly surfaces: ArtSurface[];

  constructor(
    private readonly nodes: StickyNode[],
    lamp: LampUniforms,
  ) {
    this.surfaces = nodes.map((node) => {
      const random = seeded(seedOf(`note-${node.slot}`));
      node.mesh.rotateZ(THREE.MathUtils.degToRad((random() * 2 - 1) * MAX_TURN_DEG));
      return new ArtSurface(node, lamp, { ambient: 0.55, top: 0.5, lightAbove: 0.2, fall: 0.4 }, node.paper);
    });
  }

  /** Writes every note (after the hand has loaded, or in the fallback cursive). */
  async load() {
    await loadHand();
    this.surfaces.forEach((surface, i) => {
      const phrase = STICKY_PHRASES[this.nodes[i].slot];
      if (phrase) surface.show(canvasTexture(this.draw(phrase, this.nodes[i])), true);
    });
  }

  /** The phrase on each note, by slot (tests and the hover labels). */
  get written() {
    return this.nodes.map((node) => STICKY_PHRASES[node.slot] ?? null);
  }

  dispose() {
    for (const surface of this.surfaces) surface.dispose();
  }

  private draw(phrase: string, node: StickyNode) {
    const random = seeded(seedOf(phrase));
    const canvas = document.createElement('canvas');
    canvas.width = EDGE_PX;
    canvas.height = Math.round(EDGE_PX / node.aspect);
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;
    // The paper: its own colour, a touch darker toward the bottom where it lifts off, the glued strip a touch lighter.
    const paper = `#${node.paper.getHexString()}`;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    const shade = ctx.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, 'rgba(255,255,255,0.10)');
    shade.addColorStop(0.18, 'rgba(255,255,255,0)');
    shade.addColorStop(0.75, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(60,40,0,0.12)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
    writeHand(ctx, phrase, w / 2, h * 0.52, {
      size: w * 0.2,
      slant: 0.04 + random() * 0.1,
      turn: (random() - 0.5) * 0.08,
      colour: INK[Math.floor(random() * INK.length)],
      weight: 0.025,
      maxWidth: w * 0.84,
      maxLines: 4,
      lineHeight: 1.05,
      seed: seedOf(phrase) + node.slot,
    });
    return canvas;
  }
}
