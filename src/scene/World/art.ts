import * as THREE from 'three';
import favorites from '../../content/favorites.json';
import artFrag from '../shaders/art.frag.glsl?raw';
import artVert from '../shaders/art.vert.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { ArtNode } from './nodes';
import { canvasTexture, type TextureStore } from './textures';

// The art that is not baked: the four favourite posters (T34's hand-drawn art, or a typographic poster drawn at
// runtime for a film without it), and the surfaces the sticky notes and the Instax prints draw on. Each is lit like the
// baked wall around it, with the lava lamp's colour on top.

const PAPER = new THREE.Color('#2b241d');
const FADE_S = 0.6;
// The room bakes the light on each art surface as if it were white paper (blender/README.md), so art x light needs
// no gain; kept as a constant to retune if the bake's paper changes.
const BAKE_GAIN = 1;

/**
 * The lava lamp's light, shared by every art material and the room's baked ones (one set of uniforms, updated once a
 * frame): the tint that turns the baked lamp light to the lamp's colour near it, and the faint tint of the whole room.
 */
export interface LampUniforms {
  uLampTint: { value: THREE.Color };
  uRoomTint: { value: THREE.Color };
  uLampPos: { value: THREE.Vector3 };
  uLampRange: { value: number };
}

export function lampUniforms(): LampUniforms {
  return {
    uLampTint: { value: new THREE.Color(1, 1, 1) },
    uRoomTint: { value: new THREE.Color(1, 1, 1) },
    uLampPos: { value: new THREE.Vector3() },
    uLampRange: { value: 1.3 * WORLD_SCALE },
  };
}

export interface Lighting {
  ambient: number;
  top: number;
  /** How far above the art's top edge the light sits, and how fast it falls off below it (metres). */
  lightAbove: number;
  fall: number;
}

/** One art mesh with its own material; a texture fades in over the paper colour once it arrives. */
export class ArtSurface {
  readonly material: THREE.ShaderMaterial;
  private texture: THREE.Texture | null = null;

  constructor(
    readonly node: ArtNode,
    lamp: LampUniforms,
    lighting: Lighting,
    paper = PAPER,
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
        uPaper: { value: paper },
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
