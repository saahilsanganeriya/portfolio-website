import { describe, expect, it } from 'vitest';
import { FULL, Quality } from '../src/scene/Application/Quality';

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
