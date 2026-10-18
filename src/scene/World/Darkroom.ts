import * as THREE from 'three';
import type { Hotspot } from '../hotspots';
import printFrag from '../shaders/print.frag.glsl?raw';
import printVert from '../shaders/print.vert.glsl?raw';
import printShadowFrag from '../shaders/print_shadow.frag.glsl?raw';
import printShadowVert from '../shaders/print_shadow.vert.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { LampUniforms } from './art';
import { loadHand, seeded, seedOf, writeHand } from './handwriting';
import type { Photograph, Picture } from './photographs';
import type { TextureStore } from './textures';

// His photographs as fibre prints drying on the darkroom lines: each hangs below its clip (`darkroom_clip_<line>_<k>`,
// local +Z out of the wall, +Y up, the clip's tilt already in its rotation), as big as its photograph's shape allows in
// the clip's box (extras maxW_m x maxH_m), with a thin paper border and his marker line on the bottom border. The hero
// clip takes the set's first photograph, then the hero's line, the lines above, the lines below, each left to right as
// seen from the room. A print takes the light the bake gives the wall behind it and drops a soft shadow on it, so it
// sits in the room's light instead of on top of it. Pictures load once the room is interactive and the line is in
// view, at a density for the view (cheap from across the room, crisp close up), and sway in the room's breeze when
// there is one (never under reduced motion).

/** A clip as the room authors it: its line, its place along the line, the box its print may fill (metres), its tilt. */
export interface ClipSpec {
  name: string;
  line: number;
  k: number;
  maxW: number;
  maxH: number;
  tiltDeg: number;
  hero: boolean;
  /** Height of the clip (for ordering lines) and its place left to right as seen from the front, both in metres. */
  y: number;
  along: number;
}

export interface PrintSize {
  paperW: number;
  paperH: number;
  photoW: number;
  photoH: number;
  /** Border on the top and sides, and at the bottom (wider: the marker line sits there), metres. */
  border: number;
  bottom: number;
}

/** The room's breeze (World's Wind): uniforms to merge, and GLSL declaring them with `vec2 windOffset(vec2 worldXz)`. */
export interface Breeze {
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly glsl: string;
}

const BORDER_M = 0.009;
const CAPTION_BAND_M = 0.02;
// The clip grips the paper this far below its top edge's line; prints sit this far in front of the clip's plane by k.
const GRIP_M = 0.004;
const LAYER_M = 0.0025;
const CURL_M = 0.0025;
// Texels per metre of paper: from across the room, and close up (at least one texel per screen pixel at 2560x1440 DPR 2
// from cam_photos, about 1,950 px/m there). The close-up set loads once the line shows above UPGRADE_PX_PER_M.
const SMALL_TEXELS_PER_M = 700;
const LARGE_TEXELS_PER_M = 2400;
const UPGRADE_PX_PER_M = 800;
const CHECK_EVERY_S = 0.5;
const FADE_S = 0.8;
const SHADOW_BLUR_M = 0.014;
const SHADOW_DROP_M = 0.015;
// How far the breeze moves a print's bottom edge, as a share of what it moves a plant's tip.
const SWAY_SHARE = 0.6;
// The wall's bake is read where its light is brightest: this far below the darkroom's lamp.
const REFERENCE_BELOW_LAMP_M = 0.25;
// A clip the set lacks (a larger set than the room has clips for): its print's box, how far a print stays in from the
// string's screw eyes, and how near its clip, and how small, the parts of a peg are.
const NEW_CLIP = { maxW: 0.28, maxH: 0.22 };
const STRING_END_M = 0.015;
const PEG_REACH_M = 0.045;
const PEG_PART_M = 0.08;
const PAPER = '#f1eee6';
const INK = ['#141414', '#17181c', '#1a1916'];

/** The clips' order on the lines: the hero first, then its line, the lines above it, the lines below, each left to right. */
export function hangOrder<T extends Pick<ClipSpec, 'line' | 'hero' | 'y' | 'along'>>(clips: readonly T[]): T[] {
  const hero = clips.find((c) => c.hero) ?? null;
  const lineY = new Map<number, number>();
  for (const clip of clips) lineY.set(clip.line, Math.max(lineY.get(clip.line) ?? -Infinity, clip.y));
  const heroY = hero ? lineY.get(hero.line)! : Math.max(...lineY.values());
  const rank = (line: number) => {
    const y = lineY.get(line)!;
    return [y === heroY ? 0 : y > heroY ? 1 : 2, Math.abs(y - heroY)];
  };
  const rest = clips
    .filter((c) => c !== hero)
    .sort((a, b) => {
      const [ga, da] = rank(a.line);
      const [gb, db] = rank(b.line);
      return ga - gb || da - db || a.line - b.line || a.along - b.along;
    });
  return hero ? [hero, ...rest] : rest;
}

/** The biggest print of a photograph of shape `aspect` (width over height) whose paper fits in maxW x maxH. */
export function printSize(maxW: number, maxH: number, aspect: number): PrintSize {
  const border = BORDER_M;
  const bottom = BORDER_M + CAPTION_BAND_M;
  const photoW = Math.max(0, Math.min(maxW - 2 * border, (maxH - border - bottom) * aspect));
  const photoH = photoW / aspect;
  return { paperW: photoW + 2 * border, paperH: photoH + border + bottom, photoW, photoH, border, bottom };
}

/** The print's card title: the photograph's title and its place (unless the title names it), capitalised. */
export function cardTitle(photo: Pick<Photograph, 'title' | 'place'>) {
  const title = photo.title.trim();
  const place = photo.place?.trim();
  const named = place && title.toLowerCase().includes(place.toLowerCase());
  return [title.charAt(0).toUpperCase() + title.slice(1), named ? null : place].filter(Boolean).join(', ');
}

/** What the marker says on the border: his line, else the title, else the day he posted it. */
export function sharpieOf(photo: Pick<Photograph, 'sharpie' | 'title' | 'date'>) {
  return photo.sharpie?.trim() || photo.title?.trim() || photo.date || '';
}

/** The size of a photograph to draw `widthPx` wide from: the smallest that is wide enough, else the largest. */
export function pictureFor(photo: Pick<Photograph, 'small' | 'medium' | 'large'>, widthPx: number): Picture {
  return [photo.small, photo.medium, photo.large].find((p) => p.width >= widthPx) ?? photo.large;
}

/**
 * A least-squares affine map from world position to a flat mesh's first UV set, as two rows (u = p·xyz + w), or null
 * when the UVs are not affine over the mesh (several islands, a bent wall): then no point on it has one UV to read the
 * bake from. The fit runs in the mesh's own plane (its thinnest axis is its normal), centred, so it stays well
 * conditioned at millimetre scale.
 */
export function affineUv(positions: ArrayLike<number>, uvs: ArrayLike<number>, count: number, tolerance = 0.004) {
  if (count < 3) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const centre = [0, 0, 0];
  for (let i = 0; i < count; i++)
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a];
      min[a] = Math.min(min[a], v);
      max[a] = Math.max(max[a], v);
      centre[a] += v / count;
    }
  const extent = max.map((v, a) => v - min[a]);
  const normal = extent.indexOf(Math.min(...extent));
  const [s, t] = [0, 1, 2].filter((a) => a !== normal);
  // Normal equations for u = a s + b t + c over the centred in-plane coordinates.
  const m = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  const e = m.elements;
  const bu = [0, 0, 0];
  const bv = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const q = [positions[i * 3 + s] - centre[s], positions[i * 3 + t] - centre[t], 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) e[c * 3 + r] += q[r] * q[c];
      bu[r] += q[r] * uvs[i * 2];
      bv[r] += q[r] * uvs[i * 2 + 1];
    }
  }
  if (Math.abs(m.determinant()) < 1e-12) return null;
  m.invert();
  const [ua, ub, uc] = new THREE.Vector3(...bu).applyMatrix3(m).toArray();
  const [va, vb, vc] = new THREE.Vector3(...bv).applyMatrix3(m).toArray();
  const row = (a: number, b: number, c: number) => {
    const xyz = [0, 0, 0];
    xyz[s] = a;
    xyz[t] = b;
    return new THREE.Vector4(xyz[0], xyz[1], xyz[2], c - a * centre[s] - b * centre[t]);
  };
  const u = row(ua, ub, uc);
  const v = row(va, vb, vc);
  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector4(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], 1);
    if (Math.abs(p.dot(u) - uvs[i * 2]) > tolerance || Math.abs(p.dot(v) - uvs[i * 2 + 1]) > tolerance) return null;
  }
  return { u, v };
}

// ---- A clip the set does not have ----

/** One print on a line as the layout sees it: its place along the line and its paper's width (metres). */
export interface Slot {
  along: number;
  width: number;
  hero: boolean;
}

/**
 * Where a line's prints go when it takes one more print `width` wide, between the string's usable ends: the new print
 * goes into the widest gap, and every print then hangs the same distance from the next, in the same order, the first
 * and the last at the string's ends (a negative distance is an overlap). Returns each slot's new place (in the given
 * order), the new print's, and the gap it took (pass it back to keep it).
 */
export function makeRoom(slots: readonly Slot[], ends: readonly [number, number], width: number, at?: number) {
  const order = slots.map((slot, i) => ({ ...slot, i })).sort((a, b) => a.along - b.along);
  const gaps = [...order, null].map((s, k) => {
    const before = k ? order[k - 1].along + order[k - 1].width / 2 : ends[0];
    return (s ? s.along - s.width / 2 : ends[1]) - before;
  });
  const gap = at ?? gaps.indexOf(Math.max(...gaps));
  const row = [...order.slice(0, gap), { width, i: -1 }, ...order.slice(gap)];
  const joint = (ends[1] - ends[0] - row.reduce((sum, s) => sum + s.width, 0)) / Math.max(1, row.length - 1);
  const placed = slots.map((s) => s.along);
  let added = 0;
  let edge = ends[0];
  for (const s of row) {
    const centre = edge + s.width / 2;
    if (s.i < 0) added = centre;
    else placed[s.i] = centre;
    edge = centre + s.width / 2 + joint;
  }
  return { placed, added, at: gap };
}

interface Clip extends ClipSpec {
  anchor: THREE.Object3D;
}

interface Print {
  clip: Clip;
  index: number;
  photo: Photograph;
  size: PrintSize;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  shadow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  proxy: THREE.Mesh;
  texture: THREE.Texture | null;
  density: 'small' | 'large' | null;
  /** The picture the print was last drawn from (its URL). */
  picture: string | null;
}

/** The room's darkroom clips, read from their empties' names and extras. */
export function readClips(root: THREE.Object3D): Clip[] {
  const clips: Clip[] = [];
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const match = /^darkroom_clip_(\d+)_(\d+)$/.exec(node.name);
    if (!match) return;
    const quaternion = node.getWorldQuaternion(new THREE.Quaternion());
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    const right = new THREE.Vector3(0, 1, 0).cross(out).normalize();
    const position = node.getWorldPosition(new THREE.Vector3()).divideScalar(WORLD_SCALE);
    clips.push({
      name: node.name,
      line: Number(match[1]),
      k: Number(match[2]),
      maxW: Number(node.userData.maxW_m) || 0.25,
      maxH: Number(node.userData.maxH_m) || 0.3,
      tiltDeg: Number(node.userData.tiltDeg) || 0,
      hero: node.userData.hero === true,
      y: position.y,
      along: position.dot(right),
      anchor: node,
    });
  });
  return hangOrder(clips);
}

export class Darkroom {
  private clips: Clip[];
  private readonly prints: Print[] = [];
  private readonly bounds = new THREE.Box3();
  private readonly wall: THREE.Mesh | null;
  private readonly sharedUniforms: Record<string, THREE.IUniform>;
  private readonly breeze: Breeze | null;
  private readonly lightSource: 'wall-bake' | 'fallback';
  private wanted: 'small' | 'large' | null = null;
  private loading: Promise<void> | null = null;
  private sinceCheck = CHECK_EVERY_S;
  private hung = false;
  /** A picture arrived since the last frame; and whether the last update changed what the prints show. */
  private arrived = false;
  private changed = false;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly proxies: THREE.Mesh[],
    private readonly hotspots: readonly Hotspot[],
    lamp: LampUniforms,
    breeze: Breeze | null,
    private readonly reducedMotion: boolean,
  ) {
    this.clips = readClips(root);
    this.breeze = reducedMotion ? null : breeze;
    const centre = new THREE.Vector3();
    for (const clip of this.clips) {
      const box = this.clipBox(clip);
      this.bounds.union(box);
    }
    this.bounds.getCenter(centre);
    const out = this.clips.length
      ? new THREE.Vector3(0, 0, 1).applyQuaternion(this.clips[0].anchor.getWorldQuaternion(new THREE.Quaternion()))
      : new THREE.Vector3(0, 0, 1);

    const wall = this.findWall(root, centre, out);
    this.wall = wall?.mesh ?? null;
    const fit = wall ? this.fitWall(wall.mesh, wall.point, out) : null;
    this.lightSource = fit ? 'wall-bake' : 'fallback';
    const lampNode = root.getObjectByName('env_darkroom_light');
    const lampPos = lampNode
      ? new THREE.Box3().setFromObject(lampNode).getCenter(new THREE.Vector3())
      : centre.clone().add(new THREE.Vector3(0, 0.6 * WORLD_SCALE, 0)).addScaledVector(out, 0.3 * WORLD_SCALE);
    const reference = lampPos.clone().add(new THREE.Vector3(0, -REFERENCE_BELOW_LAMP_M * WORLD_SCALE, 0));
    const refUv = fit ? new THREE.Vector2(reference.dot(vec3(fit.u)) + fit.u.w, reference.dot(vec3(fit.v)) + fit.v.w) : new THREE.Vector2();

    this.sharedUniforms = {
      uWallBake: { value: this.wallMap() },
      uWallUvMatrix: { value: new THREE.Matrix3() },
      uUseWall: { value: fit ? 1 : 0 },
      uWallU: { value: fit?.u ?? new THREE.Vector4() },
      uWallV: { value: fit?.v ?? new THREE.Vector4() },
      uRefUv: { value: refUv },
      uLight: { value: 0.72 },
      uLampPos: { value: lampPos },
      uRoomTint: lamp.uRoomTint,
      uSway: { value: SWAY_SHARE },
      ...(this.breeze?.uniforms ?? {}),
    };
    this.followWallMap();
    this.replaceLineProxy();
  }

  /** The density the view asks for now: the close-up set once the line shows more than UPGRADE_PX_PER_M. */
  densityFor(camera: THREE.PerspectiveCamera, viewportPx: number): 'small' | 'large' {
    return this.pxPerMetre(camera, viewportPx) > UPGRADE_PX_PER_M ? 'large' : 'small';
  }

  /** A picture arrived or a print is fading in: the room draws a frame even while motion is paused (reduced motion). */
  get changing() {
    return this.changed;
  }

  /** The room has a darkroom line to hang prints on. */
  get hasClips() {
    return this.clips.length > 0;
  }

  get isHung() {
    return this.hung;
  }

  /** The lines' bounds with every print's box, for loading once they come into view. */
  get box() {
    return this.bounds;
  }

  /** Hangs the set on the clips in order (the first on the hero clip) and names each print's hotspot after its photograph. */
  hang(photos: readonly Photograph[]) {
    if (this.hung) return;
    this.hung = true;
    // The full atlases may have replaced the wall's since the line was built: the prints start from what it shows now.
    this.followWallMap();
    for (let extra = photos.length - this.clips.length; extra > 0 && this.addClip(photos); extra--);
    this.clips.forEach((clip, index) => {
      const photo = photos[index];
      if (!photo) return;
      const aspect = photo.medium.width / photo.medium.height;
      const size = printSize(clip.maxW, clip.maxH, aspect);
      const print = this.buildPrint(clip, index, photo, size);
      this.prints.push(print);
      const hotspot = this.hotspots.find((h) => h.proxies.includes(print.proxy.name));
      if (!hotspot) return;
      hotspot.label = sharpieOf(photo) || photo.title;
      hotspot.prop = `A print of “${photo.title}”`;
      hotspot.card = { title: cardTitle(photo), line: photo.caption };
      hotspot.target = `photography/${photo.slug}`;
      hotspot.href = `/#photography/${photo.slug}`;
    });
  }

  /** The slug of the photograph on the `index`-th print in hang order (0 is the hero), or null. */
  slugAt(index: number): string | null {
    return this.prints.find((p) => p.index === index)?.photo.slug ?? null;
  }

  /** Draws every print at the density for the view; `instantly` (reduced motion) skips the fade. */
  async load(textures: TextureStore, density: 'small' | 'large', instantly: boolean) {
    if (this.wanted === 'large' || this.wanted === density) return this.loading ?? undefined;
    this.wanted = density;
    const texelsPerM = density === 'large' ? LARGE_TEXELS_PER_M : SMALL_TEXELS_PER_M;
    this.loading = (async () => {
      await loadHand();
      await Promise.all(
        this.prints.map(async (print) => {
          try {
            const source = pictureFor(print.photo, print.size.photoW * texelsPerM);
            // AVIF where the browser decodes it, else the WebP copy.
            let url = source.avif ?? source.src;
            const bitmap = await textures.bitmap(url).catch(() => {
              if (url === source.src) throw new Error(`${url} did not decode`);
              url = source.src;
              return textures.bitmap(url);
            });
            if (this.wanted !== density) return bitmap.close();
            const canvas = drawPrint(print.photo, bitmap, print.size, texelsPerM);
            bitmap.close();
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            print.texture?.dispose();
            print.texture = texture;
            print.density = density;
            print.picture = url;
            print.mesh.material.uniforms.uMap.value = texture;
            print.shadow.visible = true;
            this.arrived = true;
            if (instantly) print.mesh.material.uniforms.uShown.value = 1;
          } catch (error) {
            console.warn(`room: the print of ${print.photo.slug} did not load`, error);
          }
        }),
      );
    })();
    return this.loading;
  }

  /**
   * Fades prints in, follows the wall's atlas if it is swapped for a sharper one, and asks for the close-up set once the
   * line shows more than UPGRADE_PX_PER_M (`viewportPx`: the canvas height in device pixels).
   */
  update(dt: number, camera: THREE.PerspectiveCamera, viewportPx: number, textures: TextureStore) {
    this.changed = this.arrived;
    this.arrived = false;
    for (const print of this.prints) {
      const shown = print.mesh.material.uniforms.uShown;
      if (print.texture && shown.value < 1) {
        shown.value = Math.min(1, shown.value + dt / FADE_S);
        this.changed = true;
      }
    }
    this.followWallMap();
    this.sinceCheck += dt;
    if (this.sinceCheck < CHECK_EVERY_S || this.wanted !== 'small' || !this.prints.length) return;
    this.sinceCheck = 0;
    if (this.densityFor(camera, viewportPx) === 'large') void this.load(textures, 'large', this.reducedMotion);
  }

  probe() {
    return {
      clips: this.clips.length,
      wall: this.wall?.name ?? null,
      light: this.lightSource,
      swaying: Boolean(this.breeze),
      density: this.wanted,
      prints: this.prints.map((p) => ({
        clip: `${p.clip.line}_${p.clip.k}`,
        index: p.index,
        hero: p.clip.hero,
        slug: p.photo.slug,
        caption: sharpieOf(p.photo),
        shown: Number((p.mesh.material.uniforms.uShown.value as number).toFixed(2)),
        size: p.density,
        picture: p.picture,
        paper: [round(p.size.paperW), round(p.size.paperH)],
        layer: round(p.mesh.position.z),
        proxy: p.proxy.name,
      })),
    };
  }

  dispose() {
    for (const print of this.prints) {
      print.texture?.dispose();
      print.mesh.geometry.dispose();
      print.mesh.material.dispose();
      print.shadow.geometry.dispose();
      print.shadow.material.dispose();
      print.mesh.removeFromParent();
      print.shadow.removeFromParent();
    }
  }

  /**
   * One more clip, for a set larger than the room's clips: on the line with the fewest (the hero's on a tie), where
   * makeRoom finds room. The line's prints move along the string with their pegs (the pegs are part of the baked
   * string), following the string's sag, and the new clip gets a copy of a peg. False when the line cannot be read.
   */
  private addClip(photos: readonly Photograph[]) {
    const lines = new Map<number, Clip[]>();
    for (const clip of this.clips) lines.set(clip.line, [...(lines.get(clip.line) ?? []), clip]);
    const heroLine = this.clips.find((c) => c.hero)?.line;
    const [line, clips] = [...lines].sort(([a, x], [b, y]) => x.length - y.length || Number(b === heroLine) - Number(a === heroLine) || a - b)[0] ?? [];
    const string = this.root.getObjectByName(`darkroom_line_${line}`);
    if (!clips || !(string instanceof THREE.Mesh)) return false;

    const right = rightOf(clips[0].anchor);
    const box = new THREE.Box3().setFromObject(string);
    const alongs = boxCorners(box).map((p) => p.dot(right) / WORLD_SCALE);
    const ends: [number, number] = [Math.min(...alongs) + STRING_END_M, Math.max(...alongs) - STRING_END_M];
    const paper = (clip: Pick<Clip, 'maxW' | 'maxH'>, photo: Photograph | undefined) =>
      photo ? printSize(clip.maxW, clip.maxH, photo.medium.width / photo.medium.height).paperW : clip.maxW;
    const slots = () => clips.map((clip) => ({ along: clip.along, width: paper(clip, photos[this.clips.indexOf(clip)]), hero: clip.hero }));
    // Where it goes is decided on the line as it hangs now; the spread uses the photographs that hang once it is in.
    const first = makeRoom(slots(), ends, NEW_CLIP.maxW);
    const before = clips.filter((c) => c.along < first.added).at(-1);
    const after = clips.find((c) => c.along > first.added);
    const parity = [before, after].find((c) => c && !c.hero)?.k ?? 1;
    const used = new Set(clips.map((c) => c.k));
    let k = (parity + 1) % 2;
    while (used.has(k)) k += 2;
    const template = clips.filter((c) => c.k % 2 === k % 2).sort((a, b) => Math.abs(a.along - first.added) - Math.abs(b.along - first.added))[0] ?? clips[0];
    const anchor = new THREE.Object3D();
    anchor.name = `darkroom_clip_${line}_${k}`;
    anchor.quaternion.copy(template.anchor.quaternion);
    anchor.position.copy(template.anchor.position);
    Object.assign(anchor.userData, { maxW_m: NEW_CLIP.maxW, maxH_m: NEW_CLIP.maxH, tiltDeg: template.tiltDeg });
    template.anchor.parent?.add(anchor);
    const clip: Clip = { ...NEW_CLIP, name: anchor.name, line, k, tiltDeg: template.tiltDeg, hero: false, y: template.y, along: template.along, anchor };
    this.clips = hangOrder([...this.clips, clip]);
    const final = makeRoom(slots(), ends, paper(clip, photos[this.clips.indexOf(clip)]), first.at);

    // The string sags as a parabola, and every clip hangs the same drop below it: fit its height along the line.
    const sag = fitParabola(clips.map((c) => [c.along, c.y]));
    const pegs = pegParts(string);
    const shift = (c: Clip, along: number) => {
      const from = c.anchor.getWorldPosition(new THREE.Vector3());
      const to = from.clone().addScaledVector(right, (along - c.along) * WORLD_SCALE);
      to.y += (sag(along) - sag(c.along)) * WORLD_SCALE;
      return { from, to };
    };
    copyPeg(string, pegs, shift(template, template.along).from, shift(template, final.added).to, `darkroom_peg_${line}_${k}`);
    [...clips, clip].forEach((c, i) => {
      const along = c === clip ? final.added : final.placed[i];
      const { from, to } = shift(c, along);
      if (c !== clip) movePeg(string, pegs, from, to);
      c.anchor.position.copy(c.anchor.parent!.worldToLocal(to.clone()));
      c.anchor.updateMatrixWorld(true);
      c.y += sag(along) - sag(c.along);
      c.along = along;
    });
    this.bounds.union(this.clipBox(clip));
    return true;
  }

  private buildPrint(clip: Clip, index: number, photo: Photograph, size: PrintSize): Print {
    // The print's own frame is the clip's: it hangs below the clip, a layer in front for every other clip on the line
    // (the hero on top), so where prints overlap one is plainly in front and its box is the one a click finds first.
    const layer = clip.hero ? 2 * LAYER_M : (clip.k % 2) * LAYER_M;
    const geometry = new THREE.PlaneGeometry(size.paperW, size.paperH, 8, 12);
    geometry.translate(0, GRIP_M - size.paperH / 2, 0);
    const uv = geometry.getAttribute('uv');
    const drop = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) drop[i] = 1 - uv.getY(i);
    geometry.setAttribute('aDrop', new THREE.BufferAttribute(drop, 1));
    const random = seeded(seedOf(`print-${photo.slug}`));
    const material = new THREE.ShaderMaterial({
      vertexShader: (this.breeze ? `#define SWAY\n${this.breeze.glsl}\n` : '') + printVert,
      fragmentShader: printFrag,
      side: THREE.DoubleSide,
      uniforms: {
        ...this.sharedUniforms,
        uMap: { value: null },
        uShown: { value: 0 },
        uPaper: { value: new THREE.Color(PAPER) },
        uCurl: { value: CURL_M * (0.6 + random() * 0.8) * (random() < 0.5 ? 1 : 0.7) },
        uHalfWidth: { value: size.paperW / 2 },
      },
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `darkroom_print_${index}`;
    mesh.position.z = layer;
    clip.anchor.add(mesh);

    const behind = this.distanceToWall(clip);
    const shadowGeometry = new THREE.PlaneGeometry(size.paperW + 2 * SHADOW_BLUR_M, size.paperH + 2 * SHADOW_BLUR_M);
    const shadow = new THREE.Mesh(
      shadowGeometry,
      new THREE.ShaderMaterial({
        vertexShader: printShadowVert,
        fragmentShader: printShadowFrag,
        transparent: true,
        depthWrite: false,
        uniforms: { uHalf: { value: new THREE.Vector2(size.paperW / 2, size.paperH / 2) }, uBlur: { value: SHADOW_BLUR_M }, uStrength: { value: 0.5 } },
      }),
    );
    shadow.name = `darkroom_print_shadow_${index}`;
    shadow.position.set(0, GRIP_M - size.paperH / 2 - SHADOW_DROP_M, -behind + 0.0015);
    shadow.visible = false;
    clip.anchor.add(shadow);

    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.paperW, size.paperH, 0.006));
    proxy.name = `hit_darkroom_print_${index}`;
    proxy.position.set(0, GRIP_M - size.paperH / 2, layer + 0.003);
    proxy.visible = false;
    clip.anchor.add(proxy);
    proxy.updateMatrixWorld(true);
    this.proxies.push(proxy);
    return { clip, index, photo, size, mesh, shadow, proxy, texture: null, density: null, picture: null };
  }

  /** Where a clip's print may hang: its box below the clip, in world units. */
  private clipBox(clip: Clip) {
    const corners = [
      [-clip.maxW / 2, GRIP_M],
      [clip.maxW / 2, GRIP_M],
      [-clip.maxW / 2, GRIP_M - clip.maxH],
      [clip.maxW / 2, GRIP_M - clip.maxH],
    ];
    clip.anchor.updateWorldMatrix(true, false);
    return new THREE.Box3().setFromPoints(corners.map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(clip.anchor.matrixWorld)));
  }

  /** The wall the lines hang on: the room's `wall_*` mesh nearest behind the lines, and where the ray met it. */
  private findWall(root: THREE.Object3D, centre: THREE.Vector3, out: THREE.Vector3) {
    const raycaster = new THREE.Raycaster(centre.clone().addScaledVector(out, 0.2 * WORLD_SCALE), out.clone().negate());
    const walls: THREE.Mesh[] = [];
    root.traverse((node) => node instanceof THREE.Mesh && /^wall_/.test(node.name) && walls.push(node));
    const hit = raycaster.intersectObjects(walls, false)[0];
    return hit ? { mesh: hit.object as THREE.Mesh, point: hit.point } : null;
  }

  /** The UV map of the wall's face toward the room (a wall is a box: each face is its own island in the atlas). */
  private fitWall(wall: THREE.Mesh, point: THREE.Vector3, out: THREE.Vector3) {
    const position = wall.geometry.getAttribute('position');
    const uv = wall.geometry.getAttribute('uv');
    if (!position || !uv) return null;
    wall.updateWorldMatrix(true, false);
    const index = wall.geometry.getIndex();
    const vertex = (i: number) => (index ? index.getX(i) : i);
    const triangles = (index ? index.count : position.count) / 3;
    const world: number[] = [];
    const flat: number[] = [];
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const near = 0.01 * WORLD_SCALE;
    for (let t = 0; t < triangles; t++) {
      const ids = [vertex(t * 3), vertex(t * 3 + 1), vertex(t * 3 + 2)];
      a.fromBufferAttribute(position, ids[0]).applyMatrix4(wall.matrixWorld);
      b.fromBufferAttribute(position, ids[1]).applyMatrix4(wall.matrixWorld);
      c.fromBufferAttribute(position, ids[2]).applyMatrix4(wall.matrixWorld);
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      if (normal.dot(out) < 0.95 || Math.abs(a.clone().sub(point).dot(out)) > near) continue;
      for (const [j, p] of [a, b, c].entries()) {
        world.push(p.x, p.y, p.z);
        flat.push(uv.getX(ids[j]), uv.getY(ids[j]));
      }
    }
    return affineUv(world, flat, world.length / 3);
  }

  /** The wall's atlas may be swapped for a sharper one (or carry a UV transform): the prints read what it reads. */
  private followWallMap() {
    const map = this.wallMap();
    this.sharedUniforms.uWallBake.value = map;
    if (!map) return;
    if (map.matrixAutoUpdate) map.updateMatrix();
    (this.sharedUniforms.uWallUvMatrix.value as THREE.Matrix3).copy(map.matrix);
  }

  private wallMap(): THREE.Texture | null {
    const material = this.wall?.material;
    return material && !Array.isArray(material) && 'map' in material ? ((material as THREE.MeshBasicMaterial).map ?? null) : null;
  }

  /** How far a clip hangs in front of the wall, metres (its local -Z to the wall), else 4 cm. */
  private distanceToWall(clip: Clip) {
    if (!this.wall) return 0.04;
    const origin = clip.anchor.getWorldPosition(new THREE.Vector3());
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(clip.anchor.getWorldQuaternion(new THREE.Quaternion()));
    const hit = new THREE.Raycaster(origin, back).intersectObject(this.wall, false)[0];
    return hit ? hit.distance / WORLD_SCALE : 0.04;
  }

  /**
   * The room's box round the whole line becomes a thin slab against the wall: a click between prints still flies to
   * the line, but each print's own box stands in front of it, and the slab claims no print for the hover glint.
   */
  private replaceLineProxy() {
    const i = this.proxies.findIndex((p) => p.name === 'hit_darkroom');
    if (i < 0 || this.bounds.isEmpty() || !this.wall) return;
    const old = this.proxies[i];
    const root = old.parent!;
    const slab = this.bounds.clone().expandByScalar(0.03 * WORLD_SCALE);
    const centre = slab.getCenter(new THREE.Vector3());
    const clip = this.clips[0];
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(clip.anchor.getWorldQuaternion(new THREE.Quaternion()));
    const wallPoint = clip.anchor.getWorldPosition(new THREE.Vector3()).addScaledVector(out, -this.distanceToWall(clip) * WORLD_SCALE);
    const axis = Math.abs(out.x) > Math.abs(out.z) ? 'x' : 'z';
    const depth = 0.01 * WORLD_SCALE;
    centre[axis] = wallPoint[axis] + Math.sign(out[axis]) * depth / 2;
    const size = slab.getSize(new THREE.Vector3());
    size[axis] = depth;
    size.divideScalar(WORLD_SCALE);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
    proxy.name = 'hit_darkroom';
    proxy.position.copy(root.worldToLocal(centre));
    proxy.visible = false;
    root.add(proxy);
    proxy.updateMatrixWorld();
    old.name = 'hit_darkroom_room';
    this.proxies[i] = proxy;
  }

  private pxPerMetre(camera: THREE.PerspectiveCamera, viewportPx: number) {
    const distance = camera.getWorldPosition(new THREE.Vector3()).distanceTo(this.bounds.getCenter(new THREE.Vector3())) / WORLD_SCALE;
    return viewportPx / (2 * Math.max(distance, 0.05) * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2));
  }
}

const vec3 = (v: THREE.Vector4) => new THREE.Vector3(v.x, v.y, v.z);

/** A clip's left-to-right direction along its line as seen from the room (world). */
function rightOf(anchor: THREE.Object3D) {
  const out = new THREE.Vector3(0, 0, 1).applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion()));
  return new THREE.Vector3(0, 1, 0).cross(out).normalize();
}

const boxCorners = (box: THREE.Box3) =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));

/** The least-squares parabola y = a s² + b s + c through (s, y) points, as a function of s. */
export function fitParabola(points: readonly (readonly [number, number])[]) {
  const m = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  const rhs = new THREE.Vector3();
  const mean = points.reduce((sum, [s]) => sum + s, 0) / Math.max(1, points.length);
  for (const [s0, y] of points) {
    const s = s0 - mean;
    const row = [s * s, s, 1];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m.elements[c * 3 + r] += row[r] * row[c];
    rhs.x += row[0] * y;
    rhs.y += row[1] * y;
    rhs.z += row[2] * y;
  }
  if (points.length < 3 || Math.abs(m.determinant()) < 1e-12) {
    const flat = points.reduce((sum, [, y]) => sum + y, 0) / Math.max(1, points.length);
    return () => flat;
  }
  const [a, b, c] = rhs.applyMatrix3(m.invert()).toArray();
  return (s0: number) => a * (s0 - mean) ** 2 + b * (s0 - mean) + c;
}

/** The small parts of a baked string's mesh (its pegs' halves and springs), each a set of triangles, with its centre. */
function pegParts(string: THREE.Mesh) {
  const geometry = string.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const corner = (i: number) => (index ? index.getX(i) : i);
  const triangles = (index ? index.count : position.count) / 3;
  const parent = Int32Array.from({ length: position.count }, (_, i) => i);
  const find = (a: number) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let t = 0; t < triangles; t++) {
    const a = find(corner(t * 3));
    parent[find(corner(t * 3 + 1))] = a;
    parent[find(corner(t * 3 + 2))] = a;
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < triangles; t++) {
    const root = find(corner(t * 3));
    groups.set(root, [...(groups.get(root) ?? []), t]);
  }
  string.updateWorldMatrix(true, false);
  const v = new THREE.Vector3();
  return [...groups.values()].flatMap((tris) => {
    const box = new THREE.Box3();
    for (const t of tris) for (let j = 0; j < 3; j++) box.expandByPoint(v.fromBufferAttribute(position, corner(t * 3 + j)).applyMatrix4(string.matrixWorld));
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) < PEG_PART_M * WORLD_SCALE ? [{ tris, centre: box.getCenter(new THREE.Vector3()) }] : [];
  });
}

type PegParts = ReturnType<typeof pegParts>;
const near = (parts: PegParts, at: THREE.Vector3) => parts.filter((part) => part.centre.distanceTo(at) < PEG_REACH_M * WORLD_SCALE);

/** Moves the peg at the clip point `from` (world) to `to`: its vertices shift in the string's own geometry. */
function movePeg(string: THREE.Mesh, parts: PegParts, from: THREE.Vector3, to: THREE.Vector3) {
  const geometry = string.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const delta = string.worldToLocal(to.clone()).sub(string.worldToLocal(from.clone()));
  const moved = new Set<number>();
  for (const part of near(parts, from)) {
    for (const t of part.tris) for (let j = 0; j < 3; j++) moved.add(index ? index.getX(t * 3 + j) : t * 3 + j);
    part.centre.add(to.clone().sub(from));
  }
  for (const i of moved) position.setXYZ(i, position.getX(i) + delta.x, position.getY(i) + delta.y, position.getZ(i) + delta.z);
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/** A copy of the peg at the clip point `from` hung at `to`: its own mesh, drawn with the string's material. */
function copyPeg(string: THREE.Mesh, parts: PegParts, from: THREE.Vector3, to: THREE.Vector3, name: string) {
  const geometry = string.geometry;
  const index = geometry.getIndex();
  const corners = near(parts, from).flatMap((part) => part.tris.flatMap((t) => [0, 1, 2].map((j) => (index ? index.getX(t * 3 + j) : t * 3 + j))));
  if (!corners.length) return null;
  const copy = new THREE.BufferGeometry();
  for (const [key, attribute] of Object.entries(geometry.attributes)) {
    const Array_ = attribute.array.constructor as new (length: number) => THREE.TypedArray;
    const out = new THREE.BufferAttribute(new Array_(corners.length * attribute.itemSize), attribute.itemSize, attribute.normalized);
    corners.forEach((i, n) => {
      for (let c = 0; c < attribute.itemSize; c++) out.setComponent(n, c, attribute.getComponent(i, c));
    });
    copy.setAttribute(key, out);
  }
  copy.translate(...string.worldToLocal(to.clone()).sub(string.worldToLocal(from.clone())).toArray());
  const peg = new THREE.Mesh(copy, string.material);
  peg.name = name;
  string.add(peg);
  return peg;
}
const round = (metres: number) => Number(metres.toFixed(4));

/** One print: paper with a faint fibre, the photograph inside its border, and his marker line on the bottom border. */
function drawPrint(photo: Photograph, image: ImageBitmap, size: PrintSize, texelsPerM: number) {
  const random = seeded(seedOf(photo.slug));
  const px = (metres: number) => metres * texelsPerM;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.round(px(size.paperW)));
  canvas.height = Math.max(8, Math.round(px(size.paperH)));
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0, n = Math.min(4000, (w * h) / 60); i < n; i++) {
    ctx.fillStyle = `rgba(110,98,80,${0.02 + random() * 0.03})`;
    ctx.fillRect(random() * w, random() * h, 1 + random() * 1.5, 1);
  }

  const x = px(size.border);
  const y = px(size.border);
  const pw = w - 2 * x;
  const ph = px(size.photoH);
  ctx.drawImage(image, x, y, pw, ph);
  // Where the image meets the paper the emulsion stops a hair short: a faint line keeps the edge from looking pasted.
  ctx.strokeStyle = 'rgba(40,32,24,0.18)';
  ctx.lineWidth = Math.max(1, px(0.0004));
  ctx.strokeRect(x, y, pw, ph);

  const caption = sharpieOf(photo);
  if (caption) {
    const band = { top: y + ph, bottom: h };
    const line = band.bottom - band.top;
    writeHand(ctx, caption, w / 2 + (random() - 0.5) * w * 0.08, band.top + line * (0.5 + (random() - 0.5) * 0.12), {
      size: line * (0.56 + random() * 0.1),
      slant: -0.04 + random() * 0.16,
      turn: (random() - 0.5) * 0.035,
      colour: INK[Math.floor(random() * INK.length)],
      weight: 0.05,
      maxWidth: w * 0.9,
      maxLines: 1,
      lineHeight: 1,
      seed: seedOf(caption),
    });
  }
  return canvas;
}
