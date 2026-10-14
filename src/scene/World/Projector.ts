import * as THREE from 'three';
import artVert from '../shaders/art.vert.glsl?raw';
import projectionFrag from '../shaders/projection.frag.glsl?raw';
import type { LampUniforms } from './art';
import { chapterAt, type Film } from './film';
import { artUvFlip, type ProjectorNodes } from './nodes';
import type { Photograph } from './photographs';
import type { TextureStore } from './textures';

// The projector and its picture on the wall. A dial picks the program: his story (a short silent film, see film.ts)
// or his photographs, one frame at a time with the film rolling between them. The lamp is always on: at rest the wall
// shows the program's still (the film's poster, or the photograph in the gate); a click runs it, with the reels
// turning and the projector's own sound, and a click stops it. The film plays once and returns to its poster; the
// photographs run until stopped. Nothing loads before it is wanted: the poster once the room is interactive and the
// wall is in view, the film on its first run. Reduced motion still plays what the visitor asked for, without the
// gate's weave, flicker or grain, and cuts between photographs instead of rolling.

const FPS = 18;
const CARD = { width: 640, height: 360 };
const SERIF = '"Newsreader Variable", Georgia, serif';
const CARD_FADE_S = 0.4;
const FADE_IN_S = 0.6;
// A program change: the lamp dips while the film rolls over to the next program.
const CHANGE_S = 0.5;
// Of the baked open-gate light on the wall, the share that is the room's other light (what film black leaves), and
// the wall's own colour against the white the patch was baked as, so a black frame sinks into the dark green wall.
const AMBIENT_SHARE = 0.26;
const WALL = new THREE.Color(0.3, 0.5, 0.42);
const PHOTO_HOLD_S = 6;
const PHOTO_ROLL_S = 0.9;
// The reels turn this many times a second while the film runs (Super 8 at 18 frames a second off a 7 cm reel).
const REEL_TURNS_S = [0.32, 0.27];

export const PROGRAMS = [
  { name: 'story', label: 'His story', mark: 'reel' },
  { name: 'photographs', label: 'Photographs', mark: 'photographs' },
] as const;
export type ProgramName = (typeof PROGRAMS)[number]['name'];
export type ProgramState = 'idle' | 'loading' | 'playing' | 'paused' | 'failed';

/** What the picture's shader shows this frame. */
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
  /** Whether it is running now (the visitor started it and it has not ended). */
  readonly running: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  /** Fetches what it shows at rest (a poster, the first photograph). */
  prepare(): Promise<void>;
  /** Starts it from where it rests; resolves once it can show its first frame. */
  start(): Promise<void>;
  stop(): void;
  /** This frame's picture: running, advanced by `dt` while `playing`; at rest, its still; null before it has one. */
  frame(dt: number, playing: boolean, still: boolean): ScreenInputs | null;
  dispose(): void;
}

const canvasTexture = (canvas: HTMLCanvasElement) => {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
};

/** A 16:9 canvas on black, the size of the gate's picture. */
class Frame {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;

  constructor() {
    this.canvas.width = CARD.width;
    this.canvas.height = CARD.height;
    this.texture = canvasTexture(this.canvas);
  }

  get ctx() {
    return this.canvas.getContext('2d')!;
  }

  black() {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CARD.width, CARD.height);
  }

  /** `image` fitted inside the frame on black. */
  picture(image: CanvasImageSource & { width: number; height: number }) {
    this.black();
    const scale = Math.min(CARD.width / image.width, CARD.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    this.ctx.drawImage(image, (CARD.width - w) / 2, (CARD.height - h) / 2, w, h);
    this.texture.needsUpdate = true;
  }

  /** An intertitle in the site's serif: a title, and a small line under it. */
  card(title: string, small = '') {
    this.black();
    const ctx = this.ctx;
    ctx.fillStyle = '#ece6da';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 46;
    ctx.font = `${size}px ${SERIF}`;
    while (ctx.measureText(title).width > CARD.width * 0.8 && size > 20) ctx.font = `${(size -= 2)}px ${SERIF}`;
    ctx.fillText(title, CARD.width / 2, CARD.height * 0.47);
    if (small) {
      ctx.globalAlpha = 0.7;
      ctx.font = `18px ${SERIF}`;
      ctx.letterSpacing = '4px';
      ctx.fillText(small.toUpperCase(), CARD.width / 2, CARD.height * 0.62);
      ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1;
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

// ---- His story ----

class StoryProgram implements Program {
  readonly name = 'story';
  private readonly poster = new Frame();
  private readonly card = new Frame();
  private readonly abort = new AbortController();
  private video: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private objectUrl = '';
  private posterReady: Promise<void> | null = null;
  private status: 'idle' | 'loading' | 'running' | 'failed' = 'idle';
  /** Seconds into the film while it runs as cards (no video in the manifest). */
  private clock = 0;
  private chapter = -1;
  private playingNow = false;

  constructor(private readonly film: Film) {
    // A card drawn before the page's serif arrived is drawn again with it.
    void document.fonts?.ready.then(() => {
      this.chapter = -1;
      if (!film.poster) this.drawTitle();
    });
  }

  get running() {
    return this.status === 'running';
  }

  get loading() {
    return this.status === 'loading';
  }

  get failed() {
    return this.status === 'failed';
  }

  get time() {
    return this.video ? this.video.currentTime : this.clock;
  }

  get playing() {
    return this.running && this.playingNow;
  }

  prepare() {
    this.posterReady ??= (async () => {
      if (!this.film.poster) return this.drawTitle();
      try {
        const response = await fetch(this.film.poster, { signal: this.abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        this.poster.picture(bitmap);
        bitmap.close();
      } catch (error) {
        if (this.abort.signal.aborted) return;
        console.warn('room: the film poster did not load; the wall shows its title', error);
        this.drawTitle();
      }
    })();
    return this.posterReady;
  }

  async start() {
    void this.prepare();
    this.clock = 0;
    this.chapter = -1;
    if (!this.film.sources.length) {
      this.status = 'running';
      return;
    }
    if (this.video) {
      this.video.currentTime = 0;
      this.status = 'running';
      return;
    }
    this.status = 'loading';
    try {
      const source = this.pickSource();
      // One request for the whole file: no range requests while it plays, and seeking never waits on the network.
      const response = await fetch(source.src, { signal: this.abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.objectUrl = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: source.type.split(';')[0] }));
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = this.objectUrl;
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(video.error), { once: true });
      });
      if (this.abort.signal.aborted) return;
      video.addEventListener('ended', () => this.stop());
      this.video = video;
      this.videoTexture = new THREE.VideoTexture(video);
      this.videoTexture.colorSpace = THREE.SRGBColorSpace;
      this.videoTexture.flipY = false;
      // A stop that came while it loaded wins.
      if (this.status === 'loading') this.status = 'running';
    } catch (error) {
      if (this.abort.signal.aborted) return;
      console.warn('room: the film did not load; the wall keeps its poster', error);
      this.status = 'failed';
    }
  }

  stop() {
    if (this.status === 'running' || this.status === 'loading') this.status = 'idle';
    if (this.video) {
      this.video.pause();
      this.video.currentTime = 0;
    }
    this.clock = 0;
    this.playingNow = false;
  }

  frame(dt: number, playing: boolean): ScreenInputs | null {
    if (!this.running) {
      if (!this.posterReady) return null;
      return { a: this.poster.texture, b: this.poster.texture, mixB: 0, roll: 0, colour: 1, frame: 0 };
    }
    this.playingNow = playing;
    const video = this.video;
    if (video && this.videoTexture) {
      if (playing && video.paused) {
        video.play().catch((error: DOMException) => {
          // A pause() before play() settled is not a failure.
          if (error.name !== 'AbortError') this.status = 'failed';
        });
      } else if (!playing && !video.paused) video.pause();
      return { a: this.videoTexture, b: this.videoTexture, mixB: 0, roll: 0, colour: 1, frame: Math.floor(video.currentTime * FPS) };
    }
    // No video yet in the manifest: its chapters as title cards, one after another, then back to the poster.
    if (playing) this.clock += dt;
    if (this.clock >= this.film.duration) {
      this.stop();
      return this.frame(0, false);
    }
    const index = this.film.chapters.indexOf(chapterAt(this.film, this.clock));
    if (index !== this.chapter) {
      this.card.card(this.film.chapters[index].title);
      this.chapter = index;
    }
    const start = this.film.chapters[index].t;
    const end = this.film.chapters[index + 1]?.t ?? this.film.duration;
    const fade = THREE.MathUtils.clamp(Math.min(this.clock - start, end - this.clock) / CARD_FADE_S, 0, 1);
    return { a: this.poster.texture, b: this.card.texture, mixB: fade, roll: 0, colour: 1, frame: Math.floor(this.clock * FPS) };
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
    this.poster.dispose();
    this.card.dispose();
  }

  /** WebM (VP9 or AV1) where the browser plays it, else the next source the browser can play, else the first. */
  private pickSource() {
    const probe = document.createElement('video');
    return this.film.sources.find((s) => probe.canPlayType(s.type) !== '') ?? this.film.sources[0];
  }

  private drawTitle() {
    this.poster.card(this.film.chapters[0]?.title ?? '', 'a film');
  }
}

// ---- Photographs ----

class PhotoProgram implements Program {
  readonly name = 'photographs';
  private photos: Photograph[] = [];
  private index = 0;
  private hold = 0;
  private roll = -1;
  private clock = 0;
  private status: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private isRunning = false;
  private readonly frames = [new Frame(), new Frame()];
  private readonly slugs = ['', ''];
  private readonly bitmaps = new Map<string, Promise<ImageBitmap | null>>();
  private prepared: Promise<void> | null = null;
  /** The next photograph, drawn into the second frame once its picture is in hand; the film rolls only then. */
  private upcoming: { index: number; ready: boolean } | null = null;

  constructor(
    private readonly textures: TextureStore,
    private readonly collection: () => Promise<Photograph[]>,
    private readonly reducedMotion: boolean,
  ) {}

  get running() {
    return this.isRunning;
  }

  get loading() {
    return this.status === 'loading';
  }

  get failed() {
    return this.status === 'failed';
  }

  get slug() {
    return this.slugs[0] || null;
  }

  prepare() {
    this.prepared ??= (async () => {
      this.status = 'loading';
      try {
        this.photos = await this.collection();
        if (this.photos.length === 0) throw new Error('no photographs');
        this.draw(0, 0, await this.picture(0));
        void this.picture(1);
        this.status = 'ready';
      } catch (error) {
        console.warn('room: the photographs did not load', error);
        this.status = 'failed';
      }
    })();
    return this.prepared;
  }

  async start() {
    await this.prepare();
    if (this.status === 'ready') this.isRunning = true;
  }

  stop() {
    this.isRunning = false;
  }

  frame(dt: number, playing: boolean): ScreenInputs | null {
    if (this.status !== 'ready') return null;
    if (this.isRunning && playing) {
      this.clock += dt;
      if (this.roll >= 0) {
        this.roll = this.reducedMotion ? 1 : this.roll + dt / PHOTO_ROLL_S;
        if (this.roll >= 1) {
          // The next frame is now in the gate: swap, and fetch the one after.
          this.frames.reverse();
          this.slugs.reverse();
          this.index = (this.index + 1) % this.photos.length;
          this.roll = -1;
          this.hold = 0;
          this.upcoming = null;
          void this.picture(this.index + 1);
        }
      } else if ((this.hold += dt) >= PHOTO_HOLD_S) {
        if (!this.upcoming) this.prepareNext((this.index + 1) % this.photos.length);
        // Roll only once the next picture is in hand, so the film never rolls onto a black frame.
        else if (this.upcoming.ready) this.roll = 0;
      }
    }
    // Read after the swap above, so the frame that lands is the one shown.
    const eased = this.roll < 0 ? 0 : this.roll * this.roll * (3 - 2 * this.roll);
    return { a: this.frames[0].texture, b: this.frames[1].texture, mixB: 0, roll: eased, colour: 1, frame: Math.floor(this.clock * FPS) };
  }

  dispose() {
    for (const frame of this.frames) frame.dispose();
    for (const bitmap of this.bitmaps.values()) void bitmap.then((b) => b?.close());
  }

  private draw(slot: number, index: number, image: ImageBitmap | null) {
    if (image) this.frames[slot].picture(image);
    else this.frames[slot].black();
    this.slugs[slot] = this.photos[index].slug;
  }

  private prepareNext(index: number) {
    const upcoming = { index, ready: false };
    this.upcoming = upcoming;
    void this.picture(index).then((image) => {
      if (this.upcoming !== upcoming) return;
      this.draw(1, index, image);
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

// ---- The projector: its picture, its programs, its dial and its reels ----

export interface ProjectorState {
  program: ProgramName;
  state: ProgramState;
  running: boolean;
  inView: boolean;
  /** Seconds into the film (his story). */
  time: number;
  /** The photograph in the gate, under Photographs. */
  photo: string | null;
}

export interface ProjectorHost {
  /** The projector's own sound runs while the film does. */
  setRunning(running: boolean): void;
}

export class Projector {
  private readonly programs: Program[];
  private current = 0;
  private readonly material: THREE.ShaderMaterial;
  private readonly bounds = new THREE.Box3();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly dial: {
    knob: THREE.Object3D;
    axis: THREE.Vector3;
    anglesDeg: Record<string, number>;
    rest: THREE.Quaternion;
    angle: number;
    velocity: number;
  } | null;
  private readonly reelAngles: number[];
  private changing = 0;
  private visible = false;
  private forced = false;
  /** Set once the room is interactive: the still may then load by itself when the wall comes into view. */
  private interactive = false;
  private soundOn = false;
  private suspended = false;

  constructor(
    private readonly nodes: ProjectorNodes,
    film: Film,
    textures: TextureStore,
    collection: () => Promise<Photograph[]>,
    dial: { knob: THREE.Object3D; axis: THREE.Vector3; anglesDeg: Record<string, number> } | null,
    lamp: LampUniforms,
    private readonly reducedMotion: boolean,
    private readonly host: ProjectorHost,
  ) {
    this.programs = [new StoryProgram(film), new PhotoProgram(textures, collection, reducedMotion)];
    this.dial = dial ? { ...dial, rest: dial.knob.quaternion.clone(), angle: 0, velocity: 0 } : null;
    if (this.dial) this.dial.angle = this.dialAngle();
    this.reelAngles = nodes.reels.map(() => 0);

    const surface = nodes.surface;
    const baked = (surface.material as THREE.MeshBasicMaterial).map ?? null;
    const bakeUv = surface.geometry.getAttribute('uv1');
    if (baked && bakeUv) surface.geometry.setAttribute('aBakeUv', bakeUv);
    this.blank.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: artVert,
      fragmentShader: projectionFrag,
      uniforms: {
        uA: { value: this.blank },
        uB: { value: this.blank },
        uBake: { value: baked },
        uUseBake: { value: baked && bakeUv ? 1 : 0 },
        uMixB: { value: 0 },
        uRoll: { value: 0 },
        uColour: { value: 1 },
        uFrame: { value: 0 },
        uShown: { value: 0 },
        uAmbient: { value: AMBIENT_SHARE },
        uWall: { value: WALL },
        uStill: { value: reducedMotion ? 1 : 0 },
        uFlip: { value: artUvFlip(surface) },
        ...lamp,
      },
    });
    surface.material = this.material;
    this.bounds.setFromObject(surface);
  }

  get label() {
    return PROGRAMS[this.current].label;
  }

  get nextLabel() {
    return PROGRAMS[(this.current + 1) % PROGRAMS.length].label;
  }

  get running() {
    return this.programs[this.current].running;
  }

  /** The lamp's light in the beam: full while film runs, a little lower on a still. */
  get beam() {
    return this.running ? 1 : 0.75;
  }

  get state(): ProjectorState {
    const program = this.programs[this.current];
    const story = this.programs[0] as StoryProgram;
    const photos = this.programs[1] as PhotoProgram;
    let state: ProgramState = 'idle';
    if (program.failed) state = 'failed';
    else if (program.loading) state = 'loading';
    else if (program.running) state = this.isPlaying(program) ? 'playing' : 'paused';
    return {
      program: program.name,
      state,
      running: program.running,
      inView: this.visible,
      time: Number(story.time.toFixed(2)),
      photo: program === photos ? photos.slug : null,
    };
  }

  allowOnDemand() {
    this.interactive = true;
  }

  /** Runs the program on the wall, or stops it if it runs. Returns whether it now runs. */
  toggle() {
    const program = this.programs[this.current];
    if (program.running || program.loading) {
      program.stop();
      return false;
    }
    void program.start();
    return true;
  }

  /** Runs the program if it is not running already. */
  play() {
    const program = this.programs[this.current];
    if (!program.running && !program.loading) void program.start();
  }

  /** The dial's next stop: the lamp dips while the film rolls over to the next program, which then runs. */
  next() {
    this.programs[this.current].stop();
    this.current = (this.current + 1) % this.programs.length;
    this.changing = this.reducedMotion ? 0 : CHANGE_S;
    void this.programs[this.current].start();
  }

  /** The room stopped drawing (off screen): the program pauses with it. */
  suspend(suspended: boolean) {
    this.suspended = suspended;
  }

  /** Measurement hook: run whenever the room runs, in view or not, for a worst-case frame rate. */
  force(on: boolean) {
    this.forced = on;
    if (on) this.play();
  }

  update(camera: THREE.Camera, running: boolean, realDt: number) {
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    this.visible = this.frustum.intersectsBox(this.bounds);
    this.updateDial(realDt);

    const program = this.programs[this.current];
    if ((this.visible || this.forced) && this.interactive) void program.prepare();
    const playing = this.isPlaying(program) && running;
    const inputs = program.frame(realDt, playing, this.reducedMotion);

    // The projector's sound and reels run while the film does.
    const sound = program.running && playing;
    if (sound !== this.soundOn) {
      this.soundOn = sound;
      this.host.setRunning(sound);
    }
    if (sound && !this.reducedMotion) {
      this.nodes.reels.forEach((reel, i) => {
        this.reelAngles[i] += REEL_TURNS_S[i % REEL_TURNS_S.length] * Math.PI * 2 * realDt;
        reel.pivot.quaternion.copy(reel.rest).multiply(new THREE.Quaternion().setFromAxisAngle(reel.axis, this.reelAngles[i]));
      });
    }

    const u = this.material.uniforms;
    this.changing = Math.max(0, this.changing - realDt);
    const shown = inputs !== null;
    u.uShown.value =
      this.changing > 0
        ? Math.abs(Math.cos((this.changing / CHANGE_S) * Math.PI))
        : this.approach(u.uShown.value, shown ? 1 : 0, realDt);
    if (!inputs) return;
    u.uA.value = inputs.a;
    u.uB.value = inputs.b;
    u.uMixB.value = inputs.mixB;
    u.uRoll.value = inputs.roll;
    u.uColour.value = inputs.colour;
    u.uFrame.value = inputs.frame;
  }

  /** The film or the photographs are moving on the wall (frames must be drawn while motion is otherwise paused). */
  get animating() {
    return this.programs[this.current].running || this.changing > 0;
  }

  dispose() {
    for (const program of this.programs) program.dispose();
    this.blank.dispose();
    this.material.dispose();
  }

  /** The program advances while it runs, the wall is seen (or forced) and the tab is visible. */
  private isPlaying(program: Program) {
    return program.running && (this.visible || this.forced) && !this.suspended && document.visibilityState === 'visible';
  }

  private approach(value: number, target: number, dt: number) {
    const step = dt / FADE_IN_S;
    return value < target ? Math.min(target, value + step) : Math.max(target, value - step * 3);
  }

  /** Where the knob points for the program on the wall (radians from its rest). */
  private dialAngle() {
    return THREE.MathUtils.degToRad(this.dial?.anglesDeg[PROGRAMS[this.current].mark] ?? 0);
  }

  /** The knob springs to its stop with a little overshoot, as a detent does. */
  private updateDial(dt: number) {
    const dial = this.dial;
    if (!dial) return;
    const target = this.dialAngle();
    if (this.reducedMotion) dial.angle = target;
    else if (dt > 0) {
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
