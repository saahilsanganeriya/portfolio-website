import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';

// The 360° orbit (owner, round 8: "drag the scene and do a 360, scroll zooms in and out"): the camera turns about the
// room's `orbit_center` empty, which carries its limits (minDist, maxDist in metres; minPolarDeg, maxPolarDeg from
// straight up). A drag turns it and lets go with a little inertia; the wheel, a pinch or +/- move it in and out on a
// damped glide; the pivot glides from wherever the camera was looking to the orbit's centre on the first turn. A
// camera that starts outside the limits (the desk framing is closer than minDist, the monitor's is level) keeps its
// place and is held to the limits only once it is inside them, so entering the orbit never jumps.

export interface OrbitLimits {
  /** World units. */
  minDist: number;
  maxDist: number;
  /** Radians from straight up. */
  minPolar: number;
  maxPolar: number;
}

export interface OrbitSettings {
  center: THREE.Vector3;
  limits: OrbitLimits;
}

// A set without an orbit_center empty (the first corner-less room): turn about the floor's middle at desk height.
const FALLBACK = { heightM: 1, minDist: 3, maxDist: 10, minPolarDeg: 50, maxPolarDeg: 84 };
// A drag the height of the stage turns the camera this far (OrbitControls' default is a full turn, 2π).
const TURN_PER_STAGE_HEIGHT = Math.PI * 1.6;
// Let go, the turn keeps its speed and loses it with this time constant; the radius and the pivot glide this fast.
const INERTIA_TAU_S = 0.32;
const ZOOM_TAU_S = 0.16;
const PIVOT_TAU_S = 0.35;
// Outside the limits, the camera is drawn back inside them this fast (a key held into a limit, a pinch past it).
const LIMIT_TAU_S = 0.12;
// One notch of a mouse wheel is about 100 px of deltaY: it moves the camera about 12 % in or out.
const ZOOM_PER_PX = 0.0012;
const MAX_TURN_RAD_S = 6;
// The speed a drag hands to the inertia: an average over its last few moves, forgotten if the pointer rested.
const VELOCITY_WINDOW_MS = 80;

/** The orbit's centre and limits from the room's `orbit_center` empty, or ones fitted to the floor when it has none. */
export function readOrbit(root: THREE.Object3D): OrbitSettings {
  const node = root.getObjectByName('orbit_center');
  const extras = (node?.userData ?? {}) as Record<string, unknown>;
  const num = (key: keyof typeof FALLBACK, fallback: number) => {
    const value = Number(extras[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  let center: THREE.Vector3;
  if (node) center = node.getWorldPosition(new THREE.Vector3());
  else {
    const floor = root.getObjectByName('floor') ?? root.getObjectByName('env_floor');
    const box = new THREE.Box3().setFromObject(floor ?? root);
    center = box.getCenter(new THREE.Vector3());
    center.y = (box.isEmpty() ? 0 : box.min.y) + FALLBACK.heightM * WORLD_SCALE;
  }
  const minDist = num('minDist', FALLBACK.minDist) * WORLD_SCALE;
  const maxDist = Math.max(minDist, num('maxDist', FALLBACK.maxDist) * WORLD_SCALE);
  const minPolar = THREE.MathUtils.degToRad(num('minPolarDeg', FALLBACK.minPolarDeg));
  const maxPolar = Math.max(minPolar, THREE.MathUtils.degToRad(num('maxPolarDeg', FALLBACK.maxPolarDeg)));
  return { center, limits: { minDist, maxDist, minPolar, maxPolar } };
}

/** Azimuth (radians, 0 toward +z, the set's open front, growing toward +x), polar (from +y) and radius of `offset`. */
export function toSpherical(offset: { x: number; y: number; z: number }) {
  const radius = Math.hypot(offset.x, offset.y, offset.z);
  return {
    azimuth: Math.atan2(offset.x, offset.z),
    polar: radius > 0 ? Math.acos(THREE.MathUtils.clamp(offset.y / radius, -1, 1)) : Math.PI / 2,
    radius,
  };
}

export function fromSpherical(azimuth: number, polar: number, radius: number, out = new THREE.Vector3()) {
  const across = Math.sin(polar) * radius;
  return out.set(Math.sin(azimuth) * across, Math.cos(polar) * radius, Math.cos(azimuth) * across);
}

/** A range the value is held to: the limits, widened to include where the value started until it has come inside. */
class SoftRange {
  constructor(
    private low: number,
    private high: number,
    private readonly limits: [number, number],
  ) {}

  static from(value: number, [min, max]: [number, number]) {
    return new SoftRange(Math.min(min, value), Math.max(max, value), [min, max]);
  }

  /** Widens to hold `value` (where a glide of the pivot has carried the camera). */
  include(value: number) {
    this.low = Math.min(this.low, value);
    this.high = Math.max(this.high, value);
  }

  /** Narrows back to the limits on each side the value has reached. */
  admit(value: number) {
    if (value >= this.limits[0]) this.low = this.limits[0];
    if (value <= this.limits[1]) this.high = this.limits[1];
  }

  clamp(value: number) {
    return THREE.MathUtils.clamp(value, this.low, this.high);
  }
}

/**
 * The orbit's state: where the camera stands about its pivot, and how it is moving. `step` advances it by `dt`
 * seconds; `still` (reduced motion) drops the inertia and the glides, so every input lands at once.
 */
export class Orbit {
  azimuth: number;
  polar: number;
  radius: number;
  /** What the camera looks at and turns about: where it was looking, gliding to the centre once the visitor turns. */
  readonly pivot: THREE.Vector3;
  private radiusGoal: number;
  private readonly pivotGoal: THREE.Vector3;
  private readonly radii: SoftRange;
  private readonly polars: SoftRange;
  private velocity = { azimuth: 0, polar: 0 };
  private dragging = false;
  private readonly moves: { at: number; azimuth: number; polar: number }[] = [];

  constructor(
    eye: THREE.Vector3,
    target: THREE.Vector3,
    private readonly settings: OrbitSettings,
    private readonly still: boolean,
  ) {
    const { azimuth, polar, radius } = toSpherical(eye.clone().sub(target));
    this.azimuth = azimuth;
    this.polar = polar;
    this.radius = this.radiusGoal = radius;
    this.pivot = target.clone();
    this.pivotGoal = target.clone();
    const { minDist, maxDist, minPolar, maxPolar } = settings.limits;
    this.radii = SoftRange.from(radius, [minDist, maxDist]);
    this.polars = SoftRange.from(polar, [minPolar, maxPolar]);
  }

  /** The eye, into `out`. */
  eye(out = new THREE.Vector3()) {
    return fromSpherical(this.azimuth, this.polar, this.radius, out).add(this.pivot);
  }

  /** Whether the pivot has reached the orbit's centre (it goes there on the first turn). */
  get centred() {
    return this.pivotGoal.equals(this.settings.center);
  }

  /** The visitor turns the set: the pivot heads for the orbit's centre. */
  private centre() {
    if (this.centred) return;
    this.pivotGoal.copy(this.settings.center);
    if (this.still) this.movePivot(1);
  }

  /**
   * Moves the pivot `share` of the way to its goal. The eye keeps its place, so the view turns toward the centre rather
   * than sliding sideways, but never comes nearer the pivot than the distance limits allow.
   */
  private movePivot(share: number) {
    const eye = this.eye();
    this.pivot.lerp(this.pivotGoal, share);
    if (this.pivot.distanceToSquared(this.pivotGoal) < 1) this.pivot.copy(this.pivotGoal);
    const { azimuth, polar, radius } = toSpherical(eye.sub(this.pivot));
    this.polars.include(polar);
    this.azimuth = azimuth;
    this.polar = polar;
    this.radius = this.radiusGoal = this.radii.clamp(radius);
  }

  /** A drag of (dx, dy) CSS pixels on a stage `height` px tall: the set follows the pointer. */
  drag(dx: number, dy: number, height: number) {
    this.centre();
    this.dragging = true;
    const perPx = TURN_PER_STAGE_HEIGHT / Math.max(1, height);
    this.turn(-dx * perPx, -dy * perPx);
    const now = performance.now();
    this.moves.push({ at: now, azimuth: -dx * perPx, polar: -dy * perPx });
    while (this.moves.length && now - this.moves[0].at > VELOCITY_WINDOW_MS) this.moves.shift();
  }

  /** The drag ended: the turn carries on with the speed it had (none under reduced motion, or after a rest). */
  release() {
    this.dragging = false;
    const now = performance.now();
    const recent = this.moves.filter((m) => now - m.at <= VELOCITY_WINDOW_MS);
    this.moves.length = 0;
    if (this.still || recent.length < 2) return;
    const span = Math.max(16, now - recent[0].at) / 1000;
    const sum = recent.reduce((a, m) => ({ azimuth: a.azimuth + m.azimuth, polar: a.polar + m.polar }), { azimuth: 0, polar: 0 });
    const clampSpeed = (v: number) => THREE.MathUtils.clamp(v, -MAX_TURN_RAD_S, MAX_TURN_RAD_S);
    this.velocity = { azimuth: clampSpeed(sum.azimuth / span), polar: clampSpeed(sum.polar / span) };
  }

  /** A key press: turn by these angles (radians), gliding there, or at once under reduced motion. */
  nudge(azimuth: number, polar: number) {
    this.centre();
    if (this.still) {
      this.turn(azimuth, polar);
      return;
    }
    // A push the inertia spends: the camera ends up `angle` further on.
    this.velocity.azimuth = THREE.MathUtils.clamp(this.velocity.azimuth + azimuth / INERTIA_TAU_S, -MAX_TURN_RAD_S, MAX_TURN_RAD_S);
    this.velocity.polar = THREE.MathUtils.clamp(this.velocity.polar + polar / INERTIA_TAU_S, -MAX_TURN_RAD_S, MAX_TURN_RAD_S);
  }

  /** The wheel (deltaY in px, as the platform gives it: positive is away from the set), a pinch or +/-. */
  zoom(deltaPx: number) {
    this.zoomBy(Math.exp(deltaPx * ZOOM_PER_PX));
  }

  /** Moves in (`factor` < 1) or out, within the limits. */
  zoomBy(factor: number) {
    this.radiusGoal = this.radii.clamp(this.radiusGoal * factor);
    if (this.still) this.radius = this.radiusGoal;
  }

  /** How fast it is still turning (radians a second): zero once the inertia is spent. */
  get turning() {
    return Math.hypot(this.velocity.azimuth, this.velocity.polar);
  }

  /** Advances the inertia and the glides by `dt` seconds. */
  step(dt: number) {
    if (!this.dragging && dt > 0) {
      this.turn(this.velocity.azimuth * dt, this.velocity.polar * dt);
      const decay = Math.exp(-dt / INERTIA_TAU_S);
      this.velocity.azimuth *= decay;
      this.velocity.polar *= decay;
      if (this.turning < 1e-3) this.velocity = { azimuth: 0, polar: 0 };
    }
    const toward = (value: number, goal: number, tau: number) => (this.still || dt <= 0 ? goal : goal + (value - goal) * Math.exp(-dt / tau));
    this.radius = toward(this.radius, this.radiusGoal, ZOOM_TAU_S);
    const inside = this.radii.clamp(this.radius);
    if (inside !== this.radius) this.radius = toward(this.radius, inside, LIMIT_TAU_S);
    this.radii.admit(this.radius);
    this.radiusGoal = this.radii.clamp(this.radiusGoal);
    if (!this.pivot.equals(this.pivotGoal)) this.movePivot(this.still || dt <= 0 ? 1 : 1 - Math.exp(-dt / PIVOT_TAU_S));
  }

  private turn(azimuth: number, polar: number) {
    this.azimuth += azimuth;
    const next = this.polar + polar;
    this.polar = this.polars.clamp(next);
    // A turn into a limit stops there: no inertia keeps pushing against it.
    if (this.polar !== next) this.velocity.polar = 0;
    this.polars.admit(this.polar);
  }
}
