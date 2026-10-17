import * as THREE from 'three';
import { RoomAudio, type AudioHandle, type OfflineOptions } from '../audio/RoomAudio';
import { Navigation } from '../Camera/Navigation';
import type { RoomPlan } from '../Camera/glide';
import { RoomCamera, type CameraPhase, type Motion } from '../Camera/RoomCamera';
import type { Hotspot } from '../hotspots';
import { Diorama } from '../World/Diorama';
import { deferWindowPictures } from '../World/textures';
import { Shine } from '../World/Shine';
import { World } from '../World/World';
import { Effects } from './Effects';
import { HoverReactions } from './Hover';
import { Interaction } from './Interaction';
import { MonitorScreen } from './MonitorScreen';
import { FULL, LIGHT, Quality, type QualityTier } from './Quality';
import { AtlasStreamer, createKtx2Loader, halveTextures, loadRoom, loadVoidColor, ROOM_URL, textureWidths, type ProgressReporter } from './Resources';
import { readRoom, WORLD_SCALE, type RoomNodes, type StationName } from './RoomModel';
import { RoomRenderer } from './Renderer';

export interface RoomOptions {
  /** The OS page shown on the monitor, e.g. `/os?embed=1`. */
  osUrl: string;
  onProgress: ProgressReporter;
  /** Cut between framings instead of gliding (prefers-reduced-motion). */
  reducedMotion?: boolean;
  /**
   * Phones and small windows: the light tier (one pixel per CSS pixel, fewer effects, half-size textures) and no live
   * screen in the 3D monitor. Reaching the monitor hands over to `onMonitor`, which shows SaahilOS full screen.
   */
  light?: boolean;
  onMonitor?(target: string | null): void;
  /** The browser took the GL context away (memory pressure): the page should show the drawn monitor instead. */
  onLost?(): void;
  /** The camera has come to rest where the room starts (the desk; the monitor on a window address): the ways on begin here. */
  onLanded?(): void;
}

export interface StartOptions {
  /**
   * A window address: land at the monitor at once with this SaahilOS window open (`projects/swe-sim`); '' opens none.
   * Without it, the arrival glides past the room to the desk, holds there, then goes into the monitor, where SaahilOS
   * shows its first window (About).
   */
  open?: string;
  /** Cut to the end framing (the visitor's input skipped the intro). */
  fast?: boolean;
}

/** Where the camera is and looks, in the room's plan (metres: x, and z toward the wide view), for the map. */
export interface RoomView {
  x: number;
  z: number;
  /** The horizontal direction the camera looks, normalised, and the point it looks at. */
  dirX: number;
  dirZ: number;
  targetX: number;
  targetZ: number;
  /** The station the camera is at or flying to. */
  destination: CameraPhase;
  moving: boolean;
  /** The played tour's glide: path seconds now, at each stop and at its end, and whether it is braking; null when none. */
  glide: { time: number; stops: number[]; end: number; braking: boolean } | null;
}

/** A box on the page, in CSS pixels from the viewport's top left. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RoomHandle {
  /** Leaves the boot framing: the arrival glide to the desk and on into the monitor, or with `open` the monitor at once. */
  start(options?: StartOptions): void;
  /** Glides to the monitor and opens that SaahilOS window; `fast` shortens the glide. */
  openWindow(target: string, options?: { fast?: boolean }): void;
  /** Flies the camera to a framing (idle, desk, monitor, window, tour_3, ...); false if the room lacks it. */
  fly(station: StationName): boolean;
  /**
   * Flies across the room to a stop (the map, the played tour) without overshoot; `onDone` runs once it lands there.
   * `distance` stands the camera that many times further back than the stop's framing.
   */
  visit(station: StationName, onDone?: () => void, distance?: number): boolean;
  /**
   * The played tour: one continuous glide through the stops and back to the desk, `seconds` long; any input brakes it
   * where it is. `room` (the floor plan) lets it keep the view on the room's walls. False under reduced motion (the map
   * then visits the stops one by one) or with no stop to frame.
   */
  glideTour(stops: readonly { station: StationName; distance: number }[], seconds: number, onDone?: () => void, room?: RoomPlan): boolean;
  /** Brakes the glide to rest where it is; false when none is cruising. */
  stopGlide(): boolean;
  /** Whether the room has this framing (a map stop names its camera node, `cam_tour_3` → `tour_3`). */
  has(station: string): station is StationName;
  /** The camera in plan coordinates, read every frame by the map's you-are-here mark. */
  view(): RoomView;
  /** Lands the intro glide now; the step into the monitor that follows it still comes. */
  skipIntro(): void;
  /** The visitor took over (the map opened, a stop chosen): nothing moves the camera by itself any more. */
  takeOver(): void;
  /** Out of the monitor, back to the desk (the room's back control). */
  back(): void;
  /** Where the monitor's glass is on the page now, or null when it is not in view. */
  monitorRect(): ScreenRect | null;
  /** The room's sound: unlock() on the first gesture, mute, volume, setState(state), sfx(name, position?). */
  readonly audio: AudioHandle;
  setPaused(paused: boolean): void;
  /** The median frame rate over the next `ms` (the second half of it), drawing every frame meanwhile. */
  measureFps(ms: number): Promise<number>;
  dispose(): void;
}

// The OS iframe must not hold the room back for ever; past this it keeps loading behind the boot screen.
const OS_LOAD_TIMEOUT_MS = 8000;
// The arrival on `/` (brief §1: 4–6 s): from the boot framing past the window and the mango plant to the desk.
const ARRIVAL_SECONDS = 4.8;
// On a phone the arrival hands over to SaahilOS with this window; on the desktop the OS opens it by itself (its default),
// so the room never moves the visitor's keyboard focus into the monitor while it glides.
const ARRIVAL_WINDOW = 'about';
// The desk holds this long after the arrival, then the camera goes into the monitor by itself: at the desk the OS draws
// at about 5 px, in front of the monitor at about 12 px, where a first-time visitor can read About.
const DESK_HOLD_MS = 1000;
// A click this soon after the press that skipped the arrival belongs to that press.
const SKIP_CLICK_MS = 600;
// On tiers this coarse (a machine that composites slowly), the screen seen from the wide view is a still picture.
const STILL_SCREEN_RESOLUTION = 0.5;

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
  readonly view: RoomView;
  /** How far the pointer's lean has turned the view from its framing (radians). */
  readonly look: { yaw: number; pitch: number };
  /** Where the camera stands about the set while the visitor turns it (radians, world units); null at a framing. */
  readonly orbit: RoomCamera['orbitState'];
  /** The orbit's centre (world units) and limits. */
  readonly orbitSettings: RoomCamera['orbitSettings'];
  /** Each wall of the diorama: its opacity, what fades with it, whether its hotspots take the pointer. */
  readonly walls: ReturnType<Diorama['probe']>;
  /** Base width of each texture in the room, after the light tier halves them. */
  readonly textureWidths: number[];
  /** The visible meshes each proxy lifts on hover. */
  readonly claims: Record<string, string[]>;
  /** How far the object behind a proxy is lifted now (millimetres). */
  lift(proxy: string): number;
  point(name: string): { x: number; y: number } | null;
  /** The proxy under a client point, or null for empty space. */
  hit(x: number, y: number): string | null;
  /** Where the monitor's glass is on the page now (RoomHandle.monitorRect). */
  monitorRect(): ScreenRect | null;
  goto(station: StationName): void;
  /** The living room: the window, lava lamp, espresso, oven, posters, Instax board, sticky notes. */
  readonly world: ReturnType<World['probe']>;
  /** performance.now() when the intro ended and the room became interactive; null before. */
  readonly interactiveAt: number | null;
  /**
   * performance.now() when the room started (the boot screen left, input reaches the room), and when the camera first
   * came to rest where it starts (the desk; the monitor for a phone's address); null before. On `/` the two bound the
   * arrival glide; on a window address they are the same moment.
   */
  readonly startedAt: number | null;
  readonly landedAt: number | null;
  /** Whether the screen shows its still picture instead of the live OS (the wide view on the slowest tiers). */
  readonly monitorStill: boolean;
  /** The last frame's draw calls and triangles, and what the GPU holds. */
  readonly gpu: { calls: number; triangles: number; textures: number; geometries: number; programs: number };
  /** Everything that moves at once: the lava lamp cycling, steam and an espresso pour. */
  forceEverything(on: boolean): void;
  /** Renders the room's sound offline as heard from a framing; see RoomAudio.renderOffline. */
  renderSound(seconds: number, options: OfflineOptions & { view: string }): Promise<Float32Array[]>;
  /** The sound's graph state (music stems, filter, beds, master) and its controls. */
  readonly audio: Pick<RoomAudio, 'graph' | 'setState' | 'sfx' | 'setMusicSource' | 'musicSource'>;
  /** Opens the record crate wherever the camera is (the room may have no player to click). */
  openRecords(): void;
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
  private readonly ktx2: ReturnType<typeof createKtx2Loader>;
  private nodes!: RoomNodes;
  private camera!: RoomCamera;
  private monitor!: MonitorScreen;
  private effects!: Effects;
  private atlases!: AtlasStreamer;
  private shine!: Shine;
  audio!: RoomAudio;
  private world!: World;
  private diorama!: Diorama;
  private interactiveAt: number | null = null;
  private startedAt: number | null = null;
  private landedAt: number | null = null;
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
  /** The arrival's step from the desk into the monitor, pending until the hold ends or the visitor takes over. */
  private stepIn = 0;
  private skippedAt = -Infinity;
  private leftMonitorAt = -Infinity;
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
    // One transcoder for the room and the runtime art loaded after it.
    this.ktx2 = createKtx2Loader(this.renderer.gl);
    // Counted per frame (scene and film pass together) for the probe.
    this.renderer.gl.info.autoReset = false;
    this.renderer.gl.domElement.addEventListener('webglcontextlost', () => this.options.onLost?.());
    this.quality = new Quality(this.light ? LIGHT : FULL, (tier) => this.applyTier(tier));
    this.renderer.setTier(this.quality.tier);
    // Captures and A/Bs (window.__roomDebug): the same moment of the idle drift, and switches applied at once.
    this.renderer.hooks = {
      setClock: (seconds) => {
        this.clock = seconds;
        this.dirty = true;
      },
      reapply: () => {
        if (this.world) this.applyTier(this.quality.tier);
      },
    };
  }

  async load() {
    const report = this.options.onProgress;
    const undefer = deferWindowPictures(this.ktx2);
    const root = await loadRoom(ROOM_URL, this.renderer.gl, (p, label) => report(p * 0.8, label), this.ktx2).finally(undefer);
    // Before anything is uploaded: dropping the largest mip level quarters the GPU memory the atlases take.
    if (this.light) halveTextures(root);
    this.nodes = readRoom(root);
    this.scene.add(root);
    void loadVoidColor().then((color) => {
      this.renderer.setVoidColor(color);
      this.dirty = true;
    });
    this.atlases = new AtlasStreamer(this.scene, this.renderer, this.ktx2, { light: this.light, onSwap: () => (this.dirty = true) });

    const still = Boolean(this.options.reducedMotion);
    this.camera = new RoomCamera(this.nodes, this.aspect(), still);
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
    this.effects.setTier(this.renderer.effective(this.quality.tier));
    this.audio = new RoomAudio({ crt: this.nodes.monitor.position, desk: this.nodes.framings.desk.target }, root);
    // Before the hover reactions: the world names and adds proxies (posters by slot, one per print, the dial's).
    this.world = new World(this.nodes, this.scene, this.container, this.ktx2, {
      fly: (station) => this.fly(station),
      station: () => this.camera.destination,
      openWindow: (target) => this.openWindow(target),
      sfx: (name, at) => this.audio.sfx(name, at),
      audio: this.audio,
      reducedMotion: still,
    });
    this.world.setTier(this.renderer.effective(this.quality.tier));
    this.shine = new Shine(root, this.renderer.gl, this.nodes.crtGlow && { glass: this.nodes.crtGlow, pose: this.nodes.monitor }, () => (this.dirty = true));
    this.shine.setTier(this.renderer.effective(this.quality.tier));
    // After the world: it names and adds the proxies the walls' hotspots are found among.
    this.diorama = new Diorama(root, this.nodes.proxies, this.camera.orbitSettings.center, still);
    this.hover = new HoverReactions(root, this.nodes.proxies, this.camera.instance, still);
    this.navigation = new Navigation(this.container, this.camera, this.nodes, {
      fly: (station, motion, onDone) => this.flyTo(station, motion, onDone),
      canSteer: () => this.started && !this.handedOver,
      takeOver: () => this.takeOver(),
      interrupt: () => this.camera.brake(),
      orbit: () => this.enterOrbit(),
    });
    this.interaction = new Interaction(this.container, this.monitor.iframe, this.camera.instance, this.nodes.proxies, this.label, {
      hotspot: (hotspot, proxy) => this.onHotspot(hotspot, proxy),
      toggle: () => this.toggle(),
      enterMonitor: () => this.enterMonitor(),
      leaveMonitor: () => this.leaveMonitor(),
      click: (kind) => {
        // A press inside the monitor while the tour glides past the desk stops the glide too.
        if (kind === 'mouse-down') this.camera.brake();
        this.audio.click(kind);
      },
      canHover: () => this.started && this.camera.destination !== 'monitor' && !this.handedOver,
      endedDrag: () => this.navigation.endedDrag(),
    });
    this.resize();
    this.observe();

    await this.world.load();
    report(0.85, 'posters');
    this.renderer.prepareTextures(this.scene);
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
    this.startedAt = performance.now();
    this.monitor.iframe?.removeAttribute('tabindex');
    const endIntro = () => {
      this.intro = false;
      this.landedAt ??= performance.now();
      this.options.onLanded?.();
      // The visitor can act now: what was left for later may start loading.
      this.interactiveAt ??= performance.now();
      this.world.becomeInteractive();
      void this.atlases.start();
      this.shine.start();
    };
    if (open === undefined) this.arrive(fast, endIntro);
    else if (this.light) this.toMonitor('fast', open || null, endIntro, true);
    else {
      // A window address lands ready: the camera in front of the monitor at once, the window already open on it.
      this.glide('monitor', 'fast', endIntro, true);
      if (open) this.monitor.open(open, { first: true });
    }
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

  visit(station: StationName, onDone?: () => void, distance = 1) {
    if (!this.camera.has(station)) return false;
    this.takeOver();
    this.flyTo(station, 'travel', onDone, distance);
    return true;
  }

  has(station: string): station is StationName {
    return this.camera.has(station as StationName);
  }

  glideTour(stops: readonly { station: StationName; distance: number }[], seconds: number, onDone?: () => void, room?: RoomPlan) {
    if (this.options.reducedMotion || this.paused) return false;
    this.takeOver();
    this.intro = false;
    this.handedOver = false;
    this.dirty = true;
    return this.camera.glide(stops, 'desk', seconds, onDone, room);
  }

  stopGlide() {
    return this.camera.brake();
  }

  view(): RoomView {
    const camera = this.camera.instance;
    const direction = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const target = this.camera.lookAt;
    return {
      x: camera.position.x / WORLD_SCALE,
      z: camera.position.z / WORLD_SCALE,
      dirX: direction.x,
      dirZ: direction.z,
      targetX: target.x / WORLD_SCALE,
      targetZ: target.z / WORLD_SCALE,
      destination: this.camera.destination,
      moving: this.camera.moving,
      glide: this.camera.glideState,
    };
  }

  skipIntro() {
    if (!this.intro) return;
    this.camera.finish();
    this.skippedAt = performance.now();
  }

  takeOver() {
    clearTimeout(this.stepIn);
  }

  back() {
    if (this.camera.destination === 'monitor') this.leaveMonitor();
  }

  monitorRect(): ScreenRect | null {
    const { position, quaternion, width, height } = this.nodes.monitor;
    const rect = this.container.getBoundingClientRect();
    const camera = this.camera.instance;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => new THREE.Vector3((x * width) / 2, (y * height) / 2, 0).applyQuaternion(quaternion).add(position).project(camera));
    if (corners.some((p) => p.z > 1)) return null;
    const xs = corners.map((p) => rect.left + ((p.x + 1) / 2) * rect.width);
    const ys = corners.map((p) => rect.top + ((1 - p.y) / 2) * rect.height);
    const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    return box.right < rect.left || box.left > rect.right || box.bottom < rect.top || box.top > rect.bottom ? null : box;
  }

  /** Stops every motion that runs by itself (sway, dust, LEDs); the camera still answers clicks. */
  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.takeOver();
      this.camera.brake();
    }
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
    clearTimeout(this.stepIn);
    for (const observer of this.observers) observer.disconnect();
    this.navigation?.dispose();
    this.interaction?.dispose();
    this.hover?.dispose();
    this.monitor?.dispose();
    this.audio?.dispose();
    this.world?.dispose();
    this.atlases?.dispose();
    this.shine?.dispose();
    this.diorama?.dispose();
    this.ktx2.dispose();
    this.effects?.dispose();
    this.renderer.dispose();
    for (const el of this.layers) el.remove();
    delete window.__room;
  }

  /**
   * The arrival on `/`: a timed glide from the wide view through the room's arrival waypoints to the desk, where the
   * monitor shows SaahilOS's first window (About). Reduced motion, or input that skipped the boot, cuts to the desk.
   */
  private arrive(fast: boolean, onDone: () => void) {
    this.intro = false;
    this.handedOver = false;
    this.dirty = true;
    const landed = () => {
      onDone();
      this.afterArrival();
    };
    if (fast || this.options.reducedMotion) this.camera.fly('desk', 'fast', landed, true);
    else this.camera.flyPath(this.nodes.arrival, 'desk', ARRIVAL_SECONDS, landed);
  }

  /**
   * The desk holds a moment, then the camera goes into the monitor, where the first window reads (a phone then hands
   * over to SaahilOS full screen with About). Reduced motion cuts in at once; a visitor who paused motion stays.
   */
  private afterArrival() {
    const opening = this.light ? ARRIVAL_WINDOW : null;
    if (this.options.reducedMotion) this.toMonitor('monitor', opening, undefined, true);
    // Any other move of the camera meanwhile cancels the step (see glide): the visitor leads now.
    else if (!this.paused) this.stepIn = window.setTimeout(() => this.toMonitor('monitor', opening), DESK_HOLD_MS);
  }

  private onHotspot(hotspot: Hotspot, proxy: THREE.Object3D) {
    // A click during the tour's glide only stops it, where it is.
    if (this.camera.brake()) return;
    this.hover.pulse(proxy);
    if (hotspot.labelOnly) return;
    this.audio.hotspot({ proxies: [proxy.name] });
    if (this.world.activate(hotspot)) return;
    if (hotspot.fly && this.camera.destination !== hotspot.fly && this.camera.has(hotspot.fly)) this.fly(hotspot.fly);
    else if (hotspot.target) this.openWindow(hotspot.target);
    else if (!hotspot.fly) this.enterMonitor();
  }

  private enterMonitor() {
    // The glide passes the desk: a pointer resting where the glass goes by is not the visitor asking to go in; nor is
    // a drag of the set that let go over the screen.
    if (this.camera.glideState || this.navigation.endedDrag()) return;
    if (this.started && this.camera.destination !== 'monitor') this.toMonitor('monitor', null);
  }

  private leaveMonitor() {
    if (this.camera.destination !== 'monitor') return;
    this.leftMonitorAt = performance.now();
    this.flyTo('desk', 'step');
  }

  /** The visitor turns or zooms the set: the camera leaves where it is (the monitor too) for the orbit about the set. */
  private enterOrbit() {
    if (!this.started || this.handedOver) return null;
    if (this.camera.destination === 'monitor') this.leftMonitorAt = performance.now();
    this.takeOver();
    this.intro = false;
    this.dirty = true;
    return this.camera.startOrbit();
  }

  /**
   * A click on empty space: in to the desk from the wide view, back to the desk from the monitor, out to the wide view
   * from a framing. Turned about the set, the camera stays where the visitor put it.
   */
  private toggle() {
    const now = performance.now();
    // The click that skipped the arrival only skips it; the press that took focus off the glass has already stepped out.
    if (!this.started || now - this.skippedAt < SKIP_CLICK_MS || now - this.leftMonitorAt < SKIP_CLICK_MS) return;
    if (this.camera.brake()) return;
    const here = this.camera.destination;
    if (here === 'orbit') return;
    this.flyTo(here === 'idle' || here === 'monitor' ? 'desk' : 'idle', 'step');
  }

  private flyTo(station: StationName, motion: Motion, onDone?: () => void, distance = 1) {
    if (station === 'monitor') this.toMonitor(motion, null, onDone);
    else this.glide(station, motion, onDone, false, distance);
  }

  /** Into the glass. On the light tier, landing there hands over to SaahilOS full screen with the window asked for. */
  private toMonitor(motion: Motion, target: string | null, onDone?: () => void, cut = false) {
    const motionIn = motion === 'step' || motion === 'travel' ? 'monitor' : motion;
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

  private glide(station: StationName, motion: Motion, onDone?: () => void, cut = false, distance = 1) {
    this.takeOver();
    this.intro = false;
    if (station !== 'monitor') this.handedOver = false;
    this.dirty = true;
    this.camera.fly(station, motion, onDone, cut || this.options.reducedMotion, distance);
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
    return this.renderer.pixelRatio(this.quality.ladder.dprCap, tier);
  }

  private applyTier(tier: QualityTier) {
    this.renderer.setTier(tier);
    this.renderer.setPixelRatio(this.pixelRatio(tier));
    this.effects.setTier(this.renderer.effective(tier));
    this.world.setTier(this.renderer.effective(tier));
    this.shine.setTier(this.renderer.effective(tier));
    this.dirty = true;
  }

  private observe() {
    const resize = new ResizeObserver(() => this.resize());
    resize.observe(this.container);
    // Hidden (the drawn monitor took over, or the page is off screen) the room stops drawing.
    const visibility = new IntersectionObserver(([entry]) => {
      this.onScreen = entry.isIntersecting;
      if (this.onScreen) this.loop();
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
    if (this.diorama.update(this.camera.instance.position, dt)) this.dirty = true;
    this.interaction.update();
    this.hover.set(this.interaction.hoveredProxy);
    if (this.hover.update(dt, now)) this.dirty = true;
    if (!this.paused) this.effects.update(this.clock);
    this.monitor.update(this.clock, this.camera.instance);
    const still = this.quality.tier.resolution <= STILL_SCREEN_RESOLUTION && this.camera.phase === 'idle' && this.camera.destination === 'idle';
    if (still !== this.monitor.isStill) {
      this.monitor.setStill(still);
      this.dirty = true;
    }
    this.world.update({
      camera: this.camera.instance,
      clock: this.clock,
      dt: this.paused ? 0 : dt,
      realDt: dt,
      running: this.started && !this.paused,
      pixelRatio: this.renderer.gl.getPixelRatio(),
    });
    if (this.world.animating) this.dirty = true;
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
    this.renderer.gl.info.reset();
    this.renderer.render(this.scene, this.cssScene, this.camera.instance);
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
      get view() {
        return app.view();
      },
      get look() {
        return app.camera.lookAngles;
      },
      get orbit() {
        return app.camera.orbitState;
      },
      orbitSettings: this.camera.orbitSettings,
      get walls() {
        return app.diorama.probe();
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
      monitorRect: () => app.monitorRect(),
      openRecords() {
        app.world.openRecords();
      },
      get world() {
        return app.world.probe();
      },
      get interactiveAt() {
        return app.interactiveAt;
      },
      get startedAt() {
        return app.startedAt;
      },
      get landedAt() {
        return app.landedAt;
      },
      get monitorStill() {
        return app.monitor.isStill;
      },
      get gpu() {
        const { render, memory, programs } = app.renderer.gl.info;
        return { calls: render.calls, triangles: render.triangles, ...memory, programs: programs?.length ?? 0 };
      },
      forceEverything(on) {
        app.world.forceEverything(on);
      },
      renderSound(seconds, { view, ...options }) {
        // A framing the runtime does not read yet (cam_window) still renders from its empties.
        const at = (name: string) => app.scene.getObjectByName(name)?.getWorldPosition(new THREE.Vector3());
        const known = app.nodes.framings[view as keyof RoomNodes['framings']];
        const framing = known ?? { position: at(`cam_${view}`), target: at(`cam_${view}_target`) };
        if (!framing.position || !framing.target) throw new Error(`room audio: the room has no ${view} framing`);
        const listener = new THREE.PerspectiveCamera();
        listener.position.copy(framing.position);
        listener.lookAt(framing.target);
        listener.updateMatrixWorld();
        return app.audio.renderOffline(seconds, listener, options);
      },
      get audio() {
        return app.audio;
      },
    };
  }
}
