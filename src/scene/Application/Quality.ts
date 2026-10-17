export interface QualityTier {
  /** Multiplier on the capped device pixel ratio. */
  resolution: number;
  /** MSAA samples on the room's render target (0 = none). */
  msaa: number;
  /**
   * The finishing pass: the tone curve and warm grade (off on every tier: the bake is already Blender's AgX render, and
   * a second curve on it is a double tone map), bloom on the practical lights, the vignette (`film`).
   */
  grade: boolean;
  bloom: boolean;
  film: boolean;
  motes: number;
  halos: boolean;
  /** Live shine on gloss-tagged surfaces (T79 reads it): on wherever the machine has headroom. */
  shine: boolean;
}

export interface QualityLadder {
  /** Highest first. The renderer starts at the top and steps down until frames hold 50 fps. */
  tiers: readonly QualityTier[];
  /** Cap on the device pixel ratio that each tier's resolution multiplies. */
  dprCap: number;
}

export const FULL: QualityLadder = {
  tiers: [
    { resolution: 1, msaa: 4, grade: false, bloom: true, film: true, motes: 600, halos: true, shine: true },
    { resolution: 0.8, msaa: 4, grade: false, bloom: true, film: true, motes: 360, halos: true, shine: true },
    { resolution: 0.62, msaa: 4, grade: false, bloom: true, film: true, motes: 200, halos: true, shine: true },
    { resolution: 0.5, msaa: 4, grade: false, bloom: false, film: true, motes: 120, halos: false, shine: true },
    { resolution: 0.4, msaa: 0, grade: false, bloom: false, film: false, motes: 60, halos: false, shine: false },
    // At the DPR cap of 2 this is the old bottom tier's 0.6 device pixels per CSS pixel.
    { resolution: 0.3, msaa: 0, grade: false, bloom: false, film: false, motes: 60, halos: false, shine: false },
  ],
  dprCap: 2,
};

/** Phones and small windows: one CSS pixel per pixel at most, a little dust, no halos, the grade without bloom or vignette. */
export const LIGHT: QualityLadder = {
  tiers: [
    { resolution: 1, msaa: 4, grade: false, bloom: false, film: false, motes: 120, halos: false, shine: true },
    { resolution: 0.8, msaa: 4, grade: false, bloom: false, film: false, motes: 60, halos: false, shine: true },
    { resolution: 0.62, msaa: 0, grade: false, bloom: false, film: false, motes: 30, halos: false, shine: false },
  ],
  dprCap: 1,
};

declare global {
  interface Window {
    /** Pins the quality tier before the page loads (screenshots and captures). */
    __roomTier?: number;
  }
}

const TARGET_FPS = 50;
const STALL_MS = 250;
// This many long frames in a row are the machine's speed, not a stall.
const SLOW_RUN = 3;
// Half a second per window: the arrival glides for under five, none of them at a tier the machine cannot hold.
const WINDOW_MS = 500;

/**
 * Adaptive quality: each half second, if the median frame rate of that window is under 50 fps, drop to the tier the
 * rate calls for (fill cost goes with the pixel count, so the resolution scales with the square root of the shortfall),
 * at least one. It never climbs back, so the level settles instead of oscillating; the first window after a change
 * only warms up.
 */
export class Quality {
  index = 0;
  private samples: number[] = [];
  private windowStart = 0;
  private warmingUp = true;
  private longFrames = 0;
  /** Screenshot runs set `window.__roomTier` before the page loads, so every shot is drawn at the same tier. */
  private readonly pinned: boolean;

  constructor(
    readonly ladder: QualityLadder,
    private readonly onChange: (tier: QualityTier, index: number) => void,
  ) {
    const pin = (globalThis as { __roomTier?: number }).__roomTier;
    this.pinned = typeof pin === 'number' && pin >= 0 && pin < ladder.tiers.length;
    if (this.pinned) this.index = pin as number;
  }

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
    if (this.pinned) return;
    if (!this.windowStart) this.reset(now);
    // A lone gap this long is a stall (shader compile, tab switch, GC), not the renderer's speed.
    this.longFrames = frameMs > STALL_MS ? this.longFrames + 1 : 0;
    if (this.longFrames > 0 && this.longFrames < SLOW_RUN) return;
    this.samples.push(frameMs);
    if (now - this.windowStart < WINDOW_MS) return;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const fps = 1000 / sorted[Math.floor(sorted.length / 2)];
    const warmingUp = this.warmingUp;
    this.reset(now);
    this.warmingUp = false;
    if (warmingUp || fps >= TARGET_FPS || this.index === this.ladder.tiers.length - 1) return;

    const wanted = this.tier.resolution * Math.sqrt(fps / TARGET_FPS);
    const fits = this.ladder.tiers.findIndex((tier, i) => i > this.index && tier.resolution <= wanted);
    this.index = fits < 0 ? this.ladder.tiers.length - 1 : Math.max(this.index + 1, fits);
    this.warmingUp = true;
    this.onChange(this.tier, this.index);
  }
}
