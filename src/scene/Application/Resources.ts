import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { GpuMemory, RoomRenderer } from './Renderer';

/** Progress in [0, 1] with the name of what just loaded, for the BIOS resource list. */
export type ProgressReporter = (progress: number, label: string) => void;

export const ROOM_URL = '/room/room.glb';
export const ATLASES_URL = '/room/atlases.json';
export const FLOORPLAN_URL = '/room/floorplan.json';
const BASIS_PATH = '/room/basis/';
// The light tier keeps what the room embeds up to this size (a 1024² first-frame set as it is); larger atlases are halved.
const LIGHT_MAX_PX = 2048;

/** One KTX2 transcoder for the room and everything loaded after it (posters, the window), so it downloads once. */
export function createKtx2Loader(renderer: THREE.WebGLRenderer) {
  return new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(renderer);
}

/**
 * Loads the baked room (KTX2 textures, meshopt geometry). Byte progress drives the BIOS percent. A transcoder passed
 * in stays with the caller; one made here is disposed once the room has loaded.
 */
export async function loadRoom(
  url: string,
  renderer: THREE.WebGLRenderer,
  onProgress: ProgressReporter,
  shared?: KTX2Loader,
): Promise<THREE.Object3D> {
  const ktx2 = shared ?? createKtx2Loader(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const name = url.split('/').pop() ?? url;
  try {
    const gltf = await loader.loadAsync(url, (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(0.99, event.loaded / event.total), name);
    });
    onProgress(1, name);
    return gltf.scene;
  } finally {
    if (!shared) ktx2.dispose();
  }
}

function roomTextures(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const map = (material as THREE.MeshBasicMaterial).map;
      if (map) textures.add(map);
    }
  });
  return [...textures];
}

/**
 * The light tier's smaller textures, without a second download: the atlases carry full mip chains, so levels above
 * 2048² are dropped and the next one becomes the base (a 4096² atlas becomes 2048², a quarter of the GPU memory; a
 * 1024² first-frame atlas stays). Must run before the first upload.
 */
export function halveTextures(root: THREE.Object3D) {
  for (const texture of roomTextures(root)) {
    if (!(texture instanceof THREE.CompressedTexture)) continue;
    while (texture.mipmaps.length > 1 && texture.mipmaps[0].width > LIGHT_MAX_PX) texture.mipmaps = texture.mipmaps.slice(1);
    const { width, height } = texture.mipmaps[0];
    texture.image = { width, height };
    texture.needsUpdate = true;
  }
}

/** Base width of each texture in the room, largest first. */
export function textureWidths(root: THREE.Object3D) {
  return roomTextures(root)
    .map((texture) => (texture.image as { width?: number } | null)?.width ?? 0)
    .sort((a, b) => b - a);
}

/** The void's colour behind the set, from the floor plan T71 writes (`voidColor`), or null when it has none. */
export async function loadVoidColor(): Promise<string | null> {
  try {
    const response = await fetch(FLOORPLAN_URL);
    if (!response.ok) return null;
    const { voidColor } = (await response.json()) as { voidColor?: unknown };
    return typeof voidColor === 'string' && /^#[0-9a-f]{6}$/i.test(voidColor) ? voidColor : null;
  } catch {
    return null;
  }
}

// ---- Atlas streaming: the first frame draws the small set room.glb embeds; the full atlases follow, one at a time ----

interface AtlasLevel {
  /** Relative to atlases.json, or absolute. */
  uri: string;
  px: number;
  bytes: number;
}

/** One row of public/room/atlases.json (PLAN-ROUND-8 §4). `hero: true` streams before the rest; otherwise file order. */
export interface AtlasEntry {
  name: string;
  /** room.glb material names that show this atlas. */
  materials: string[];
  low: AtlasLevel;
  /**
   * `format`: ktx2 (UASTC or ETC1S) through the KTX2 transcoder, or avif / webp / jpeg decoded off the main thread.
   * Absent until the full set is exported: the atlas then stays at its first-frame size.
   */
  full?: AtlasLevel & { format: string };
  hero?: boolean;
}

export type AtlasState = 'low' | 'loading' | 'full' | 'failed';

export interface AtlasStatus {
  name: string;
  state: AtlasState;
  /** Base width of the texture the room shows now. */
  px: number;
  /** Bytes of the full file once fetched (from atlases.json before). */
  bytes: number;
  /** Milliseconds from its request to the swap. */
  ms?: number;
  error?: string;
}

/** `window.__roomStats`: GPU memory and the atlases' state, for tests and the measurement scripts. */
export interface RoomStats {
  /** Why nothing streams ('light', 'no-atlases'), or null when it does. */
  readonly skipped: string | null;
  readonly started: boolean;
  /** Every listed atlas has reached `full` or `failed`. */
  readonly done: boolean;
  readonly atlases: AtlasStatus[];
  readonly gpu: GpuMemory;
}

declare global {
  interface Window {
    __roomStats?: RoomStats;
  }
}

const isKtx2 = (full: NonNullable<AtlasEntry['full']>) => /^(ktx2|uastc|etc1s)/i.test(full.format) || full.uri.endsWith('.ktx2');

/**
 * After the first frame (once the room is interactive) loads each full-quality atlas in public/room/atlases.json and
 * swaps it in for the small one room.glb embeds: uploaded to the GPU first, then swapped on the next frame, so no frame
 * waits for it; every reference to the small texture (materials, the art's bake uniform) moves to the full one, which
 * keeps its filtering, UV set, colour space and orientation; the small one is then freed. Phones (the light tier) keep
 * the small set; Save-Data visitors never get the 3D room (src/layouts/Room.astro).
 */
export class AtlasStreamer {
  readonly atlases: AtlasStatus[] = [];
  private skipped: string | null = null;
  private started = false;
  private done = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: RoomRenderer,
    private readonly ktx2: KTX2Loader,
    private readonly options: { light: boolean; onSwap(): void },
  ) {
    this.skipped = options.light ? 'light' : null;
    const streamer = this;
    window.__roomStats = {
      get skipped() {
        return streamer.skipped;
      },
      get started() {
        return streamer.started;
      },
      get done() {
        return streamer.done;
      },
      atlases: this.atlases,
      get gpu() {
        return streamer.renderer.memory(streamer.scene);
      },
    };
  }

  /** Starts streaming once; resolves when every atlas has been swapped or has failed. */
  async start() {
    if (this.started) return;
    this.started = true;
    const entries = this.skipped ? [] : await this.list();
    if (!this.skipped && !entries.length) this.skipped = 'no-atlases';
    for (const entry of entries) this.atlases.push({ name: entry.name, state: 'low', px: entry.low.px, bytes: entry.full.bytes });
    for (const [i, entry] of entries.entries()) {
      if (this.abort.signal.aborted) return;
      await this.stream(entry, this.atlases[i]);
    }
    this.done = true;
  }

  dispose() {
    this.abort.abort();
    delete window.__roomStats;
  }

  private async list() {
    try {
      const response = await fetch(ATLASES_URL, { signal: this.abort.signal });
      if (!response.ok) return [];
      const entries = (await response.json()) as AtlasEntry[];
      // A stable sort: heroes first, the rest in the order T71 listed them.
      return entries
        .filter((e): e is AtlasEntry & { full: NonNullable<AtlasEntry['full']> } => Boolean(e?.full?.uri && e.materials?.length))
        .sort((a, b) => Number(Boolean(b.hero)) - Number(Boolean(a.hero)));
    } catch {
      return [];
    }
  }

  private async stream(entry: AtlasEntry & { full: NonNullable<AtlasEntry['full']> }, status: AtlasStatus) {
    const lows = this.texturesOf(entry);
    if (!lows.length) {
      Object.assign(status, { state: 'failed', error: `no texture on ${entry.materials.join(', ')}` });
      return;
    }
    const started = performance.now();
    status.state = 'loading';
    try {
      const full = await this.load(entry.full);
      const template = lows[0];
      const anisotropy = this.renderer.anisotropy();
      // One clone per UV set the small atlas was read with: clones share the image, so it uploads once.
      const byLow = new Map<THREE.Texture, THREE.Texture>();
      for (const low of lows) {
        const texture = byLow.size ? full.clone() : full;
        texture.name = template.name || entry.name;
        texture.channel = low.channel;
        texture.colorSpace = low.colorSpace;
        texture.wrapS = low.wrapS;
        texture.wrapT = low.wrapT;
        texture.magFilter = low.magFilter;
        texture.minFilter = low.minFilter;
        texture.anisotropy = anisotropy;
        texture.flipY = low.flipY;
        byLow.set(low, texture);
      }
      // Upload now; the swap waits for the next frame, so the frame that shows it does not also pay for the upload.
      this.renderer.gl.initTexture(full);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.swap(byLow);
      for (const low of lows) low.dispose();
      const image = full instanceof THREE.CompressedTexture ? full.mipmaps[0] : (full.image as { width: number });
      Object.assign(status, { state: 'full', px: image.width, ms: Math.round(performance.now() - started) });
      this.options.onSwap();
    } catch (error) {
      Object.assign(status, { state: 'failed', error: String((error as Error)?.message ?? error) });
      console.warn(`room: atlas ${entry.name} kept its first-frame texture:`, error);
    }
  }

  private async load(full: NonNullable<AtlasEntry['full']>): Promise<THREE.Texture> {
    // T71 writes paths relative to atlases.json (`atlas/desk.ktx2`); absolute ones work too.
    const url = new URL(full.uri, new URL(ATLASES_URL, location.href)).href;
    if (isKtx2(full)) return this.ktx2.loadAsync(url);
    // Decoded by createImageBitmap, off the main thread; glTF's orientation (no flip), mipmaps built on the GPU.
    const bitmap = await new THREE.ImageBitmapLoader().loadAsync(url);
    const texture = new THREE.Texture(bitmap as ImageBitmap);
    texture.flipY = false;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * The textures (one per UV set) that show this atlas: on its materials, the map or emissive map named after it
   * (room.glb names the image `room_<atlas>`), or any map of theirs if none carries the name.
   */
  private texturesOf({ name, materials }: AtlasEntry) {
    const names = new Set(materials);
    const named = new Set<unknown>();
    const any = new Set<unknown>();
    this.forEachMaterial((material) => {
      if (!names.has(material.name)) return;
      const { map, emissiveMap } = material as THREE.MeshBasicMaterial & { emissiveMap?: THREE.Texture | null };
      for (const texture of [map, emissiveMap]) {
        if (!texture) continue;
        any.add(texture.source);
        if (texture.name === name || texture.name === `room_${name}`) named.add(texture.source);
      }
    });
    const sources = named.size ? named : any;
    const textures = new Set<THREE.Texture>();
    this.forEachTexture((texture) => {
      if (sources.has(texture.source)) textures.add(texture);
    });
    return [...textures];
  }

  private swap(byLow: Map<THREE.Texture, THREE.Texture>) {
    this.forEachMaterial((material) => {
      const record = material as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        const full = value instanceof THREE.Texture ? byLow.get(value) : undefined;
        if (full) record[key] = full;
      }
      for (const uniform of Object.values((material as THREE.ShaderMaterial).uniforms ?? {})) {
        const full = uniform?.value instanceof THREE.Texture ? byLow.get(uniform.value) : undefined;
        if (full) uniform.value = full;
      }
    });
  }

  private forEachMaterial(visit: (material: THREE.Material) => void) {
    this.scene.traverse((node) => {
      const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (material) for (const m of Array.isArray(material) ? material : [material]) visit(m);
    });
  }

  private forEachTexture(visit: (texture: THREE.Texture) => void) {
    this.forEachMaterial((material) => {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) visit(value);
      for (const uniform of Object.values((material as THREE.ShaderMaterial).uniforms ?? {})) {
        if (uniform?.value instanceof THREE.Texture) visit(uniform.value);
      }
    });
  }
}
