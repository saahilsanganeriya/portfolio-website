import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { GpuMemory, RoomRenderer } from './Renderer';

/** Bytes received so far of a download, and its size (0 while unknown). */
export type ByteReporter = (loaded: number, total: number) => void;

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
 * Loads the baked room (KTX2 textures, meshopt geometry), reporting its bytes as they arrive. A transcoder passed in
 * stays with the caller; one made here is disposed once the room has loaded.
 */
export async function loadRoom(url: string, renderer: THREE.WebGLRenderer, onBytes: ByteReporter, shared?: KTX2Loader): Promise<THREE.Object3D> {
  const ktx2 = shared ?? createKtx2Loader(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  try {
    // A compressed response carries no length (total 0); the caller then counts against the file's own size.
    const gltf = await loader.loadAsync(url, (event) => onBytes(event.loaded, event.lengthComputable ? event.total : 0));
    return gltf.scene;
  } finally {
    if (!shared) ktx2.dispose();
  }
}

/** The whole body of a response, reporting the bytes received as they come. */
async function readBytes(response: Response, onBytes: (loaded: number) => void): Promise<ArrayBuffer> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onBytes(buffer.byteLength);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
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

// ---- The full atlases: fetched with room.glb, on the GPU before the room is shown; the small set is the fallback ----

interface AtlasLevel {
  /** Relative to atlases.json, or absolute. */
  uri: string;
  px: number;
  bytes: number;
}

/** One row of public/room/atlases.json (PLAN-ROUND-8 §4). `hero: true` swaps in before the rest; otherwise file order. */
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

type FullEntry = AtlasEntry & { full: NonNullable<AtlasEntry['full']> };

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
  /** performance.now() when the full texture was uploaded to the GPU, and when the materials moved to it. */
  uploadedAt?: number;
  swappedAt?: number;
  /** Swapped in before the room was first shown (true), or streamed in after it (false). */
  beforeFirstFrame?: boolean;
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
  /**
   * The wait before the first frame: how long it took (ms) and whether the safety deadline ended it with some atlases
   * still on their way; null until it is over (and on the light tier, which does not wait).
   */
  readonly arrival: { ms: number; timedOut: boolean } | null;
  readonly gpu: GpuMemory;
}

declare global {
  interface Window {
    __roomStats?: RoomStats;
  }
}

const isKtx2 = (full: FullEntry['full']) => /^(ktx2|uastc|etc1s)/i.test(full.format) || full.uri.endsWith('.ktx2');

interface Fetched {
  entry: FullEntry;
  status: AtlasStatus;
  texture: Promise<THREE.Texture>;
  ready: boolean;
}

/**
 * The full-quality atlases in public/room/atlases.json, in place of the small ones room.glb embeds. `load()` fetches
 * every one at once, alongside room.glb; `install()` waits for them (up to a deadline), uploads each to the GPU
 * (`renderer.initTexture`) and moves every reference to the small texture (materials, the art's bake uniform) to the
 * full one, which keeps its filtering, UV set, colour space and orientation; the small one is then freed. An atlas that
 * misses the deadline is uploaded when it arrives and swapped on the next frame. Phones (the light tier) keep the small
 * set; Save-Data visitors never get the 3D room (src/layouts/Room.astro).
 */
export class AtlasStreamer {
  readonly atlases: AtlasStatus[] = [];
  private skipped: string | null = null;
  private fetching: Promise<Fetched[]> | null = null;
  private done = false;
  private arrival: RoomStats['arrival'] = null;
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
        return streamer.fetching !== null;
      },
      get done() {
        return streamer.done;
      },
      atlases: this.atlases,
      get arrival() {
        return streamer.arrival;
      },
      get gpu() {
        return streamer.renderer.memory(streamer.scene);
      },
    };
  }

  /** Starts fetching the list and every full atlas at once (once); `onBytes` hears each one's bytes as they arrive. */
  load(onBytes: (name: string, loaded: number, total: number) => void = () => {}) {
    this.fetching ??= (async () => {
      const entries = this.skipped ? [] : await this.list();
      if (!this.skipped && !entries.length) this.skipped = 'no-atlases';
      if (!entries.length) this.done = true;
      return entries.map((entry) => {
        const status: AtlasStatus = { name: entry.name, state: 'loading', px: entry.low.px, bytes: entry.full.bytes };
        this.atlases.push(status);
        onBytes(entry.name, 0, entry.full.bytes);
        const fetched: Fetched = { entry, status, ready: false, texture: this.fetchFull(entry.full, (loaded) => onBytes(entry.name, loaded, entry.full.bytes)) };
        fetched.texture.then(
          () => (fetched.ready = true),
          () => (fetched.ready = true),
        );
        return fetched;
      });
    })();
    return this.fetching;
  }

  /**
   * Swaps in, uploaded, every full atlas that has arrived once all have or `deadline` passes, before the room is first
   * drawn; the rest follow as they arrive. Resolves at that moment, not when the late ones land.
   */
  async install(deadline: Promise<void>) {
    const begun = performance.now();
    const fetched = await Promise.race([this.load(), deadline.then(() => null)]);
    if (!fetched) {
      // Even the list is late: the room shows its small set and the full ones stream in behind it.
      this.arrival = { ms: Math.round(performance.now() - begun), timedOut: true };
      void this.load().then((late) => this.settle(late, []));
      return;
    }
    await Promise.race([Promise.allSettled(fetched.map((f) => f.texture)), deadline]);
    const [now, late] = [fetched.filter((f) => f.ready), fetched.filter((f) => !f.ready)];
    // Hero atlases first (a stable sort keeps the list's order otherwise).
    for (const f of now.sort((a, b) => Number(Boolean(b.entry.hero)) - Number(Boolean(a.entry.hero)))) await this.swapIn(f, true);
    this.arrival = { ms: Math.round(performance.now() - begun), timedOut: late.length > 0 };
    this.settle(late, now);
  }

  dispose() {
    this.abort.abort();
    delete window.__roomStats;
  }

  /** The atlases that missed the first frame swap in as they arrive; `done` once every one has landed or failed. */
  private settle(late: Fetched[], installed: Fetched[]) {
    if (!late.length) {
      this.done = installed.length > 0 || this.done;
      return;
    }
    void Promise.all(late.map((f) => f.texture.then(() => this.swapIn(f, false), () => this.swapIn(f, false)))).then(() => (this.done = true));
  }

  private async list(): Promise<FullEntry[]> {
    try {
      const response = await fetch(ATLASES_URL, { signal: this.abort.signal });
      if (!response.ok) return [];
      const entries = (await response.json()) as AtlasEntry[];
      return entries.filter((e): e is FullEntry => Boolean(e?.full?.uri && e.materials?.length));
    } catch {
      return [];
    }
  }

  /**
   * Uploads one fetched atlas and moves the room onto it. Before the first frame the swap is immediate; after it, the
   * swap waits for the next frame, so the frame that shows it does not also pay for the upload.
   */
  private async swapIn({ entry, status, texture }: Fetched, beforeFirstFrame: boolean) {
    const started = performance.now();
    try {
      const full = await texture;
      const lows = this.texturesOf(entry);
      if (!lows.length) throw new Error(`no texture on ${entry.materials.join(', ')}`);
      const template = lows[0];
      const anisotropy = this.renderer.anisotropy();
      // One clone per UV set the small atlas was read with: clones share the image, so it uploads once.
      const byLow = new Map<THREE.Texture, THREE.Texture>();
      for (const low of lows) {
        const copy = byLow.size ? full.clone() : full;
        copy.name = template.name || entry.name;
        copy.channel = low.channel;
        copy.colorSpace = low.colorSpace;
        copy.wrapS = low.wrapS;
        copy.wrapT = low.wrapT;
        copy.magFilter = low.magFilter;
        copy.minFilter = low.minFilter;
        copy.anisotropy = anisotropy;
        copy.flipY = low.flipY;
        byLow.set(low, copy);
      }
      if (this.abort.signal.aborted) return full.dispose();
      this.renderer.gl.initTexture(full);
      status.uploadedAt = performance.now();
      if (!beforeFirstFrame) await new Promise((resolve) => requestAnimationFrame(resolve));
      if (this.abort.signal.aborted) return full.dispose();
      this.swap(byLow);
      for (const low of lows) low.dispose();
      const image = full instanceof THREE.CompressedTexture ? full.mipmaps[0] : (full.image as { width: number });
      Object.assign(status, { state: 'full', px: image.width, swappedAt: performance.now(), beforeFirstFrame, ms: Math.round(performance.now() - started) });
      // The proof that the room never shows a small atlas while the arrival runs reads these lines.
      console.info(`room: atlas ${entry.name} full ${image.width}px, uploaded at ${Math.round(status.uploadedAt)} ms, ${beforeFirstFrame ? 'before the first frame' : 'after the first frame'}`);
      this.options.onSwap();
    } catch (error) {
      Object.assign(status, { state: 'failed', error: String((error as Error)?.message ?? error) });
      console.warn(`room: atlas ${entry.name} kept its first-frame texture:`, error);
    }
  }

  private async fetchFull(full: FullEntry['full'], onBytes: (loaded: number) => void): Promise<THREE.Texture> {
    // T71 writes paths relative to atlases.json (`atlas/desk.ktx2`); absolute ones work too.
    const url = new URL(full.uri, new URL(ATLASES_URL, location.href)).href;
    const response = await fetch(url, { signal: this.abort.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${full.uri}`);
    const buffer = await readBytes(response, onBytes);
    if (isKtx2(full)) return new Promise((resolve, reject) => void this.ktx2.parse(buffer, resolve, reject));
    // Decoded by createImageBitmap, off the main thread, as ImageBitmapLoader does; glTF's orientation (no flip),
    // mipmaps built on the GPU.
    const bitmap = await createImageBitmap(new Blob([buffer], { type: response.headers.get('content-type') ?? '' }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const texture = new THREE.Texture(bitmap);
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
