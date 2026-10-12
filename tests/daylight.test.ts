import { describe, expect, it } from 'vitest';
import { CITIES, localTime, nightWeight, sunElevation } from '../src/scene/World/daylight';

/** Catches the window lighting a city by the visitor's clock or by UTC instead of that city's own day and night. */
describe('each half of the window follows its own city', () => {
  it('is day in San Francisco and night in Delhi at 13:00 Pacific in June, and the reverse twelve hours on', () => {
    const june = new Date('2026-06-21T20:00:00Z');
    expect(localTime(CITIES.sf, june)).toBe('1:00 pm');
    expect(localTime(CITIES.delhi, june)).toBe('1:30 am');
    expect(nightWeight(CITIES.sf, june)).toBe(0);
    expect(nightWeight(CITIES.delhi, june)).toBe(1);
    const later = new Date('2026-06-22T08:00:00Z');
    expect(nightWeight(CITIES.sf, later)).toBe(1);
    expect(nightWeight(CITIES.delhi, later)).toBe(0);
  });

  /** Catches a fixed sunset hour: San Francisco is dark by 18:00 in December but light at 19:00 in June. */
  it('moves dusk with the season', () => {
    expect(nightWeight(CITIES.sf, new Date('2026-12-21T02:00:00Z'))).toBe(1); // 18:00 PST
    expect(nightWeight(CITIES.sf, new Date('2026-06-22T02:00:00Z'))).toBe(0); // 19:00 PDT
  });

  /** Catches a hard switch at sunset: the blend passes through values between day and night. */
  it('blends through dusk', () => {
    const minutes = Array.from({ length: 121 }, (_, i) => new Date(Date.UTC(2026, 9, 12, 0, 30 + i)));
    const weights = minutes.map((date) => nightWeight(CITIES.sf, date));
    expect(weights[0]).toBe(0);
    expect(weights.at(-1)).toBe(1);
    expect(weights.filter((w) => w > 0.2 && w < 0.8).length).toBeGreaterThan(10);
    // Noon sun in Delhi in June is high in the sky.
    expect(sunElevation(CITIES.delhi, new Date('2026-06-21T06:45:00Z'))).toBeGreaterThan(80);
  });
});
