// The played tour's glide (owner, round 8: "it should glide, like the guide in room v2"): one path through every
// stop's pose, with no pause at any. A pose is seven numbers: the eye's xyz, where it looks as a turn and a tilt with the
// distance to what it looks at, and the field of view. The path is a cubic Hermite spline through them with
// Catmull-Rom tangents over time, so speed and direction carry smoothly through each stop. The head turns rather than
// sliding its look-at point across (between two stops that face apart, the point passed under the eye and the view
// dropped to the floor). The room is a set with an open front and a right wall that stops short, so on each leg the
// head picks when to turn: ahead of the eye, as a person looks before walking, or after it, whichever keeps the middle
// of the view on the room's walls and floor (leaving the space wall it must turn first, or the view swings past the
// right wall's end into the dark; leaving the armchair it must wait until the eye is in from the open front). Each leg
// takes time in proportion to the eye's travel and the head's turn, so the pace is even; a slow start and a gentle
// landing are the only changes of speed. Braked, it slows to rest over a second.

/** The path's clock against the real one: a smooth ease at each end, an even pace between. */
export interface GlidePlan {
  /** The poses the spline passes through: the given ones, and one inside each leg where the head leads. */
  poses: Float64Array[];
  /** The rate of change of each pose number, per path second, at each pose. */
  tangents: Float64Array[];
  /** Path seconds at each of `poses`. */
  knots: number[];
  /** Path seconds at each given pose: the start, every stop, the end. */
  marks: number[];
  /** Path seconds from the start to the end. */
  duration: number;
  /** Real seconds of each end's ease. */
  ease: number;
}

const POSE_SIZE = 7;
// A radian of the head's turn or tilt takes as long as this many metres of the eye's travel.
const TURN_M_PER_RAD = 0.8;
// No leg is shorter than this share of an even split, so a stop beside the last one is still passed slowly.
const MIN_LEG_SHARE = 0.5;
// Inside each leg, at this share of its time, the eye has covered `eye` of its travel and the head `head` of its turn:
// the head leading (the default), keeping pace, or following, tried in this order.
const LEAD_TIME = 0.4;
const LEADS = [
  { eye: 0.35, head: 0.65 },
  { eye: 0.25, head: 0.85 },
  { eye: 0.4, head: 0.4 },
  { eye: 0.6, head: 0.2 },
  { eye: 0.75, head: 0.08 },
];
const LEG_SAMPLES = 24;

/** The room in plan (metres): the floor's outline and the walls, as public/room/floorplan.json gives them. */
export interface RoomPlan {
  outline: readonly (readonly [number, number])[];
  walls?: readonly (readonly (readonly [number, number])[])[];
}

/** Whether a line of sight from `eye` along `dir` (metres) meets a wall or the floor, not the dark outside the set. */
export function seesRoom(room: RoomPlan, eye: ArrayLike<number>, dir: ArrayLike<number>) {
  for (const [[x1, z1], [x2, z2]] of room.walls ?? []) {
    const [ex, ez] = [x2 - x1, z2 - z1];
    const den = dir[0] * ez - dir[2] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((x1 - eye[0]) * ez - (z1 - eye[2]) * ex) / den;
    const s = ((x1 - eye[0]) * dir[2] - (z1 - eye[2]) * dir[0]) / den;
    if (t > 0 && s >= 0 && s <= 1 && eye[1] + t * dir[1] >= 0) return true;
  }
  if (dir[1] >= 0) return false;
  const t = -eye[1] / dir[1];
  const [x, z] = [eye[0] + t * dir[0], eye[2] + t * dir[2]];
  const xs = room.outline.map(([px]) => px);
  const zs = room.outline.map(([, pz]) => pz);
  return x >= Math.min(...xs) && x <= Math.max(...xs) && z >= Math.min(...zs) && z <= Math.max(...zs);
}
const EASE_S = 3;
const BRAKE_S = 1.2;

/** ∫₀ˣ smoothstep: the path covered while the pace eases from 0 to 1 over a unit of time. */
const easedIn = (x: number) => x * x * x - (x * x * x * x) / 2;
const smoothstep = (x: number) => x * x * (3 - 2 * x);

/**
 * A glide through `poses` (start, stops, end) that takes `seconds` by the clock, its ease included. With `room` (and
 * `scale`, world units to its metres), each leg's head timing keeps the view on the room where it can.
 */
export function planGlide(poses: readonly (readonly number[])[], seconds: number, room?: RoomPlan, scale = 1): GlidePlan {
  if (poses.length < 2) throw new Error('a glide needs a start and an end');
  const vectors = poses.map((p) => Float64Array.from(p));
  const travel = vectors.slice(1).map((p, i) => {
    const q = vectors[i];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) + TURN_M_PER_RAD * Math.hypot(p[3] - q[3], p[4] - q[4]);
  });
  const ease = Math.min(EASE_S, seconds / 4);
  const duration = seconds - ease;
  const even = travel.reduce((a, b) => a + b, 0) / travel.length;
  const legs = travel.map((t) => Math.max(t, even * MIN_LEG_SHARE));
  const stretch = duration / legs.reduce((a, b) => a + b, 0);
  const marks = [0];
  for (const leg of legs) marks.push(marks[marks.length - 1] + leg * stretch);
  marks[marks.length - 1] = duration;
  // The given poses with one inside each leg where the head leads or follows the eye.
  const through: Float64Array[] = [vectors[0]];
  const knots = [0];
  for (let i = 1; i < vectors.length; i++) {
    const [a, b] = [vectors[i - 1], vectors[i]];
    const blend = (lead: (typeof LEADS)[number]) => a.map((v, c) => v + (b[c] - v) * (c < 3 ? lead.eye : lead.head));
    const misses = (lead: (typeof LEADS)[number]) => (room ? legMisses(room, scale, a, blend(lead), b) : 0);
    const best = LEADS.reduce((chosen, lead) => (misses(lead) < misses(chosen) ? lead : chosen));
    through.push(blend(best), b);
    knots.push(marks[i - 1] + (marks[i] - marks[i - 1]) * LEAD_TIME, marks[i]);
  }
  const last = through.length - 1;
  const slope = (i: number, c: number) => (through[i + 1][c] - through[i][c]) / (knots[i + 1] - knots[i]);
  const tangents = through.map((_, i) => {
    const m = new Float64Array(POSE_SIZE);
    if (i === 0 || i === last) {
      for (let c = 0; c < POSE_SIZE; c++) m[c] = slope(i === 0 ? 0 : last - 1, c);
      return m;
    }
    const [h0, h1] = [knots[i] - knots[i - 1], knots[i + 1] - knots[i]];
    for (let c = 0; c < POSE_SIZE; c++) {
      const [d0, d1] = [slope(i - 1, c), slope(i, c)];
      // The eye: Catmull-Rom, a smooth arc through the pose. The head: monotone (Fritsch-Carlson), so a turn never
      // overshoots or lingers ahead of a big turn on the next leg.
      if (c < 3) m[c] = (through[i + 1][c] - through[i - 1][c]) / (h0 + h1);
      else m[c] = d0 * d1 <= 0 ? 0 : (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
    }
    return m;
  });
  return { poses: through, tangents, knots, marks, duration, ease };
}

/** Path seconds `real` seconds after the glide began. */
export function glideTime(plan: GlidePlan, real: number) {
  const { ease, duration } = plan;
  const total = duration + ease;
  if (real <= 0) return 0;
  if (real < ease) return ease * easedIn(real / ease);
  if (real <= total - ease) return ease / 2 + (real - ease);
  if (real < total) return duration - ease * easedIn((total - real) / ease);
  return duration;
}

/** How fast the path's clock runs `real` seconds in (1 at the even pace). */
export function glideRate(plan: GlidePlan, real: number) {
  const total = plan.duration + plan.ease;
  if (real <= 0 || real >= total) return 0;
  return smoothstep(Math.min(1, real / plan.ease, (total - real) / plan.ease));
}

/** Braked at path second `from` while running at `rate`: the path second `since` real seconds later, and whether it has stopped. */
export function brakedTime(plan: GlidePlan, from: number, rate: number, since: number) {
  const x = Math.min(1, Math.max(0, since / BRAKE_S));
  return { time: Math.min(plan.duration, from + rate * BRAKE_S * (x - easedIn(x))), done: x >= 1 };
}

/** The pose at path second `time`, into `out`. */
export function glidePose(plan: GlidePlan, time: number, out = new Float64Array(POSE_SIZE)) {
  const { knots, poses, tangents } = plan;
  const t = Math.min(plan.duration, Math.max(0, time));
  let i = 0;
  while (i < knots.length - 2 && knots[i + 1] <= t) i++;
  const h = knots[i + 1] - knots[i];
  const u = h > 0 ? (t - knots[i]) / h : 1;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  for (let c = 0; c < POSE_SIZE; c++) {
    out[c] = h00 * poses[i][c] + h10 * h * tangents[i][c] + h01 * poses[i + 1][c] + h11 * h * tangents[i + 1][c];
  }
  return out;
}

/**
 * A camera pose as the glide's seven numbers. The turn is measured from the room's back wall (0 looks at it, +π/2 to
 * the right) and never wraps: the room is a set open toward +z, so every turn between two framings sweeps through the
 * room, never across its open front.
 */
export function toGlidePose(eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, fov: number) {
  const [dx, dy, dz] = [target.x - eye.x, target.y - eye.y, target.z - eye.z];
  const distance = Math.hypot(dx, dy, dz);
  return [eye.x, eye.y, eye.z, Math.atan2(dx, -dz), Math.asin(dy / distance), distance, fov];
}

/** The eye, the look-at point and the field of view of one of the glide's poses. */
export function fromGlidePose(pose: ArrayLike<number>) {
  const [x, y, z, turn, tilt, distance, fov] = Array.from(pose);
  const across = Math.cos(tilt) * distance;
  return { eye: [x, y, z], target: [x + Math.sin(turn) * across, y + Math.sin(tilt) * distance, z - Math.cos(turn) * across], fov };
}

/** How many views along a leg (straight through its middle pose) look out of the set. */
function legMisses(room: RoomPlan, scale: number, a: Float64Array, via: Float64Array, b: Float64Array) {
  let misses = 0;
  for (let k = 1; k < LEG_SAMPLES; k++) {
    const f = (k / LEG_SAMPLES - LEAD_TIME) / (k / LEG_SAMPLES < LEAD_TIME ? LEAD_TIME : 1 - LEAD_TIME);
    const [from, to, u] = f < 0 ? [a, via, f + 1] : [via, b, f];
    const pose = from.map((v, c) => v + (to[c] - v) * u);
    const { eye, target } = fromGlidePose(pose);
    const dir = target.map((v, c) => v - eye[c]);
    if (!seesRoom(room, eye.map((v) => v / scale), dir)) misses++;
  }
  return misses;
}
