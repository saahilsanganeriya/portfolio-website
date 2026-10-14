import { describe, expect, test } from 'vitest';
import { cityDay, dayWeight, logCurve, powerCurve, readSettings, SETTINGS_KEY, stateFor, writeSettings } from '../src/scene/audio/state';

describe('the room sound state', () => {
  /** Catches a framing or SaahilOS window mapped to the wrong music (e.g. Films heard as the muffled OS). */
  test('the camera and the front window pick the state', () => {
    expect(stateFor('idle', '')).toBe('room');
    expect(stateFor('desk', 'films')).toBe('room');
    expect(stateFor('projector', '')).toBe('projector');
    expect(stateFor('window', '')).toBe('window');
    expect(stateFor('monitor', 'projects/swe-sim')).toBe('os');
    expect(stateFor('monitor', 'films/la-la-land')).toBe('projector');
  });

  /** Catches a stored volume that breaks the page (bad JSON, out of range) or is not read back. */
  test('settings survive a round trip and reject malformed storage', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readSettings(storage)).toEqual({ volume: 1, muted: false });
    writeSettings(storage, { volume: 0.35, muted: true });
    expect(readSettings(storage)).toEqual({ volume: 0.35, muted: true });
    store.set(SETTINGS_KEY, '{"volume": 7, "muted": "yes"}');
    expect(readSettings(storage)).toEqual({ volume: 1, muted: false });
    store.set(SETTINGS_KEY, 'not json');
    expect(readSettings(storage)).toEqual({ volume: 1, muted: false });
  });

  /** Catches the cities read in the visitor's time zone instead of their own, and a hard switch at dawn. */
  test('each city is day or night by its own clock, eased through twilight', () => {
    const at = new Date('2026-10-12T20:00:00Z');
    expect(cityDay('sf', at)).toBe(1);
    expect(cityDay('delhi', at)).toBe(0);
    expect(dayWeight(6)).toBeCloseTo(0.5, 5);
    expect(dayWeight(5.5)).toBeGreaterThan(0);
    expect(dayWeight(5.5)).toBeLessThan(0.5);
  });

  /** Catches a linear ramp or a fade that dips or bumps the summed power of a crossfade. */
  test('fades have weight: they leave and land at rest, and a crossfade keeps its power', () => {
    const out = powerCurve(1, 0);
    const into = powerCurve(0, 1);
    for (let i = 0; i < out.length; i++) expect(out[i] ** 2 + into[i] ** 2).toBeCloseTo(1, 5);
    expect([into[0], into.at(-1)]).toEqual([0, 1]);
    // A linear ramp's first step is 1/63 of the way; a smootherstep in power starts far slower.
    expect(into[1] ** 2).toBeLessThan(0.002);
    const sweep = logCurve(11000, 1400);
    expect(sweep[0]).toBeCloseTo(11000, 3);
    expect(sweep.at(-1)).toBeCloseTo(1400, 3);
    // Half way in time is half way in octaves (the geometric mean), not half way in hertz.
    const middle = sweep[Math.floor(sweep.length / 2)] / Math.sqrt(sweep[0] * sweep.at(-1)!);
    expect(Math.abs(middle - 1)).toBeLessThan(0.05);
  });
});
