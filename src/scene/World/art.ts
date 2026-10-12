import * as THREE from 'three';
import favorites from '../../content/favorites.json';
import type { Hotspot } from '../hotspots';
import artFrag from '../shaders/art.frag.glsl?raw';
import artVert from '../shaders/art.vert.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { ArtNode } from './nodes';
import type { Photograph } from './photographs';
import { canvasTexture, type TextureStore } from './textures';

// The art on the walls that is not baked: the four favourite posters (T34's hand-drawn art, or a typographic poster
// drawn at runtime for a film without it) and five prints of the owner's photographs. Each is lit like the baked
// wall around it, plus the lava lamp's light.

const PAPER = new THREE.Color('#2b241d');
const FADE_S = 0.6;
// The room bakes the light on each art surface as if it were white paper (blender/README.md), so art x light needs
// no gain; kept as a constant to retune if the bake's paper changes.
const BAKE_GAIN = 1;
const PRINT_EDGE_PX = 384;

/** The lava lamp's light, shared by every art material (one set of uniforms, updated once a frame). */
export interface LampUniforms {
  uLampColor: { value: THREE.Color };
  uLampPos: { value: THREE.Vector3 };
  uLampRange: { value: number };
}

export function lampUniforms(): LampUniforms {
  return {
    uLampColor: { value: new THREE.Color(0, 0, 0) },
    uLampPos: { value: new THREE.Vector3() },
    uLampRange: { value: 0.45 * WORLD_SCALE },
  };
}

interface Lighting {
  ambient: number;
  top: number;
  /** How far above the art's top edge the light sits, and how fast it falls off below it (metres). */
  lightAbove: number;
  fall: number;
}

/** One art mesh with its own material; a texture fades in over the paper colour once it arrives. */
class ArtSurface {
  readonly material: THREE.ShaderMaterial;
  private texture: THREE.Texture | null = null;

  constructor(
    readonly node: ArtNode,
    lamp: LampUniforms,
    lighting: Lighting,
  ) {
    const top = new THREE.Box3().setFromObject(node.mesh).max.y;
    const baked = (node.mesh.material as THREE.MeshBasicMaterial).map ?? null;
    const bakeUv = node.mesh.geometry.getAttribute('uv1');
    if (baked && bakeUv) node.mesh.geometry.setAttribute('aBakeUv', bakeUv);
    this.material = new THREE.ShaderMaterial({
      vertexShader: artVert,
      fragmentShader: artFrag,
      uniforms: {
        uMap: { value: null },
        uShown: { value: 0 },
        uPaper: { value: PAPER },
        uBake: { value: baked },
        uUseBake: { value: baked && bakeUv ? 1 : 0 },
        uBakeGain: { value: BAKE_GAIN },
        uAmbient: { value: lighting.ambient },
        uTop: { value: lighting.top },
        uTopY: { value: top + lighting.lightAbove * WORLD_SCALE },
        uTopFall: { value: lighting.fall * WORLD_SCALE },
        ...lamp,
      },
    });
    node.mesh.material = this.material;
  }

  get shown() {
    return this.material.uniforms.uShown.value as number;
  }

  show(texture: THREE.Texture, instantly: boolean) {
    this.texture?.dispose();
    this.texture = texture;
    this.material.uniforms.uMap.value = texture;
    if (instantly) this.material.uniforms.uShown.value = 1;
  }

  update(dt: number) {
    const u = this.material.uniforms.uShown;
    if (this.texture && u.value < 1) u.value = Math.min(1, u.value + dt / FADE_S);
  }

  dispose() {
    this.texture?.dispose();
    this.material.dispose();
  }
}

export class Posters {
  private readonly surfaces: ArtSurface[];

  constructor(nodes: ArtNode[], lamp: LampUniforms) {
    this.surfaces = nodes.map((node) => new ArtSurface(node, lamp, { ambient: 0.55, top: 0.6, lightAbove: 0.3, fall: 0.45 }));
  }

  /** Loads every poster's art before the room is shown (they hang in the first view). */
  async load(textures: TextureStore) {
    await Promise.all(
      this.surfaces.map(async (surface) => {
        const film = favorites.films[surface.node.slot];
        if (!film) return;
        try {
          if (film.poster) surface.show(await textures.ktx2(film.poster.replace(/\.[a-z0-9]+$/, '.ktx2')), true);
          else surface.show(await this.drawn(film, textures), true);
        } catch (error) {
          console.warn(`room: poster ${film.slug} did not load; drawing it instead`, error);
          surface.show(await this.drawn(film, textures), true);
        }
      }),
    );
  }

  /** A typographic poster for a film with no hand-drawn art (src/lib/posters.ts, loaded only when one is needed). */
  private async drawn(film: (typeof favorites.films)[number], textures: TextureStore) {
    const { renderPoster } = await import('../../lib/posters');
    return canvasTexture(await textures.svg(renderPoster(film), 512, 768));
  }

  get loaded() {
    return this.surfaces.map((s) => s.shown === 1);
  }

  update(dt: number) {
    for (const surface of this.surfaces) surface.update(dt);
  }

  dispose() {
    for (const surface of this.surfaces) surface.dispose();
  }
}

/** Which photograph hangs in which frame: the wall's chosen prints first, each in the frame whose shape suits it best. */
export function hangPrints(slots: { slot: number; aspect: number }[], photos: Photograph[]): Map<number, Photograph> {
  const ranked = [...photos].sort(
    (a, b) => Number(b.onWall) - Number(a.onWall) || Number(b.featured) - Number(a.featured) || a.order - b.order,
  );
  const free = new Set(slots.map((s) => s.slot));
  const hung = new Map<number, Photograph>();
  for (const photo of ranked) {
    if (free.size === 0) break;
    const aspect = photo.small.width / photo.small.height;
    let best = -1;
    let bestMiss = Infinity;
    for (const { slot, aspect: frame } of slots) {
      const miss = Math.abs(Math.log(aspect / frame));
      if (free.has(slot) && miss < bestMiss) [best, bestMiss] = [slot, miss];
    }
    free.delete(best);
    hung.set(best, photo);
  }
  return hung;
}

export class Prints {
  private readonly surfaces: ArtSurface[];
  private hung = new Map<number, Photograph>();
  private loading = false;

  constructor(
    nodes: ArtNode[],
    lamp: LampUniforms,
    private readonly hotspots: readonly Hotspot[],
  ) {
    this.surfaces = nodes.map((node) => new ArtSurface(node, lamp, { ambient: 0.5, top: 0.55, lightAbove: 0.12, fall: 0.3 }));
  }

  get photos() {
    return [...this.hung.entries()].sort(([a], [b]) => a - b).map(([slot, photo]) => ({ slot, slug: photo.slug, shown: this.surfaces.find((s) => s.node.slot === slot)?.shown ?? 0 }));
  }

  photoIn(slot: number) {
    return this.hung.get(slot) ?? null;
  }

  /** Hangs the collection and names each print's hotspot after its photograph. */
  hang(photos: Photograph[]) {
    this.hung = hangPrints(
      this.surfaces.map((s) => ({ slot: s.node.slot, aspect: s.node.aspect })),
      photos,
    );
    for (const [slot, photo] of this.hung) {
      const hotspot = this.hotspots.find((h) => h.proxies.includes(`hit_photo_print_${slot}`));
      if (!hotspot) continue;
      hotspot.label = photo.title;
      hotspot.prop = `A print of “${photo.title}”`;
      hotspot.target = `photography/${photo.slug}`;
    }
  }

  /** Fetches the small pictures, cropped to each frame (on demand: after the room is interactive). */
  async load(textures: TextureStore, instantly: boolean) {
    if (this.loading) return;
    this.loading = true;
    await Promise.all(
      this.surfaces.map(async (surface) => {
        const photo = this.hung.get(surface.node.slot);
        if (!photo) return;
        try {
          const bitmap = await textures.bitmap(photo.small.src);
          surface.show(canvasTexture(coverCrop(bitmap, surface.node.aspect, PRINT_EDGE_PX)), instantly);
          bitmap.close();
        } catch (error) {
          console.warn(`room: print ${photo.slug} did not load`, error);
        }
      }),
    );
  }

  update(dt: number) {
    for (const surface of this.surfaces) surface.update(dt);
  }

  dispose() {
    for (const surface of this.surfaces) surface.dispose();
  }
}

/** The middle of `image` at `aspect` (width over height), `edge` pixels on its long side. */
function coverCrop(image: ImageBitmap, aspect: number, edge: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(aspect >= 1 ? edge : edge * aspect);
  canvas.height = Math.round(aspect >= 1 ? edge / aspect : edge);
  const source = image.width / image.height;
  const sw = source > aspect ? image.height * aspect : image.width;
  const sh = source > aspect ? image.height : image.width / aspect;
  canvas.getContext('2d')!.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}
