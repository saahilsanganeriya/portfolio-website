import * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import glassFrag from '../shaders/glass.frag.glsl?raw';
import glassVert from '../shaders/glass.vert.glsl?raw';
import type { MonitorPose } from './RoomModel';
import { WORLD_SCALE } from './RoomModel';

// The OS renders at this CSS size inside the glass, inset a little, the way a CRT hides its overscan.
const SCREEN_WIDTH_PX = 1280;
const OVERSCAN_PX = 32;
const PROJECTOR = new THREE.Color('#9db4c0');
// The still picture that stands in for the live screen from across the room (see setStill), in canvas pixels.
const STILL_WIDTH_PX = 320;
const INK = '#14110f';
const PAPER = '#ede4d3';

export type MonitorEvent =
  | { type: 'pointer'; x: number; y: number }
  | { type: 'press'; down: boolean }
  | { type: 'key'; key: string; down: boolean }
  /** Escape that the OS itself did not use (no menu open): the visitor wants out of the screen. */
  | { type: 'escape' };

export interface OpenOptions {
  /** The window the visit lands on (a window address): SaahilOS opens it at the height of a visit's first window. */
  first?: boolean;
}

/**
 * The monitor as Henry built it: a CSS3D iframe placed at the glass, an invisible GL plane that writes alpha 0 so the
 * iframe shows through (and nearer geometry still covers it), and glass layers drawn over the hole.
 */
export class MonitorScreen {
  /** The OS's frame on the glass; null without a live screen (phones open the OS full screen instead). */
  readonly iframe: HTMLIFrameElement | null = null;
  private readonly glass: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly center: THREE.Vector3;
  private readonly normal: THREE.Vector3;
  private readonly pixelSize: { width: number; height: number };
  private ready = false;
  private queued: { target: string; options: OpenOptions } | null = null;
  private readonly onMessage: (event: MessageEvent) => void;
  private frame: HTMLElement | null = null;
  private hole: THREE.Mesh<THREE.PlaneGeometry, THREE.Material> | null = null;
  private holeMaterial: THREE.Material | null = null;
  private stillMaterial: THREE.MeshBasicMaterial | null = null;
  private still = false;

  constructor(
    pose: MonitorPose,
    scene: THREE.Scene,
    cssScene: THREE.Scene,
    private readonly osUrl: string,
    private readonly onEvent: (event: MonitorEvent) => void,
    live = true,
  ) {
    this.normal = new THREE.Vector3(0, 0, 1).applyQuaternion(pose.quaternion);
    // A hair in front of the modelled glass, so the hole never z-fights with it.
    this.center = pose.position.clone().addScaledVector(this.normal, 0.0015 * WORLD_SCALE);
    const heightPx = Math.round((SCREEN_WIDTH_PX * pose.height) / pose.width);
    this.pixelSize = { width: SCREEN_WIDTH_PX, height: heightPx };
    if (live) this.iframe = this.addScreen(pose, scene, cssScene, heightPx);

    this.glass = new THREE.Mesh(
      new THREE.PlaneGeometry(pose.width, pose.height),
      new THREE.ShaderMaterial({
        vertexShader: glassVert,
        fragmentShader: glassFrag,
        uniforms: {
          uTime: { value: 0 },
          uDim: { value: 0 },
          uLines: { value: heightPx / 3 },
          uTint: { value: PROJECTOR.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
      }),
    );
    this.glass.position.copy(this.center).addScaledVector(this.normal, 0.001 * WORLD_SCALE);
    this.glass.quaternion.copy(pose.quaternion);
    this.glass.renderOrder = 3;
    scene.add(this.glass);

    this.onMessage = (event) => this.receive(event);
    window.addEventListener('message', this.onMessage);
  }

  /** The live screen: the OS's iframe on a CSS3D plane at the glass, and the GL plane that punches its hole. */
  private addScreen(pose: MonitorPose, scene: THREE.Scene, cssScene: THREE.Scene, heightPx: number) {
    const frame = document.createElement('div');
    frame.className = 'room-monitor';
    frame.style.width = `${SCREEN_WIDTH_PX}px`;
    frame.style.height = `${heightPx}px`;
    const iframe = document.createElement('iframe');
    iframe.title = 'SaahilOS, on the room’s monitor';
    // Out of the tab order until the room starts, while the boot screen still covers it.
    iframe.tabIndex = -1;
    iframe.style.cssText = `width:100%;height:100%;border:0;padding:${OVERSCAN_PX}px;box-sizing:border-box;display:block;background:transparent`;
    frame.appendChild(iframe);

    const object = new CSS3DObject(frame);
    object.position.copy(this.center);
    object.quaternion.copy(pose.quaternion);
    object.scale.setScalar(pose.width / SCREEN_WIDTH_PX);
    cssScene.add(object);
    this.frame = frame;

    const hole = new THREE.Mesh(
      new THREE.PlaneGeometry(pose.width, pose.height),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending, side: THREE.DoubleSide }),
    );
    hole.position.copy(this.center);
    hole.quaternion.copy(pose.quaternion);
    hole.renderOrder = 1;
    scene.add(hole);
    this.hole = hole;
    this.holeMaterial = hole.material;
    return iframe;
  }

  /**
   * From across the room the screen is a few dozen pixels wide, and without a GPU compositor the live OS layer over
   * the redrawing canvas costs a frame interval of its own (the wide view held 30 fps; with the layer transparent, 60).
   * `still` keeps the OS in place, transparent and still focusable, and draws a picture of it into the screen instead:
   * its wallpaper, its windows as paper with their title bars, and the taskbar, as they are at that moment.
   */
  setStill(still: boolean) {
    if (!this.frame || !this.hole || still === this.still) return;
    this.still = still;
    this.frame.style.opacity = still ? '0' : '';
    if (still) this.drawStill();
    this.hole.material = still && this.stillMaterial ? this.stillMaterial : this.holeMaterial!;
  }

  get isStill() {
    return this.still;
  }

  private drawStill() {
    const doc = this.iframe?.contentDocument;
    const width = STILL_WIDTH_PX;
    const height = Math.round((width * this.pixelSize.height) / this.pixelSize.width);
    const canvas = (this.stillMaterial?.map?.image as HTMLCanvasElement | undefined) ?? document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d')!;
    g.fillStyle = INK;
    g.fillRect(0, 0, width, height);
    if (doc?.documentElement) {
      // The OS sits inside the overscan, as on the live screen.
      const inset = (OVERSCAN_PX * width) / SCREEN_WIDTH_PX;
      // The frame's viewport, not <html>'s box: the OS positions everything, so its <html> has no height.
      const sx = (width - 2 * inset) / Math.max(1, doc.defaultView?.innerWidth ?? 0);
      const sy = (height - 2 * inset) / Math.max(1, doc.defaultView?.innerHeight ?? 0);
      g.save();
      g.translate(inset, inset);
      const wallpaper = doc.querySelector<HTMLImageElement>('.os-wallpaper img');
      if (wallpaper?.complete && wallpaper.naturalWidth > 0) {
        // Cover the screen, as the OS's own wallpaper does.
        const innerW = width - 2 * inset;
        const innerH = height - 2 * inset;
        const scale = Math.max(innerW / wallpaper.naturalWidth, innerH / wallpaper.naturalHeight);
        const w = wallpaper.naturalWidth * scale;
        const h = wallpaper.naturalHeight * scale;
        g.save();
        g.beginPath();
        g.rect(0, 0, innerW, innerH);
        g.clip();
        g.drawImage(wallpaper, (innerW - w) / 2, (innerH - h) / 2, w, h);
        g.restore();
      }
      const box = (el: Element, fill: string) => {
        const r = el.getBoundingClientRect();
        g.fillStyle = fill;
        g.fillRect(r.left * sx, r.top * sy, r.width * sx, r.height * sy);
        return r;
      };
      for (const dialog of doc.querySelectorAll('[role="dialog"]')) {
        const r = box(dialog, PAPER);
        g.fillStyle = INK;
        g.fillRect(r.left * sx, r.top * sy, r.width * sx, Math.max(2, 26 * sy));
        // Its text, as grey lines of uneven length (all a reader could make out of it from across the room).
        g.fillStyle = '#a99f90';
        for (let y = r.top + 70, line = 0; y < r.bottom - 24; y += 26, line++) {
          const share = 0.55 + 0.35 * Math.abs(Math.sin(line * 1.7));
          g.fillRect((r.left + 24) * sx, y * sy, (r.width - 48) * share * sx, Math.max(1, 7 * sy));
        }
      }
      const taskbar = doc.querySelector('.os-taskbar');
      if (taskbar) box(taskbar, '#c9bfae');
      g.restore();
    }
    if (!this.stillMaterial) {
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      this.stillMaterial = new THREE.MeshBasicMaterial({ map, toneMapped: false });
    } else this.stillMaterial.map!.needsUpdate = true;
  }

  /** Points the iframe at the OS; resolves when its document has loaded (at once without a live screen). */
  load(): Promise<void> {
    const iframe = this.iframe;
    if (!iframe) return Promise.resolve();
    return new Promise((resolve) => {
      iframe.addEventListener('load', () => resolve(), { once: true });
      iframe.src = this.osUrl;
    });
  }

  /** Opens an app in the OS (PLAN 3.7 target, e.g. "about" or "films/la-la-land"), once the OS says it is ready. */
  open(target: string, options: OpenOptions = {}) {
    if (!this.iframe) return;
    if (this.ready && this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage({ type: 'open', target, first: Boolean(options.first) }, location.origin);
    } else this.queued = { target, options };
  }

  /** The OS's front window (`films`, `about/…`, or '' for none): SaahilOS names it in its own location hash. */
  get frontWindow(): string {
    try {
      return this.iframe?.contentWindow?.location.hash.slice(1) ?? '';
    } catch {
      return '';
    }
  }

  update(time: number, camera: THREE.Camera) {
    const u = this.glass.material.uniforms;
    u.uTime.value = time;
    // Henry's dimming plane: the glass greys out at a glancing angle and from across the room.
    const toCamera = camera.position.clone().sub(this.center);
    const distance = toCamera.length() / WORLD_SCALE;
    const facing = Math.max(0, toCamera.normalize().dot(this.normal));
    u.uDim.value = THREE.MathUtils.clamp((1 - facing) * 0.55 + THREE.MathUtils.smoothstep(distance, 1.2, 6) * 0.3, 0, 0.8);
  }

  private receive(event: MessageEvent) {
    if (!this.iframe || event.source !== this.iframe.contentWindow || event.origin !== location.origin) return;
    const data = event.data as { type?: unknown; clientX?: unknown; clientY?: unknown; key?: unknown } | null;
    switch (data?.type) {
      case 'os-ready':
        this.ready = true;
        if (this.queued) {
          const { target, options } = this.queued;
          this.queued = null;
          this.open(target, options);
        }
        break;
      case 'escape':
        this.onEvent({ type: 'escape' });
        break;
      case 'mousemove': {
        // The OS reports its own coordinates; map them back onto the page so the desk parallax keeps following.
        const rect = this.iframe.getBoundingClientRect();
        const x = Number(data.clientX);
        const y = Number(data.clientY);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const inner = { w: this.pixelSize.width - OVERSCAN_PX * 2, h: this.pixelSize.height - OVERSCAN_PX * 2 };
          this.onEvent({ type: 'pointer', x: rect.left + (x / inner.w) * rect.width, y: rect.top + (y / inner.h) * rect.height });
        }
        break;
      }
      case 'mousedown':
      case 'mouseup':
        this.onEvent({ type: 'press', down: data.type === 'mousedown' });
        break;
      case 'keydown':
      case 'keyup':
        if (typeof data.key === 'string') this.onEvent({ type: 'key', key: data.key, down: data.type === 'keydown' });
        break;
    }
  }

  dispose() {
    window.removeEventListener('message', this.onMessage);
    if (this.iframe) this.iframe.src = 'about:blank';
  }
}
