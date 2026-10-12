// Damped springs for the camera: every move is a spring pulled toward its goal, so a glide can be redirected
// mid-flight without a jolt and lands with a slight settle instead of an eased stop.

export interface SpringSettings {
  /** Angular frequency (rad/s): how hard the spring pulls. */
  omega: number;
  /** Damping ratio: 1 lands without overshoot, below 1 overshoots a little and settles back. */
  zeta: number;
}

/**
 * Settings that land a move in about `seconds` (within 1% of the distance), whatever the distance.
 * Below zeta 1 the envelope e^(-zeta * omega * t) sets the time; at 1, (1 + omega t) e^(-omega t) does.
 */
export function springFor(seconds: number, zeta = 1): SpringSettings {
  const decay = zeta >= 1 ? 6.64 : 4.6 / zeta;
  return { omega: decay / Math.max(0.05, seconds), zeta: Math.min(1, zeta) };
}

/** Advances one component (value x, velocity v) toward `goal` by dt seconds, exactly for a constant goal. */
function stepComponent(x: number, v: number, goal: number, dt: number, { omega, zeta }: SpringSettings): [number, number] {
  const offset = x - goal;
  if (zeta >= 1) {
    const decay = Math.exp(-omega * dt);
    const c2 = v + omega * offset;
    return [goal + (offset + c2 * dt) * decay, (c2 - omega * (offset + c2 * dt)) * decay];
  }
  const damping = omega * zeta;
  const alpha = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-damping * dt);
  const cos = Math.cos(alpha * dt);
  const sin = Math.sin(alpha * dt);
  const c2 = (v + damping * offset) / alpha;
  return [
    goal + decay * (offset * cos + c2 * sin),
    -decay * ((offset * damping - c2 * alpha) * cos + (offset * alpha + c2 * damping) * sin),
  ];
}

/** A spring over N numbers (a position, a look-at point, a field of view) with one shared setting. */
export class Spring {
  readonly value: Float64Array;
  readonly velocity: Float64Array;

  constructor(size: number) {
    this.value = new Float64Array(size);
    this.velocity = new Float64Array(size);
  }

  step(goal: ArrayLike<number>, dt: number, settings: SpringSettings) {
    for (let i = 0; i < this.value.length; i++) {
      [this.value[i], this.velocity[i]] = stepComponent(this.value[i], this.velocity[i], goal[i], dt, settings);
    }
  }

  /** Jumps to `goal` and stops (a cut). */
  set(goal: ArrayLike<number>) {
    this.value.set(goal);
    this.velocity.fill(0);
  }

  /** Largest distance from `goal` over the components, and the largest speed. */
  distance(goal: ArrayLike<number>) {
    let offset = 0;
    let speed = 0;
    for (let i = 0; i < this.value.length; i++) {
      offset = Math.max(offset, Math.abs(this.value[i] - goal[i]));
      speed = Math.max(speed, Math.abs(this.velocity[i]));
    }
    return { offset, speed };
  }
}
