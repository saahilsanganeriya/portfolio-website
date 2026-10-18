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
  halos: boolean;
  /** Live shine on gloss-tagged surfaces (T79 reads it): on wherever the machine has headroom. */
  shine: boolean;
  /**
   * Anisotropic taps on every texture (or the GPU's maximum, if lower): the floor and the desk top are seen at grazing
   * angles. The top two tiers only: a machine below them is short of time, and a software GPU pays for the taps. The
   * top tier asks for 16, which every M-series GPU offers: closer to a 16-sample frame on grazing edges than 8 (T93).
   */
  anisotropy: number;
  /**
   * The output dither that keeps dark gradients from banding (T73b). Off on the tiers a machine reaches only under fps
   * pressure, where the pass it needs costs a frame interval on a software GPU; phones keep it on their top tier.
   */
  dither: boolean;
}

export interface QualityLadder {
  /** Highest first. The renderer starts at the top and steps down until frames hold 50 fps. */
  tiers: readonly QualityTier[];
  /** Cap on the device pixel ratio that each tier's resolution multiplies. */
  dprCap: number;
}

export const FULL: QualityLadder = {
  tiers: [
    { resolution: 1, msaa: 4, grade: false, bloom: true, film: true, halos: true, shine: true, anisotropy: 16, dither: true },
    { resolution: 0.8, msaa: 4, grade: false, bloom: true, film: true, halos: true, shine: true, anisotropy: 8, dither: true },
    { resolution: 0.62, msaa: 4, grade: false, bloom: true, film: true, halos: true, shine: true, anisotropy: 1, dither: true },
    { resolution: 0.5, msaa: 4, grade: false, bloom: false, film: true, halos: false, shine: true, anisotropy: 1, dither: true },
    { resolution: 0.4, msaa: 0, grade: false, bloom: false, film: false, halos: false, shine: false, anisotropy: 1, dither: false },
    // At the DPR cap of 2 this is the old bottom tier's 0.6 device pixels per CSS pixel.
    { resolution: 0.3, msaa: 0, grade: false, bloom: false, film: false, halos: false, shine: false, anisotropy: 1, dither: false },
    // 0.4 device pixels per CSS pixel: round 9's wide view does about a third more work than round 8's at 0.6
    // and fell to 30 fps on a software renderer; here it does less than round 8's did at 0.6 (T9H).
    { resolution: 0.2, msaa: 0, grade: false, bloom: false, film: false, halos: false, shine: false, anisotropy: 1, dither: false },
  ],
  dprCap: 2,
};

/** Phones and small windows: one CSS pixel per pixel at most, no halos, no bloom or vignette. */
export const LIGHT: QualityLadder = {
  tiers: [
    { resolution: 1, msaa: 4, grade: false, bloom: false, film: false, halos: false, shine: true, anisotropy: 8, dither: true },
    { resolution: 0.8, msaa: 4, grade: false, bloom: false, film: false, halos: false, shine: true, anisotropy: 8, dither: false },
    { resolution: 0.62, msaa: 0, grade: false, bloom: false, film: false, halos: false, shine: false, anisotropy: 1, dither: false },
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
// The arrival starts 0.4 s after the room has loaded, before a warm-up window and a measured one have passed: a machine
// whose first frames run under half the target decides after this many, so the glide does not start at the top tier.
const QUICK_FRAMES = 3;
// Before the room starts, a frame timed until the GPU has finished it is far too slow over twice the target's interval;
// one over CERTAIN_MS is the machine, not a stall (a garbage collection), so it is not looked at twice.
const FAR_TOO_SLOW_MS = 2000 / TARGET_FPS;
const CERTAIN_MS = 150;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * Adaptive quality: each half second, if the median frame rate of that window is under 50 fps, drop to the tier the
 * rate calls for (fill cost goes with the pixel count, so the resolution scales with the square root of the shortfall),
 * at least one. It never climbs back, so the level settles instead of oscillating; the first window after a change
 * only warms up, except at the start on a machine far too slow for the top tier (QUICK_FRAMES).
 */
export class Quality {
  index = 0;
  private samples: number[] = [];
  private windowStart = 0;
  private warmingUp = true;
  private longFrames = 0;
  /** A window has been measured (not only warmed up) since the room started. */
  private decided = false;
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
    const quick = !this.decided && this.samples.length >= QUICK_FRAMES && median(this.samples) > 2000 / TARGET_FPS;
    if (!quick && now - this.windowStart < WINDOW_MS) return;

    const fps = 1000 / median(this.samples);
    const warmingUp = this.warmingUp && !quick;
    this.reset(now);
    this.warmingUp = false;
    if (!warmingUp) this.decided = true;
    if (warmingUp || fps >= TARGET_FPS || this.atBottom) return;
    this.stepFor(fps);
  }

  /**
   * Picks the tier the arrival starts at, before anyone sees the room: the ladder only ever steps down, so it must not
   * start a machine at a tier it cannot hold. `first` is the room's first frame, timed until the GPU finished it (its
   * textures upload with it, so it can keep the top tier but never drop it); `frame` draws one more at the current tier
   * and returns the same time. Steps down as the ladder does while a frame takes over twice the target's interval; a
   * frame over that but under CERTAIN_MS is timed twice and the faster counts. Returns the frames it timed.
   */
  async calibrate(first: number, frame: () => Promise<number>) {
    const timed: { tier: number; ms: number }[] = [];
    const time = async () => {
      const ms = await frame();
      timed.push({ tier: this.index, ms });
      return ms;
    };
    if (this.pinned || first <= FAR_TOO_SLOW_MS) return timed;
    while (!this.atBottom) {
      let ms = await time();
      if (ms > FAR_TOO_SLOW_MS && ms <= CERTAIN_MS) ms = Math.min(ms, await time());
      if (ms <= FAR_TOO_SLOW_MS) break;
      this.stepFor(1000 / ms);
    }
    return timed;
  }

  private get atBottom() {
    return this.index === this.ladder.tiers.length - 1;
  }

  /** Down to the tier a frame rate calls for, at least one. */
  private stepFor(fps: number) {
    const wanted = this.tier.resolution * Math.sqrt(fps / TARGET_FPS);
    const fits = this.ladder.tiers.findIndex((tier, i) => i > this.index && tier.resolution <= wanted);
    this.index = fits < 0 ? this.ladder.tiers.length - 1 : Math.max(this.index + 1, fits);
    this.warmingUp = true;
    this.onChange(this.tier, this.index);
  }
}
