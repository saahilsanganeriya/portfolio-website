import * as THREE from 'three';
import { RoomAudio, type AudioHandle, type OfflineOptions } from '../audio/RoomAudio';
import { Navigation } from '../Camera/Navigation';
import { RoomCamera, type CameraPhase, type Motion } from '../Camera/RoomCamera';
import type { Hotspot } from '../hotspots';
import { Effects } from './Effects';
import { HoverReactions } from './Hover';
import { Interaction } from './Interaction';
import { MonitorScreen } from './MonitorScreen';
import { FULL, LIGHT, Quality, type QualityTier } from './Quality';
import { halveTextures, loadRoom, ROOM_URL, textureWidths, type ProgressReporter } from './Resources';
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
  /**
   * Phones and small windows: the light tier (one pixel per CSS pixel, fewer effects, half-size textures) and no live
   * screen in the 3D monitor. Reaching the monitor hands over to `onMonitor`, which shows SaahilOS full screen.
   */
  light?: boolean;
  onMonitor?(target: string | null): void;
  /** The browser took the GL context away (memory pressure): the page should show the drawn monitor instead. */
  onLost?(): void;
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
  /** Lands the intro glide now and ends the first drift; later glides are left alone. */
  skipIntro(): void;
  /** The room's sound: unlock() on the first gesture, mute, volume, setState(state), sfx(name, position?). */
  readonly audio: AudioHandle;
  setPaused(paused: boolean): void;
  /** The median frame rate over the next `ms` (the second half of it), drawing every frame meanwhile. */
  measureFps(ms: number): Promise<number>;
  dispose(): void;
}

// The OS iframe must not hold the room back for ever; past this it keeps loading behind the boot screen.
const OS_LOAD_TIMEOUT_MS = 8000;
// On a phone the wide view holds this long after the intro, then the camera goes into the monitor by itself.
const PHONE_HOLD_MS = 1600;
// A click this soon after the press that ended the drift belongs to that press.
const DRIFT_CLICK_MS = 600;

/** Debug and measurement hook: tests click real props by their projected screen position. */
export interface RoomProbe {
  readonly phase: CameraPhase;
  /** The station the camera is flying to, or `phase` when it rests. */
  readonly destination: CameraPhase;
  readonly moving: boolean;
  readonly tier: number;
  readonly light: boolean;
  /** The stations arrow keys and the wheel step through, in order. */
  readonly stations: readonly StationName[];
  readonly drifting: boolean;
  /** How far the free look has turned the view from its framing (radians). */
  readonly look: { yaw: number; pitch: number };
  /** Base width of each texture in the room, after the light tier halves them. */
  readonly textureWidths: number[];
  /** The visible meshes each proxy lifts on hover. */
  readonly claims: Record<string, string[]>;
  /** How far the object behind a proxy is lifted now (millimetres). */
  lift(proxy: string): number;
  point(name: string): { x: number; y: number } | null;
  /** The proxy under a client point, or null for empty space. */
  hit(x: number, y: number): string | null;
  goto(station: StationName): void;
  readonly reel: { state: ReelState; time: number; inView: boolean } | null;
  /** Plays the reel whenever the room runs, in view or not (worst-case frame rate). */
  forceReel(on: boolean): void;
  /** Renders the room's sound offline as heard from a framing; see RoomAudio.renderOffline. */
  renderSound(seconds: number, options: OfflineOptions & { view: string }): Promise<Float32Array[]>;
  /** The sound's graph state (music stems, filter, beds, master) and its controls. */
  readonly audio: Pick<RoomAudio, 'graph' | 'setState' | 'sfx'> | null;
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
  private readonly light: boolean;
  private nodes!: RoomNodes;
  private camera!: RoomCamera;
  private monitor!: MonitorScreen;
  private effects!: Effects;
  audio!: RoomAudio;
  private reel: Reel | null = null;
  private interaction!: Interaction;
  private navigation!: Navigation;
  private hover!: HoverReactions;
  private started = false;
  private intro = false;
  private paused = false;
  private onScreen = true;
  /** Light tier: SaahilOS is open full screen over the room, which stops drawing until the camera leaves. */
  private handedOver = false;
  private pendingWindow: string | null = null;
  private phoneZoom = 0;
  private driftEndedAt = -Infinity;
  private frameSink: ((frameMs: number) => void) | null = null;
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
    this.light = Boolean(options.light);
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
    this.renderer.gl.domElement.addEventListener('webglcontextlost', () => this.options.onLost?.());
    this.quality = new Quality(this.light ? LIGHT : FULL, (tier) => this.applyTier(tier));
  }

  async load() {
    const report = this.options.onProgress;
    const root = await loadRoom(ROOM_URL, this.renderer.gl, (p, label) => report(p * 0.8, label));
    // Before anything is uploaded: dropping the largest mip level quarters the GPU memory the atlases take.
    if (this.light) halveTextures(root);
    this.nodes = readRoom(root);
    this.scene.add(root);

    this.camera = new RoomCamera(this.nodes, this.aspect());
    this.monitor = new MonitorScreen(
      this.nodes.monitor,
      this.scene,
      this.cssScene,
      this.options.osUrl,
      (e) => this.interaction.fromMonitor(e),
      !this.light,
    );
    if (this.light) this.addMonitorProxy();
    this.effects = new Effects(this.nodes, this.scene);
    this.effects.setTier(this.quality.tier);
    this.audio = new RoomAudio(
      { crt: this.nodes.monitor.position, projector: this.nodes.projector?.lens ?? null, desk: this.nodes.framings.desk.target },
      root,
    );
    // The light tier keeps the baked still on the projector screen: no reel to download and decode on a phone.
    if (this.nodes.projection && !this.light) {
      this.reel = new Reel(this.nodes.projection, this.nodes.screenSurface, this.scene, this.options.films);
    }
    this.hover = new HoverReactions(root, this.nodes.proxies, this.camera.instance, Boolean(this.options.reducedMotion));
    this.navigation = new Navigation(this.container, this.camera, this.nodes, {
      fly: (station, motion, onDone) => this.flyTo(station, motion, onDone),
      canSteer: () => this.started && !this.handedOver,
      takeOver: () => this.takeOver(),
    });
    this.interaction = new Interaction(this.container, this.monitor.iframe, this.camera.instance, this.nodes.proxies, this.label, {
      hotspot: (hotspot, proxy) => this.onHotspot(hotspot, proxy),
      toggle: () => this.toggle(),
      enterMonitor: () => this.enterMonitor(),
      leaveMonitor: () => this.leaveMonitor(),
      click: (kind) => this.audio.click(kind),
      canHover: () => this.started && this.camera.destination !== 'monitor' && !this.handedOver,
      endedDrag: () => this.navigation.endedDrag(),
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
    this.monitor.iframe?.removeAttribute('tabindex');
    void this.reel?.load();
    const endIntro = () => (this.intro = false);
    if (open !== undefined) this.toMonitor('fast', open || null, endIntro, fast);
    else
      this.glide(
        'idle',
        'intro',
        () => {
          endIntro();
          this.afterIntro();
        },
        fast,
      );
    // The intro runs as long as its flight does; a cut has already landed it.
    this.intro = this.camera.moving;
  }

  openWindow(target: string, { fast = false }: { fast?: boolean } = {}) {
    if (this.started) this.toMonitor(fast ? 'fast' : 'monitor', target);
    else if (this.light) this.pendingWindow = target;
    else this.monitor.open(target);
  }

  fly(station: StationName) {
    if (!this.camera.has(station)) return false;
    this.takeOver();
    this.flyTo(station, 'step');
    return true;
  }

  skipIntro() {
    if (this.intro) this.camera.finish();
    this.takeOver();
  }

  /** Stops every motion that runs by itself (sway, dust, LEDs, grain, the first drift); the camera still answers clicks. */
  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.takeOver();
    this.dirty = true;
  }

  measureFps(ms: number) {
    return new Promise<number>((resolve) => {
      const frames: number[] = [];
      this.frameSink = (frameMs) => frames.push(frameMs);
      setTimeout(() => {
        this.frameSink = null;
        const settled = frames.slice(Math.floor(frames.length / 2)).sort((a, b) => a - b);
        resolve(settled.length ? 1000 / settled[Math.floor(settled.length / 2)] : 0);
      }, ms);
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.phoneZoom);
    for (const observer of this.observers) observer.disconnect();
    this.navigation?.dispose();
    this.interaction?.dispose();
    this.hover?.dispose();
    this.monitor?.dispose();
    this.audio?.dispose();
    this.reel?.dispose();
    this.effects?.dispose();
    this.renderer.dispose();
    for (const el of this.layers) el.remove();
    delete window.__room;
  }

  /** After the intro lands on the wide view: the slow drift past the corners, or on a phone the way into the monitor. */
  private afterIntro() {
    if (this.options.reducedMotion || this.paused) return;
    if (this.light) this.phoneZoom = window.setTimeout(() => this.toMonitor('monitor', null), PHONE_HOLD_MS);
    else this.navigation.drift();
  }

  /** The visitor took over: nothing moves the camera by itself any more. */
  private takeOver() {
    clearTimeout(this.phoneZoom);
    if (this.navigation.drifting) this.driftEndedAt = performance.now();
    this.navigation.stopDrift();
  }

  private onHotspot(hotspot: Hotspot, proxy: THREE.Object3D) {
    this.hover.pulse(proxy);
    this.audio.hotspot({ proxies: [proxy.name] });
    if (hotspot.fly && this.camera.destination !== hotspot.fly && this.camera.has(hotspot.fly)) this.fly(hotspot.fly);
    else if (hotspot.target) this.openWindow(hotspot.target);
    else if (!hotspot.fly) this.enterMonitor();
  }

  private enterMonitor() {
    if (this.started) this.toMonitor('monitor', null);
  }

  private leaveMonitor() {
    if (this.camera.destination === 'monitor') this.flyTo('desk', 'step');
  }

  /** A click on empty space: in to the desk from the wide view, back out to the wide view from anywhere else. */
  private toggle() {
    // The click that ended the first drift only ends it.
    if (!this.started || performance.now() - this.driftEndedAt < DRIFT_CLICK_MS) return;
    this.flyTo(this.camera.destination === 'idle' ? 'desk' : 'idle', 'step');
  }

  private flyTo(station: StationName, motion: Motion, onDone?: () => void) {
    if (station === 'monitor') this.toMonitor(motion, null, onDone);
    else this.glide(station, motion, onDone);
  }

  /** Into the glass. On the light tier, landing there hands over to SaahilOS full screen with the window asked for. */
  private toMonitor(motion: Motion, target: string | null, onDone?: () => void, cut = false) {
    const motionIn = motion === 'step' || motion === 'drift' ? 'monitor' : motion;
    if (!this.light) {
      this.glide('monitor', motionIn, onDone, cut);
      if (target) this.monitor.open(target);
      return;
    }
    if (target !== null) this.pendingWindow = target;
    this.glide(
      'monitor',
      motionIn,
      () => {
        onDone?.();
        this.handOver();
      },
      cut,
    );
  }

  private handOver() {
    if (this.camera.phase !== 'monitor' || this.camera.moving) return;
    this.handedOver = true;
    const target = this.pendingWindow;
    this.pendingWindow = null;
    this.options.onMonitor?.(target);
  }

  private glide(station: StationName, motion: Motion, onDone?: () => void, cut = false) {
    this.intro = false;
    if (station !== 'monitor') this.handedOver = false;
    this.dirty = true;
    this.camera.fly(station, motion, onDone, cut || this.options.reducedMotion);
  }

  /** Phones have no live screen to hover or focus, so the glass gets a proxy box of its own (hotspots: hit_monitor). */
  private addMonitorProxy() {
    const { position, quaternion, width, height } = this.nodes.monitor;
    const proxy = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    proxy.name = 'hit_monitor';
    proxy.visible = false;
    proxy.position.copy(position);
    proxy.quaternion.copy(quaternion);
    this.scene.add(proxy);
    proxy.updateMatrixWorld();
    this.nodes.proxies.push(proxy);
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
    return Math.min(window.devicePixelRatio || 1, this.quality.ladder.dprCap) * tier.resolution;
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
    // SaahilOS covers the whole screen: nothing of the room is visible to draw.
    if (this.handedOver && !this.camera.moving) {
      this.quality.reset(now);
      return;
    }
    if (!this.paused) this.clock += dt;
    if (this.frameSink) {
      this.dirty = true;
      if (frameMs > 0) this.frameSink(frameMs);
    }

    this.camera.update(dt, this.clock, this.interaction.pointer);
    this.interaction.update();
    this.hover.set(this.interaction.hoveredProxy);
    if (this.hover.update(dt, now)) this.dirty = true;
    if (!this.paused) this.effects.update(this.clock, this.renderer.gl.getPixelRatio());
    this.monitor.update(this.clock, this.camera.instance);
    this.reel?.update(this.camera.instance, this.started && !this.paused, dt);
    this.audio.update(this.camera.instance, now, this.camera.destination, this.monitor.frontWindow);

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
    const widths = textureWidths(this.nodes.root);
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
      light: this.light,
      stations: this.navigation.tour,
      get drifting() {
        return app.navigation.drifting;
      },
      get look() {
        return app.camera.lookAngles;
      },
      textureWidths: widths,
      claims: this.hover.claims,
      lift: (proxy) => this.hover.liftOf(proxy),
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
      hit(x, y) {
        const rect = app.container.getBoundingClientRect();
        const pointer = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, app.camera.instance);
        return raycaster.intersectObjects(app.nodes.proxies, false)[0]?.object.name ?? null;
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
      renderSound(seconds, { view, ...options }) {
        const framing = app.nodes.framings[view as keyof RoomNodes['framings']];
        if (!framing) throw new Error(`room audio: the room has no ${view} framing`);
        const listener = new THREE.PerspectiveCamera();
        listener.position.copy(framing.position);
        listener.lookAt(framing.target);
        listener.updateMatrixWorld();
        return app.audio.renderOffline(seconds, listener, options);
      },
      get audio() {
        return app.audio ?? null;
      },
    };
  }
}
