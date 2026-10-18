import { describe, expect, it } from 'vitest';
import { FULL, LIGHT, Quality, type QualityTier } from '../src/scene/Application/Quality';

/** Feeds `count` frames of `frameMs` each and returns the tier the controller settled on. */
function settle(frameMs: number, count: number) {
  const quality = new Quality(FULL, () => {});
  let now = 1000;
  for (let i = 0; i < count; i++) quality.sample((now += frameMs), frameMs);
  return quality.index;
}

describe('the quality controller', () => {
  /**
   * Catches a machine too slow for the top tier never leaving it: every frame over 250 ms was skipped as a stall, so
   * a room whose finishing pass took 300 ms a frame stayed at full resolution and its camera glides took ten times
   * as long (world.spec's window test timed out under load).
   */
  it('steps down when every frame is slow, not only when some are', () => {
    expect(settle(300, 40)).toBe(FULL.tiers.length - 1);
  });

  /**
   * Catches the arrival starting at the top tier on a machine far too slow for it: the glide begins 0.4 s after the
   * room loads, and a warm-up window plus a measured one take a second, so its first frames came far apart
   * (room.spec's waypoint pass missed cam_arrival_0 by 1.15 m once MSAA made the top tier heavier).
   */
  it('leaves the top tier within the first frames when they run under half the target', () => {
    const quality = new Quality(FULL, () => {});
    let now = 1000;
    for (let i = 0; i < 4; i++) quality.sample((now += 100), 100);
    expect(quality.index).toBeGreaterThan(0);
  });

  /** Catches a one-off stall (a shader compile) costing a tier. */
  it('ignores a single long frame among fast ones', () => {
    const quality = new Quality(FULL, () => {});
    let now = 1000;
    for (let i = 0; i < 200; i++) {
      const frameMs = i === 50 ? 900 : 16;
      quality.sample((now += frameMs), frameMs);
    }
    expect(quality.index).toBe(0);
  });
});

/**
 * Calibrates on a fake clock: every frame at the top tier takes `topMs` (the first one, which uploads the textures,
 * `firstMs`), a lower tier as much less as it has fewer pixels (MSAA counts four samples a pixel); timed frame number
 * `stall` takes 80 ms more (a garbage collection). Returns the tier picked and how long it took.
 */
async function calibrate(topMs: number, { firstMs = topMs, stall = 0 } = {}) {
  let clock = 0;
  let frames = 0;
  const quality = new Quality(FULL, () => {});
  const cost = () => {
    const tier = quality.tier;
    const samples = (tier.resolution / FULL.tiers[0].resolution) ** 2 * (tier.msaa ? 1 : 0.25);
    return topMs * samples + (++frames === stall ? 80 : 0);
  };
  const frame = async () => {
    const ms = cost();
    clock += ms;
    return ms;
  };
  clock += firstMs;
  await quality.calibrate(firstMs, frame);
  return { tier: quality.index, ms: clock };
}

describe('the calibration before the arrival', () => {
  /**
   * Catches a fast machine losing the top tier, or waiting for it: the ladder never climbs back, so a top tier lost
   * before the glide is lost for the visit, and the glide may start at most 300 ms later than it did.
   */
  it('keeps a fast machine (16 ms frames) at the top tier within 300 ms', async () => {
    expect(await calibrate(16)).toEqual({ tier: 0, ms: 16 });
    // The first frame uploads the textures: slow on any machine, it only asks for a clean frame.
    const uploading = await calibrate(16, { firstMs: 120 });
    expect(uploading.tier).toBe(0);
    expect(uploading.ms).toBeLessThanOrEqual(300);
  });

  /** Catches one stall (a garbage collection) during a fast machine's measured frame costing it the top tier. */
  it('looks again at a frame between twice the target and certainly slow', async () => {
    expect((await calibrate(16, { firstMs: 120, stall: 1 })).tier).toBe(0);
  });

  /**
   * Catches the arrival starting at a tier the machine cannot hold (T78: tier 0 at 0.7–1.1 s a frame, the glide ran
   * 12–33 frames): a machine whose top-tier frames take 100 ms starts lower, at a tier whose frames fit.
   */
  it('starts a slow machine (100 ms frames) at a lower tier', async () => {
    const { tier } = await calibrate(100);
    expect(tier).toBeGreaterThan(0);
    const picked = FULL.tiers[tier];
    expect(100 * picked.resolution ** 2 * (picked.msaa ? 1 : 0.25)).toBeLessThanOrEqual(40);
  });

  /** Catches a pinned tier (screenshots, captures) being moved by the calibration. */
  it('leaves a pinned tier alone', async () => {
    (globalThis as { __roomTier?: number }).__roomTier = 0;
    try {
      const quality = new Quality(FULL, () => {});
      await quality.calibrate(900, async () => 900);
      expect(quality.index).toBe(0);
    } finally {
      delete (globalThis as { __roomTier?: number }).__roomTier;
    }
  });
});

describe('the ladders', () => {
  /**
   * Catches a tier that costs more than the one above it: the ladder only ever steps down, so a lower tier with more
   * pixels, samples, anisotropic taps or passes (tier 2 filtering with 16 taps under tier 1's 8, say) would hold a slow
   * machine at a cost it had just failed to meet. Each rung keeps or drops each part; the resolution always drops.
   */
  it.each([
    ['desktop', FULL],
    ['phone', LIGHT],
  ])('only take quality away as they step down (%s)', (_, ladder) => {
    const costs = (t: QualityTier) => [t.msaa, t.anisotropy, ...(['bloom', 'film', 'halos', 'shine'] as const).map((k) => Number(t[k]))];
    for (let i = 1; i < ladder.tiers.length; i++) {
      const [above, below] = [ladder.tiers[i - 1], ladder.tiers[i]];
      expect(below.resolution, `tier ${i} draws fewer pixels than tier ${i - 1}`).toBeLessThan(above.resolution);
      costs(below).forEach((cost, k) => expect(cost, `tier ${i}, part ${k}`).toBeLessThanOrEqual(costs(above)[k]));
    }
  });
});
