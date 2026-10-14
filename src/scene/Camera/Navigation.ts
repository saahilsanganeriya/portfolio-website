import * as THREE from 'three';
import type { RoomNodes, StationName } from '../Application/RoomModel';
import type { Motion, RoomCamera } from './RoomCamera';

export interface NavigationHandlers {
  /** Moves the camera (the room applies reduced motion and what reaching the monitor means). */
  fly(station: StationName, motion: Motion, onDone?: () => void): void;
  /** Whether the visitor may steer now: the room has started and no window is being read on the monitor. */
  canSteer(): boolean;
  /** The visitor took the camera (a drag, a scroll, an arrow key): nothing moves it by itself any more. */
  takeOver(): void;
}

// A drag starts once the pointer has travelled this far; anything shorter is a click or a tap.
const DRAG_START_PX = 6;
// One scroll gesture is one step: wheel deltas add up to this, then the wheel must rest before the next step.
const WHEEL_STEP_PX = 40;
const WHEEL_REST_MS = 220;
// Two framings this close (eye and look-at point, millimetres) are one stop: a tour stop authored at the desk is the desk.
const SAME_STOP_MM = 250;
const STEP_KEYS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };

/**
 * The stations in the order a visitor steps through them: left to right as seen from the wide view, the monitor
 * straight after the desk it sits on. A room with tour stops steps through those (prop close-ups stay out of the
 * walk); the first room steps through its named framings. Arrow keys and the scroll wheel walk this list.
 */
export function tourOrder(nodes: RoomNodes): StationName[] {
  const idle = nodes.framings.idle;
  const forward = idle.target.clone().sub(idle.position).setY(0).normalize();
  const right = forward.clone().cross(THREE.Object3D.DEFAULT_UP).normalize();
  const bearing = (point: THREE.Vector3) => {
    const toward = point.clone().sub(idle.position);
    return Math.atan2(toward.dot(right), toward.dot(forward));
  };
  const stops: StationName[] = nodes.tour.length ? nodes.tour : ['window', 'projector', 'shelf', 'photos'];
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

/** Keys, the scroll wheel, drags and touch steer the camera. */
export class Navigation {
  readonly tour: StationName[];
  private press: { id: number; x: number; y: number; lastX: number; lastY: number; dragging: boolean } | null = null;
  private dragEndedAt = -Infinity;
  private wheelTravel = 0;
  private wheelLockedUntil = 0;
  private wheelLastAt = 0;
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

  /** Steps along the tour from where the camera is (or is heading); from a close-up, from the stop nearest it. */
  step(direction: 1 | -1) {
    const here = this.camera.destination;
    const index = this.tour.indexOf(here === 'loading' ? 'idle' : this.nearestStop(here));
    const next = this.tour[THREE.MathUtils.clamp(index + direction, 0, this.tour.length - 1)];
    if (next !== here) this.handlers.fly(next, 'step');
  }

  private nearestStop(station: StationName): StationName {
    const at = this.nodes.framings[station]?.target;
    if (this.tour.includes(station) || !at) return station;
    const distance = (s: StationName) => at.distanceTo(this.nodes.framings[s]?.target ?? at);
    return this.tour.filter((s) => s !== 'monitor').reduce((best, s) => (distance(s) < distance(best) ? s : best));
  }

  /** True for the click that ends a drag, which must not also click a prop. */
  endedDrag() {
    return performance.now() - this.dragEndedAt < 250;
  }

  private onPointerDown(event: PointerEvent) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.press = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragging: false };
  }

  private onPointerMove(event: PointerEvent) {
    const press = this.press;
    if (!press || press.id !== event.pointerId) return;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START_PX || !this.handlers.canSteer()) return;
      press.dragging = true;
      this.stage.setPointerCapture?.(event.pointerId);
      this.handlers.takeOver();
    }
    this.camera.dragLook(event.clientX - press.lastX, event.clientY - press.lastY, this.stage.clientHeight);
    press.lastX = event.clientX;
    press.lastY = event.clientY;
  }

  private onPointerUp(event: PointerEvent) {
    if (!this.press || this.press.id !== event.pointerId) return;
    if (this.press.dragging) this.dragEndedAt = performance.now();
    this.press = null;
  }

  private onWheel(event: WheelEvent) {
    // A pinch on a trackpad arrives as a wheel with Control held: that is the browser's zoom, not a step.
    if (event.ctrlKey) return;
    event.preventDefault();
    if (!this.handlers.canSteer()) return;
    const now = performance.now();
    // Inside one gesture (a flick's inertia, a spun wheel) every event pushes the end of the gesture back.
    if (now < this.wheelLockedUntil) {
      this.wheelLockedUntil = now + WHEEL_REST_MS;
      return;
    }
    if (now - this.wheelLastAt > WHEEL_REST_MS * 2) this.wheelTravel = 0;
    this.wheelLastAt = now;
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 400 : 1;
    this.wheelTravel += event.deltaY * lines;
    if (Math.abs(this.wheelTravel) < WHEEL_STEP_PX) return;
    const direction = this.wheelTravel > 0 ? 1 : -1;
    this.wheelTravel = 0;
    this.wheelLockedUntil = now + WHEEL_REST_MS;
    this.handlers.takeOver();
    this.step(direction);
  }

  private onKey(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
    const direction = STEP_KEYS[event.key];
    const home = event.key === 'Home';
    const out = event.key === 'Escape';
    if (!direction && !home && !out) return;
    if (!this.handlers.canSteer()) return;
    event.preventDefault();
    this.handlers.takeOver();
    if (direction) this.step(direction);
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
