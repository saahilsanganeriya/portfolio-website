import * as THREE from 'three';
import type { RoomNodes, StationName } from '../Application/RoomModel';
import type { Orbit } from './orbit';
import type { Motion, RoomCamera, Station } from './RoomCamera';

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
  /** Home (the H or Home key): back to the wide view, from anywhere. */
  home(): void;
}

/** Where pinches arrive besides the stage: the room's whole page area, and the OS's frame on the monitor. */
export interface PinchSources {
  host?: HTMLElement | null;
  frame?: HTMLIFrameElement | null;
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
const HOME_KEYS = new Set(['Home', 'h', 'H']);
// Page Up and Page Down still step between the framings, in the walk's order.
const STEP_KEYS: Record<string, 1 | -1> = { PageDown: 1, PageUp: -1 };
// Two framings this close (eye and look-at point, millimetres) are one stop: a tour stop authored at the desk is the desk.
const SAME_STOP_MM = 250;
// Moving focus is not input to the room (the page's own rule): these keys leave the tour's glide gliding.
const FOCUS_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
// A wheel's line mode in pixels: one notch is 3 lines in Firefox and 100 px in Chromium, so a notch zooms the same in
// both (three.js's OrbitControls takes 16 px a line, and Firefox zoomed at half Chromium's speed). A page is the stage.
const LINE_PX = 100 / 3;
// A trackpad gesture's events come this close together; a longer gap starts a new gesture, which picks its axis again
// once it has moved this far: sideways turns the set, up and down zooms, never both at once.
const WHEEL_GESTURE_GAP_MS = 200;
const WHEEL_AXIS_PX = 4;
// A trackpad pinch arrives as a wheel with Control held (Chromium, Firefox): deltaY is about -100 ln(scale), so the
// room follows the fingers at exp(deltaY / 100). One event moves at most as far as a wheel notch (a mouse wheel turned
// with Control held is not a pinch, and must not jump).
const PINCH_PX = 100;
const PINCH_MAX_PX = 12;

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

/** A wheel event's deltas in CSS pixels, whatever its mode; Shift turns a plain wheel sideways, as browsers do. */
export function wheelPixels(event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'shiftKey'>, pagePx: number): [number, number] {
  // deltaMode first: Firefox reports pixels to a page that reads deltaY before it.
  const mode = event.deltaMode;
  const scale = mode === 1 ? LINE_PX : mode === 2 ? pagePx : 1;
  const [dx, dy] = [event.deltaX * scale, event.deltaY * scale];
  return event.shiftKey && dx === 0 ? [dy, 0] : [dx, dy];
}

/** Safari's pinch: `scale` since the gesture began. */
type GestureEvent = UIEvent & { scale?: number };

/**
 * Drags, the wheel, pinches and keys steer the camera. A drag turns the whole set about its centre (the orbit), the
 * wheel or a pinch moves in and out, a sideways swipe on a trackpad turns it, arrow keys turn it, + and - zoom, H or
 * Home goes home, Escape backs out. Every direction is the platform's own: the set follows the pointer and the
 * fingers, and the wheel zooms the way the page would scroll. At the monitor nothing here moves the camera except a
 * drag, a pinch outward, Home or Escape: the wheel there belongs to the OS window under the pointer.
 */
export class Navigation {
  readonly tour: StationName[];
  /** Pointers down on the stage, by id: one turns the set, two pinch. */
  private readonly presses = new Map<number, Press>();
  /** Pointers still down after Home cancelled their drag: they do nothing until they lift. */
  private readonly cancelled = new Set<number>();
  private dragging = false;
  private pinch = 0;
  private dragEndedAt = -Infinity;
  /** The trackpad gesture under way: its axis once known, what it has moved before that, its last event. */
  private wheel = { axis: null as 'x' | 'y' | null, dx: 0, dy: 0, at: -Infinity };
  /** Safari's pinch under way: its scale at the last event. */
  private gestureScale: number | null = null;
  private readonly abort = new AbortController();

  constructor(
    private readonly stage: HTMLElement,
    private readonly camera: RoomCamera,
    private readonly nodes: RoomNodes,
    private readonly handlers: NavigationHandlers,
    { host = stage, frame = null }: PinchSources = {},
  ) {
    this.tour = tourOrder(nodes);
    const signal = this.abort.signal;
    stage.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal });
    stage.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    stage.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal });
    stage.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal });
    stage.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e), { signal });
    // A pinch anywhere on the room's page zooms the room, never the page: over the controls too, and over the OS on the
    // monitor, whose frame has a document of its own (same origin; listened to again each time it loads).
    this.listenForPinches(host ?? stage, signal);
    if (frame) {
      const attach = () => frame.contentWindow && this.listenForPinches(frame.contentWindow, signal);
      frame.addEventListener('load', attach, { signal });
      if (frame.contentDocument?.readyState === 'complete' && frame.contentWindow?.location.href !== 'about:blank') attach();
    }
  }

  private listenForPinches(target: EventTarget, signal: AbortSignal) {
    const options = { signal, passive: false };
    target.addEventListener('wheel', (e) => this.onPinchWheel(e as WheelEvent), options);
    target.addEventListener('gesturestart', (e) => this.onGesture(e as GestureEvent), options);
    target.addEventListener('gesturechange', (e) => this.onGesture(e as GestureEvent), options);
    target.addEventListener('gestureend', (e) => this.onGesture(e as GestureEvent), options);
  }

  /**
   * Home took the camera: a drag or pinch under way is dropped (its pointers do nothing more until they lift, and the
   * click that ends it clicks nothing), and the set's coast with it.
   */
  cancel() {
    for (const id of this.presses.keys()) {
      this.cancelled.add(id);
      try {
        this.stage.releasePointerCapture?.(id);
      } catch {
        // not captured
      }
    }
    this.presses.clear();
    if (this.dragging) this.dragEndedAt = performance.now();
    this.dragging = false;
    this.pinch = 0;
    this.gestureScale = null;
  }

  /** Steps along the walk from where the camera is (or is heading); from a close-up or the orbit, from the nearest stop. */
  step(direction: 1 | -1) {
    const here = this.camera.destination;
    const index = this.tour.indexOf(here === 'loading' ? 'idle' : this.nearestStop(here));
    const next = this.tour[THREE.MathUtils.clamp(index + direction, 0, this.tour.length - 1)];
    if (next !== here) this.handlers.fly(next, 'step');
  }

  /** The walk's stop nearest what the camera looks at: from the orbit or an object's own framing, by where it looks. */
  private nearestStop(station: Station | 'orbit'): StationName {
    const named = station === 'orbit' || station.startsWith('object:') ? null : (station as StationName);
    if (named && this.tour.includes(named)) return named;
    const at = named ? this.nodes.framings[named]?.target : this.camera.lookAt;
    if (!at) return named ?? 'idle';
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
    // A press stops the set's coast where it is, as a hand on a turntable would.
    this.camera.stopCoast();
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
      orbit.holdZoom(true);
      if (this.pinch > 0 && spread > 0) orbit.zoomBy(this.pinch / spread);
      this.pinch = spread;
      return;
    }
    orbit.drag(event.clientX - press.lastX, event.clientY - press.lastY, this.stage.clientHeight);
    press.lastX = event.clientX;
    press.lastY = event.clientY;
  }

  private onPointerUp(event: PointerEvent) {
    if (this.cancelled.delete(event.pointerId)) {
      this.dragEndedAt = performance.now();
      return;
    }
    if (!this.presses.delete(event.pointerId)) return;
    if (this.presses.size === 1) {
      this.pinch = 0;
      if (this.dragging) this.handlers.orbit()?.holdZoom(false);
    }
    if (this.presses.size || !this.dragging) return;
    this.dragging = false;
    this.dragEndedAt = performance.now();
    const orbit = this.handlers.orbit();
    orbit?.holdZoom(false);
    orbit?.release();
  }

  /** The distance between the two fingers of a pinch, in CSS pixels. */
  private spread() {
    const [a, b] = [...this.presses.values()];
    return a && b ? Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY) : 0;
  }

  private onWheel(event: WheelEvent) {
    // A pinch (Control held) bubbles on to the room's own pinch handler.
    if (event.ctrlKey) return;
    event.preventDefault();
    // The tour's glide brakes on any wheel; at the monitor the wheel scrolls the OS, never the camera.
    if (this.handlers.interrupt() || !this.handlers.canSteer() || this.camera.destination === 'monitor') return;
    const [dx, dy] = wheelPixels(event, this.stage.clientHeight);
    const now = performance.now();
    const gesture = this.wheel;
    if (now - gesture.at > WHEEL_GESTURE_GAP_MS) Object.assign(gesture, { axis: null, dx: 0, dy: 0 });
    gesture.at = now;
    gesture.dx += dx;
    gesture.dy += dy;
    // Until the gesture has a direction, what it moved is kept for it.
    if (!gesture.axis) {
      if (Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) < WHEEL_AXIS_PX) return;
      gesture.axis = Math.abs(gesture.dx) > Math.abs(gesture.dy) ? 'x' : 'y';
    }
    const [moveX, moveY] = [gesture.dx, gesture.dy];
    gesture.dx = gesture.dy = 0;
    this.handlers.takeOver();
    const orbit = this.handlers.orbit();
    if (!orbit) return;
    this.camera.touchOrbit();
    // Sideways, the set follows the fingers: a swipe to the right (deltaX < 0 where content follows the fingers) turns
    // it as a drag to the right does. Up and down, deltaY as the platform gives it: positive moves out, as a page would
    // scroll on (and as in three.js's OrbitControls).
    if (gesture.axis === 'x') orbit.swipe(-moveX, 0, this.stage.clientHeight);
    else orbit.zoom(moveY);
  }

  /** A trackpad pinch in Chromium and Firefox (a wheel with Control held): the room zooms, the page never does. */
  private onPinchWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    // Safari's own gesture events carry this pinch.
    if (this.gestureScale !== null) return;
    const [, dy] = wheelPixels(event, this.stage.clientHeight);
    this.pinchBy(Math.exp(THREE.MathUtils.clamp(dy, -PINCH_MAX_PX, PINCH_MAX_PX) / PINCH_PX));
  }

  /** A trackpad pinch in Safari: gesturestart, gesturechange with the scale since the start, gestureend. */
  private onGesture(event: GestureEvent) {
    event.preventDefault();
    const scale = event.scale ?? 1;
    if (event.type === 'gesturestart') {
      this.gestureScale = scale;
      return;
    }
    if (event.type === 'gestureend') {
      this.gestureScale = null;
      this.camera.holdZoom(false);
      return;
    }
    const last = this.gestureScale ?? 1;
    this.gestureScale = scale;
    // On a phone the same pinch also arrives as two touches, which zoom the room already.
    if (this.presses.size >= 2 || !(scale > 0) || !(last > 0)) return;
    this.pinchBy(last / scale, true);
  }

  /** Zooms by `factor` on the radius (below 1 is in). At the monitor only a pinch outward counts: it leaves the screen. */
  private pinchBy(factor: number, held = false) {
    if (this.handlers.interrupt() || !this.handlers.canSteer()) return;
    if (this.camera.destination === 'monitor' && factor <= 1) return;
    this.handlers.takeOver();
    const orbit = this.handlers.orbit();
    if (!orbit) return;
    this.camera.touchOrbit();
    orbit.holdZoom(held);
    orbit.zoomBy(factor);
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
    const home = HOME_KEYS.has(event.key);
    const out = event.key === 'Escape';
    if (!turn && !zoom && !step && !home && !out) return;
    if (!this.handlers.canSteer()) return;
    // At the monitor the OS is being read: only Escape and Home leave it.
    if (this.camera.destination === 'monitor' && !out && !home) return;
    event.preventDefault();
    if (home) {
      if (!event.repeat) this.handlers.home();
      return;
    }
    this.handlers.takeOver();
    if (turn || zoom) {
      const orbit = this.handlers.orbit();
      if (!orbit) return;
      this.camera.touchOrbit();
      if (turn) orbit.nudge(...turn);
      else orbit.zoomBy(zoom);
    } else if (step) this.step(step);
    else this.stepOut();
  }

  /**
   * Escape backs out: from the monitor to the desk, from anywhere else to the wide view; turned about the set, by Home's
   * way round it rather than a straight line through the walls.
   */
  private stepOut() {
    const here = this.camera.destination;
    if (here === 'monitor') this.handlers.fly('desk', 'step');
    else if (here === 'orbit') this.handlers.home();
    else if (here !== 'idle') this.handlers.fly('idle', 'step');
  }

  dispose() {
    this.abort.abort();
  }
}
