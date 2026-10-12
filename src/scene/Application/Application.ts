import * as THREE from 'three';
import { RoomCamera, type CameraPhase, type Motion } from '../Camera/RoomCamera';
import type { Hotspot } from '../hotspots';
import { RoomAudio, type ClickKind } from './Audio';
import { Effects } from './Effects';
import { Interaction } from './Interaction';
import { MonitorScreen } from './MonitorScreen';
import { DPR_CAP, Quality, type QualityTier } from './Quality';
import { loadRoom, ROOM_URL, type ProgressReporter } from './Resources';
import { Reel, type ReelFilm, type ReelState } from './Reel';
import { readRoom, type RoomNodes, type StationName } from './RoomModel';
import { RoomRenderer } from './Renderer';

export interface RoomOptions {
  /** The OS page shown on the monitor, e.g. `/os?embed=1`. */
  osUrl: string;
  onProgress: ProgressReporter;
  /** Cut between framings instead of gliding (prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** The newest diary entries in the build, for the reel's cards until the live diary answers. */
  films: ReelFilm[];
}

export interface StartOptions {
  /** End on the monitor instead of the idle view, opening this SaahilOS window (`projects/swe-sim`); '' opens none. */
  open?: string;
  /** Cut to the end framing (the visitor's input skipped the intro). */
  fast?: boolean;
}

export interface RoomHandle {
  /** Leaves the boot framing: the intro glide to the idle view, or a short glide into the monitor with `open`. */
  start(options?: StartOptions): void;
  /** Glides to the monitor and opens that SaahilOS window; `fast` shortens the glide. */
  openWindow(target: string, options?: { fast?: boolean }): void;
  /** Flies the camera to a framing (idle, window, desk, monitor, projector, shelf, photos); false if the room lacks it. */
  fly(station: StationName): boolean;
  /** Lands the intro glide now; later glides are left alone. */
  skipIntro(): void;
  /** Starts the room's sound. Browsers only allow it inside a user gesture (a click, tap or key). */
  unlockAudio(): void;
  setMuted(muted: boolean): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

// The OS iframe must not hold the room back for ever; past this it keeps loading behind the boot screen.
const OS_LOAD_TIMEOUT_MS = 8000;

/** Debug and measurement hook: tests click real props by their projected screen position. */
export interface RoomProbe {
  readonly phase: CameraPhase;
  /** The station the camera is flying to, or `phase` when it rests. */
  readonly destination: CameraPhase;
  readonly moving: boolean;
  readonly tier: number;
  /** How far the free look has turned the view from its framing (radians). */
  readonly look: { yaw: number; pitch: number };
  point(name: string): { x: number; y: number } | null;
  goto(station: StationName): void;
  readonly reel: { state: ReelState; time: number; inView: boolean } | null;
  /** Plays the reel whenever the room runs, in view or not (worst-case frame rate). */
  forceReel(on: boolean): void;
  /** Renders the room's sound offline as heard from a framing; see RoomAudio.renderOffline. */
  renderSound(
    seconds: number,
    options: { view: 'idle' | 'desk' | 'monitor'; filmsOpen?: boolean; clicks?: { at: number; kind: ClickKind }[] },
  ): Promise<Float32Array[]>;
}

declare global {
  interface Window {
    __room?: RoomProbe;
  }
}

export class Application implements RoomHandle {
  private readonly scene = new THREE.Scene();
  private readonly cssScene = new THREE.Scene();
  private readonly renderer: RoomRenderer;
  private readonly quality: Quality;
  private readonly label: HTMLElement;
  private readonly layers: HTMLElement[];
  private nodes!: RoomNodes;
  private camera!: RoomCamera;
  private monitor!: MonitorScreen;
  private effects!: Effects;
  private audio!: RoomAudio;
  private reel: Reel | null = null;
  private interaction!: Interaction;
  private started = false;
  private intro = false;
  private paused = false;
  private onScreen = true;
  private clock = 0;
  private last = 0;
  private raf = 0;
  private dirty = true;
  private readonly lastView = new THREE.Matrix4();
  private readonly observers: { disconnect(): void }[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly options: RoomOptions,
  ) {
    const layer = (className: string) => {
      const el = document.createElement('div');
      el.className = className;
      container.appendChild(el);
      return el;
    };
    const cssHost = layer('room-css');
    const webglHost = layer('room-webgl');
    this.label = layer('room-label');
    this.label.hidden = true;
    this.label.setAttribute('aria-hidden', 'true');
    this.layers = [cssHost, webglHost, this.label];
    this.renderer = new RoomRenderer(webglHost, cssHost);
    this.quality = new Quality((tier) => this.applyTier(tier));
  }

  async load() {
    const report = this.options.onProgress;
    const root = await loadRoom(ROOM_URL, this.renderer.gl, (p, label) => report(p * 0.8, label));
    this.nodes = readRoom(root);
    this.scene.add(root);

    this.camera = new RoomCamera(this.nodes, this.aspect());
    this.monitor = new MonitorScreen(this.nodes.monitor, this.scene, this.cssScene, this.options.osUrl, (e) =>
      this.interaction.fromMonitor(e),
    );
    this.effects = new Effects(this.nodes, this.scene);
    this.effects.setTier(this.quality.tier);
    this.audio = new RoomAudio({
      crt: this.nodes.monitor.position,
      projector: this.nodes.projector?.lens ?? null,
      desk: this.nodes.framings.desk.target,
    });
    if (this.nodes.projection) {
      this.reel = new Reel(this.nodes.projection, this.nodes.screenSurface, this.scene, this.options.films);
    }
    this.interaction = new Interaction(this.container, this.monitor.iframe, this.camera.instance, this.nodes.proxies, this.label, {
      hotspot: (hotspot) => this.onHotspot(hotspot),
      toggle: () => this.toggle(),
      enterMonitor: () => this.enterMonitor(),
      leaveMonitor: () => this.leaveMonitor(),
      click: (kind) => this.audio.click(kind),
      canHover: () => this.started && this.camera.destination !== 'monitor',
    });
    this.resize();
    this.observe();

    // Compile every shader and upload the textures now, so the first frame in the room does not stall.
    await this.renderer.gl.compileAsync(this.scene, this.camera.instance);
    this.render();
    report(0.9, 'shaders');

    await Promise.race([this.monitor.load(), new Promise((resolve) => setTimeout(resolve, OS_LOAD_TIMEOUT_MS))]);
    report(1, 'SaahilOS');
    this.installProbe();
    // Frames drawn behind the boot screen calibrate the quality tier before anyone sees the room.
    this.loop();
  }

  start({ open, fast = false }: StartOptions = {}) {
    if (this.started) return;
    this.started = true;
    this.monitor.iframe.removeAttribute('tabindex');
    void this.reel?.load();
    const endIntro = () => (this.intro = false);
    if (open !== undefined) this.toMonitor('fast', open || null, endIntro, fast);
    else
      this.glide(
        'idle',
        'intro',
        endIntro,
        fast,
      );
    // The intro runs as long as its flight does; a cut has already landed it.
    this.intro = this.camera.moving;
  }

  openWindow(target: string, { fast = false }: { fast?: boolean } = {}) {
    if (this.started) this.toMonitor(fast ? 'fast' : 'monitor', target);
    else this.monitor.open(target);
  }

  fly(station: StationName) {
    if (!this.camera.has(station)) return false;
    this.flyTo(station, 'step');
    return true;
  }

  skipIntro() {
    if (this.intro) this.camera.finish();
  }

  unlockAudio() {
    this.audio.unlock();
  }

  setMuted(muted: boolean) {
    this.audio.setMuted(muted);
  }

  /** Stops every motion that runs by itself (sway, dust, LEDs, grain); the camera still answers clicks. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.dirty = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const observer of this.observers) observer.disconnect();
    this.interaction?.dispose();
    this.monitor?.dispose();
    this.audio?.dispose();
    this.reel?.dispose();
    this.effects?.dispose();
    this.renderer.dispose();
    for (const el of this.layers) el.remove();
    delete window.__room;
  }

  private onHotspot(hotspot: Hotspot) {
    if (hotspot.target) this.openWindow(hotspot.target);
    else this.enterMonitor();
  }

  private enterMonitor() {
    if (this.started) this.toMonitor('monitor', null);
  }

  private leaveMonitor() {
    if (this.camera.destination === 'monitor') this.flyTo('desk', 'step');
  }

  /** A click on empty space: in to the desk from the wide view, back out to the wide view from anywhere else. */
  private toggle() {
    if (!this.started) return;
    this.flyTo(this.camera.destination === 'idle' ? 'desk' : 'idle', 'step');
  }

  private flyTo(station: StationName, motion: Motion, onDone?: () => void) {
    if (station === 'monitor') this.toMonitor(motion, null, onDone);
    else this.glide(station, motion, onDone);
  }

  /** Into the glass, opening a SaahilOS window when one is asked for. */
  private toMonitor(motion: Motion, target: string | null, onDone?: () => void, cut = false) {
    this.glide('monitor', motion === 'step' || motion === 'drift' ? 'monitor' : motion, onDone, cut);
    if (target) this.monitor.open(target);
  }

  private glide(station: StationName, motion: Motion, onDone?: () => void, cut = false) {
    this.intro = false;
    this.dirty = true;
    this.camera.fly(station, motion, onDone, cut || this.options.reducedMotion);
  }

  private aspect() {
    return Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight);
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, this.pixelRatio());
    this.camera.resize(width / height);
    this.dirty = true;
    this.quality.reset(performance.now());
  }

  private pixelRatio(tier: QualityTier = this.quality.tier) {
    return Math.min(window.devicePixelRatio || 1, DPR_CAP) * tier.resolution;
  }

  private applyTier(tier: QualityTier) {
    this.renderer.film.enabled = tier.film;
    this.renderer.setPixelRatio(this.pixelRatio(tier));
    this.effects.setTier(tier);
    this.dirty = true;
  }

  private observe() {
    const resize = new ResizeObserver(() => this.resize());
    resize.observe(this.container);
    // Hidden (the drawn monitor took over, or the page is off screen) the room stops drawing.
    const visibility = new IntersectionObserver(([entry]) => {
      this.onScreen = entry.isIntersecting;
      if (this.onScreen) this.loop();
      else this.reel?.suspend();
    });
    visibility.observe(this.container);
    this.observers.push(resize, visibility);
  }

  private loop() {
    cancelAnimationFrame(this.raf);
    this.last = 0;
    this.quality.reset(performance.now());
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    if (!this.onScreen) return;
    this.raf = requestAnimationFrame(this.tick);
    const frameMs = this.last ? now - this.last : 0;
    const dt = Math.min(0.1, frameMs / 1000);
    this.last = now;
    if (!this.paused) this.clock += dt;

    this.camera.update(dt, this.clock, this.interaction.pointer);
    this.interaction.update();
    if (!this.paused) this.effects.update(this.clock, this.renderer.gl.getPixelRatio());
    this.monitor.update(this.clock, this.camera.instance);
    this.reel?.update(this.camera.instance, this.started && !this.paused, dt);
    this.audio.update(this.camera.instance, now, this.monitor.frontWindow.startsWith('films'));

    // While paused, a still camera means a still frame: skip the work entirely.
    const viewChanged = !this.lastView.equals(this.camera.instance.matrixWorld);
    if (this.paused && !viewChanged && !this.dirty) {
      this.quality.reset(now);
      return;
    }
    this.render();
    if (frameMs > 0) this.quality.sample(now, frameMs);
  };

  private render() {
    this.renderer.render(this.scene, this.cssScene, this.camera.instance, this.clock, this.effects.flicker);
    this.lastView.copy(this.camera.instance.matrixWorld);
    this.dirty = false;
  }

  private installProbe() {
    const app = this;
    window.__room = {
      get phase() {
        return app.camera.phase;
      },
      get destination() {
        return app.camera.destination;
      },
      get moving() {
        return app.camera.moving;
      },
      get tier() {
        return app.quality.index;
      },
      get look() {
        return app.camera.lookAngles;
      },
      point(name) {
        const rect = app.container.getBoundingClientRect();
        let world: THREE.Vector3;
        if (name === 'monitor') world = app.nodes.monitor.position.clone();
        else {
          const proxy = app.nodes.proxies.find((p) => p.name === name);
          if (!proxy) return null;
          world = new THREE.Box3().setFromObject(proxy).getCenter(new THREE.Vector3());
        }
        const p = world.project(app.camera.instance);
        if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) return null;
        return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
      },
      goto(station) {
        app.fly(station);
      },
      get reel() {
        const reel = app.reel;
        return reel ? { state: reel.state, time: reel.time, inView: reel.inView } : null;
      },
      forceReel(on) {
        app.reel?.force(on);
      },
      renderSound(seconds, { view, filmsOpen, clicks }) {
        const framing = app.nodes.framings[view];
        const listener = new THREE.PerspectiveCamera();
        listener.position.copy(framing.position);
        listener.lookAt(framing.target);
        listener.updateMatrixWorld();
        return app.audio.renderOffline(seconds, listener, { filmsOpen, clicks });
      },
    };
  }
}
