import { describe, expect, it } from 'vitest';
import { moonAge } from '../src/scene/World/daylight';
import { palette, windowLook } from '../src/scene/World/sky';

/** Catches a sky that jumps between palettes (a hard switch at sunset) instead of changing a little at a time. */
describe('each city’s sky follows its sun smoothly', () => {
  it('changes by under 3% a channel for each tenth of a degree the sun moves, night to noon', () => {
    for (const city of ['sf', 'delhi'] as const) {
      let before = palette(city, -20);
      for (let elevation = -19.9; elevation <= 40; elevation += 0.1) {
        const now = palette(city, elevation);
        for (const part of ['zenith', 'horizon'] as const)
          for (let c = 0; c < 3; c++) expect(Math.abs(now[part][c] - before[part][c]), `${city} ${part} at ${elevation.toFixed(1)}°`).toBeLessThan(0.03);
        before = now;
      }
    }
  });
});

/** Catches the sun on the night side or the moon in daylight, and a window with two moons in it. */
describe('the window’s sun, moon and stars', () => {
  it('puts the sun over the city in daylight and the moon and stars over the city at night', () => {
    // 1:00 pm in San Francisco, 1:30 am in Delhi.
    const { sf, delhi } = windowLook(new Date('2026-06-21T20:00:00Z'));
    expect(sf.sun.shown).toBe(1);
    expect(sf.moon.shown).toBe(0);
    expect(sf.stars).toBe(0);
    expect(delhi.sun.shown).toBe(0);
    expect(delhi.moon.shown).toBeGreaterThan(0.9);
    expect(delhi.stars).toBeGreaterThan(0.9);
    // Each body stays in its own city's half: San Francisco left of straight out, Delhi right.
    expect(sf.sun.azimuth).toBeLessThan(0);
    expect(delhi.moon.azimuth).toBeGreaterThan(0);
  });

  it('shows one moon when both cities are dark', () => {
    // December: 5:00 am in San Francisco, 6:30 pm in Delhi.
    const { sf, delhi } = windowLook(new Date('2026-12-21T13:00:00Z'));
    expect(sf.night).toBe(1);
    expect(delhi.night).toBe(1);
    expect(Math.max(sf.moon.shown, delhi.moon.shown)).toBeGreaterThan(0.9);
    expect(Math.min(sf.moon.shown, delhi.moon.shown)).toBeLessThan(0.1);
  });

  it('never stands two suns side by side in the middle of the window', () => {
    // Every quarter hour of a year: whenever both suns show, they stand at least 28° apart.
    let closest = Infinity;
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 15 * 60_000) {
      const { sf, delhi } = windowLook(new Date(t));
      if (sf.sun.shown > 0.5 && delhi.sun.shown > 0.5) closest = Math.min(closest, delhi.sun.azimuth - sf.sun.azimuth);
    }
    expect(closest).toBeGreaterThanOrEqual(28);
  });

  it('raises the sun in the window as it climbs', () => {
    const heights = [6, 7, 8, 9, 10].map((h) => windowLook(new Date(Date.UTC(2026, 5, 21, h - 5, 30))).delhi.sun.height);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1]);
  });
});

/** Catches a moon drawn in the wrong phase: full on 2026-10-26, new on 2026-10-10. */
describe('the moon’s phase', () => {
  it('is full on 26 October 2026 and new on 10 October 2026', () => {
    expect(moonAge(new Date('2026-10-26T04:00:00Z'))).toBeCloseTo(0.5, 1);
    const age = moonAge(new Date('2026-10-10T16:00:00Z'));
    expect(Math.min(age, 1 - age)).toBeLessThan(0.03);
  });
});
