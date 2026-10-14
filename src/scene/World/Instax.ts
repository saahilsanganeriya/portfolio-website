import * as THREE from 'three';
import type { Hotspot } from '../hotspots';
import artVert from '../shaders/art.vert.glsl?raw';
import instaxFrag from '../shaders/instax.frag.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { LampUniforms } from './art';
import { loadHand, seeded, seedOf, writeHand } from './handwriting';
import { artUvFlip, type ArtNode } from './nodes';
import type { Photograph } from './photographs';
import { canvasTexture, type TextureStore } from './textures';

// His photographs on the cork board as Instax prints, drawn at runtime: the photograph inside the film's white card
// with its thick bottom margin, and in that margin his marker caption (the photo's `sharpie`, else its title or date)
// in his hand, a different size and slant on each print. The face is glossy and the card curls a little (instax.frag).
// The board takes the collection's first prints in order, one per slot. A room without the board (the first v3
// export) hangs them in its framed prints instead. The pictures load once the room is interactive and the board is in
// view: the 480 px copies, 20 x about 20 KB.

// Instax film, in millimetres: the card, the picture window's width, and the margins above and below it.
const FORMATS = [
  { name: 'mini', card: [54, 86], image: [46, 62], top: 6.5 },
  { name: 'square', card: [72, 86], image: [62, 62], top: 6.5 },
  { name: 'wide', card: [108, 86], image: [99, 62], top: 6.5 },
] as const;
type Format = (typeof FORMATS)[number];
// A slot within this ratio of a format's shape takes the card edge to edge; any other (a framed print) shows the card
// on a mat inside it.
const FILL_TOLERANCE = 1.12;
const CARD_EDGE_PX = 320;
const CARDS = ['#f4f1ea', '#f2eee4', '#f5f3ee', '#efebe1'];
const MAT = '#e6dfd0';
const INK = ['#141414', '#17181c', '#1b1a17'];
const GLOSS = 0.32;
const FADE_S = 0.6;

const PAPER = new THREE.Color('#e9e4d8');

interface Print {
  node: ArtNode;
  material: THREE.ShaderMaterial;
  texture: THREE.Texture | null;
  photo: Photograph | null;
}

/** The format whose card shape is nearest the slot's. */
function formatFor(aspect: number): Format {
  let best: Format = FORMATS[0];
  for (const format of FORMATS) {
    const miss = Math.abs(Math.log(aspect / (format.card[0] / format.card[1])));
    if (miss < Math.abs(Math.log(aspect / (best.card[0] / best.card[1])))) best = format;
  }
  return best;
}

/** The board's prints in order (the collection's `onWall` photographs), then the others, for `slots` places. */
export function boardOrder(photos: readonly Photograph[], slots: number): Photograph[] {
  return [...photos.filter((p) => p.onWall), ...photos.filter((p) => !p.onWall)].slice(0, slots);
}

/** What the marker says: his caption, else the photo's title, else the day he posted it. */
export function captionOf(photo: Photograph) {
  return photo.sharpie?.trim() || photo.title?.trim() || photo.date || '';
}

export class Instax {
  private readonly prints: Print[];
  private hung = false;
  private loading = false;
  private readonly bounds = new THREE.Box3();

  constructor(
    nodes: ArtNode[],
    lamp: LampUniforms,
    private readonly hotspots: readonly Hotspot[],
    private readonly onBoard: boolean,
  ) {
    for (const node of nodes) this.bounds.expandByObject(node.mesh);
    const centre = this.bounds.getCenter(new THREE.Vector3());
    // The picture lamp over the board: its light is what the glossy faces catch.
    const glossLight = centre.clone().add(new THREE.Vector3(0, 0.75 * WORLD_SCALE, 0));
    this.prints = nodes.map((node) => {
      const random = seeded(seedOf(`instax-${node.slot}`));
      const quaternion = node.mesh.getWorldQuaternion(new THREE.Quaternion());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
      const tangent = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
      const baked = (node.mesh.material as THREE.MeshBasicMaterial).map ?? null;
      const bakeUv = node.mesh.geometry.getAttribute('uv1');
      if (baked && bakeUv) node.mesh.geometry.setAttribute('aBakeUv', bakeUv);
      const top = new THREE.Box3().setFromObject(node.mesh).max.y;
      const material = new THREE.ShaderMaterial({
        vertexShader: artVert,
        fragmentShader: instaxFrag,
        uniforms: {
          uMap: { value: null },
          uShown: { value: 0 },
          uPaper: { value: PAPER },
          uBake: { value: baked },
          uUseBake: { value: baked && bakeUv ? 1 : 0 },
          uBakeGain: { value: 1 },
          uAmbient: { value: 0.5 },
          uTop: { value: 0.55 },
          uTopY: { value: top + 0.12 * WORLD_SCALE },
          uTopFall: { value: 0.3 * WORLD_SCALE },
          uWindow: { value: new THREE.Vector4(0, 0, 0, 0) },
          uNormal: { value: normal },
          uTangent: { value: tangent },
          // Each card curls its own way, a few degrees at the edges.
          uCurl: { value: new THREE.Vector2((random() - 0.5) * 0.12, 0.04 + random() * 0.08) },
          uGlossLight: { value: glossLight.clone().addScaledVector(normal, 0.5 * WORLD_SCALE) },
          uGloss: { value: GLOSS },
          uFlip: { value: artUvFlip(node.mesh) },
          ...lamp,
        },
      });
      node.mesh.material = material;
      return { node, material, texture: null, photo: null };
    });
  }

  /** Puts the collection's prints on the board in order and names each print's hotspot after its photograph. */
  hang(photos: Photograph[]) {
    const order = boardOrder(photos, this.prints.length);
    this.prints.forEach((print, i) => (print.photo = order[i] ?? null));
    this.hung = true;
    for (const print of this.prints) {
      if (!print.photo) continue;
      const hotspot = this.hotspots.find((h) => h.proxies.includes(`hit_photo_print_${print.node.slot}`));
      if (!hotspot) continue;
      hotspot.label = captionOf(print.photo) || print.photo.title;
      hotspot.prop = `An Instax print of “${print.photo.title}”`;
      hotspot.target = `photography/${print.photo.slug}`;
    }
  }

  get isHung() {
    return this.hung;
  }

  /** The slug of the photograph on the board's `index`-th print (in slot order), or null. */
  slugAt(index: number): string | null {
    return this.prints[index]?.photo?.slug ?? null;
  }

  /** The board's bounds, for loading once it comes into view. */
  get box() {
    return this.bounds;
  }

  /** Draws every print (on demand: after the room is interactive and the board is in view). */
  async load(textures: TextureStore, instantly: boolean) {
    if (this.loading) return;
    this.loading = true;
    await loadHand();
    await Promise.all(
      this.prints.map(async (print) => {
        const photo = print.photo;
        if (!photo) return;
        try {
          const bitmap = await textures.bitmap(photo.small.src);
          const { canvas, window } = this.draw(photo, bitmap, print.node);
          bitmap.close();
          print.texture?.dispose();
          print.texture = canvasTexture(canvas);
          print.texture.anisotropy = 4;
          print.material.uniforms.uMap.value = print.texture;
          (print.material.uniforms.uWindow.value as THREE.Vector4).copy(window);
          if (instantly) print.material.uniforms.uShown.value = 1;
        } catch (error) {
          console.warn(`room: Instax print ${photo.slug} did not load`, error);
        }
      }),
    );
  }

  update(dt: number) {
    for (const print of this.prints) {
      const u = print.material.uniforms.uShown;
      if (print.texture && u.value < 1) u.value = Math.min(1, u.value + dt / FADE_S);
    }
  }

  probe() {
    return {
      board: this.onBoard,
      prints: this.prints.map((p) => ({
        slot: p.node.slot,
        slug: p.photo?.slug ?? null,
        caption: p.photo ? captionOf(p.photo) : null,
        shown: Number((p.material.uniforms.uShown.value as number).toFixed(2)),
        flip: (p.material.uniforms.uFlip.value as THREE.Vector2).toArray(),
      })),
    };
  }

  dispose() {
    for (const print of this.prints) {
      print.texture?.dispose();
      print.material.dispose();
    }
  }

  /**
   * One print: the card (edge to edge when the slot has the film's shape, else on a mat), the photograph cropped to the
   * film's window, and the caption in the bottom margin. Returns the canvas and the photo window in UV (top-down).
   */
  private draw(photo: Photograph, image: ImageBitmap, node: ArtNode) {
    const random = seeded(seedOf(photo.slug));
    const format = formatFor(node.aspect);
    const cardAspect = format.card[0] / format.card[1];
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(node.aspect >= 1 ? CARD_EDGE_PX : CARD_EDGE_PX * node.aspect);
    canvas.height = Math.round(node.aspect >= 1 ? CARD_EDGE_PX / node.aspect : CARD_EDGE_PX);
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;

    // The card's place: the whole canvas when the slot is the film's shape, else centred on a mat with room around it.
    const fills = Math.max(node.aspect, cardAspect) / Math.min(node.aspect, cardAspect) <= FILL_TOLERANCE;
    let cw = w;
    let ch = h;
    if (!fills) {
      ctx.fillStyle = MAT;
      ctx.fillRect(0, 0, w, h);
      const scale = Math.min((w * 0.82) / format.card[0], (h * 0.82) / format.card[1]);
      cw = format.card[0] * scale;
      ch = format.card[1] * scale;
    }
    const cx = (w - cw) / 2;
    const cy = (h - ch) / 2;
    const mm = ch / format.card[1];
    const side = (cw - format.image[0] * mm) / 2;
    const win = { x: cx + side, y: cy + format.top * mm, w: cw - side * 2, h: format.image[1] * mm };

    // The card, with a soft shadow under it on a mat and a faint grain.
    if (!fills) {
      ctx.fillStyle = 'rgba(40,30,20,0.25)';
      ctx.fillRect(cx + mm * 0.8, cy + mm * 1.2, cw, ch);
    }
    ctx.fillStyle = CARDS[Math.floor(random() * CARDS.length)];
    ctx.fillRect(cx, cy, cw, ch);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(90,80,60,${0.02 + random() * 0.03})`;
      ctx.fillRect(cx + random() * cw, cy + random() * ch, 1, 1);
    }

    // The photograph, covering the window from its middle; Instax film lifts the blacks and warms a little.
    const source = image.width / image.height;
    const target = win.w / win.h;
    const sw = source > target ? image.height * target : image.width;
    const sh = source > target ? image.height : image.width / target;
    ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, win.x, win.y, win.w, win.h);
    ctx.fillStyle = 'rgba(255,236,210,0.07)';
    ctx.fillRect(win.x, win.y, win.w, win.h);
    const vignette = ctx.createRadialGradient(win.x + win.w / 2, win.y + win.h / 2, Math.min(win.w, win.h) * 0.35, win.x + win.w / 2, win.y + win.h / 2, Math.max(win.w, win.h) * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = vignette;
    ctx.fillRect(win.x, win.y, win.w, win.h);
    // The window's edge sits a hair below the card.
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(win.x + 0.5, win.y + 0.5, win.w - 1, win.h - 1);

    // His marker caption in the bottom margin: its own size, slant and lean on every print.
    const margin = { top: win.y + win.h, bottom: cy + ch };
    const caption = captionOf(photo);
    if (caption) {
      writeHand(ctx, caption, cx + cw / 2 + (random() - 0.5) * cw * 0.06, (margin.top + margin.bottom) / 2 + (random() - 0.5) * mm * 1.2, {
        size: mm * (6.2 + random() * 2.2),
        slant: -0.06 + random() * 0.22,
        turn: (random() - 0.5) * 0.09,
        colour: INK[Math.floor(random() * INK.length)],
        weight: 0.05,
        maxWidth: cw * 0.86,
        maxLines: 2,
        lineHeight: 0.98,
        seed: seedOf(caption),
      });
    }
    return { canvas, window: new THREE.Vector4(win.x / w, win.y / h, (win.x + win.w) / w, (win.y + win.h) / h) };
  }
}
