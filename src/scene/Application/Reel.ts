import * as THREE from 'three';
import { latestFilms, type ReelFilm } from '../../lib/films/latest';
import timeline from '../reel.json';
import reelFrag from '../shaders/reel.frag.glsl?raw';
import reelVert from '../shaders/reel.vert.glsl?raw';
import { WORLD_SCALE } from './RoomModel';

// The projector plays a silent reel on its screen: public-domain early cinema (public/room/reel.mp4, built by
// scripts/media/build-reel.mjs) intercut with intertitle cards drawn here, one of them the newest film in the
// owner's Letterboxd diary. It plays only while the room runs, the screen is in view and the tab is visible, never
// under reduced motion; until it plays, or if it fails, the screen keeps the still that is baked into the room.

export const REEL_URL = '/room/reel.mp4';
const FILMS_URL = '/api/films.json';
const FPS = 18;
const CARD_FADE_S = 0.3;
const FADE_IN_S = 0.6;
// The picture floats this far in front of the baked projection so the two never z-fight, on a plane a little larger
// than it whose margin covers the hard edge of the open gate's light baked into the fabric.
const LIFT_M = 0.002;
const MARGIN = 1.05;
const CARD = { width: 512, height: 384 };
const SERIF = '"Newsreader Variable", Georgia, serif';
// The bake lit the whole screen with the projector's open gate; with film in the gate, only the picture is lit, so
// the fabric dims (a linear factor on its baked colour) while the reel shows.
const FABRIC_DIM = 0.16;
// Display values, like the room's baked colours: the dimmed fabric (film black), and the lamp's full light.
const SCREEN_DARK = new THREE.Vector3(0.3, 0.27, 0.23);
const SCREEN_LIT = new THREE.Vector3(0.93, 0.95, 0.96);

type Card = { kind: 'now-showing' } | { kind: 'lately' } | { kind: 'title'; title: string; original: string; credit: string };
interface Segment {
  start: number;
  end: number;
  card?: Card;
  clip?: string;
}
const SEGMENTS = timeline.segments as Segment[];

export type ReelState = 'waiting' | 'loading' | 'playing' | 'paused' | 'failed';
export type { ReelFilm };

export class Reel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly bounds = new THREE.Box3();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly canvas = document.createElement('canvas');
  private readonly cardTexture: THREE.CanvasTexture;
  private readonly blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly abort = new AbortController();
  private readonly fabric: { material: THREE.MeshBasicMaterial; baked: THREE.Color } | null = null;
  private video: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private objectUrl = '';
  private status: ReelState = 'waiting';
  private cardIndex = -1;
  private running = false;
  private visible = false;
  private forced = false;

  constructor(
    private readonly projection: THREE.Mesh,
    surface: THREE.Mesh | null,
    scene: THREE.Scene,
    private films: ReelFilm[],
  ) {
    if (surface?.material instanceof THREE.MeshBasicMaterial) {
      // Its own copy: the baked material is shared with every prop in the atlas.
      const material = surface.material.clone();
      surface.material = material;
      this.fabric = { material, baked: material.color.clone() };
    }

    projection.geometry.computeBoundingBox();
    const box = projection.geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    projection.updateWorldMatrix(true, false);
    const geometry = new THREE.PlaneGeometry(size.x * MARGIN, size.y * MARGIN);
    geometry.translate(centre.x, centre.y, centre.z + (LIFT_M * WORLD_SCALE) / projection.matrixWorld.getMaxScaleOnAxis());

    this.canvas.width = CARD.width;
    this.canvas.height = CARD.height;
    this.cardTexture = new THREE.CanvasTexture(this.canvas);
    this.blank.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      vertexShader: reelVert,
      fragmentShader: reelFrag,
      uniforms: {
        uVideo: { value: this.blank },
        uCard: { value: this.cardTexture },
        uCardMix: { value: 0 },
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

    const { signal } = this.abort;
    document.addEventListener('visibilitychange', () => this.sync(), { signal });
    this.reducedMotion.addEventListener('change', () => this.sync(), { signal });
    // A card drawn before the page's serif arrived is drawn again with it.
    void document.fonts?.ready.then(() => (this.cardIndex = -1));
  }

  get state(): ReelState {
    if (!this.video) return this.status;
    return this.video.paused ? 'paused' : 'playing';
  }

  get time() {
    return this.video?.currentTime ?? 0;
  }

  get inView() {
    return this.visible;
  }

  /** Fetches the reel (after START, so it never competes with the room's own loading) and the live diary. */
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
      this.mesh.material.uniforms.uVideo.value = this.videoTexture;
      this.mesh.visible = true;
      this.sync();
    } catch (error) {
      if (signal.aborted) return;
      console.warn('room: the projector reel did not load; the screen keeps its still', error);
      this.fail();
    }
  }

  /**
   * Once a frame: plays while `running` (room started, motion not paused) and the screen is in the camera's view,
   * pauses otherwise, and moves the cards and the film look along with the video's own clock.
   */
  update(camera: THREE.Camera, running: boolean, dt: number) {
    this.running = running;
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    this.visible = this.frustum.intersectsBox(this.bounds);
    this.sync();

    const video = this.video;
    if (!video) return;
    const u = this.mesh.material.uniforms;
    if (!video.paused && u.uOpacity.value < 1) {
      u.uOpacity.value = Math.min(1, u.uOpacity.value + dt / FADE_IN_S);
      this.fabric?.material.color.copy(this.fabric.baked).multiplyScalar(THREE.MathUtils.lerp(1, FABRIC_DIM, u.uOpacity.value));
      this.projection.visible = u.uOpacity.value < 1;
    }
    const t = video.currentTime;
    u.uFrame.value = Math.floor(t * FPS);
    const index = SEGMENTS.findIndex((s) => t < s.end);
    const segment = SEGMENTS[index === -1 ? SEGMENTS.length - 1 : index];
    if (segment.card) {
      if (index !== this.cardIndex) {
        this.drawCard(segment.card);
        this.cardIndex = index;
      }
      u.uCardMix.value = THREE.MathUtils.clamp(Math.min(t - segment.start, segment.end - t) / CARD_FADE_S, 0, 1);
    } else u.uCardMix.value = 0;
  }

  /** The room stopped drawing (scrolled off screen): the reel stops with it. */
  suspend() {
    this.running = false;
    this.sync();
  }

  /** Measurement hook: play whenever the room runs, in view or not, for a worst-case frame rate. */
  force(on: boolean) {
    this.forced = on;
    this.sync();
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
    this.cardTexture.dispose();
    this.blank.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
    this.fabric?.material.dispose();
  }

  private sync() {
    const video = this.video;
    if (!video) return;
    const wanted =
      this.running && (this.visible || this.forced) && document.visibilityState === 'visible' && !this.reducedMotion.matches;
    if (wanted && video.paused) {
      video.play().catch((error: DOMException) => {
        // A pause() before play() settled is not a failure.
        if (error.name !== 'AbortError') this.fail();
      });
    } else if (!wanted && !video.paused) video.pause();
  }

  private fail() {
    this.status = 'failed';
    this.video = null;
    this.mesh.visible = false;
    this.projection.visible = true;
    this.fabric?.material.color.copy(this.fabric.baked);
  }

  // ---- intertitle cards: grey on black, read by the shader as how much light reaches the screen ----

  private drawCard(card: Card) {
    const ctx = this.canvas.getContext('2d')!;
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
    const [newest, ...earlier] = this.films;

    if (card.kind === 'now-showing') {
      this.caps('Now showing', h * 0.22, 22);
      this.text('last watched', h * 0.33, 24, 0.75);
      if (newest) {
        const bottom = this.fit(newest.title, h * 0.5, 64, 2);
        this.text(`(${newest.year})`, bottom + 30, 26, 0.85);
        if (newest.rating !== null) this.stars(newest.rating, bottom + 74, 30);
      }
    } else if (card.kind === 'lately') {
      this.caps('Also lately', h * 0.22, 22);
      earlier.slice(0, 2).forEach((film, i) => {
        const y = h * (0.42 + i * 0.25);
        this.fit(`${film.title} (${film.year})`, y, 32, 1);
        if (film.rating !== null) this.stars(film.rating, y + 34, 20);
      });
    } else {
      const bottom = this.fit(card.title, h * 0.38, 54, 2);
      this.fit(card.original, bottom + 40, 24, 1, 0.8);
      ctx.fillRect(w / 2 - 40, bottom + 70, 80, 1.5);
      this.caps(card.credit, bottom + 100, 17);
    }
    this.cardTexture.needsUpdate = true;
  }

  private text(value: string, y: number, size: number, alpha = 1) {
    const ctx = this.canvas.getContext('2d')!;
    ctx.globalAlpha = alpha;
    ctx.font = `${size}px ${SERIF}`;
    ctx.fillText(value, CARD.width / 2, y);
    ctx.globalAlpha = 1;
  }

  private caps(value: string, y: number, size: number) {
    const ctx = this.canvas.getContext('2d')!;
    ctx.letterSpacing = `${Math.round(size * 0.25)}px`;
    this.text(value.toUpperCase(), y, size);
    ctx.letterSpacing = '0px';
  }

  /** Draws `value` centred on `y`, shrinking it (then wrapping, up to `lines`) to fit the card; returns its bottom. */
  private fit(value: string, y: number, maxSize: number, lines: number, alpha = 1) {
    const ctx = this.canvas.getContext('2d')!;
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
  private stars(rating: number, y: number, size: number) {
    const ctx = this.canvas.getContext('2d')!;
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
}
