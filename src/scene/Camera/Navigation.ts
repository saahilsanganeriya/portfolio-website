import * as THREE from 'three';
import type { RoomNodes, StationName } from '../Application/RoomModel';
import type { Orbit } from './orbit';
import type { Motion, RoomCamera } from './RoomCamera';

export interface NavigationHandlers {
  /** Moves the camera (the room applies reduced motion and what reaching the monitor means). */
  fly(station: StationName, motion: Motion, onDone?: () => void): void;
  /** Whether the visitor may steer now: the room has started and no window is being read on the monitor. */
  canSteer(): boolean;
  /** The visitor took the camera (a drag, a scroll, an arrow key): nothing moves it by itself any more. */
  takeOver(): void;
  /** Input during the tour's glide brakes it where it is; true when it did (the input then does nothing else). */
  interrupt(): boolean;
  /** The visitor turns or zooms the set: the camera leaves its framing (or the monitor) for the orbit. */
  orbit(): Orbit | null;
}

// A drag starts once the pointer has travelled this far; anything shorter is a click or a tap.
const DRAG_START_PX = 6;
// Arrow keys turn the set this far a press (a held key repeats); + and - move in or out this much.
const KEY_TURN_RAD = THREE.MathUtils.degToRad(15);
const KEY_TILT_RAD = THREE.MathUtils.degToRad(8);
const KEY_ZOOM = 0.85;
const ORBIT_KEYS: Record<string, [azimuth: number, polar: number]> = {
  ArrowLeft: [-KEY_TURN_RAD, 0],
  ArrowRight: [KEY_TURN_RAD, 0],
  ArrowUp: [0, -KEY_TILT_RAD],
  ArrowDown: [0, KEY_TILT_RAD],
};
const ZOOM_KEYS: Record<string, number> = { '+': KEY_ZOOM, '=': KEY_ZOOM, '-': 1 / KEY_ZOOM, _: 1 / KEY_ZOOM };
// Page Up and Page Down still step between the framings, in the walk's order.
const STEP_KEYS: Record<string, 1 | -1> = { PageDown: 1, PageUp: -1 };
// Two framings this close (eye and look-at point, millimetres) are one stop: a tour stop authored at the desk is the desk.
const SAME_STOP_MM = 250;
// Moving focus is not input to the room (the page's own rule): these keys leave the tour's glide gliding.
const FOCUS_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
// A wheel's line and page modes, in pixels.
const LINE_PX = 16;
const PAGE_PX = 400;

/**
 * The stations in the order Page Up and Page Down step through them: left to right as seen from the wide view, the
 * monitor straight after the desk it sits on. A room with tour stops steps through those (prop close-ups stay out of
 * the walk); the first room steps through its named framings.
 */
export function tourOrder(nodes: RoomNodes): StationName[] {
  const idle = nodes.framings.idle;
  const forward = idle.target.clone().sub(idle.position).setY(0).normalize();
  const right = forward.clone().cross(THREE.Object3D.DEFAULT_UP).normalize();
  const bearing = (point: THREE.Vector3) => {
    const toward = point.clone().sub(idle.position);
    return Math.atan2(toward.dot(right), toward.dot(forward));
  };
  const stops: StationName[] = nodes.tour.length ? nodes.tour : ['window', 'shelf', 'photos'];
  const kept: StationName[] = [];
  for (const name of ['idle', 'desk', ...stops] as StationName[]) {
    const f = nodes.framings[name];
    if (!f) continue;
    const same = kept.some((k) => {
      const other = nodes.framings[k]!;
      return f.position.distanceTo(other.position) < SAME_STOP_MM && f.target.distanceTo(other.target) < SAME_STOP_MM;
    });
    if (!same) kept.push(name);
  }
  const placed = kept
    .map((name) => ({ name, bearing: bearing(nodes.framings[name]!.target) }))
    .sort((a, b) => a.bearing - b.bearing)
    .map(({ name }) => name);
  placed.splice(placed.indexOf('desk') + 1, 0, 'monitor');
  return placed;
}

interface Press {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
}

/**
 * Drags, the wheel, pinches and keys steer the camera. A drag turns the whole set about its centre (the orbit), the
 * wheel or a pinch moves in and out, arrow keys turn it, + and - zoom, Escape backs out. At the monitor nothing here
 * moves the camera except a drag or Escape: the wheel there belongs to the OS window under the pointer.
 */
export class Navigation {
  readonly tour: StationName[];
  /** Pointers down on the stage, by id: one turns the set, two pinch. */
  private readonly presses = new Map<number, Press>();
  private dragging = false;
  private pinch = 0;
  private dragEndedAt = -Infinity;
  private readonly abort = new AbortController();

  constructor(
    private readonly stage: HTMLElement,
    private readonly camera: RoomCamera,
    private readonly nodes: RoomNodes,
    private readonly handlers: NavigationHandlers,
  ) {
    this.tour = tourOrder(nodes);
    const signal = this.abort.signal;
    stage.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal });
    stage.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    stage.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal });
    stage.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal });
    stage.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e), { signal });
  }

  /** Steps along the walk from where the camera is (or is heading); from a close-up or the orbit, from the nearest stop. */
  step(direction: 1 | -1) {
    const here = this.camera.destination;
    const index = this.tour.indexOf(here === 'loading' ? 'idle' : this.nearestStop(here));
    const next = this.tour[THREE.MathUtils.clamp(index + direction, 0, this.tour.length - 1)];
    if (next !== here) this.handlers.fly(next, 'step');
  }

  private nearestStop(station: StationName | 'orbit'): StationName {
    const at = station === 'orbit' ? this.camera.lookAt : this.nodes.framings[station]?.target;
    if ((station !== 'orbit' && this.tour.includes(station)) || !at) return station === 'orbit' ? 'idle' : station;
    const distance = (s: StationName) => at.distanceTo(this.nodes.framings[s]?.target ?? at);
    return this.tour.filter((s) => s !== 'monitor').reduce((best, s) => (distance(s) < distance(best) ? s : best));
  }

  /** True for the click that ends a drag or a pinch, which must not also click a prop. */
  endedDrag() {
    return performance.now() - this.dragEndedAt < 250;
  }

  private onPointerDown(event: PointerEvent) {
    if (!event.isPrimary && event.pointerType !== 'touch') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.presses.set(event.pointerId, { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY });
    if (this.presses.size === 2) this.pinch = this.spread();
  }

  private onPointerMove(event: PointerEvent) {
    const press = this.presses.get(event.pointerId);
    if (!press) return;
    if (!this.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START_PX || !this.handlers.canSteer()) return;
      this.dragging = true;
      this.stage.setPointerCapture?.(event.pointerId);
      // A drag during the tour's glide only stops it, where it is.
      if (this.handlers.interrupt()) {
        this.presses.clear();
        this.dragging = false;
        this.dragEndedAt = performance.now();
        return;
      }
      // The set then turns by the whole way the pointer has come since the press, so a drag never loses its start.
      this.handlers.takeOver();
    }
    const orbit = this.handlers.orbit();
    if (!orbit) return;
    this.camera.touchOrbit();
    if (this.presses.size >= 2) {
      press.lastX = event.clientX;
      press.lastY = event.clientY;
      const spread = this.spread();
      if (this.pinch > 0 && spread > 0) orbit.zoomBy(this.pinch / spread);
      this.pinch = spread;
      return;
    }
    orbit.drag(event.clientX - press.lastX, event.clientY - press.lastY, this.stage.clientHeight);
    press.lastX = event.clientX;
    press.lastY = event.clientY;
  }

  private onPointerUp(event: PointerEvent) {
    if (!this.presses.delete(event.pointerId)) return;
    if (this.presses.size === 1) this.pinch = 0;
    if (this.presses.size || !this.dragging) return;
    this.dragging = false;
    this.dragEndedAt = performance.now();
    this.handlers.orbit()?.release();
  }

  /** The distance between the two fingers of a pinch, in CSS pixels. */
  private spread() {
    const [a, b] = [...this.presses.values()];
    return a && b ? Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY) : 0;
  }

  private onWheel(event: WheelEvent) {
    // A pinch on a trackpad arrives as a wheel with Control held: that is the browser's zoom, left to the browser.
    if (event.ctrlKey) return;
    event.preventDefault();
    // The tour's glide brakes on any wheel; at the monitor the wheel scrolls the OS, never the camera.
    if (this.handlers.interrupt() || !this.handlers.canSteer() || this.camera.destination === 'monitor') return;
    this.handlers.takeOver();
    const orbit = this.handlers.orbit();
    if (!orbit) return;
    this.camera.touchOrbit();
    // deltaY as the platform gives it (its own natural direction): positive moves out, as in three.js's OrbitControls.
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? PAGE_PX : 1;
    orbit.zoom(event.deltaY * scale);
  }

  private onKey(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (!FOCUS_KEYS.has(event.key) && this.handlers.interrupt()) {
      // The key only stops the glide; Enter or Space on a focused button still presses it.
      if (!target?.closest?.('button, a')) event.preventDefault();
      return;
    }
    const turn = ORBIT_KEYS[event.key];
    const zoom = ZOOM_KEYS[event.key];
    const step = STEP_KEYS[event.key];
    const home = event.key === 'Home';
    const out = event.key === 'Escape';
    if (!turn && !zoom && !step && !home && !out) return;
    if (!this.handlers.canSteer()) return;
    // At the monitor the OS is being read: only Escape leaves it.
    if (this.camera.destination === 'monitor' && !out) return;
    event.preventDefault();
    this.handlers.takeOver();
    if (turn || zoom) {
      const orbit = this.handlers.orbit();
      if (!orbit) return;
      this.camera.touchOrbit();
      if (turn) orbit.nudge(...turn);
      else orbit.zoomBy(zoom);
    } else if (step) this.step(step);
    else if (home) this.handlers.fly('idle', 'step');
    else this.stepOut();
  }

  /** Escape backs out: from the monitor to the desk, from anywhere else to the wide view. */
  private stepOut() {
    const here = this.camera.destination;
    if (here === 'monitor') this.handlers.fly('desk', 'step');
    else if (here !== 'idle') this.handlers.fly('idle', 'step');
  }

  dispose() {
    this.abort.abort();
  }
}
