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

// ---- Frame backs ----

// From behind (the walls turn see-through in the orbit) a framed piece shows plain card, never its picture (owner,
// round 9). The bake gives every face its own patch of the atlas, so what a bake puts on a back is not to be trusted:
// the back panel comes off the baked mesh and is drawn as card. The front's triangles stay as they were.
const FRAMED = /^(?:print_\w+|props_poster_frame_\d+|props_frame_\w+|voyager_record|poster_plaque)$/;
/** Kraft card, as the room's light shows it. */
export const BACKING_COLOUR = '#7a5f45';
// A back triangle faces within ~25° of straight back and lies on the back panel's plane, give or take this: the panels
// sit 0.5–3 mm inside their frames' back edges, which stay wood.
const BACK_FACING = -0.9;
const PANEL_SLACK_M = 0.0003;

/**
 * The triangles of a framed piece that make its back panel: of those facing away from `toward` along the piece's main
 * axis (the area-weighted normal axis, so front and back faces both count), the ones on the plane with the most area.
 * `world` holds xyz per vertex, `corners` three vertex ids per triangle; `slack` is in the same units as `world`.
 */
export function backPanel(world: ArrayLike<number>, corners: ArrayLike<number>, toward: THREE.Vector3, slack: number) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const tris: { normal: THREE.Vector3; area: number; centre: THREE.Vector3 }[] = [];
  const axis = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  const middle = new THREE.Vector3();
  let total = 0;
  for (let t = 0; t < corners.length; t += 3) {
    a.fromArray(world, corners[t] * 3);
    b.fromArray(world, corners[t + 1] * 3);
    c.fromArray(world, corners[t + 2] * 3);
    const centre = a.clone().add(b).add(c).divideScalar(3);
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    const area = normal.length() / 2;
    normal.normalize();
    tris.push({ normal, area, centre });
    if (!area) continue;
    const e = axis.elements;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e[i * 3 + j] += area * normal.getComponent(i) * normal.getComponent(j);
    middle.addScaledVector(centre, area);
    total += area;
  }
  if (!total) return [];
  // The axis the faces mostly lie across: the area-weighted normals' principal direction (a few power steps).
  const front = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 24; i++) front.applyMatrix3(axis).normalize();
  if (front.dot(toward.clone().sub(middle.divideScalar(total))) < 0) front.negate();
  const back = tris.map((tri, t) => ({ ...tri, t })).filter((tri) => tri.area > 0 && tri.normal.dot(front) < BACK_FACING);
  if (!back.length) return [];
  // Planes are measured along the biggest back triangle's own normal: the main axis leans a little toward any strut.
  const across = back.reduce((big, tri) => (tri.area > big.area ? tri : big)).normal;
  const offsets = back.map((tri) => tri.centre.dot(across));
  let plane = 0;
  let most = -1;
  for (const offset of offsets) {
    const area = back.reduce((sum, tri, i) => sum + (Math.abs(offsets[i] - offset) <= slack ? tri.area : 0), 0);
    if (area > most) [most, plane] = [area, offset];
  }
  return back.filter((_, i) => Math.abs(offsets[i] - plane) <= slack).map((tri) => tri.t);
}

/** Every framed piece in the room with its back panel drawn as card (a sibling mesh, so it fades and lifts with it). */
export class FrameBacks {
  readonly pieces: { name: string; triangles: number; backing: THREE.Mesh }[] = [];
  private readonly material = new THREE.MeshBasicMaterial({ color: BACKING_COLOUR });

  constructor(root: THREE.Object3D, toward: THREE.Vector3) {
    const framed: THREE.Mesh[] = [];
    const users = new Map<THREE.BufferGeometry, number>();
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      users.set(node.geometry, (users.get(node.geometry) ?? 0) + 1);
      if (FRAMED.test(node.name)) framed.push(node);
    });
    root.updateMatrixWorld(true);
    for (const mesh of framed) {
      if ((users.get(mesh.geometry) ?? 0) > 1) mesh.geometry = mesh.geometry.clone();
      this.back(mesh, toward);
    }
  }

  private back(mesh: THREE.Mesh, toward: THREE.Vector3) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const corners = index ? Array.from(index.array) : Array.from({ length: position.count }, (_, i) => i);
    const world = new Float32Array(position.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray(world, i * 3);
    const panel = new Set(backPanel(world, corners, toward, PANEL_SLACK_M * WORLD_SCALE));
    if (!panel.size || !mesh.parent) return;

    const local = new Float32Array(panel.size * 9);
    const kept: number[] = [];
    let k = 0;
    for (let t = 0; t < corners.length / 3; t++) {
      const ids = corners.slice(t * 3, t * 3 + 3);
      if (!panel.has(t)) kept.push(...ids);
      else for (const id of ids) v.fromBufferAttribute(position, id).toArray(local, 3 * k++);
    }
    geometry.setIndex(kept);
    const card = new THREE.BufferGeometry();
    card.setAttribute('position', new THREE.BufferAttribute(local, 3));
    const backing = new THREE.Mesh(card, this.material);
    backing.name = `${mesh.name}_backing`;
    backing.position.copy(mesh.position);
    backing.quaternion.copy(mesh.quaternion);
    backing.scale.copy(mesh.scale);
    mesh.parent.add(backing);
    this.pieces.push({ name: mesh.name, triangles: panel.size, backing });
  }

  /** The backing's centre a quarter of its height below the middle (clear of an easel's strut), world units. */
  sample(name: string) {
    const backing = this.pieces.find((p) => p.name === name)?.backing;
    if (!backing) return null;
    const box = new THREE.Box3().setFromObject(backing);
    const at = box.getCenter(new THREE.Vector3());
    at.y -= (box.max.y - box.min.y) / 4;
    return at;
  }

  probe() {
    return { colour: BACKING_COLOUR, pieces: this.pieces.map(({ name, triangles }) => ({ name, triangles })) };
  }

  dispose() {
    for (const { backing } of this.pieces) backing.geometry.dispose();
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
