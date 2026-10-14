// The played tour's glide (owner, round 8: "it should glide, like the guide in room v2"): one path through every
// stop's pose, with no pause at any. A pose is seven numbers: the eye's xyz, where it looks as a turn and a tilt with the
// distance to what it looks at, and the field of view. The path is a cubic Hermite spline through them with
// Catmull-Rom tangents over time, so speed and direction carry smoothly through each stop. The head turns rather than
// sliding its look-at point across (between two stops that face apart, the point passed under the eye and the view
// dropped to the floor), and it leads: on each leg it makes most of its turn while the eye covers the first stretch,
// as a person looks before walking (turning while walking, the view swung past the end of the right wall into the
// dark outside the set). Each leg takes time in proportion to the eye's travel and the head's turn, so the pace is
// even; a slow start and a gentle landing are the only changes of speed. Braked, it slows to rest over a second.

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
// Inside each leg, at this share of its time, the eye has covered the first share of its travel and the head the second
// of its turn.
const LEAD = { time: 0.4, eye: 0.35, head: 0.65 };
const EASE_S = 3;
const BRAKE_S = 1.2;

/** ∫₀ˣ smoothstep: the path covered while the pace eases from 0 to 1 over a unit of time. */
const easedIn = (x: number) => x * x * x - (x * x * x * x) / 2;
const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** A glide through `poses` (start, stops, end) that takes `seconds` by the clock, its ease included. */
export function planGlide(poses: readonly (readonly number[])[], seconds: number): GlidePlan {
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
  const scale = duration / legs.reduce((a, b) => a + b, 0);
  const marks = [0];
  for (const leg of legs) marks.push(marks[marks.length - 1] + leg * scale);
  marks[marks.length - 1] = duration;
  // The given poses with a leading one inside each leg: the eye a little way along, the head most of the way round.
  const through: Float64Array[] = [vectors[0]];
  const knots = [0];
  for (let i = 1; i < vectors.length; i++) {
    const [a, b] = [vectors[i - 1], vectors[i]];
    const lead = new Float64Array(POSE_SIZE);
    for (let c = 0; c < POSE_SIZE; c++) lead[c] = a[c] + (b[c] - a[c]) * (c < 3 ? LEAD.eye : LEAD.head);
    through.push(lead, b);
    knots.push(marks[i - 1] + (marks[i] - marks[i - 1]) * LEAD.time, marks[i]);
  }
  const last = through.length - 1;
  const tangents = through.map((_, i) => {
    const [a, b] = [Math.max(0, i - 1), Math.min(last, i + 1)];
    const m = new Float64Array(POSE_SIZE);
    for (let c = 0; c < POSE_SIZE; c++) m[c] = (through[b][c] - through[a][c]) / (knots[b] - knots[a]);
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
