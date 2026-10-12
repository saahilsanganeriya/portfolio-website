import * as THREE from 'three';
import { RoomAudio } from './Audio';
import { RoomCamera, type CameraPhase } from './Camera';
import { loadDevRoom } from './devRoom';
import { Effects } from './Effects';
import { Interaction } from './Interaction';
import { MonitorScreen } from './MonitorScreen';
import { DPR_CAP, Quality, type QualityTier } from './Quality';
import type { ProgressReporter } from './Resources';
import { readRoom, type RoomNodes } from './RoomModel';
import { RoomRenderer } from './Renderer';
import { easeInOutQuint, easeIntoMonitor, easeOutExpo } from './tween';

export interface RoomOptions {
  /** The OS page shown on the monitor, e.g. `/os?embed=1`. */
  osUrl: string;
  onProgress: ProgressReporter;
}

export interface RoomHandle {
  /** After START: unlock audio, glide to the idle view. Must run inside the click handler. */
  start(): void;
  open(target: string): void;
  setMuted(muted: boolean): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

// The OS iframe must not hold START back for ever; past this it keeps loading behind the boot screen.
const OS_LOAD_TIMEOUT_MS = 8000;

/** Debug and measurement hook: tests click real props by their projected screen position. */
export interface RoomProbe {
  readonly phase: CameraPhase;
  readonly moving: boolean;
  readonly tier: number;
  point(name: string): { x: number; y: number } | null;
  goto(phase: 'idle' | 'desk' | 'monitor'): void;
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
  private interaction!: Interaction;
  private started = false;
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
    const root = await loadDevRoom((p, label) => report(p * 0.8, label));
    this.nodes = readRoom(root);
    this.scene.add(root);

    this.camera = new RoomCamera(this.nodes, this.aspect());
    this.monitor = new MonitorScreen(this.nodes.monitor, this.scene, this.cssScene, this.options.osUrl, (e) =>
      this.interaction.fromMonitor(e),
    );
    this.effects = new Effects(this.nodes, this.scene);
    this.effects.setTier(this.quality.tier);
    this.audio = new RoomAudio(this.nodes.monitor.position, this.nodes.projector?.lens ?? null, this.nodes.framings.desk.target);
    this.interaction = new Interaction(this.container, this.monitor.iframe, this.camera.instance, this.nodes.proxies, this.label, {
      hotspot: (hotspot) => (hotspot.target ? this.open(hotspot.target) : this.enterMonitor()),
      toggle: () => this.toggle(),
      enterMonitor: () => this.enterMonitor(),
      leaveMonitor: () => this.leaveMonitor(),
      click: (kind) => this.audio.click(kind),
      canHover: () => this.started && this.camera.destination !== 'monitor',
    });
    this.resize();
    this.observe();

    // Compile every shader and upload the textures now, so the first frame after START does not stall.
    await this.renderer.gl.compileAsync(this.scene, this.camera.instance);
    this.render();
    report(0.9, 'shaders');

    await Promise.race([this.monitor.load(), new Promise((resolve) => setTimeout(resolve, OS_LOAD_TIMEOUT_MS))]);
    report(1, 'SaahilOS');
    this.installProbe();
    // Frames drawn behind the boot screen calibrate the quality tier before anyone sees the room.
    this.loop();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.monitor.iframe.removeAttribute('tabindex');
    this.audio.unlock();
    this.camera.goTo('idle', 2500, easeOutExpo);
  }

  open(target: string) {
    this.enterMonitor();
    this.monitor.open(target);
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
    this.effects?.dispose();
    this.renderer.dispose();
    for (const el of this.layers) el.remove();
    delete window.__room;
  }

  private enterMonitor() {
    if (this.started) this.camera.goTo('monitor', 2000, easeIntoMonitor);
  }

  private leaveMonitor() {
    if (this.camera.destination === 'monitor') this.camera.goTo('desk', 1000, easeInOutQuint);
  }

  private toggle() {
    if (!this.started) return;
    const next = this.camera.destination === 'desk' ? 'idle' : 'desk';
    this.camera.goTo(next, 1000, easeInOutQuint);
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
    // Off screen (scrolled down to the text index) the room stops drawing.
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
    if (!this.paused) this.clock += dt;

    this.camera.update(now, dt, this.clock, this.interaction.pointer);
    this.interaction.update();
    if (!this.paused) this.effects.update(this.clock, this.renderer.gl.getPixelRatio());
    this.monitor.update(this.clock, this.camera.instance);
    this.audio.update(this.camera.instance, now);

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
      get moving() {
        return app.camera.moving;
      },
      get tier() {
        return app.quality.index;
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
      goto(phase) {
        if (phase === 'monitor') app.enterMonitor();
        else app.camera.goTo(phase, 1000, easeInOutQuint);
      },
    };
  }
}
