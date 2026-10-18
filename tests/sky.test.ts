import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BLEND_HALF_WIDTH_M, SKY, linearOf, skyColour, windowBlend, type SkyFrame } from '../src/scene/World/sky';

// A frame like the room's, in metres: the window's middle on the back wall, the window framing's eye 3 m in front of it,
// out of the window along -Z, San Francisco to the left (-X), Delhi to the right.
const frame: SkyFrame = {
  centre: new THREE.Vector3(1.85, 0.85, -0.6),
  eye: new THREE.Vector3(1.85, 1.5, 2.4),
  out: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  band: BLEND_HALF_WIDTH_M,
};

/** A point on the dome (radius 9 m about its centre) seen through the window at `x` metres right of the middle, `up` high. */
function domePoint(x: number, up: number) {
  const through = new THREE.Vector3(frame.centre.x + x, frame.centre.y + up, frame.centre.z);
  const dir = through.sub(frame.eye).normalize();
  // Walk from the eye along the ray until it is 9 m from the dome's centre.
  const p = frame.eye.clone();
  for (let step = 0; step < 400 && p.distanceTo(frame.centre) < 9; step++) p.addScaledVector(dir, 0.05);
  return p;
}

describe('the sky over the window', () => {
  /**
   * Catches a seam: a step anywhere across the window bigger than the gradient around it (the old halves met in a hard
   * straight line at the central bar; a 5 mm blend band reproduces it and turns this red).
   */
  it('changes by under 1.2% a channel per centimetre of window, at every height', () => {
    for (const up of [0.15, 0.4, 0.7, 1.0]) {
      let before = skyColour(domePoint(-0.75, up), frame);
      for (let cm = -74; cm <= 75; cm++) {
        const now = skyColour(domePoint(cm / 100, up), frame);
        for (let c = 0; c < 3; c++) expect(Math.abs(now[c] - before[c]), `${up} m up, ${cm} cm`).toBeLessThan(0.012);
        before = now;
      }
    }
  });

  /** Catches the cities swapped (dusk over Delhi, morning over San Francisco), or a blend that stops short so one side shows a mix of both skies. */
  it('is San Francisco’s sky at the left edge and Delhi’s at the right', () => {
    expect(windowBlend(domePoint(-0.75, 0.4), frame)).toBe(0);
    expect(windowBlend(domePoint(0.75, 0.4), frame)).toBe(1);
    expect(windowBlend(domePoint(0, 0.4), frame)).toBeCloseTo(0.5, 2);
    // San Francisco's is the sunset (its horizon the redder, its zenith the darker), Delhi's the morning.
    const [left, right] = [skyColour(domePoint(-0.75, 0.02), frame), skyColour(domePoint(0.75, 0.02), frame)];
    expect(left[0] - left[1]).toBeGreaterThan(right[0] - right[1]);
    const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(luma(skyColour(domePoint(-0.75, 1.4), frame))).toBeLessThan(luma(skyColour(domePoint(0.75, 1.4), frame)));
  });

  /** Catches a gradient upside down (a dark horizon under a pale zenith reads as night coming, not the sun's glow). */
  it('is paler at the horizon than overhead, on both sides', () => {
    for (const city of ['sf', 'delhi'] as const) {
      const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      expect(luma(linearOf(SKY[city].horizon))).toBeGreaterThan(luma(linearOf(SKY[city].zenith)));
    }
    for (const x of [-0.6, 0.6]) expect(skyColour(domePoint(x, 0.02), frame)[1]).toBeGreaterThan(skyColour(domePoint(x, 1.4), frame)[1]);
  });
});
