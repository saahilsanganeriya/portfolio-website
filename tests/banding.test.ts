import { describe, expect, test } from 'vitest';
import { bandingOf, findDarkGradients } from '../scripts/lib/banding.mjs';

const W = 384;
const H = 192;

/** An RGB frame from a function of (x, y) giving a level in 0–255 (grey). */
function frame(level: (x: number, y: number) => number) {
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.fill(Math.max(0, Math.min(255, level(x, y))), (y * W + x) * 3, (y * W + x) * 3 + 3);
  return rgb;
}

// A dark ramp of six levels across the frame, the shape of the floor's fade into the void.
const ramp = (x: number) => 8 + (6 * x) / W;
// The finishing pass's noise, ±0.5 level, fixed per pixel.
const ign = (x: number, y: number) => ((52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1) - 0.5;

describe('the banding metric', () => {
  /**
   * Catches a metric that cannot tell posterised steps from a dithered ramp (the number T73b's before/after rests on):
   * the same ramp rounded flat must score far worse on both numbers than the ramp rounded after the dither.
   */
  test('scores a ramp rounded in flat steps worse than the same ramp dithered', () => {
    const rect = { left: 64, top: 32, width: 256, height: 128 };
    const banded = bandingOf(frame((x) => Math.round(ramp(x))), W, H, rect, 1);
    const dithered = bandingOf(frame((x, y) => Math.round(ramp(x) + ign(x, y))), W, H, rect, 1);
    expect(banded.run, 'flat steps are tens of pixels wide').toBeGreaterThan(30);
    expect(dithered.run).toBeLessThan(banded.run / 5);
    expect(dithered.ripple, 'the eye sees less of a staircase').toBeLessThan(banded.ripple * 0.6);
  });

  /** Catches the crop finder choosing a black void, a lit area or an edge instead of the dark gradient to measure. */
  test('finds the dark smooth gradient, not the flat void, the edge or the lit area', () => {
    // Left third: flat void; middle: the dark ramp; right third: a lit surface with a hard edge in it.
    const rgb = frame((x, y) => (x < 128 ? 3 : x < 256 ? Math.round(ramp((x - 128) * 3)) : y < 96 ? 30 : 120));
    const [found] = findDarkGradients(rgb, W, H, 1, { count: 1, size: [96, 64] });
    expect(found.left).toBeGreaterThanOrEqual(128 - 16);
    expect(found.left + found.width).toBeLessThanOrEqual(256 + 16);
  });
});
