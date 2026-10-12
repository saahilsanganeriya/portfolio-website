import * as THREE from 'three';
import type { Framing, RoomNodes, StationName } from '../Application/RoomModel';
import { WORLD_SCALE } from '../Application/RoomModel';
import { Spring, springFor, type SpringSettings } from './spring';

export type CameraPhase = 'loading' | StationName;

/** How a move feels: each is a spring tuned to land in about the time named. */
export const MOTIONS = {
  /** The boot framing to the wide view. */
  intro: springFor(2.5),
  /** Arrow keys, scroll, a clicked prop: a little overshoot, then it settles. */
  step: springFor(1.1, 0.78),
  /** Into the glass, where an overshoot would push through the screen. */
  monitor: springFor(2),
  /** A window address or the skip link: straight in. */
  fast: springFor(1.2),
  /** The first slow drift around the room; it never lands between corners, it keeps moving to the next. */
  drift: springFor(6),
} satisfies Record<string, SpringSettings>;
export type Motion = keyof typeof MOTIONS;

interface Flight {
  to: StationName;
  spring: SpringSettings;
  onDone?: () => void;
}

// ±8°: the Blender room fills the 16:10 idle framing, so Henry's ±12.6° pushed the posters and the window out of view.
const IDLE_SWAY_RAD = 0.14;
const IDLE_PERIOD_S = 80;
const MONITOR_MARGIN = 1.3;
// Henry's framings were tuned for a 16:10 window; taller windows step back so the desk stays in frame.
const REFERENCE_ASPECT = 900 / 1440;
// Free look: the pointer turns the view a little; a drag turns it further, within these limits.
const POINTER_LOOK = { yaw: 0.06, pitch: 0.035 };
const DRAG_LIMIT = { yaw: 0.5, pitch: 0.24 };
// The eye also slides a little with the pointer (Henry's desk parallax), as a share of the distance to what it looks at.
const POINTER_SHIFT = { x: 0.03, y: 0.02 };
const LOOK_SPRING = springFor(0.45);
const SWAY_IN = springFor(5);
const SWAY_OUT = springFor(1.2);
// A flight has landed once it is this close (a share of the viewing distance, at least half a millimetre).
const LAND_SHARE = 0.0025;
const FOV_TOLERANCE_DEG = 0.05;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The room's camera: framings authored as empties in the room (cam_<name> + cam_<name>_target), reached by springs.
 * On top of the framing, a constrained free look: the pointer turns the view slightly, a drag turns it further.
 */
export class RoomCamera {
  readonly instance: THREE.PerspectiveCamera;
  phase: CameraPhase = 'loading';
  private flight: Flight | null = null;
  private readonly framings: RoomNodes['framings'];
  private readonly monitorCenter: THREE.Vector3;
  private readonly monitorNormal: THREE.Vector3;
  private readonly monitorSize: { width: number; height: number };
  // position xyz, target xyz, fov
  private readonly rig = new Spring(7);
  private readonly goal = new Float64Array(7);
  // pointer yaw, pointer pitch, drag yaw, drag pitch
  private readonly look = new Spring(4);
  private readonly lookGoal = new Float64Array(4);
  /** How much of the idle sway applies: it fades in slowly on the wide view and out faster when the camera leaves. */
  private readonly swayWeight = new Spring(1);
  private clock = 0;
  private readonly drag = { yaw: 0, pitch: 0 };
  private readonly pointer = new THREE.Vector2();
  private readonly position = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private aspect = 1;

  constructor(nodes: RoomNodes, aspect: number) {
    this.framings = nodes.framings;
    this.monitorCenter = nodes.monitor.position.clone();
    this.monitorNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(nodes.monitor.quaternion);
    this.monitorSize = { width: nodes.monitor.width, height: nodes.monitor.height };
    const loading = this.framings.loading;
    this.instance = new THREE.PerspectiveCamera(loading.fov, aspect, 0.01 * WORLD_SCALE, 80 * WORLD_SCALE);
    this.resize(aspect);
    this.writeGoal('loading');
    this.rig.set(this.goal);
    this.apply();
  }

  get moving() {
    return this.flight !== null;
  }

  /** The station the camera is at or flying to. */
  get destination(): CameraPhase {
    return this.flight?.to ?? this.phase;
  }

  /** Whether the room has this framing (window, projector, shelf and photos are optional). */
  has(station: StationName) {
    return station === 'monitor' || Boolean(this.framings[station]);
  }

  resize(aspect: number) {
    this.aspect = aspect;
    this.instance.aspect = aspect;
    this.instance.updateProjectionMatrix();
  }

  /** Flies to a station on a spring; `cut` jumps there (reduced motion, a skipped intro). False if the room lacks it. */
  fly(station: StationName, motion: Motion, onDone?: () => void, cut = false): boolean {
    if (!this.has(station)) return false;
    this.drag.yaw = this.drag.pitch = 0;
    if (cut) {
      this.flight = { to: station, spring: MOTIONS[motion], onDone };
      this.finish();
      return true;
    }
    if (!this.flight && this.phase === station) {
      onDone?.();
      return true;
    }
    // Re-aiming keeps the rig's velocity, so a change of mind curves instead of stopping and starting again.
    this.flight = { to: station, spring: MOTIONS[motion], onDone };
    return true;
  }

  /** Lands the current flight at its framing now. */
  finish() {
    const flight = this.flight;
    if (!flight) return;
    this.writeGoal(flight.to);
    this.rig.set(this.goal);
    this.land();
    this.apply();
  }

  /** Turns the view by a drag of (dx, dy) CSS pixels: the room follows the finger. */
  dragLook(dx: number, dy: number, viewportHeight: number) {
    if (this.destination === 'monitor') return;
    const radiansPerPixel = THREE.MathUtils.degToRad(this.instance.fov) / Math.max(1, viewportHeight);
    this.drag.yaw = THREE.MathUtils.clamp(this.drag.yaw + dx * radiansPerPixel, -DRAG_LIMIT.yaw, DRAG_LIMIT.yaw);
    this.drag.pitch = THREE.MathUtils.clamp(this.drag.pitch + dy * radiansPerPixel, -DRAG_LIMIT.pitch, DRAG_LIMIT.pitch);
  }

  /** How far the view is turned from its framing (radians), for tests and measurements. */
  get lookAngles() {
    const [pointerYaw, pointerPitch, dragYaw, dragPitch] = this.look.value;
    return { yaw: pointerYaw + dragYaw, pitch: pointerPitch + dragPitch };
  }

  /** `pointer` is in [-1, 1] on both axes, +y up; `clock` is the ambient time in seconds (frozen while paused). */
  update(dt: number, clock: number, pointer: THREE.Vector2) {
    const station = this.destination;
    this.clock = clock;
    this.writeGoal(station);
    if (this.flight) {
      this.rig.step(this.goal, dt, this.flight.spring);
      const { offset, speed } = this.rig.distance(this.goal);
      const viewDistance = Math.hypot(this.goal[0] - this.goal[3], this.goal[1] - this.goal[4], this.goal[2] - this.goal[5]);
      const tolerance = Math.max(0.5, viewDistance * LAND_SHARE);
      if (offset < tolerance && speed < tolerance * 3 && Math.abs(this.rig.value[6] - this.goal[6]) < FOV_TOLERANCE_DEG) this.land();
    } else {
      this.rig.set(this.goal);
    }

    if (station === 'monitor' || station === 'loading') this.pointer.set(0, 0);
    else this.pointer.copy(pointer);
    this.lookGoal[0] = -this.pointer.x * POINTER_LOOK.yaw;
    this.lookGoal[1] = this.pointer.y * POINTER_LOOK.pitch;
    this.lookGoal[2] = this.drag.yaw;
    this.lookGoal[3] = this.drag.pitch;
    this.look.step(this.lookGoal, dt, LOOK_SPRING);
    const swayOn = station === 'idle';
    this.swayWeight.step([swayOn ? 1 : 0], dt, swayOn ? SWAY_IN : SWAY_OUT);
    this.apply();
  }

  private land() {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    this.phase = flight.to;
    flight.onDone?.();
  }

  private apply() {
    const v = this.rig.value;
    this.position.set(v[0], v[1], v[2]);
    this.target.set(v[3], v[4], v[5]);
    // The wide view drifts by itself; kept out of the flight's goal, so a moving goal never holds a landing back.
    const sway = this.swayWeight.value[0];
    if (sway > 0.001) this.sway(sway);
    const forward = this.target.clone().sub(this.position);
    const distance = forward.length();
    forward.normalize();
    const right = forward.clone().cross(UP).normalize();
    const up = right.clone().cross(forward);
    const [pointerYaw, pointerPitch, dragYaw, dragPitch] = this.look.value;
    // The eye slides with the pointer, as in Henry's desk parallax; a drag only turns the head.
    this.position
      .addScaledVector(right, (-pointerYaw / POINTER_LOOK.yaw) * POINTER_SHIFT.x * distance)
      .addScaledVector(up, (pointerPitch / POINTER_LOOK.pitch) * POINTER_SHIFT.y * distance);
    forward.applyAxisAngle(right, pointerPitch + dragPitch).applyAxisAngle(UP, pointerYaw + dragYaw);

    this.instance.position.copy(this.position);
    this.instance.lookAt(this.position.clone().addScaledVector(forward, distance));
    // Hit tests and the paused-frame check read the world matrix before the renderer would refresh it.
    this.instance.updateMatrixWorld();
    if (this.instance.fov !== v[6]) {
      this.instance.fov = v[6];
      this.instance.updateProjectionMatrix();
    }
  }

  private writeGoal(phase: CameraPhase) {
    let position: THREE.Vector3;
    let target: THREE.Vector3;
    let fov: number;
    if (phase === 'monitor') ({ position, target, fov } = this.monitorPose());
    else {
      const framing = phase === 'loading' ? this.framings.loading : this.framings[phase] ?? this.framings.idle;
      ({ position, target, fov } = this.fromFraming(framing, phase === 'loading' ? 1 : this.aspectFit()));
    }
    this.goal[0] = position.x;
    this.goal[1] = position.y;
    this.goal[2] = position.z;
    this.goal[3] = target.x;
    this.goal[4] = target.y;
    this.goal[5] = target.z;
    this.goal[6] = fov;
  }

  private fromFraming(f: Framing, distanceScale: number) {
    const position = f.target.clone().add(f.position.clone().sub(f.target).multiplyScalar(distanceScale));
    return { position, target: f.target.clone(), fov: f.fov };
  }

  private aspectFit() {
    return THREE.MathUtils.clamp(1 + (1 / this.aspect - REFERENCE_ASPECT) * 0.55, 0.9, 1.6);
  }

  /** Henry's idle sway: a slow swing around what the camera looks at, and a slower bob. */
  private sway(weight: number) {
    const angle = Math.sin((this.clock * Math.PI * 2) / IDLE_PERIOD_S) * IDLE_SWAY_RAD * weight;
    this.position.sub(this.target).applyAxisAngle(UP, angle).add(this.target);
    this.position.y += Math.sin((this.clock * Math.PI * 2) / 47) * 0.05 * WORLD_SCALE * weight;
  }

  /** Close enough that the glass fills the view with a thin bezel, whatever the window's shape. */
  private monitorPose() {
    const fov = this.framings.monitor.fov;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    const fitHeight = this.monitorSize.height / 2 / halfTan;
    const fitWidth = this.monitorSize.width / 2 / (halfTan * this.aspect);
    const distance = Math.max(fitHeight, fitWidth) * MONITOR_MARGIN;
    const authored = this.framings.monitor.position.clone().sub(this.framings.monitor.target).normalize();
    const direction = authored.lengthSq() > 0 ? authored : this.monitorNormal;
    return {
      position: this.monitorCenter.clone().addScaledVector(direction, distance),
      target: this.monitorCenter.clone(),
      fov,
    };
  }
}
