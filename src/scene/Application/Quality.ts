export interface QualityTier {
  /** Multiplier on the capped device pixel ratio. */
  resolution: number;
  film: boolean;
  motes: number;
  halos: boolean;
}

export interface QualityLadder {
  /** Highest first. The renderer starts at the top and steps down until frames hold 50 fps. */
  tiers: readonly QualityTier[];
  /** Cap on the device pixel ratio that each tier's resolution multiplies. */
  dprCap: number;
}

export const FULL: QualityLadder = {
  tiers: [
    { resolution: 1, film: true, motes: 600, halos: true },
    { resolution: 0.8, film: true, motes: 360, halos: true },
    { resolution: 0.62, film: true, motes: 200, halos: true },
    { resolution: 0.5, film: true, motes: 120, halos: false },
    { resolution: 0.4, film: false, motes: 60, halos: false },
  ],
  dprCap: 1.5,
};

/** Phones and small windows: one CSS pixel per pixel at most, a little dust, no halos. */
export const LIGHT: QualityLadder = {
  tiers: [
    { resolution: 1, film: true, motes: 120, halos: false },
    { resolution: 0.8, film: true, motes: 60, halos: false },
    { resolution: 0.62, film: false, motes: 30, halos: false },
  ],
  dprCap: 1,
};

const TARGET_FPS = 50;
const WINDOW_MS = 1000;

/**
 * Adaptive quality: each second, if the median frame rate of that second is under 50 fps, drop one tier. It never
 * climbs back, so the level settles instead of oscillating; the first second after a change only warms up.
 */
export class Quality {
  index = 0;
  private samples: number[] = [];
  private windowStart = 0;
  private warmingUp = true;

  constructor(
    readonly ladder: QualityLadder,
    private readonly onChange: (tier: QualityTier, index: number) => void,
  ) {}

  get tier() {
    return this.ladder.tiers[this.index];
  }

  /** Forget the current window after a pause, a resize or a hidden tab, so stale frames do not count. */
  reset(now: number) {
    this.samples = [];
    this.windowStart = now;
    this.warmingUp = true;
  }

  sample(now: number, frameMs: number) {
    if (!this.windowStart) this.reset(now);
    // A gap this long is a stall (shader compile, tab switch, GC), not the renderer's speed.
    if (frameMs > 250) return;
    this.samples.push(frameMs);
    if (now - this.windowStart < WINDOW_MS) return;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const fps = 1000 / sorted[Math.floor(sorted.length / 2)];
    const warmingUp = this.warmingUp;
    this.reset(now);
    this.warmingUp = false;
    if (warmingUp || fps >= TARGET_FPS || this.index === this.ladder.tiers.length - 1) return;

    this.index += 1;
    this.warmingUp = true;
    this.onChange(this.tier, this.index);
  }
}
