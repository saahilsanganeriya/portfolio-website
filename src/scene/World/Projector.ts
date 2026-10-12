import * as THREE from 'three';
import { latestFilms, type ReelFilm } from '../../lib/films/latest';
import timeline from '../reel.json';
import screenFrag from '../shaders/screen.frag.glsl?raw';
import screenVert from '../shaders/screen.vert.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { Photograph } from './photographs';
import type { TextureStore } from './textures';

// The projector and its screen. A dial on the projector picks the program: The Reel (public-domain early cinema
// intercut with intertitles from the owner's Letterboxd diary, public/room/reel.mp4 built by
// scripts/media/build-reel.mjs), Photographs (his photography, one frame at a time, the film rolling between them),
// or Short films (a card until there are some). Nothing on it ever has sound. A program loads only once the room is
// interactive and the screen is in view, or when it is picked; it plays while the room runs, the screen is in view
// and the tab is visible, never under reduced motion. Until then, or if it fails, the screen keeps its baked still.

export const REEL_URL = '/room/reel.mp4';
const FILMS_URL = '/api/films.json';
const FPS = 18;
const CARD_FADE_S = 0.3;
const FADE_IN_S = 0.6;
// A program change: the lamp dips while the film rolls over to the next program.
const CHANGE_S = 0.5;
// The picture floats this far in front of the baked projection so the two never z-fight, on a plane a little larger
// than it whose margin covers the hard edge of the open gate's light baked into the fabric.
const LIFT_M = 0.002;
const MARGIN = 1.05;
const CARD = { width: 512, height: 384 };
const SERIF = '"Newsreader Variable", Georgia, serif';
// The bake lit the whole screen with the projector's open gate; with film in the gate, only the picture is lit, so
// the fabric dims (a linear factor on its baked colour) while a program shows.
const FABRIC_DIM = 0.16;
// Display values, like the room's baked colours: the dimmed fabric (film black), and the lamp's full light.
const SCREEN_DARK = new THREE.Vector3(0.3, 0.27, 0.23);
const SCREEN_LIT = new THREE.Vector3(0.93, 0.95, 0.96);
// Photographs: how long each holds, and how long the film takes to roll to the next.
const PHOTO_HOLD_S = 6;
const PHOTO_ROLL_S = 0.9;

export const PROGRAMS = [
  { name: 'reel', label: 'The Reel', mark: 'reel' },
  { name: 'photographs', label: 'Photographs', mark: 'photographs' },
  { name: 'shorts', label: 'Short films — coming soon', mark: 'short_films' },
] as const;
export type ProgramName = (typeof PROGRAMS)[number]['name'];
export type ProgramState = 'waiting' | 'loading' | 'playing' | 'paused' | 'failed';
export type { ReelFilm };

type Card = { kind: 'now-showing' } | { kind: 'lately' } | { kind: 'title'; title: string; original: string; credit: string };
interface Segment {
  start: number;
  end: number;
  card?: Card;
  clip?: string;
}
const SEGMENTS = timeline.segments as Segment[];

/** What the screen's shader shows this frame. */
interface ScreenInputs {
  a: THREE.Texture;
  b: THREE.Texture;
  mixB: number;
  roll: number;
  colour: number;
  frame: number;
}

interface Program {
  readonly name: ProgramName;
  readonly state: ProgramState;
  /** Fetches what it shows; resolves once it can show a frame (or has failed). */
  load(): Promise<void>;
  /** Advances its own clock while `playing`; null until it has a frame. */
  frame(dt: number, playing: boolean): ScreenInputs | null;
  /** Stops while another program is on the screen. */
  pause(): void;
  /** The SaahilOS window holding what is on the screen now. */
  target(): string;
  dispose(): void;
}

// ---- intertitle cards: grey on black, read by the shader as how much light reaches the screen ----

class Intertitle {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;

  constructor() {
    this.canvas.width = CARD.width;
    this.canvas.height = CARD.height;
    this.texture = new THREE.CanvasTexture(this.canvas);
  }

  private get ctx() {
    return this.canvas.getContext('2d')!;
  }

  /** The border every card shares, on black. */
  frame() {
    const ctx = this.ctx;
    const { width: w, height: h } = CARD;
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d8d8d8';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, w - 40, h - 40);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(30, 30, w - 60, h - 60);
    for (const [x, y] of [
      [30, 30],
      [w - 30, 30],
      [30, h - 30],
      [w - 30, h - 30],
    ]) {
      ctx.fillStyle = '#d8d8d8';
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y);
      ctx.lineTo(x, y + 7);
      ctx.lineTo(x - 7, y);
      ctx.fill();
    }
    ctx.fillStyle = '#f0f0f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }

  done() {
    this.texture.needsUpdate = true;
  }

  text(value: string, y: number, size: number, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.font = `${size}px ${SERIF}`;
    ctx.fillText(value, CARD.width / 2, y);
    ctx.globalAlpha = 1;
  }

  caps(value: string, y: number, size: number) {
    this.ctx.letterSpacing = `${Math.round(size * 0.25)}px`;
    this.text(value.toUpperCase(), y, size);
    this.ctx.letterSpacing = '0px';
  }

  /** Draws `value` centred on `y`, shrinking it (then wrapping, up to `lines`) to fit the card; returns its bottom. */
  fit(value: string, y: number, maxSize: number, lines: number, alpha = 1) {
    const ctx = this.ctx;
    const maxWidth = CARD.width - 110;
    const width = (s: string, size: number) => {
      ctx.font = `${size}px ${SERIF}`;
      return ctx.measureText(s).width;
    };
    let size = maxSize;
    let rows = [value];
    while (size > 16) {
      if (width(value, size) <= maxWidth) break;
      if (lines > 1 && size <= maxSize * 0.75) {
        const words = value.split(' ');
        const half = words.findIndex((_, i) => width(words.slice(0, i + 1).join(' '), size) > maxWidth / 1.6);
        const split = Math.max(1, half === -1 ? Math.ceil(words.length / 2) : half);
        rows = [words.slice(0, split).join(' '), words.slice(split).join(' ')].filter(Boolean);
        if (rows.every((row) => width(row, size) <= maxWidth)) break;
        rows = [value];
      }
      size -= 2;
    }
    const lead = size * 1.1;
    const top = y - ((rows.length - 1) * lead) / 2;
    rows.forEach((row, i) => this.text(row, top + i * lead, size, alpha));
    return top + (rows.length - 1) * lead + size / 2;
  }

  /** Letterboxd-style stars, with a half star for .5. */
  stars(rating: number, y: number, size: number) {
    const ctx = this.ctx;
    const count = Math.ceil(rating);
    const step = size * 1.2;
    const left = CARD.width / 2 - ((count - 1) * step) / 2;
    for (let i = 0; i < count; i++) {
      const x = left + i * step;
      ctx.save();
      if (i + 1 > rating) {
        ctx.beginPath();
        ctx.rect(x - size, y - size, size, size * 2);
        ctx.clip();
      }
      ctx.beginPath();
      for (let p = 0; p < 10; p++) {
        const radius = p % 2 === 0 ? size / 2 : size / 4.8;
        const angle = -Math.PI / 2 + (p * Math.PI) / 5;
        ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  dispose() {
    this.texture.dispose();
  }
}

// ---- The Reel ----

class ReelProgram implements Program {
  readonly name = 'reel';
  private readonly card = new Intertitle();
  private readonly abort = new AbortController();
  private video: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private objectUrl = '';
  private status: ProgramState = 'waiting';
  private cardIndex = -1;

  constructor(private films: ReelFilm[]) {
    // A card drawn before the page's serif arrived is drawn again with it.
    void document.fonts?.ready.then(() => (this.cardIndex = -1));
  }

  get state(): ProgramState {
    if (!this.video) return this.status;
    return this.video.paused ? 'paused' : 'playing';
  }

  get time() {
    return this.video?.currentTime ?? 0;
  }

  async load() {
    if (this.status !== 'waiting') return;
    this.status = 'loading';
    const { signal } = this.abort;
    void fetch(FILMS_URL, { signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        const live = latestFilms(data);
        if (live.length > 0) {
          this.films = live;
          this.cardIndex = -1;
        }
      })
      .catch(() => {});
    try {
      // One request for the whole file: no range requests while it loops, and seeking never waits on the network.
      const response = await fetch(REEL_URL, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.objectUrl = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: 'video/mp4' }));
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = this.objectUrl;
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(video.error), { once: true });
      });
      if (signal.aborted) return;
      this.video = video;
      this.videoTexture = new THREE.VideoTexture(video);
    } catch (error) {
      if (signal.aborted) return;
      console.warn('room: the projector reel did not load; the screen keeps its still', error);
      this.status = 'failed';
    }
  }

  frame(_dt: number, playing: boolean): ScreenInputs | null {
    const video = this.video;
    if (!video || !this.videoTexture) return null;
    if (playing && video.paused) {
      video.play().catch((error: DOMException) => {
        // A pause() before play() settled is not a failure.
        if (error.name !== 'AbortError') this.fail();
      });
    } else if (!playing && !video.paused) video.pause();

    const t = video.currentTime;
    const index = SEGMENTS.findIndex((s) => t < s.end);
    const segment = SEGMENTS[index === -1 ? SEGMENTS.length - 1 : index];
    let mixB = 0;
    if (segment.card) {
      if (index !== this.cardIndex) {
        this.drawCard(segment.card);
        this.cardIndex = index;
      }
      mixB = THREE.MathUtils.clamp(Math.min(t - segment.start, segment.end - t) / CARD_FADE_S, 0, 1);
    }
    return { a: this.videoTexture, b: this.card.texture, mixB, roll: 0, colour: 0, frame: Math.floor(t * FPS) };
  }

  target() {
    return 'films';
  }

  pause() {
    if (this.video && !this.video.paused) this.video.pause();
  }

  dispose() {
    this.abort.abort();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.videoTexture?.dispose();
    this.card.dispose();
  }

  private fail() {
    this.status = 'failed';
    this.video?.pause();
    this.video = null;
  }

  private drawCard(card: Card) {
    const c = this.card;
    const h = CARD.height;
    c.frame();
    const [newest, ...earlier] = this.films;
    if (card.kind === 'now-showing') {
      c.caps('Now showing', h * 0.22, 22);
      c.text('last watched', h * 0.33, 24, 0.75);
      if (newest) {
        const bottom = c.fit(newest.title, h * 0.5, 64, 2);
        c.text(`(${newest.year})`, bottom + 30, 26, 0.85);
        if (newest.rating !== null) c.stars(newest.rating, bottom + 74, 30);
      }
    } else if (card.kind === 'lately') {
      c.caps('Also lately', h * 0.22, 22);
      earlier.slice(0, 2).forEach((film, i) => {
        const y = h * (0.42 + i * 0.25);
        c.fit(`${film.title} (${film.year})`, y, 32, 1);
        if (film.rating !== null) c.stars(film.rating, y + 34, 20);
      });
    } else {
      const bottom = c.fit(card.title, h * 0.38, 54, 2);
      c.fit(card.original, bottom + 40, 24, 1, 0.8);
      this.card.canvas.getContext('2d')!.fillRect(CARD.width / 2 - 40, bottom + 70, 80, 1.5);
      c.caps(card.credit, bottom + 100, 17);
    }
    c.done();
  }
}

// ---- Photographs ----

/** One photograph letterboxed on black in a 4:3 frame. */
class PhotoFrame {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  slug = '';

  constructor() {
    this.canvas.width = CARD.width;
    this.canvas.height = CARD.height;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
  }

  draw(slug: string, image: ImageBitmap | null) {
    this.slug = slug;
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CARD.width, CARD.height);
    if (image) {
      const scale = Math.min(CARD.width / image.width, CARD.height / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.drawImage(image, (CARD.width - w) / 2, (CARD.height - h) / 2, w, h);
    }
    this.texture.needsUpdate = true;
  }
}

class PhotoProgram implements Program {
  readonly name = 'photographs';
  private photos: Photograph[] = [];
  private index = 0;
  private hold = 0;
  private roll = -1;
  private clock = 0;
  private status: ProgramState = 'waiting';
  private playing = false;
  private readonly frames = [new PhotoFrame(), new PhotoFrame()];
  private readonly bitmaps = new Map<string, Promise<ImageBitmap | null>>();
  /** The next photograph, drawn into the second frame once its picture is in hand; the film rolls only then. */
  private upcoming: { index: number; ready: boolean } | null = null;

  constructor(
    private readonly textures: TextureStore,
    private readonly collection: () => Promise<Photograph[]>,
  ) {}

  get state(): ProgramState {
    if (this.status !== 'playing') return this.status;
    return this.playing ? 'playing' : 'paused';
  }

  get slug() {
    return this.photos[this.index]?.slug ?? null;
  }

  async load() {
    if (this.status !== 'waiting') return;
    this.status = 'loading';
    try {
      this.photos = await this.collection();
      if (this.photos.length === 0) throw new Error('no photographs');
      this.frames[0].draw(this.photos[0].slug, await this.picture(0));
      void this.picture(1);
      this.status = 'playing';
    } catch (error) {
      console.warn('room: the photographs did not load', error);
      this.status = 'failed';
    }
  }

  frame(dt: number, playing: boolean): ScreenInputs | null {
    if (this.status !== 'playing') return null;
    this.playing = playing;
    if (playing) {
      this.clock += dt;
      if (this.roll >= 0) {
        this.roll += dt / PHOTO_ROLL_S;
        if (this.roll >= 1) {
          // The next frame is now in the gate: swap, and fetch the one after.
          this.frames.reverse();
          this.index = (this.index + 1) % this.photos.length;
          this.roll = -1;
          this.hold = 0;
          this.upcoming = null;
          void this.picture(this.index + 1);
        }
      } else if ((this.hold += dt) >= PHOTO_HOLD_S) {
        if (!this.upcoming) this.prepare((this.index + 1) % this.photos.length, this.frames[1]);
        // Roll only once the next picture is in hand, so the film never rolls onto a black frame.
        else if (this.upcoming.ready) this.roll = 0;
      }
    }
    // Read after the swap above, so the frame that lands is the one shown.
    const [current, next] = this.frames;
    const eased = this.roll < 0 ? 0 : this.roll * this.roll * (3 - 2 * this.roll);
    return { a: current.texture, b: next.texture, mixB: 0, roll: eased, colour: 1, frame: Math.floor(this.clock * FPS) };
  }

  target() {
    return this.slug ? `photography/${this.slug}` : 'photography';
  }

  pause() {
    this.playing = false;
  }

  dispose() {
    for (const frame of this.frames) frame.texture.dispose();
    for (const bitmap of this.bitmaps.values()) void bitmap.then((b) => b?.close());
  }

  private prepare(index: number, frame: PhotoFrame) {
    const upcoming = { index, ready: false };
    this.upcoming = upcoming;
    void this.picture(index).then((image) => {
      if (this.upcoming !== upcoming) return;
      frame.draw(this.photos[index].slug, image);
      upcoming.ready = true;
    });
  }

  /** The medium picture of photo `i` (wrapping), fetched once; only the last few are kept. */
  private picture(i: number): Promise<ImageBitmap | null> {
    const photo = this.photos[i % this.photos.length];
    let bitmap = this.bitmaps.get(photo.slug);
    if (!bitmap) {
      bitmap = this.textures.bitmap(photo.medium.src).catch((error) => {
        console.warn(`room: photograph ${photo.slug} did not load`, error);
        return null;
      });
      this.bitmaps.set(photo.slug, bitmap);
      while (this.bitmaps.size > 3) {
        const [oldest, stale] = this.bitmaps.entries().next().value!;
        this.bitmaps.delete(oldest);
        void stale.then((b) => b?.close());
      }
    }
    return bitmap;
  }
}

// ---- Short films ----

class ShortsProgram implements Program {
  readonly name = 'shorts';
  private readonly card = new Intertitle();
  private drawn = false;
  private clock = 0;

  get state(): ProgramState {
    return this.drawn ? 'playing' : 'waiting';
  }

  async load() {
    if (this.drawn) return;
    await document.fonts?.ready;
    const c = this.card;
    const h = CARD.height;
    c.frame();
    c.caps('Short films', h * 0.3, 24);
    c.fit('Coming soon', h * 0.5, 60, 1);
    c.text('none plays with sound', h * 0.7, 22, 0.7);
    c.done();
    this.drawn = true;
  }

  frame(dt: number, playing: boolean): ScreenInputs | null {
    if (!this.drawn) return null;
    if (playing) this.clock += dt;
    return { a: this.card.texture, b: this.card.texture, mixB: 0, roll: 0, colour: 0, frame: Math.floor(this.clock * FPS) };
  }

  target() {
    return 'films';
  }

  pause() {}

  dispose() {
    this.card.dispose();
  }
}

// ---- The projector: its screen, its programs and its dial ----

export interface ProjectorState {
  program: ProgramName;
  state: ProgramState;
  inView: boolean;
  /** The photograph on the screen, under Photographs. */
  photo: string | null;
}

export class Projector {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly programs: Program[];
  private current = 0;
  private readonly bounds = new THREE.Box3();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly fabric: { material: THREE.MeshBasicMaterial; baked: THREE.Color } | null = null;
  private readonly dial: {
    knob: THREE.Object3D;
    axis: THREE.Vector3;
    anglesDeg: Record<string, number>;
    rest: THREE.Quaternion;
    angle: number;
    velocity: number;
  } | null;
  private changing = 0;
  private visible = false;
  private forced = false;
  private suspended = false;
  /** Set once the room is interactive: programs may then load by themselves when the screen comes into view. */
  private interactive = false;
  private chosen = false;

  constructor(
    private readonly projection: THREE.Mesh,
    surface: THREE.Mesh | null,
    scene: THREE.Scene,
    films: ReelFilm[],
    textures: TextureStore,
    collection: () => Promise<Photograph[]>,
    dial: { knob: THREE.Object3D; axis: THREE.Vector3; anglesDeg: Record<string, number> } | null,
  ) {
    this.programs = [new ReelProgram(films), new PhotoProgram(textures, collection), new ShortsProgram()];
    if (surface?.material instanceof THREE.MeshBasicMaterial) {
      // Its own copy: the baked material is shared with every prop in the atlas.
      const material = surface.material.clone();
      surface.material = material;
      this.fabric = { material, baked: material.color.clone() };
    }
    this.dial = dial ? { ...dial, rest: dial.knob.quaternion.clone(), angle: 0, velocity: 0 } : null;
    if (this.dial) this.dial.angle = this.dialAngle();

    projection.geometry.computeBoundingBox();
    const box = projection.geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    projection.updateWorldMatrix(true, false);
    const geometry = new THREE.PlaneGeometry(size.x * MARGIN, size.y * MARGIN);
    geometry.translate(centre.x, centre.y, centre.z + (LIFT_M * WORLD_SCALE) / projection.matrixWorld.getMaxScaleOnAxis());

    this.blank.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      vertexShader: screenVert,
      fragmentShader: screenFrag,
      uniforms: {
        uA: { value: this.blank },
        uB: { value: this.blank },
        uMixB: { value: 0 },
        uRoll: { value: 0 },
        uColour: { value: 0 },
        uFrame: { value: 0 },
        uOpacity: { value: 0 },
        uMargin: { value: MARGIN },
        uDark: { value: SCREEN_DARK },
        uLight: { value: SCREEN_LIT },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.applyMatrix4(projection.matrixWorld);
    this.mesh.updateMatrixWorld();
    this.mesh.visible = false;
    scene.add(this.mesh);
    geometry.computeBoundingBox();
    this.bounds.copy(geometry.boundingBox!).applyMatrix4(this.mesh.matrixWorld);
  }

  get program(): ProgramName {
    return this.programs[this.current].name;
  }

  get label() {
    return PROGRAMS[this.current].label;
  }

  get nextLabel() {
    return PROGRAMS[(this.current + 1) % PROGRAMS.length].label;
  }

  get inView() {
    return this.visible;
  }

  /** The reel as T28's probe reported it, for the tests and the measurement scripts. */
  get reel() {
    const reel = this.programs[0] as ReelProgram;
    return { state: reel.state, time: reel.time, inView: this.visible };
  }

  get state(): ProjectorState {
    const program = this.programs[this.current];
    return {
      program: program.name,
      state: program.state,
      inView: this.visible,
      photo: program instanceof PhotoProgram ? program.slug : null,
    };
  }

  /** The SaahilOS window that holds what is on the screen now. */
  target() {
    return this.programs[this.current].target();
  }

  allowOnDemand() {
    this.interactive = true;
  }

  /** The dial's next stop: the lamp dips while the film rolls over to the next program, which loads now. */
  next() {
    this.current = (this.current + 1) % this.programs.length;
    this.chosen = true;
    this.changing = this.reducedMotion.matches ? 0 : CHANGE_S;
    void this.programs[this.current].load();
  }

  /** Measurement hook: play whenever the room runs, in view or not, for a worst-case frame rate. */
  force(on: boolean) {
    this.forced = on;
  }

  /** The room stopped drawing (off screen): the program stops with it. */
  suspend(suspended: boolean) {
    this.suspended = suspended;
  }

  update(camera: THREE.Camera, running: boolean, dt: number) {
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    this.visible = this.frustum.intersectsBox(this.bounds);
    this.updateDial(dt);

    const program = this.programs[this.current];
    const seen = this.visible || this.forced;
    if (seen && (this.interactive || this.chosen) && program.state === 'waiting') void program.load();
    const playing = running && seen && !this.suspended && document.visibilityState === 'visible' && !this.reducedMotion.matches;
    for (const other of this.programs) if (other !== program) other.pause();
    const inputs = program.frame(dt, playing);

    const u = this.mesh.material.uniforms;
    this.changing = Math.max(0, this.changing - dt);
    const shown = inputs !== null;
    const opacity =
      this.changing > 0
        ? shown
          ? Math.abs(Math.cos((this.changing / CHANGE_S) * Math.PI))
          : 0
        : this.approach(u.uOpacity.value, shown ? 1 : 0, dt);
    u.uOpacity.value = opacity;
    // How far the fabric is from its baked, open-gate light: fully dark while the lamp dips for a change.
    const dark = this.changing > 0 ? 1 : opacity;
    this.mesh.visible = opacity > 0.001;
    this.fabric?.material.color.copy(this.fabric.baked).multiplyScalar(THREE.MathUtils.lerp(1, FABRIC_DIM, dark));
    this.projection.visible = dark < 1;
    if (!inputs) return;
    u.uA.value = inputs.a;
    u.uB.value = inputs.b;
    u.uMixB.value = inputs.mixB;
    u.uRoll.value = inputs.roll;
    u.uColour.value = inputs.colour;
    u.uFrame.value = inputs.frame;
  }

  dispose() {
    for (const program of this.programs) program.dispose();
    this.blank.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
    this.fabric?.material.dispose();
  }

  private approach(value: number, target: number, dt: number) {
    const step = dt / FADE_IN_S;
    return value < target ? Math.min(target, value + step) : Math.max(target, value - step * 3);
  }

  /** Where the knob points for the program on the screen (radians from its rest). */
  private dialAngle() {
    return THREE.MathUtils.degToRad(this.dial?.anglesDeg[PROGRAMS[this.current].mark] ?? 0);
  }

  /** The knob springs to its stop with a little overshoot, as a detent does. */
  private updateDial(dt: number) {
    const dial = this.dial;
    if (!dial) return;
    const target = this.dialAngle();
    if (this.reducedMotion.matches || dt <= 0) {
      if (this.reducedMotion.matches) dial.angle = target;
    } else {
      const stiffness = 220;
      const damping = 14;
      for (let t = 0; t < dt; t += 1 / 120) {
        const h = Math.min(1 / 120, dt - t);
        dial.velocity += (stiffness * (target - dial.angle) - damping * dial.velocity) * h;
        dial.angle += dial.velocity * h;
      }
    }
    dial.knob.quaternion.copy(dial.rest).multiply(new THREE.Quaternion().setFromAxisAngle(dial.axis, dial.angle));
  }
}
