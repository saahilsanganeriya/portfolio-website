import * as THREE from 'three';
import type { RoomNodes, StationName } from '../Application/RoomModel';
import type { Motion, RoomCamera } from './RoomCamera';

export interface NavigationHandlers {
  /** Moves the camera (the room applies reduced motion and what reaching the monitor means). */
  fly(station: StationName, motion: Motion, onDone?: () => void): void;
  /** Whether the visitor may steer now: the room has started and no window is being read on the monitor. */
  canSteer(): boolean;
  /** The visitor took the camera (a drag, a scroll, an arrow key): the first drift ends. */
  takeOver(): void;
}

// A drag starts once the pointer has travelled this far; anything shorter is a click or a tap.
const DRAG_START_PX = 6;
// One scroll gesture is one step: wheel deltas add up to this, then the wheel must rest before the next step.
const WHEEL_STEP_PX = 40;
const WHEEL_REST_MS = 220;
// The first drift: a beat on the wide view, then one corner after another, each leg cut short by the next.
const DRIFT_HOLD_MS = 1200;
const DRIFT_LEG_MS = 3800;
const STEP_KEYS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };

/**
 * The stations in the order a visitor steps through them: left to right as seen from the wide view, the monitor
 * straight after the desk it sits on. Arrow keys and the scroll wheel walk this list.
 */
export function tourOrder(nodes: RoomNodes): StationName[] {
  const idle = nodes.framings.idle;
  const forward = idle.target.clone().sub(idle.position).setY(0).normalize();
  const right = forward.clone().cross(THREE.Object3D.DEFAULT_UP).normalize();
  const bearing = (point: THREE.Vector3) => {
    const toward = point.clone().sub(idle.position);
    return Math.atan2(toward.dot(right), toward.dot(forward));
  };
  const placed = (['idle', 'window', 'desk', 'projector', 'shelf', 'photos'] as const)
    .filter((name) => nodes.framings[name])
    .map((name) => ({ name, bearing: bearing(nodes.framings[name]!.target) }))
    .sort((a, b) => a.bearing - b.bearing)
    .map(({ name }): StationName => name);
  placed.splice(placed.indexOf('desk') + 1, 0, 'monitor');
  return placed;
}

/** Keys, the scroll wheel, drags and touch steer the camera; also runs the slow first drift past the room's corners. */
export class Navigation {
  readonly tour: StationName[];
  /** The corners the first drift passes, ending near the monitor. */
  private readonly driftPath: StationName[];
  drifting = false;
  private driftTimers: number[] = [];
  private press: { id: number; x: number; y: number; lastX: number; lastY: number; dragging: boolean } | null = null;
  private dragEndedAt = -Infinity;
  private wheelTravel = 0;
  private wheelLockedUntil = 0;
  private wheelLastAt = 0;
  private readonly abort = new AbortController();

  constructor(
    private readonly stage: HTMLElement,
    private readonly camera: RoomCamera,
    nodes: RoomNodes,
    private readonly handlers: NavigationHandlers,
  ) {
    this.tour = tourOrder(nodes);
    this.driftPath = [...this.tour.filter((s) => s !== 'idle' && s !== 'desk' && s !== 'monitor'), 'desk'];
    const signal = this.abort.signal;
    stage.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal });
    stage.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    stage.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal });
    stage.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal });
    stage.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e), { signal });
  }

  /** Steps along the tour from where the camera is (or is heading). */
  step(direction: 1 | -1) {
    const here = this.camera.destination;
    const index = here === 'loading' ? this.tour.indexOf('idle') : this.tour.indexOf(here);
    const next = this.tour[THREE.MathUtils.clamp(index + direction, 0, this.tour.length - 1)];
    if (next !== here) this.handlers.fly(next, 'step');
  }

  /** Starts the first drift from the wide view; it ends at the desk, or as soon as the visitor does anything. */
  drift() {
    this.stopDrift();
    if (this.driftPath.length < 2) return;
    this.drifting = true;
    this.driftPath.forEach((station, i) => {
      const last = i === this.driftPath.length - 1;
      const timer = window.setTimeout(() => {
        this.handlers.fly(station, 'drift', last ? () => (this.drifting = false) : undefined);
      }, DRIFT_HOLD_MS + i * DRIFT_LEG_MS);
      this.driftTimers.push(timer);
    });
  }

  /** Ends the drift: the camera settles at the corner it was heading for instead of drifting on. */
  stopDrift() {
    for (const timer of this.driftTimers) clearTimeout(timer);
    this.driftTimers = [];
    if (!this.drifting) return;
    this.drifting = false;
    const heading = this.camera.destination;
    if (this.camera.moving && heading !== 'loading') this.handlers.fly(heading, 'step');
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
    this.stopDrift();
    this.abort.abort();
  }
}
