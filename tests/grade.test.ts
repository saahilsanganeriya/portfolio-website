import { describe, expect, it } from 'vitest';
import { gradeColor, type GradeSettings } from '../src/scene/post/grade';

const SHIPPED: GradeSettings = { tone: 'aces', exposure: 0.4, toe: [0.03, 0.3], keepHue: 0.85, strength: 0 };

describe('the finishing grade on the baked room', () => {
  /**
   * Catches a second tone curve crushing the bake's shadows: the bake already went through Blender's AgX, and ACES's toe
   * on top of it took the desk view from 22% to 55% near-black pixels before the toe fade existed.
   */
  it('leaves shadows below the toe exactly as baked, and black black', () => {
    const wall: [number, number, number] = [0.02, 0.028, 0.022];
    gradeColor(wall, SHIPPED).forEach((v, i) => expect(v).toBeCloseTo(wall[i], 6));
    expect(gradeColor([0, 0, 0], { ...SHIPPED, strength: 1 })).toEqual([0, 0, 0]);
  });

  /** Catches the oven window and lamp shade drifting from orange to yellow under per-channel ACES. */
  it('keeps a bright orange orange when it keeps the hue', () => {
    const oven: [number, number, number] = [0.95, 0.55, 0.2];
    const ratio = ([r, g]: number[]) => g / r;
    const perChannel = gradeColor(oven, { ...SHIPPED, keepHue: 0 });
    const kept = gradeColor(oven, { ...SHIPPED, keepHue: 1 });
    expect(ratio(perChannel)).toBeGreaterThan(ratio(oven) + 0.05);
    expect(Math.abs(ratio(kept) - ratio(oven))).toBeLessThan(0.02);
  });
});
