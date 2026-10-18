import * as THREE from 'three';
import type { Framing, RoomNodes, StationName } from '../Application/RoomModel';
import { WORLD_SCALE } from '../Application/RoomModel';
import { brakedTime, fromGlidePose, glidePose, glideRate, glideTime, planGlide, toGlidePose, type GlidePlan, type RoomPlan } from './glide';
import { fromSpherical, Orbit, readOrbit, toSpherical, wrapAngle, type OrbitSettings } from './orbit';
import { Spring, springFor, type SpringSettings } from './spring';

/** A framing fitted to one object (a click flies to the object first), named after the object's proxy box. */
export type ObjectStation = `object:${string}`;
/** Anywhere the camera can fly to and rest: the room's framings and the objects' own. */
export type Station = StationName | ObjectStation;
/** Where the camera is: a framing, the boot framing, or turned freely about the set (the orbit). */
export type CameraPhase = 'loading' | 'orbit' | Station;

/** How a move feels: each is a spring tuned to land in about the time named. */
export const MOTIONS = {
  /** Arrow keys, scroll, a clicked prop: a little overshoot, then it settles. */
  step: springFor(1.1, 0.78),
  /** Into the glass, where an overshoot would push through the screen. */
  monitor: springFor(2),
  /** The skip link: straight in. */
  fast: springFor(1.2),
  /** A stop picked on the map, or the played tour: across the room, so slower and without overshoot. */
  travel: springFor(1.8),
} satisfies Record<string, SpringSettings>;
export type Motion = keyof typeof MOTIONS;

/** The played tour's glide (glide.ts), timed by the clock; a brake slows it to rest where it is. */
interface Glide {
  plan: GlidePlan;
  /** The stop each of the plan's inner poses frames. */
  stations: StationName[];
  /** performance.now() when it began, and of the last frame. */
  began: number;
  last: number;
  /** Path seconds now. */
  time: number;
  brake: { at: number; time: number; rate: number } | null;
}

/** Where a braked glide came to rest: the stop it was nearest on the way, and the pose it rests in. */
interface Held {
  station: Station;
  pose: Float64Array;
}

/**
 * Home from the orbit: a spring over where the camera stands about the set (azimuth, polar, ln radius, the pivot's xyz,
 * the field of view), so it swings round the set to the wide view instead of cutting through it.
 */
interface HomeSwing {
  spring: Spring;
  goal: Float64Array;
}

interface Flight {
  to: Station;
  spring: SpringSettings;
  glide?: Glide;
  home?: HomeSwing;
  onDone?: () => void;
  /** How far back from its framing the camera stands at `to`, as a multiple of the framing's distance. */
  distance: number;
}

/** How long the glide home takes for this much travel of the eye (metres) and turn of the view (radians). */
export function homeSeconds(travelM: number, turnRad: number) {
  const { base, perMetre, perRadian, min, max } = HOME_SECONDS;
  return THREE.MathUtils.clamp(base + travelM * perMetre + turnRad * perRadian, min, max);
}

// ±8°: the Blender room fills the 16:10 idle framing, so Henry's ±12.6° pushed the posters and the window out of view.
const IDLE_SWAY_RAD = 0.14;
const IDLE_PERIOD_S = 80;
const MONITOR_MARGIN = 1.3;
// Henry's framings were tuned for a 16:10 window; taller windows step back so the desk stays in frame.
const REFERENCE_ASPECT = 900 / 1440;
// Free look: the pointer turns the view a little at a framing (a drag turns the whole set: the orbit).
const POINTER_LOOK = { yaw: 0.06, pitch: 0.035 };
// Room v3's wide view stands about 8.5 m back, so its props are small on screen: the full lean slid the mango plant
// 55 px from under a still pointer onto the window behind it. There the lean (and the eye's slide with it) is gentler.
const WIDE_LEAN = 0.4;
// Turned about the set and left alone this long, the camera starts the wide view's slow sway again.
const ORBIT_REST_S = 4;
// The eye also slides a little with the pointer (Henry's desk parallax), as a share of the distance to what it looks at.
const POINTER_SHIFT = { x: 0.03, y: 0.02 };
const LOOK_SPRING = springFor(0.45);
const SWAY_IN = springFor(5);
const SWAY_OUT = springFor(1.2);
// Steady enough for a card beside an object: the sway's last trace and the lean's speed below what a pixel would show.
const STEADY = { sway: 1e-4, leanRadS: 1e-4 };
// Home takes longer the further it has to go: a base, plus time per metre the eye travels and per radian the view turns.
// From the monitor (8.4 m back) it is about 1.8 s, from behind the set (half a turn round) 2.4 s, from nearby 0.9 s.
const HOME_SECONDS = { base: 0.7, perMetre: 0.12, perRadian: 0.3, min: 0.9, max: 2.4 };
// A flight has landed once it is this close (a share of the viewing distance, at least half a millimetre).
const LAND_SHARE = 0.0025;
const FOV_TOLERANCE_DEG = 0.05;
// A home swing has landed once its angles (radians, and ln radius) are this close, as a flight does (LAND_SHARE of
// the distance: under 2 cm at the wide view's 7.3 m), and its pivot within 2 mm.
const SWING_LAND = { angle: LAND_SHARE, pivot: 2 };

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
  private readonly objects = new Map<ObjectStation, Framing>();
  private readonly monitorCenter: THREE.Vector3;
  private readonly monitorNormal: THREE.Vector3;
  private readonly monitorSize: { width: number; height: number };
  // position xyz, target xyz, fov
  private readonly rig = new Spring(7);
  private readonly goal = new Float64Array(7);
  // pointer yaw, pointer pitch
  private readonly look = new Spring(2);
  private readonly lookGoal = new Float64Array(2);
  /** How much of the idle sway applies: it fades in slowly on the wide view and out faster when the camera leaves. */
  private readonly swayWeight = new Spring(1);
  private clock = 0;
  private readonly pointer = new THREE.Vector2();
  private readonly position = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private aspect = 1;
  /** The distance multiple of the framing the camera rests at (a tour stop may stand further back than its node). */
  private restDistance = 1;
  /** A pose between framings, where a braked glide came to rest; any flight replaces it. */
  private held: Held | null = null;
  readonly orbitSettings: OrbitSettings;
  /** The visitor turning and zooming the set; null at a framing or in flight. */
  private orbit: Orbit | null = null;
  /** Seconds since the visitor last turned or zoomed the set. */
  private orbitRest = 0;

  constructor(
    nodes: RoomNodes,
    aspect: number,
    /** Reduced motion: no inertia, no glides, no sway and no lean (each move lands at once). */
    private readonly still = false,
  ) {
    const orbit = readOrbit(nodes.root);
    this.orbitSettings = { ...orbit, front: toSpherical(nodes.framings.idle.position.clone().sub(orbit.center)).azimuth };
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
    return this.flight !== null || (this.orbit !== null && this.orbit.settling);
  }

  /** Whether the view holds quite still: not moving, the wide view's sway faded out and the pointer's lean at rest. */
  get steady() {
    const [yaw, pitch] = this.look.velocity;
    return !this.moving && this.swayWeight.value[0] < STEADY.sway && Math.hypot(yaw, pitch) < STEADY.leanRadS;
  }

  /** The station the camera is at or flying to ('orbit' while the visitor turns the set). */
  get destination(): CameraPhase {
    return this.flight?.to ?? this.phase;
  }

  /** Whether the room has this framing (window, projector, shelf and photos are optional), or the object one. */
  has(station: Station) {
    return station === 'monitor' || Boolean(this.framingOf(station));
  }

  /** Keeps a framing fitted to an object, flown to as `object:<name>`; refitted each time (the window may have resized). */
  frameObject(name: string, framing: Framing): ObjectStation {
    const station: ObjectStation = `object:${name}`;
    this.objects.set(station, framing);
    return station;
  }

  private framingOf(station: Station): Framing | undefined {
    return station.startsWith('object:') ? this.objects.get(station as ObjectStation) : this.framings[station as StationName];
  }

  resize(aspect: number) {
    this.aspect = aspect;
    this.instance.aspect = aspect;
    this.instance.updateProjectionMatrix();
  }

  /**
   * Flies to a station on a spring; `cut` jumps there (reduced motion, a skipped intro). `distance` stands the camera
   * that many times further from what the framing looks at, along the framing's own line. False if the room lacks it.
   */
  fly(station: Station, motion: Motion, onDone?: () => void, cut = false, distance = 1): boolean {
    if (!this.has(station)) return false;
    this.orbit = null;
    const wasHeld = this.held !== null;
    this.held = null;
    if (cut) {
      this.flight = { to: station, spring: MOTIONS[motion], onDone, distance };
      this.finish();
      return true;
    }
    if (!this.flight && !wasHeld && this.phase === station && this.restDistance === distance) {
      onDone?.();
      return true;
    }
    // Re-aiming keeps the rig's velocity, so a change of mind curves instead of stopping and starting again.
    this.flight = { to: station, spring: MOTIONS[motion], onDone, distance };
    return true;
  }

  /**
   * One continuous glide from wherever the camera is through `stops` (each framing stood `distance` times its own
   * distance back) to `end`, `seconds` long by the clock: slow out, an even pace past every stop with no pause at any, a
   * gentle landing. With the room's plan, the head times each turn to keep the view on the room. A later `fly` re-aims
   * from it with its speed; `brake` slows it to rest where it is.
   */
  glide(stops: readonly { station: StationName; distance: number }[], end: StationName, seconds: number, onDone?: () => void, room?: RoomPlan) {
    const framed = stops.filter((s) => s.station !== 'monitor' && this.has(s.station));
    if (!this.has(end) || !framed.length) return false;
    this.orbit = null;
    this.held = null;
    const fit = this.aspectFit();
    const pose = ({ position, target, fov }: { position: THREE.Vector3; target: THREE.Vector3; fov: number }) => toGlidePose(position, target, fov);
    const v = this.rig.value;
    const poses = [
      toGlidePose({ x: v[0], y: v[1], z: v[2] }, { x: v[3], y: v[4], z: v[5] }, v[6]),
      ...framed.map((s) => pose(this.fromFraming(this.framings[s.station]!, fit * s.distance))),
      pose(end === 'monitor' ? this.monitorPose() : this.fromFraming(this.framings[end] ?? this.framings.idle, fit)),
    ];
    const now = performance.now();
    const plan = planGlide(poses, seconds, room, WORLD_SCALE);
    const glide: Glide = { plan, stations: framed.map((s) => s.station), began: now, last: now, time: 0, brake: null };
    this.flight = { to: end, spring: MOTIONS.travel, onDone, distance: 1, glide };
    return true;
  }

  /**
   * Glides home to the wide view from wherever the camera is, in a time that grows with the way it has to go. Turned
   * about the set, it swings round the set to the front (a straight line from behind would cut through the walls and
   * the desk); from a framing, a flight or the tour's glide it flies straight back, keeping the speed it had. A turn
   * under way hands its speed on, so nothing stops dead. `cut` (reduced motion) jumps there.
   */
  home(onDone?: () => void, cut = false) {
    if (cut || this.still) return this.fly('idle', 'step', onDone, true);
    const end = this.fromFraming(this.framings.idle, this.aspectFit());
    const orbit = this.orbit;
    if (!orbit) {
      const v = this.rig.value;
      const eye = new THREE.Vector3(v[0], v[1], v[2]);
      const look = new THREE.Vector3(v[3], v[4], v[5]).sub(eye).normalize();
      const turn = look.angleTo(end.target.clone().sub(end.position).normalize());
      const seconds = homeSeconds(eye.distanceTo(end.position) / WORLD_SCALE, turn);
      if (!this.fly('idle', 'travel', onDone)) return false;
      if (this.flight) this.flight.spring = springFor(seconds);
      return true;
    }
    const to = toSpherical(end.position.clone().sub(end.target));
    const azimuth = orbit.azimuth + wrapAngle(to.azimuth - orbit.azimuth);
    const start = [orbit.azimuth, orbit.polar, Math.log(orbit.radius), orbit.pivot.x, orbit.pivot.y, orbit.pivot.z, this.rig.value[6]];
    const goal = Float64Array.from([azimuth, to.polar, Math.log(to.radius), end.target.x, end.target.y, end.target.z, end.fov]);
    // The eye's way round (an arc at the mean radius, the tilt, the change of distance, the pivot's slide) and its turn.
    const meanRadius = (orbit.radius + to.radius) / 2;
    const arc = Math.abs(goal[0] - start[0]) * Math.sin(Math.max(start[1], goal[1])) * meanRadius + Math.abs(goal[1] - start[1]) * meanRadius;
    const travel = arc + Math.abs(to.radius - orbit.radius) + orbit.pivot.distanceTo(end.target);
    const settings = springFor(homeSeconds(travel / WORLD_SCALE, Math.abs(goal[0] - start[0])));
    const spring = new Spring(7);
    spring.set(start);
    // The turn's own speed carries on into the swing, never so fast toward home that it would overshoot.
    const rates = orbit.rates();
    [rates.azimuth, rates.polar, rates.logRadius].forEach((rate, i) => {
      const toward = goal[i] - start[i];
      spring.velocity[i] = Math.sign(rate) === Math.sign(toward) ? Math.sign(rate) * Math.min(Math.abs(rate), Math.abs(toward) * settings.omega) : rate;
    });
    this.orbit = null;
    this.held = null;
    this.flight = { to: 'idle', spring: settings, onDone, distance: 1, home: { spring, goal } };
    return true;
  }

  /** A press on the set while it coasts: the coast stops where it is (flights and glides carry on). */
  stopCoast() {
    this.orbit?.hold();
  }

  /** A pinch has ended (Safari's gestureend): a zoom left past a limit may spring back now. */
  holdZoom(held: boolean) {
    this.orbit?.holdZoom(held);
  }

  /** Slows the glide to rest where it is, over about a second; false when no glide is cruising. */
  brake() {
    const glide = this.flight?.glide;
    if (!glide || glide.brake) return false;
    const now = performance.now();
    glide.brake = { at: now, time: glide.time, rate: glideRate(glide.plan, (now - glide.began) / 1000) };
    return true;
  }

  /** The glide's progress, for the map: path seconds now and at each stop and the end, and whether it is braking. */
  get glideState() {
    const glide = this.flight?.glide;
    if (!glide) return null;
    const { marks, duration } = glide.plan;
    return { time: glide.time, stops: marks.slice(1, -1), end: duration, braking: glide.brake !== null };
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

  /**
   * Hands the camera to the visitor, turned about the set from exactly where it is seen now (a flight, a framing, the
   * monitor): the sway and the pointer's lean are folded into the pose, so nothing jumps. A no-op while orbiting.
   */
  startOrbit(): Orbit {
    if (this.orbit) return this.orbit;
    const eye = this.instance.position.clone();
    const v = this.rig.value;
    const distance = Math.hypot(v[0] - v[3], v[1] - v[4], v[2] - v[5]);
    const target = eye.clone().addScaledVector(this.instance.getWorldDirection(new THREE.Vector3()), distance);
    this.rig.set([eye.x, eye.y, eye.z, target.x, target.y, target.z, this.instance.fov]);
    this.look.set([0, 0]);
    this.swayWeight.set([0]);
    this.flight = null;
    this.held = null;
    this.phase = 'orbit';
    this.restDistance = 1;
    this.orbitRest = 0;
    this.orbit = new Orbit(eye, target, this.orbitSettings, this.still);
    return this.orbit;
  }

  /** The visitor turned or zoomed the set (the orbit's own methods move it; this restarts the rest before the sway). */
  touchOrbit() {
    this.orbitRest = 0;
  }

  /** Where the camera stands about the set while orbiting, for tests and the map; null at a framing. */
  get orbitState() {
    const orbit = this.orbit;
    if (!orbit) return null;
    return {
      azimuth: orbit.azimuth,
      polar: orbit.polar,
      radius: orbit.radius,
      centred: orbit.centred,
      turning: orbit.turning,
    };
  }

  /** The point the camera looks at, before the free look turns it (world units). */
  get lookAt() {
    const v = this.rig.value;
    return new THREE.Vector3(v[3], v[4], v[5]);
  }

  /** How far the view is turned from its framing (radians), for tests and measurements. */
  get lookAngles() {
    const [pointerYaw, pointerPitch] = this.look.value;
    return { yaw: pointerYaw, pitch: pointerPitch };
  }

  /** `pointer` is in [-1, 1] on both axes, +y up; `clock` is the ambient time in seconds (frozen while paused). */
  update(dt: number, clock: number, pointer: THREE.Vector2) {
    const station = this.destination;
    this.clock = clock;
    this.writeGoal(station);
    if (this.orbit) {
      this.followOrbit(this.orbit, dt);
    } else if (this.flight?.home) {
      this.followHome(this.flight.home, this.flight.spring, dt);
    } else if (this.flight?.glide) {
      this.followGlide(this.flight.glide);
    } else if (this.flight) {
      this.rig.step(this.goal, dt, this.flight.spring);
      const { offset, speed } = this.rig.distance(this.goal);
      const viewDistance = Math.hypot(this.goal[0] - this.goal[3], this.goal[1] - this.goal[4], this.goal[2] - this.goal[5]);
      const tolerance = Math.max(0.5, viewDistance * LAND_SHARE);
      if (offset < tolerance && speed < tolerance * 3 && Math.abs(this.rig.value[6] - this.goal[6]) < FOV_TOLERANCE_DEG) this.land();
    } else {
      this.rig.set(this.goal);
    }

    // The pointer leans the view at a framing; never under reduced motion, nor at the monitor, in the boot framing or
    // while orbiting (nor where a card shows: the room passes no pointer then).
    if (this.still || station === 'monitor' || station === 'loading' || station === 'orbit') this.pointer.set(0, 0);
    else this.pointer.copy(pointer);
    const lean = station === 'idle' ? WIDE_LEAN : 1;
    this.lookGoal[0] = -this.pointer.x * POINTER_LOOK.yaw * lean;
    this.lookGoal[1] = this.pointer.y * POINTER_LOOK.pitch * lean;
    this.look.step(this.lookGoal, dt, LOOK_SPRING);
    // The wide view sways by itself; so does the orbit once the visitor has left it alone a while.
    this.orbitRest += dt;
    const swayOn = !this.still && (station === 'idle' || (station === 'orbit' && this.orbitRest > ORBIT_REST_S && this.orbit?.settling === false));
    this.swayWeight.step([swayOn ? 1 : 0], dt, swayOn ? SWAY_IN : SWAY_OUT);
    this.apply();
  }

  /** One frame of the orbit: its inertia and glides, written into the rig with their speed (a fly re-aims from it). */
  private followOrbit(orbit: Orbit, dt: number) {
    orbit.step(dt);
    const eye = orbit.eye(this.position);
    const next = [eye.x, eye.y, eye.z, orbit.pivot.x, orbit.pivot.y, orbit.pivot.z, this.rig.value[6]];
    for (let i = 0; i < next.length; i++) {
      if (dt > 0) this.rig.velocity[i] = (next[i] - this.rig.value[i]) / dt;
      this.rig.value[i] = next[i];
    }
  }

  /** One frame of the swing home round the set; the rig keeps its speed, so a re-aim curves away from it. */
  private followHome(home: HomeSwing, settings: SpringSettings, dt: number) {
    home.spring.step(home.goal, dt, settings);
    const [azimuth, polar, logRadius, px, py, pz, fov] = home.spring.value;
    const eye = fromSpherical(azimuth, polar, Math.exp(logRadius), this.position).add(this.target.set(px, py, pz));
    const next = [eye.x, eye.y, eye.z, px, py, pz, fov];
    for (let i = 0; i < next.length; i++) {
      if (dt > 0) this.rig.velocity[i] = (next[i] - this.rig.value[i]) / dt;
      this.rig.value[i] = next[i];
    }
    const off = (i: number) => Math.abs(home.spring.value[i] - home.goal[i]);
    const slow = (i: number) => Math.abs(home.spring.velocity[i]);
    const angles = [0, 1, 2].every((i) => off(i) < SWING_LAND.angle && slow(i) < SWING_LAND.angle * 3);
    const pivot = [3, 4, 5].every((i) => off(i) < SWING_LAND.pivot && slow(i) < SWING_LAND.pivot * 3);
    if (angles && pivot && off(6) < FOV_TOLERANCE_DEG) {
      this.rig.set(this.goal);
      this.land();
    }
  }

  /** One frame along the glide; the rig's velocity is kept so a re-aim curves away from it instead of stopping. */
  private followGlide(glide: Glide) {
    const now = performance.now();
    const dt = (now - glide.last) / 1000;
    glide.last = now;
    const braked = glide.brake && brakedTime(glide.plan, glide.brake.time, glide.brake.rate, (now - glide.brake.at) / 1000);
    glide.time = braked ? braked.time : glideTime(glide.plan, (now - glide.began) / 1000);
    const { eye, target, fov } = fromGlidePose(glidePose(glide.plan, glide.time));
    const next = [...eye, ...target, fov];
    for (let i = 0; i < next.length; i++) {
      if (dt > 0) this.rig.velocity[i] = (next[i] - this.rig.value[i]) / dt;
      this.rig.value[i] = next[i];
    }
    if (glide.time >= glide.plan.duration) {
      this.rig.set(this.goal);
      this.land();
    } else if (braked?.done) this.rest(glide);
  }

  /** A braked glide has stopped: the camera rests where it is, at the stop it was nearest on the way. */
  private rest(glide: Glide) {
    const stops = glide.plan.marks.slice(1, -1);
    const nearest = stops.reduce((best, t, i) => (Math.abs(t - glide.time) < Math.abs(stops[best] - glide.time) ? i : best), 0);
    const station = glide.stations[nearest];
    this.rig.velocity.fill(0);
    this.flight = null;
    this.phase = station;
    this.restDistance = 1;
    this.held = { station, pose: Float64Array.from(this.rig.value) };
  }

  private land() {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    this.phase = flight.to;
    this.restDistance = flight.distance;
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
    const [pointerYaw, pointerPitch] = this.look.value;
    // The eye slides with the pointer, as in Henry's desk parallax.
    this.position
      .addScaledVector(right, (-pointerYaw / POINTER_LOOK.yaw) * POINTER_SHIFT.x * distance)
      .addScaledVector(up, (pointerPitch / POINTER_LOOK.pitch) * POINTER_SHIFT.y * distance);
    forward.applyAxisAngle(right, pointerPitch).applyAxisAngle(UP, pointerYaw);

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
    if (!this.flight && this.held?.station === phase) {
      this.goal.set(this.held.pose);
      return;
    }
    // The orbit has no framing: the rig follows the orbit itself.
    if (phase === 'orbit') {
      this.goal.set(this.rig.value);
      return;
    }
    if (phase === 'monitor') ({ position, target, fov } = this.monitorPose());
    else if (phase.startsWith('object:')) {
      // Fitted to the window's shape already, when it was made.
      const framing = this.objects.get(phase as ObjectStation) ?? this.framings.idle;
      ({ position, target, fov } = this.fromFraming(framing, this.distanceAt(phase)));
    } else if (phase === 'loading') {
      // The arrival starts from the wide view, which fills the frame with the room: from the boot framing, 14 m out,
      // the set floated as a small box in black.
      ({ position, target, fov } = this.fromFraming(this.framings.idle, 1));
    } else {
      const framing = this.framings[phase as StationName] ?? this.framings.idle;
      ({ position, target, fov } = this.fromFraming(framing, this.aspectFit() * this.distanceAt(phase)));
    }
    this.goal[0] = position.x;
    this.goal[1] = position.y;
    this.goal[2] = position.z;
    this.goal[3] = target.x;
    this.goal[4] = target.y;
    this.goal[5] = target.z;
    this.goal[6] = fov;
  }

  private distanceAt(phase: CameraPhase) {
    if (this.flight) return phase === this.flight.to ? this.flight.distance : 1;
    return phase === this.phase ? this.restDistance : 1;
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
