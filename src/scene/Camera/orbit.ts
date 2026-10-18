import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';

// The 360° orbit (owner, round 8: "drag the scene and do a 360, scroll zooms in and out"): the camera turns about the
// room's `orbit_center` empty, which carries its limits (minDist, maxDist in metres; minPolarDeg, maxPolarDeg from
// straight up). Input moves a goal; the view follows it closely, so uneven pointer events still make even frames. Let
// go, the turn carries on at the speed the view had and eases out; a press stops it. Past the tilt and zoom limits the
// view gives a little, stiffer the further it is pulled, and springs back once let go (a rubber band, not a wall). The
// pivot glides from wherever the camera was looking to the orbit's centre on the first turn. A camera that starts
// outside the limits (the desk framing is closer than minDist, the monitor's is level) keeps its place and is held to
// the limits only once it is inside them, so entering the orbit never jumps.

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
  /** The wide view's azimuth about the centre (radians): a coast eases to rest by COAST_EDGE_RAD either side of it. */
  front?: number;
}

// A set without an orbit_center empty (the first corner-less room): turn about the floor's middle at desk height.
const FALLBACK = { heightM: 1, minDist: 3, maxDist: 10, minPolarDeg: 50, maxPolarDeg: 84 };
// A drag the height of the stage turns the camera this far (OrbitControls' default is a full turn, 2π): about 200°, so a
// drag across a MacBook's stage turns it 300° and the set never spins faster than the hand reads it.
const TURN_PER_STAGE_HEIGHT = Math.PI * 1.1;
// The view follows the goal with this time constant: long enough to even out 60 Hz pointer events on a 120 Hz screen,
// short enough (three frames at 60 fps) that a drag never feels late.
const FOLLOW_TAU_S = 0.05;
// Let go, the turn loses its speed with this time constant (OrbitControls' default damping, 0.05 a frame at 60 fps, is
// 0.33 s): a gentle throw at 1 rad/s coasts 20° and stops in about 1.4 s.
const INERTIA_TAU_S = 0.35;
// A coast below this speed stops (about a degree a second), and so does a view this close behind its goal.
const REST_RAD_S = 0.02;
// Any real flick on a trackpad or a mouse is faster than this, so this sets the longest coast: 80°, enough to show a
// side of the set.
const MAX_TURN_RAD_S = 4;
// A coast eases to rest by the side walls' edge, this far either side of the wide view, so a throw never carries the
// visitor round behind the walls (T98: one flick turned the set 209°). A drag goes on anywhere: the owner's 360°.
const COAST_EDGE_RAD = THREE.MathUtils.degToRad(95);
// The speed a drag hands to the inertia: an average over its last few moves, forgotten if the pointer rested.
const VELOCITY_WINDOW_MS = 80;
// The radius follows its goal this fast (in log space, so every step in or out takes the same time); the pivot too.
const ZOOM_TAU_S = 0.14;
const PIVOT_TAU_S = 0.35;
// Past a limit the view gives at most this much (6° of tilt, 10 % of the distance), and springs back this fast.
const POLAR_GIVE_RAD = THREE.MathUtils.degToRad(6);
const ZOOM_GIVE = Math.log(1.1);
const BACK_TAU_S = 0.12;
// A coast that runs past a tilt limit loses its speed this fast there: it overshoots a little, then springs back.
const WALL_TAU_S = 0.04;
// The wheel has no end event: this long after its last event, a zoom held past a limit springs back.
const ZOOM_SETTLE_S = 0.12;
// One notch of a mouse wheel (100 px in Chromium, 3 lines in Firefox) moves the camera about 12 % in or out.
const ZOOM_PER_PX = 0.0012;
// The motion is stepped at least this finely, so a slow frame takes the same path as several fast ones.
const SUBSTEP_S = 1 / 120;

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

/** `angle` brought into (-π, π]: the short way round. */
export function wrapAngle(angle: number) {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}

/**
 * A range the value is held to: the limits, widened to include where the value started until it has come inside. Past
 * either end a value is pulled back on a rubber band that gives at most `give`.
 */
class SoftRange {
  constructor(
    private low: number,
    private high: number,
    private readonly limits: [number, number],
    private readonly give: number,
  ) {}

  static from(value: number, [min, max]: [number, number], give: number) {
    return new SoftRange(Math.min(min, value), Math.max(max, value), [min, max], give);
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

  /** The end `value` lies beyond, or null inside the range. */
  beyond(value: number) {
    return value > this.high ? this.high : value < this.low ? this.low : null;
  }

  /** Where a pull to `value` lands: itself inside, the rubber band's stretch beyond (at most `give` past the end). */
  band(value: number) {
    const end = this.beyond(value);
    if (end === null) return value;
    if (this.give <= 0) return end;
    const over = Math.abs(value - end);
    return end + Math.sign(value - end) * ((this.give * over) / (over + this.give));
  }

  /** The pull that stretches the band to `value` (band's inverse). */
  unband(value: number) {
    const end = this.beyond(value);
    if (end === null || this.give <= 0) return this.band(value);
    const stretch = Math.min(Math.abs(value - end), this.give * 0.999);
    return end + Math.sign(value - end) * ((this.give * stretch) / (this.give - stretch));
  }
}

/**
 * The orbit's state: where the camera stands about its pivot, and how it is moving. `step` advances it by `dt`
 * seconds; `still` (reduced motion) drops the follow, the inertia, the rubber band and the glides, so every input lands
 * at once and stops at the limits.
 */
export class Orbit {
  /** Where the view is (radians), and the goal it follows. */
  azimuth: number;
  polar: number;
  private azimuthGoal: number;
  private polarGoal: number;
  /** The goal's own speed (rad/s): the inertia after a drag, or a key's push. */
  private velocity = { azimuth: 0, polar: 0 };
  /** ln(radius) of the view, and of its goal. */
  private logRadius: number;
  private logRadiusGoal: number;
  private sinceZoom = Infinity;
  private zoomHeld = false;
  /** What the camera looks at and turns about: where it was looking, gliding to the centre once the visitor turns. */
  readonly pivot: THREE.Vector3;
  private readonly pivotGoal: THREE.Vector3;
  private readonly radii: SoftRange;
  private readonly polars: SoftRange;
  private dragging = false;
  private readonly moves: { at: number; azimuth: number; polar: number }[] = [];

  constructor(
    eye: THREE.Vector3,
    target: THREE.Vector3,
    private readonly settings: OrbitSettings,
    private readonly still: boolean,
  ) {
    const { azimuth, polar, radius } = toSpherical(eye.clone().sub(target));
    this.azimuth = this.azimuthGoal = azimuth;
    this.polar = this.polarGoal = polar;
    this.logRadius = this.logRadiusGoal = Math.log(Math.max(1e-6, radius));
    this.pivot = target.clone();
    this.pivotGoal = target.clone();
    const { minDist, maxDist, minPolar, maxPolar } = settings.limits;
    this.radii = SoftRange.from(this.logRadius, [Math.log(minDist), Math.log(maxDist)], still ? 0 : ZOOM_GIVE);
    this.polars = SoftRange.from(polar, [minPolar, maxPolar], still ? 0 : POLAR_GIVE_RAD);
  }

  get radius() {
    return Math.exp(this.logRadius);
  }

  /** The eye, into `out`. */
  eye(out = new THREE.Vector3()) {
    return fromSpherical(this.azimuth, this.polar, this.radius, out).add(this.pivot);
  }

  /** Whether the pivot has reached the orbit's centre (it goes there on the first turn). */
  get centred() {
    return this.pivotGoal.equals(this.settings.center);
  }

  /** How fast the view is turning now (radians a second): zero once it has come to rest. */
  get turning() {
    return Math.hypot(this.azimuthGoal - this.azimuth, this.polarGoal - this.polar) / FOLLOW_TAU_S;
  }

  /** Whether anything still moves: the turn (or a key's push the view has yet to follow), a rubber band springing back, the zoom or the pivot. */
  get settling() {
    return (
      this.turning > 0 ||
      this.velocity.azimuth !== 0 ||
      this.velocity.polar !== 0 ||
      this.polars.beyond(this.polarGoal) !== null ||
      this.radii.beyond(this.logRadiusGoal) !== null ||
      this.logRadius !== this.logRadiusGoal ||
      !this.pivot.equals(this.pivotGoal)
    );
  }

  /** The view's rates now: radians a second of azimuth and polar, and of ln(radius) (for a glide that takes over). */
  rates() {
    return {
      azimuth: (this.azimuthGoal - this.azimuth) / FOLLOW_TAU_S,
      polar: (this.polarGoal - this.polar) / FOLLOW_TAU_S,
      logRadius: (this.logRadiusGoal - this.logRadius) / ZOOM_TAU_S,
    };
  }

  /** The visitor turns the set: the pivot heads for the orbit's centre. */
  private centre() {
    if (this.centred) return;
    this.pivotGoal.copy(this.settings.center);
    if (this.still) this.movePivot(1);
  }

  /**
   * Moves the pivot `share` of the way to its goal. The eye keeps its place, so the view turns toward the centre rather
   * than sliding sideways, but never comes nearer the pivot than the distance limits allow. The goals move with the
   * view, so a turn or a zoom under way carries on.
   */
  private movePivot(share: number) {
    const eye = this.eye();
    this.pivot.lerp(this.pivotGoal, share);
    if (this.pivot.distanceToSquared(this.pivotGoal) < 1) this.pivot.copy(this.pivotGoal);
    const { azimuth, polar, radius } = toSpherical(eye.sub(this.pivot));
    const turned = wrapAngle(azimuth - this.azimuth);
    this.azimuth += turned;
    this.azimuthGoal += turned;
    this.polarGoal += polar - this.polar;
    // Only the pivot's own move widens the range: a view already out on the rubber band stays on it.
    if (this.polars.beyond(this.polar) === null) this.polars.include(polar);
    this.polar = polar;
    const logRadius = this.radii.clamp(Math.log(Math.max(1e-6, radius)));
    this.logRadiusGoal = this.radii.clamp(this.logRadiusGoal + logRadius - this.logRadius);
    this.logRadius = logRadius;
  }

  /** A drag of (dx, dy) CSS pixels on a stage `height` px tall: the set follows the pointer. */
  drag(dx: number, dy: number, height: number) {
    this.centre();
    this.dragging = true;
    this.velocity = { azimuth: 0, polar: 0 };
    const perPx = TURN_PER_STAGE_HEIGHT / Math.max(1, height);
    this.turnGoal(-dx * perPx, -dy * perPx);
    const now = performance.now();
    this.moves.push({ at: now, azimuth: -dx * perPx, polar: -dy * perPx });
    while (this.moves.length && now - this.moves[0].at > VELOCITY_WINDOW_MS) this.moves.shift();
  }

  /**
   * The drag ended: the turn carries on at the speed it had (none under reduced motion, or after a rest). The speed is
   * the pointer's over its last moves, never more than the view's own: the view then only slows from here.
   */
  release() {
    this.dragging = false;
    const now = performance.now();
    const recent = this.moves.filter((m) => now - m.at <= VELOCITY_WINDOW_MS);
    this.moves.length = 0;
    if (this.still || recent.length < 2) return;
    const span = Math.max(16, now - recent[0].at) / 1000;
    const sum = recent.reduce((a, m) => ({ azimuth: a.azimuth + m.azimuth, polar: a.polar + m.polar }), { azimuth: 0, polar: 0 });
    const { azimuth, polar } = this.rates();
    // The smaller of the two in size, in the pointer's direction (zero when the view lags the other way).
    const speed = (pointer: number, view: number) =>
      Math.sign(pointer) === Math.sign(view) ? Math.sign(pointer) * Math.min(Math.abs(pointer), Math.abs(view), MAX_TURN_RAD_S) : 0;
    this.velocity = { azimuth: this.toEdge(speed(sum.azimuth / span, azimuth)), polar: speed(sum.polar / span, polar) };
  }

  /**
   * The coast's speed held so it comes to rest by the side walls' edge: the goal coasts v·τ in all, so from inside the
   * edges it is cut to reach the edge and no further; past an edge (a drag took it there) it may only coast back in.
   */
  private toEdge(velocity: number) {
    const { front } = this.settings;
    if (front === undefined || velocity === 0) return velocity;
    const turned = wrapAngle(this.azimuthGoal - front);
    if (Math.abs(turned) > COAST_EDGE_RAD) return Math.sign(velocity) === Math.sign(turned) ? 0 : velocity;
    const rest = THREE.MathUtils.clamp(turned + velocity * INERTIA_TAU_S, -COAST_EDGE_RAD, COAST_EDGE_RAD);
    return (rest - turned) / INERTIA_TAU_S;
  }

  /** A press on the set: any coast stops where the view is. */
  hold() {
    this.velocity = { azimuth: 0, polar: 0 };
    this.azimuthGoal = this.azimuth;
    this.polarGoal = this.polar;
  }

  /** A key press: turn by these angles (radians), gliding there, or at once under reduced motion. */
  nudge(azimuth: number, polar: number) {
    this.centre();
    if (this.still) {
      this.turnGoal(azimuth, polar);
      return;
    }
    // A push the inertia spends: the camera ends up `angle` further on.
    this.velocity.azimuth = THREE.MathUtils.clamp(this.velocity.azimuth + azimuth / INERTIA_TAU_S, -MAX_TURN_RAD_S, MAX_TURN_RAD_S);
    this.velocity.polar = THREE.MathUtils.clamp(this.velocity.polar + polar / INERTIA_TAU_S, -MAX_TURN_RAD_S, MAX_TURN_RAD_S);
  }

  /** A sideways swipe on a trackpad (CSS pixels, as a drag): the set follows the fingers, with no coast of its own. */
  swipe(dx: number, dy: number, height: number) {
    this.centre();
    const perPx = TURN_PER_STAGE_HEIGHT / Math.max(1, height);
    this.turnGoal(-dx * perPx, -dy * perPx);
  }

  /** The wheel's deltaY in pixels, as the platform gives it: positive is away from the set. */
  zoom(deltaPx: number) {
    this.zoomBy(Math.exp(deltaPx * ZOOM_PER_PX));
  }

  /** Moves in (`factor` < 1) or out; past the limits the band gives a little. */
  zoomBy(factor: number) {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    this.logRadiusGoal = this.radii.band(this.radii.unband(this.logRadiusGoal) + Math.log(factor));
    this.sinceZoom = 0;
    if (this.still) this.logRadius = this.logRadiusGoal;
  }

  /** A pinch is under way (fingers still down): a zoom past a limit waits for them to lift before it springs back. */
  holdZoom(held: boolean) {
    this.zoomHeld = held;
    this.sinceZoom = 0;
  }

  /** Advances the follow, the inertia, the rubber bands and the glides by `dt` seconds. */
  step(dt: number) {
    if (this.still || dt <= 0) {
      this.settle();
      return;
    }
    const steps = Math.ceil(dt / SUBSTEP_S);
    for (let i = 0; i < steps; i++) this.substep(dt / steps);
  }

  /** Reduced motion, or no time passed: everything at its goal. */
  private settle() {
    this.azimuth = this.azimuthGoal;
    this.polar = this.polarGoal = this.polars.clamp(this.polarGoal);
    this.logRadius = this.logRadiusGoal = this.radii.clamp(this.logRadiusGoal);
    this.radii.admit(this.logRadius);
    this.polars.admit(this.polar);
    if (!this.pivot.equals(this.pivotGoal)) this.movePivot(1);
  }

  private substep(h: number) {
    const inertia = Math.exp(-h / INERTIA_TAU_S);
    const follow = Math.exp(-h / FOLLOW_TAU_S);
    // Azimuth: the goal coasts at a speed that decays exponentially and the view follows it, solved exactly over h, so
    // the view's speed after a let-go only ever falls, at any frame rate.
    {
      const v = this.velocity.azimuth;
      const gap = this.azimuthGoal - this.azimuth;
      const forced = (v * INERTIA_TAU_S * FOLLOW_TAU_S) / (INERTIA_TAU_S - FOLLOW_TAU_S);
      this.azimuthGoal += v * INERTIA_TAU_S * (1 - inertia);
      this.azimuth = this.azimuthGoal - (gap * follow + forced * (inertia - follow));
      this.velocity.azimuth = v * inertia;
    }
    // Polar: the same coast, on the rubber band past the limits; a coast into a limit dies there and springs back.
    {
      const pull = this.polars.unband(this.polarGoal) + this.velocity.polar * INERTIA_TAU_S * (1 - inertia);
      this.velocity.polar *= inertia;
      if (this.polars.beyond(pull) !== null) this.velocity.polar *= Math.exp(-h / WALL_TAU_S);
      this.polarGoal = this.polars.band(pull);
      const end = this.polars.beyond(this.polarGoal);
      if (end !== null && !this.dragging) this.polarGoal = this.springBack(this.polarGoal, end, h, 1e-5);
      this.polar = this.polarGoal + (this.polar - this.polarGoal) * follow;
      this.polars.admit(this.polar);
    }
    // Radius: in log space; a zoom left past a limit (no wheel for a moment, the fingers lifted) springs back.
    {
      this.sinceZoom += h;
      const end = this.radii.beyond(this.logRadiusGoal);
      if (end !== null && !this.zoomHeld && this.sinceZoom > ZOOM_SETTLE_S) this.logRadiusGoal = this.springBack(this.logRadiusGoal, end, h, 1e-5);
      this.logRadius = this.logRadiusGoal + (this.logRadius - this.logRadiusGoal) * Math.exp(-h / ZOOM_TAU_S);
      if (Math.abs(this.logRadius - this.logRadiusGoal) < 1e-6) this.logRadius = this.logRadiusGoal;
      this.radii.admit(this.logRadius);
    }
    if (!this.pivot.equals(this.pivotGoal)) this.movePivot(1 - Math.exp(-h / PIVOT_TAU_S));
    // At rest: a coast this slow stops, and a view this close to its goal lands on it.
    if (!this.dragging) {
      for (const axis of ['azimuth', 'polar'] as const) if (Math.abs(this.velocity[axis]) < REST_RAD_S) this.velocity[axis] = 0;
      if (this.velocity.azimuth === 0 && this.velocity.polar === 0 && this.turning < REST_RAD_S && this.polars.beyond(this.polarGoal) === null) {
        this.azimuth = this.azimuthGoal;
        this.polar = this.polarGoal;
      }
    }
  }

  private springBack(value: number, end: number, h: number, snap: number) {
    const next = end + (value - end) * Math.exp(-h / BACK_TAU_S);
    return Math.abs(next - end) < snap ? end : next;
  }

  /** Moves the goal by these angles: the polar one on the rubber band past the limits. */
  private turnGoal(azimuth: number, polar: number) {
    this.azimuthGoal += azimuth;
    this.polarGoal = this.polars.band(this.polars.unband(this.polarGoal) + polar);
    if (this.still) {
      this.azimuth = this.azimuthGoal;
      this.polar = this.polarGoal;
      this.polars.admit(this.polar);
    }
  }
}
