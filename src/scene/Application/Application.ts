import * as THREE from 'three';
import { RoomAudio, type AudioHandle, type OfflineOptions } from '../audio/RoomAudio';
import { HOME_EVENT } from '../Camera/events';
import { frameObject } from '../Camera/focus';
import { Navigation } from '../Camera/Navigation';
import type { RoomPlan } from '../Camera/glide';
import { RoomCamera, type CameraPhase, type Motion, type Station } from '../Camera/RoomCamera';
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
import { AtlasStreamer, createKtx2Loader, halveTextures, loadRoom, loadVoidColor, ROOM_URL, textureWidths } from './Resources';
import { readRoom, WORLD_SCALE, type RoomNodes, type StationName } from './RoomModel';
import { RoomRenderer } from './Renderer';

export interface RoomOptions {
  /** The OS page shown on the monitor, e.g. `/os?embed=1`. */
  osUrl: string;
  /** How far the room has loaded, in [0, 1]: its files by bytes, then the steps after them. Never goes back. */
  onProgress(progress: number): void;
  /** room.glb's size in bytes, for when the server sends it compressed (with no length). */
  roomBytes?: number;
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
  /** The arrival has ended (the camera at rest at the monitor, or taken over by the visitor): the ways on begin here. */
  onLanded?(): void;
  /** SaahilOS has loaded on the monitor, behind the dark screen: it may load its full-size pictures now. */
  onOsLoaded?(): void;
}

export interface StartOptions {
  /**
   * A window address: the arrival lands with this SaahilOS window open (`projects/swe-sim`); '' opens none. Without
   * it, SaahilOS shows its first window (About).
   */
  open?: string;
  /** Milliseconds the wide view holds before the flight to the monitor (the page fades the room in meanwhile). */
  hold?: number;
  /** Cut to the monitor at once (the skip link: the visitor asked for SaahilOS). */
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

/** The card beside an object the camera has flown to (round 9 §10.2). */
export interface RoomCard {
  /** The object's proxy box, which names it. */
  id: string;
  title: string;
  line: string;
  /** Whether Learn more opens a window on the monitor. */
  more: boolean;
  /** Where the object is on the page now, or null when it is out of view. */
  rect: ScreenRect | null;
}

export interface RoomHandle {
  /**
   * The arrival: the wide view (the one Escape returns to) holds, then the camera makes the same flight as a click on
   * the monitor and lands with the window open; under reduced motion it cuts there.
   */
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
  /** Lands the arrival at the monitor now (a click or key while it holds or flies). */
  skipIntro(): void;
  /** The visitor took over (the map opened, a stop chosen): nothing moves the camera by itself any more. */
  takeOver(): void;
  /** Out of the monitor, back to the desk (the room's back control). */
  back(): void;
  /**
   * Home: a glide back to the wide view every visit starts from, from anywhere (a drag, a flight, the tour, the
   * monitor, turned behind the walls); a cut under reduced motion. False before the room has started.
   */
  home(): boolean;
  /** The card for the object the camera rests at, or null (none, or still flying there). */
  card(): RoomCard | null;
  /** Learn more on the card: into the monitor with that object's window open; false when there is none to open. */
  learnMore(): boolean;
  /** Where the monitor's glass is on the page now, or null when it is not in view. */
  monitorRect(): ScreenRect | null;
  /** The room's sound: unlock() on the first gesture, mute, volume, setState(state), sfx(name, position?). */
  readonly audio: AudioHandle;
  setPaused(paused: boolean): void;
  /** The median frame rate over the next `ms` (the second half of it), drawing every frame meanwhile. */
  measureFps(ms: number): Promise<number>;
  dispose(): void;
}

// The OS iframe must not hold the room back for ever; past this it keeps loading behind the dark screen.
const OS_LOAD_TIMEOUT_MS = 8000;
// The room waits this long at most for its full atlases before it is shown with what has arrived (never a dark screen
// for ever); the rest swap in as they land.
const ARRIVAL_DEADLINE_MS = 15_000;
// SaahilOS's full-size wallpaper gets this long after the OS has loaded (a renamed or missing picture never holds the
// room back further).
const OS_WALLPAPER_WAIT_MS = 4000;
// Without a hold from the page, the wide view holds this long before the flight to the monitor.
const ARRIVAL_HOLD_MS = 500;
// On a phone the arrival hands over to SaahilOS with this window; on the desktop the OS opens it by itself (its default),
// so the room never moves the visitor's keyboard focus into the monitor while it flies.
const ARRIVAL_WINDOW = 'about';
// The loading line: the files' bytes fill this share of it, the steps after them (the posters and the window, the
// shaders, SaahilOS, the measured tier, the GPU upload) the rest.
const BYTES_SHARE = 0.85;
const LOAD_STEPS = 5;
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
  /** The camera's eye and the monitor's glass centre, in metres (the arrival's path is measured between them). */
  readonly eye: [number, number, number];
  readonly monitorAt: [number, number, number];
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
   * performance.now() when the room started (the dark screen began to fade, input reaches the room), and when the
   * arrival ended: the camera at rest at the monitor, or the visitor taking it over on the way; null before.
   */
  readonly startedAt: number | null;
  readonly landedAt: number | null;
  /**
   * The tier measured before the arrival: the room's first frame and the frames timed after it (ms, each until the GPU
   * finished it), the time it took, and the tier picked (a pinned tier times the first frame only).
   */
  readonly calibration: Calibration | null;
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

export interface Calibration {
  first: number;
  frames: { tier: number; ms: number }[];
  ms: number;
  tier: number;
  /** The frame drawn with the full atlases before the room is shown, timed until the GPU finished it (ms). */
  warm?: number;
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
  /** The quality tier has been measured: until then nothing is drawn (see calibrate). */
  private measured = false;
  private calibration: Calibration | null = null;
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
  /** The arrival's flight to the monitor, pending until the wide view's hold ends or the visitor takes over. */
  private stepIn = 0;
  /** The window the arrival lands with (undefined: SaahilOS's first window). */
  private arrivalWindow: string | undefined;
  /** The arrival's own flight is being set off (any other flight ends the arrival). */
  private flyingIn = false;
  private skippedAt = -Infinity;
  private leftMonitorAt = -Infinity;
  /** The object a click flew the camera to, whose card shows once the camera rests there. */
  private focus: { hotspot: Hotspot; proxy: THREE.Object3D; station: Station } | null = null;
  /** The walls' inner faces, which a framing fitted to an object keeps its eye in front of. */
  private wallFaces: { leftWallX?: number; backWallZ?: number } = {};
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
    const progress = this.progress();
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, ARRIVAL_DEADLINE_MS));
    // The full atlases start downloading with room.glb (the desktop; phones keep the small set room.glb embeds).
    this.atlases = new AtlasStreamer(this.scene, this.renderer, this.ktx2, { light: this.light, onSwap: () => (this.dirty = true) });
    void this.atlases.load((name, loaded, total) => progress.bytes(`atlas ${name}`, loaded, total));
    const undefer = deferWindowPictures(this.ktx2);
    const root = await loadRoom(ROOM_URL, this.renderer.gl, (loaded, total) => progress.bytes('room', loaded, total || this.options.roomBytes || 0), this.ktx2).finally(undefer);
    // Before anything is uploaded: dropping the largest mip level quarters the GPU memory the atlases take.
    if (this.light) halveTextures(root);
    this.nodes = readRoom(root);
    const wall = (side: string) => root.getObjectByName(`wall_${side}`) ?? root.getObjectByName(`env_wall_${side}`);
    const [left, back] = [wall('left'), wall('back')].map((w) => (w ? new THREE.Box3().setFromObject(w) : null));
    this.wallFaces = { leftWallX: left?.max.x, backWallZ: back?.max.z };
    this.scene.add(root);
    void loadVoidColor().then((color) => {
      this.renderer.setVoidColor(color);
      this.dirty = true;
    });

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
      landed: () => this.camera.phase === this.camera.destination && !this.camera.moving,
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
    this.navigation = new Navigation(
      this.container,
      this.camera,
      this.nodes,
      {
        fly: (station, motion, onDone) => this.flyTo(station, motion, onDone),
        canSteer: () => this.started && !this.handedOver,
        takeOver: () => this.takeOver(),
        interrupt: () => this.camera.brake(),
        orbit: () => this.enterOrbit(),
        home: () => this.home(),
      },
      { host: this.container.closest<HTMLElement>('[data-room]'), frame: this.monitor.iframe },
    );
    this.interaction = new Interaction(this.container, this.monitor.iframe, this.camera.instance, this.nodes.proxies, this.label, {
      hotspot: (hotspot, proxy) => this.onHotspot(hotspot, proxy),
      toggle: () => this.toggle(),
      enterMonitor: (rested) => this.enterMonitor(rested),
      leaveMonitor: () => this.leaveMonitor(),
      click: (kind) => {
        // A press inside the monitor while the tour glides past the desk stops the glide too.
        if (kind === 'mouse-down') this.camera.brake();
        this.audio.click(kind);
      },
      canHover: () => this.started && this.camera.destination !== 'monitor' && !this.handedOver,
      endedDrag: () => this.navigation.endedDrag(),
      carded: (hotspot) => this.focus?.hotspot === hotspot && this.card() !== null,
    });
    this.resize();
    this.observe();

    // SaahilOS loads behind the dark screen while the atlases arrive, so it is ready when the camera reaches the glass.
    // The CSS3D layer puts the OS's frame into the page only when it is first laid out, so that happens now.
    this.renderer.css.render(this.cssScene, this.camera.instance);
    const os = Promise.race([this.monitor.load(), new Promise((resolve) => setTimeout(resolve, OS_LOAD_TIMEOUT_MS))]).then(() => {
      progress.step();
      this.options.onOsLoaded?.();
    });
    await this.world.load();
    progress.step();
    this.renderer.prepareTextures(this.scene);
    // Compile every shader now, so the first frame in the room does not stall.
    await this.renderer.gl.compileAsync(this.scene, this.camera.instance);
    progress.step();
    // SaahilOS's boot would share the main thread with the frames being timed; its wallpaper is the last thing the
    // arrival shows, so it must be at full size when the camera reaches the glass.
    await os;
    await this.osWallpaper(deadline);
    // The tier is measured on the small set room.glb embeds while the full atlases still download: a tier with other
    // filtering would upload every full atlas a second time.
    await this.calibrate();
    progress.step();
    // Every atlas the wide view and the flight show, full size and on the GPU at the measured tier's filtering before
    // the room is first drawn; then the live shine on the CRT glass and the desk, made now rather than after the
    // landing, where it appeared on the glass as the visitor arrived.
    await this.atlases.install(deadline);
    this.uploadTextures();
    await this.shine.start();
    await this.renderer.gl.compileAsync(this.scene, this.camera.instance);
    this.warmUp();
    progress.step();
    this.installProbe();
    // Behind the dark screen until the room starts; the ladder measures on from here.
    this.loop();
  }

  /**
   * One frame with the full set, drawn and waited for behind the dark screen: whatever a GPU does the first time it
   * samples a new texture happens here, not in the first frames the visitor sees (on software WebGL they were slow
   * enough to stretch the wide view's hold from 1 s to 2.2 s).
   */
  private warmUp() {
    const start = performance.now();
    this.render();
    this.renderer.waitForGpu();
    if (this.calibration) this.calibration.warm = performance.now() - start;
  }

  /** Until SaahilOS's full-size wallpaper has loaded and decoded (it starts once onOsLoaded has run), or a time limit. */
  private async osWallpaper(deadline: Promise<void>) {
    const view = this.monitor.iframe?.contentWindow;
    if (!view) return;
    let waiting = true;
    const arrived = async () => {
      while (waiting) {
        const img = view.document.querySelector<HTMLImageElement>('.os-wallpaper[data-full] img');
        if (img?.complete && img.naturalWidth > 0 && img.currentSrc && !/preview-/.test(img.currentSrc)) return img.decode().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    await Promise.race([arrived(), deadline, new Promise((resolve) => setTimeout(resolve, OS_WALLPAPER_WAIT_MS))]);
    waiting = false;
  }

  /** Every texture the room holds on the GPU now (the atlases are already there), so no first draw uploads one. */
  private uploadTextures() {
    const uploaded = new Set<THREE.Texture>();
    this.scene.traverse((node) => {
      const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of material ? (Array.isArray(material) ? material : [material]) : []) {
        const values = [...Object.values(m), ...Object.values((m as THREE.ShaderMaterial).uniforms ?? {}).map((u) => u?.value)];
        for (const value of values) {
          if (!(value instanceof THREE.Texture) || uploaded.has(value) || value.isRenderTargetTexture || value.version === 0) continue;
          uploaded.add(value);
          this.renderer.gl.initTexture(value);
        }
      }
    });
  }

  /** The loading line's value: bytes of every download against their sizes, then whole steps; it only ever rises. */
  private progress() {
    const downloads = new Map<string, { loaded: number; total: number }>();
    let steps = 0;
    let shown = 0;
    const report = () => {
      let loaded = 0;
      let total = 0;
      for (const d of downloads.values()) {
        loaded += Math.min(d.loaded, d.total || d.loaded);
        total += d.total || d.loaded;
      }
      const value = (total ? (loaded / total) * BYTES_SHARE : 0) + (steps / LOAD_STEPS) * (1 - BYTES_SHARE);
      if (value > shown) this.options.onProgress((shown = Math.min(1, value)));
    };
    return {
      bytes(name: string, loaded: number, total: number) {
        downloads.set(name, { loaded, total });
        report();
      },
      step() {
        steps = Math.min(LOAD_STEPS, steps + 1);
        report();
      },
    };
  }

  /**
   * The tier the arrival starts at, measured on frames of the room behind the dark screen, each timed until the GPU
   * has finished it. The time between two animation frames is no measure here: the browser queues a dozen frames for
   * the GPU before it holds the next one back, and the glide then waited for those queued top-tier frames (T82).
   */
  private async calibrate() {
    const timeFrame = () => {
      const start = performance.now();
      this.render();
      this.renderer.waitForGpu();
      return performance.now() - start;
    };
    const begun = performance.now();
    // The first frame also uploads the textures.
    const first = timeFrame();
    // A lower tier's shaders, render targets and texture filtering (a fresh upload of every texture), made in a frame of
    // their own: before its frames are timed, and for the last tier before the room starts, not in the glide.
    let drawnAt = this.quality.index;
    const prepare = async () => {
      if (drawnAt === this.quality.index) return;
      drawnAt = this.quality.index;
      await this.renderer.gl.compileAsync(this.scene, this.camera.instance);
      timeFrame();
    };
    const frames = await this.quality.calibrate(first, async () => {
      await prepare();
      return timeFrame();
    });
    await prepare();
    this.calibration = { first, frames, ms: performance.now() - begun, tier: this.quality.index };
    this.measured = true;
  }

  start({ open, hold = ARRIVAL_HOLD_MS, fast = false }: StartOptions = {}) {
    if (this.started) return;
    this.started = true;
    this.startedAt = performance.now();
    this.monitor.iframe?.removeAttribute('tabindex');
    this.intro = true;
    this.arrivalWindow = open;
    // The room appears at the wide view, the one Escape returns to.
    this.camera.fly('idle', 'fast', undefined, true);
    this.dirty = true;
    // A window address opens its window now, so it is there, drawn, when the camera reaches the glass.
    if (open && !this.light) this.monitor.open(open, { first: true });
    if (fast) this.flyIn(true);
    else this.stepIn = window.setTimeout(() => this.flyIn(Boolean(this.options.reducedMotion)), hold);
  }

  /** The arrival's move: the same flight as a click on the monitor (a cut under reduced motion), then the window. */
  private flyIn(cut: boolean) {
    clearTimeout(this.stepIn);
    if (!this.intro) return;
    // A phone hands over to SaahilOS full screen at the glass, with the address's window or About.
    const opening = this.light ? (this.arrivalWindow === undefined ? ARRIVAL_WINDOW : this.arrivalWindow || null) : null;
    this.flyingIn = true;
    try {
      this.toMonitor('monitor', opening, () => this.endArrival(), cut);
    } finally {
      this.flyingIn = false;
    }
  }

  /**
   * The arrival is over: the camera rests at the monitor, or the visitor took it on the way. The ways on appear, and
   * what was left for later (the darkroom's prints, the Pale Blue Dot's own picture) may start loading.
   */
  private endArrival() {
    if (!this.intro) return;
    this.intro = false;
    clearTimeout(this.stepIn);
    this.landedAt ??= performance.now();
    this.options.onLanded?.();
    this.interactiveAt ??= performance.now();
    this.world.becomeInteractive();
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
    this.skippedAt = performance.now();
    // In flight it lands now; while the wide view holds it cuts to the monitor.
    if (this.camera.moving) this.camera.finish();
    else this.flyIn(true);
  }

  takeOver() {
    clearTimeout(this.stepIn);
    this.endArrival();
  }

  back() {
    if (this.camera.destination === 'monitor') this.leaveMonitor();
  }

  home() {
    if (!this.started || this.handedOver) return false;
    this.navigation.cancel();
    // Out of the monitor as Escape leaves it: the press that took focus off the glass does not also step back.
    if (this.camera.destination === 'monitor') this.leftMonitorAt = performance.now();
    this.takeOver();
    this.dirty = true;
    const going = this.camera.home(undefined, this.options.reducedMotion);
    // The tour's map closes and its played glide ends (the camera has already left it).
    this.container.dispatchEvent(new CustomEvent(HOME_EVENT, { bubbles: true }));
    return going;
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

  private onHotspot(hotspot: Hotspot, proxy: THREE.Object3D) {
    // A click during the tour's glide only stops it, where it is.
    if (this.camera.brake()) return;
    this.hover.pulse(proxy);
    if (hotspot.labelOnly) return;
    this.audio.hotspot({ proxies: [proxy.name] });
    if (hotspot.card) {
      this.focusOn(hotspot, proxy);
      return;
    }
    if (this.world.activate(hotspot)) return;
    if (hotspot.fly && this.camera.destination !== hotspot.fly && this.camera.has(hotspot.fly)) this.fly(hotspot.fly);
    else if (hotspot.target) this.openWindow(hotspot.target);
    else if (!hotspot.fly) this.enterMonitor();
  }

  /**
   * An object with a card: the camera flies to the object itself (its own framing, or one fitted to it) and the card
   * shows once it is there. A second click on it opens its window, as Learn more does; on a prop that acts in the room
   * (the espresso pours, the oven door opens and shuts) it acts again, and Learn more opens the window.
   */
  private focusOn(hotspot: Hotspot, proxy: THREE.Object3D) {
    const current = this.focus;
    const acts = hotspot.action !== undefined && hotspot.action !== 'print';
    if (current?.hotspot === hotspot && this.camera.destination === current.station) {
      if (acts) this.world.activate(hotspot);
      else this.learnMore();
      return;
    }
    const station = this.stationFor(hotspot, proxy);
    this.focus = { hotspot, proxy, station };
    // The props that act once the camera is there (the espresso pours, the oven opens) fly there themselves.
    if (acts && this.world.activate(hotspot)) return;
    this.glide(station, 'travel');
  }

  /**
   * The hotspot's own framing when the room has one, else a framing fitted to its proxy box. A print always gets its
   * own: its `fly` is the whole darkroom line, and the click is for that one print.
   */
  private stationFor(hotspot: Hotspot, proxy: THREE.Object3D): Station {
    if (hotspot.fly && hotspot.action !== 'print' && this.camera.has(hotspot.fly)) return hotspot.fly;
    const idle = this.nodes.framings.idle;
    const box = new THREE.Box3().setFromObject(proxy);
    return this.camera.frameObject(proxy.name, frameObject(box, { fov: idle.fov, aspect: this.aspect(), toward: idle.position, ...this.wallFaces }));
  }

  card(): RoomCard | null {
    const focus = this.focus;
    if (!focus) return null;
    if (this.camera.destination !== focus.station) {
      this.focus = null;
      return null;
    }
    if (this.camera.moving || this.camera.phase !== focus.station) return null;
    const { hotspot, proxy } = focus;
    return {
      id: proxy.name,
      title: hotspot.card?.title ?? hotspot.label,
      line: hotspot.card?.line ?? `${hotspot.prop}.`,
      more: Boolean(hotspot.target),
      rect: this.screenRect(new THREE.Box3().setFromObject(proxy)),
    };
  }

  learnMore() {
    const focus = this.focus;
    if (!focus?.hotspot.target || this.camera.destination !== focus.station) return false;
    this.focus = null;
    this.openWindow(focus.hotspot.target);
    return true;
  }

  /** A box's outline on the page (CSS pixels from the viewport's top left), or null when it is behind or off screen. */
  private screenRect(box: THREE.Box3): ScreenRect | null {
    const rect = this.container.getBoundingClientRect();
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera.instance),
    );
    if (corners.some((p) => p.z > 1)) return null;
    const xs = corners.map((p) => rect.left + ((p.x + 1) / 2) * rect.width);
    const ys = corners.map((p) => rect.top + ((1 - p.y) / 2) * rect.height);
    const out = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    return out.right < rect.left || out.left > rect.right || out.bottom < rect.top || out.top > rect.bottom ? null : out;
  }

  private enterMonitor(rested = false) {
    // A pointer the glass slid under while the camera moved (a flight, the tour's glide, the orbit coasting) is not the
    // visitor asking to go in; nor is a drag of the set that let go over the screen.
    if (this.camera.glideState) return;
    if (rested && (this.camera.moving || this.navigation.endedDrag())) return;
    // The pointer rested on the glass while the wide view held: the arrival's flight sets off now.
    if (this.intro) this.flyIn(Boolean(this.options.reducedMotion));
    else if (this.started && this.camera.destination !== 'monitor') this.toMonitor('monitor', null);
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

  private glide(station: Station, motion: Motion, onDone?: () => void, cut = false, distance = 1) {
    clearTimeout(this.stepIn);
    // Any move but the arrival's own ends the arrival: the visitor leads now.
    if (!this.flyingIn) this.endArrival();
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
    // Frames queued for the GPU while the room loads would only delay the calibration's.
    if (!this.measured) return;
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
      get eye() {
        return app.camera.instance.position.toArray().map((v) => v / WORLD_SCALE) as [number, number, number];
      },
      monitorAt: this.nodes.monitor.position.toArray().map((v) => v / WORLD_SCALE) as [number, number, number],
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
        const feature = app.world.point(name, rect);
        if (feature !== undefined) return feature;
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
      get calibration() {
        return app.calibration;
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
