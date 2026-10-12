import * as THREE from 'three';
import { hotspotForProxy, type Hotspot } from '../hotspots';
import type { ClickKind } from './Audio';
import type { MonitorEvent } from './MonitorScreen';

export interface InteractionHandlers {
  /** A prop was clicked (or tapped); `proxy` is the box that was hit. */
  hotspot(hotspot: Hotspot, proxy: THREE.Object3D): void;
  /** Empty space was clicked: Henry's toggle between the wide view and the desk. */
  toggle(): void;
  enterMonitor(): void;
  leaveMonitor(): void;
  click(kind: ClickKind): void;
  /** Whether props can be hovered now (not while inside the monitor). */
  canHover(): boolean;
  /** Whether this click ends a drag of the view, which must not also click what is under it. */
  endedDrag(): boolean;
}

// A pointer that only crosses the monitor on its way somewhere should not pull the camera in.
const MONITOR_DWELL_MS = 140;

/** Pointer and keyboard handling for the stage: hover labels on props, clicks, and entering or leaving the monitor. */
export class Interaction {
  /** Pointer position in [-1, 1], +y up; drives the desk parallax. */
  readonly pointer = new THREE.Vector2();
  hovered: Hotspot | null = null;
  /** The proxy box under the pointer, for the hover reactions. */
  hoveredProxy: THREE.Object3D | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly clientPointer = { x: 0, y: 0, inside: false };
  private pressedInMonitor = false;
  private heldKey = '';
  private touch = false;
  private overMonitor = false;
  private dwell = 0;
  private readonly abort = new AbortController();

  constructor(
    private readonly stage: HTMLElement,
    iframe: HTMLIFrameElement | null,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly proxies: THREE.Object3D[],
    private readonly label: HTMLElement,
    private readonly handlers: InteractionHandlers,
  ) {
    const signal = this.abort.signal;
    // Events inside the iframe never reach the stage, so a stage move means the pointer is off the glass.
    stage.addEventListener(
      'pointermove',
      (e) => {
        this.movePointer(e.clientX, e.clientY);
        if (this.overMonitor) this.onMonitorPointer(false);
      },
      { signal },
    );
    stage.addEventListener('pointerleave', () => (this.clientPointer.inside = false), { signal });
    stage.addEventListener('pointerdown', (e) => (this.touch = e.pointerType === 'touch'), { signal });
    stage.addEventListener('pointerup', () => this.touch && this.releaseTouch(), { signal });
    stage.addEventListener('pointercancel', () => this.touch && this.releaseTouch(), { signal });
    stage.addEventListener('click', (e) => this.onClick(e), { signal });
    // Phones have no live screen in the 3D monitor (the OS opens full screen there), so no frame to follow.
    if (!iframe) return;
    iframe.addEventListener('pointerenter', () => !this.overMonitor && this.onMonitorPointer(true), { signal });
    iframe.addEventListener('pointerleave', () => this.overMonitor && this.onMonitorPointer(false), { signal });
    // Tabbing into the OS takes the camera to it; tabbing out goes back to the desk.
    iframe.addEventListener('focus', () => handlers.enterMonitor(), { signal });
    iframe.addEventListener('blur', () => !this.overMonitor && handlers.leaveMonitor(), { signal });
  }

  /** Events the OS forwards from inside the iframe. */
  fromMonitor(event: MonitorEvent) {
    if (event.type === 'pointer') {
      this.movePointer(event.x, event.y);
      if (!this.overMonitor) this.onMonitorPointer(true);
    } else if (event.type === 'press') {
      this.pressedInMonitor = event.down;
      this.handlers.click(event.down ? 'mouse-down' : 'mouse-up');
      if (!event.down && !this.overMonitor) this.handlers.leaveMonitor();
    } else if (!event.down) {
      if (event.key === this.heldKey) this.heldKey = '';
    } else if (event.key !== this.heldKey) {
      // A held key repeats keydown; a real key clicks once, as in Henry's room.
      this.heldKey = event.key;
      this.handlers.click('key');
    }
  }

  /** Hit-tests the props under the pointer once a frame and places the hover label. */
  update() {
    const pick = this.clientPointer.inside && !this.overMonitor && this.handlers.canHover() ? this.pick() : null;
    const hit = pick?.hotspot ?? null;
    this.hoveredProxy = pick?.proxy ?? null;
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.stage.style.cursor = hit ? 'pointer' : '';
      this.label.hidden = !hit;
      if (hit) this.label.textContent = hit.label;
    }
    if (hit) this.label.style.transform = `translate(${this.clientPointer.x + 16}px, ${this.clientPointer.y + 12}px)`;
  }

  private movePointer(clientX: number, clientY: number) {
    const rect = this.stage.getBoundingClientRect();
    this.clientPointer.x = clientX - rect.left;
    this.clientPointer.y = clientY - rect.top;
    this.clientPointer.inside = true;
    this.pointer.set((this.clientPointer.x / rect.width) * 2 - 1, -(this.clientPointer.y / rect.height) * 2 + 1);
  }

  private pick(): { hotspot: Hotspot; proxy: THREE.Object3D } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.proxies, false)) {
      const hotspot = hotspotForProxy(hit.object.name);
      if (hotspot) return { hotspot, proxy: hit.object };
    }
    return null;
  }

  private onClick(event: MouseEvent) {
    if ((event.target as Element).closest('a, button, input, [data-room-ui]') || this.handlers.endedDrag()) return;
    this.movePointer(event.clientX, event.clientY);
    const hit = this.handlers.canHover() ? this.pick() : null;
    if (hit) this.handlers.hotspot(hit.hotspot, hit.proxy);
    else this.handlers.toggle();
    if (this.touch) this.releaseTouch();
  }

  /** A finger leaves the glass: nothing stays hovered under it, and the view stops leaning toward where it was. */
  private releaseTouch() {
    this.clientPointer.inside = false;
    this.pointer.set(0, 0);
  }

  private onMonitorPointer(over: boolean) {
    this.overMonitor = over;
    clearTimeout(this.dwell);
    if (over) {
      this.dwell = window.setTimeout(() => this.handlers.enterMonitor(), MONITOR_DWELL_MS);
    } else if (!this.pressedInMonitor) {
      // Henry's room follows the pointer: leaving the glass goes back to the desk, even if the OS keeps focus.
      this.handlers.leaveMonitor();
    }
  }

  dispose() {
    clearTimeout(this.dwell);
    this.abort.abort();
  }
}
