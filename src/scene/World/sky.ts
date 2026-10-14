import { CITIES, moonAge, nightAt, solarPosition, type CityId } from './daylight';

// How each city's sky looks at a moment, from its own sun: the colours at the zenith and on the horizon, the warm glow
// toward the sun through dusk and dawn, and where the sun and the moon stand in that city's half of the window.
// Colours are sRGB, 0..1.

export type RGB = readonly [number, number, number];

export interface SkyLook {
  /** The sun's height above the horizon (degrees) and how dark it is (0 day … 1 night). */
  elevation: number;
  night: number;
  /** Warm low light through dusk and dawn: 1 with the sun on the horizon, 0 by full day or night. */
  dusk: number;
  zenith: RGB;
  horizon: RGB;
  glow: RGB;
  glowAmount: number;
  /** Azimuth in degrees (0 straight out of the window, negative toward San Francisco's side) and height above the water line. */
  sun: { azimuth: number; height: number; shown: number; colour: RGB };
  moon: { azimuth: number; height: number; shown: number };
  stars: number;
}

interface Key {
  at: number;
  zenith: string;
  horizon: string;
  glow: string;
  glowAmount: number;
}

// By the sun's height: night, blue hour, sunset, golden hour, day. San Francisco's horizon is cooler and greyer (the
// marine layer, fog lit violet at night); Delhi's warmer and dustier (sodium haze at night).
const PALETTES: Record<CityId, Key[]> = {
  sf: [
    { at: -18, zenith: '#070c22', horizon: '#1c2546', glow: '#26244a', glowAmount: 0 },
    { at: -10, zenith: '#0a1331', horizon: '#28315c', glow: '#40345f', glowAmount: 0.18 },
    { at: -5, zenith: '#13205a', horizon: '#4b4a7c', glow: '#8a5578', glowAmount: 0.45 },
    { at: -1, zenith: '#26407a', horizon: '#c07a7c', glow: '#ff8c5a', glowAmount: 0.85 },
    { at: 3, zenith: '#3d63a3', horizon: '#e6ab8a', glow: '#ffb27a', glowAmount: 0.7 },
    { at: 9, zenith: '#3a6bb0', horizon: '#b9cadb', glow: '#ffe4c4', glowAmount: 0.32 },
    { at: 30, zenith: '#2c62ad', horizon: '#aac3dc', glow: '#fff4e2', glowAmount: 0.22 },
  ],
  delhi: [
    { at: -18, zenith: '#080b20', horizon: '#2a2335', glow: '#33243a', glowAmount: 0 },
    { at: -10, zenith: '#0c1331', horizon: '#3a2f47', glow: '#55344a', glowAmount: 0.2 },
    { at: -5, zenith: '#18234f', horizon: '#5e4a64', glow: '#a2605a', glowAmount: 0.5 },
    { at: -1, zenith: '#2c3d6d', horizon: '#d98a5e', glow: '#ff9445', glowAmount: 0.95 },
    { at: 3, zenith: '#4565a0', horizon: '#eeb57c', glow: '#ffbb6a', glowAmount: 0.75 },
    { at: 9, zenith: '#416ead', horizon: '#d2cdba', glow: '#ffe2b0', glowAmount: 0.35 },
    { at: 30, zenith: '#3468ad', horizon: '#c6c6bb', glow: '#fff1d6', glowAmount: 0.25 },
  ],
};

// Each city's sun and moon cross its own half from the window's edge toward the middle: San Francisco's from 27° left
// of straight out (rising) to 10° left (setting), Delhi's from 27° right to 10° right. The cities' clocks are about 13
// hours apart, so when both suns are up one is rising and the other setting: one stands near an edge, never both near
// the middle.
const SIDES: Record<CityId, [number, number]> = { sf: [-27, -10], delhi: [27, 10] };
// The sun's height in the window follows its real height, compressed so a June noon still shows below the window's top.
const HEIGHT_PER_DEG = 0.62;
const HEIGHT_AT_HORIZON = 1;

const parsed = new Map<string, RGB>();
function rgb(hex: string): RGB {
  let colour = parsed.get(hex);
  if (!colour) {
    const n = parseInt(hex.slice(1), 16);
    colour = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    parsed.set(hex, colour);
  }
  return colour;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The palette at a sun height, eased between its keys. */
export function palette(city: CityId, elevation: number) {
  const keys = PALETTES[city];
  let i = keys.findIndex((k) => k.at > elevation);
  if (i === -1) i = keys.length;
  const a = keys[Math.max(0, i - 1)];
  const b = keys[Math.min(keys.length - 1, i)];
  const t = a === b ? 0 : smoothstep(0, 1, (elevation - a.at) / (b.at - a.at));
  return {
    zenith: mix(rgb(a.zenith), rgb(b.zenith), t),
    horizon: mix(rgb(a.horizon), rgb(b.horizon), t),
    glow: mix(rgb(a.glow), rgb(b.glow), t),
    glowAmount: a.glowAmount + (b.glowAmount - a.glowAmount) * t,
  };
}

/** Where a body at this hour angle (degrees from its highest point) crosses the city's half: 0 rising, 1 setting. */
const across = (hourAngle: number) => clamp01((hourAngle + 110) / 220);

/** The look for a sun at `elevation` degrees and `hourAngle` degrees in `city`, and a moon `age` into its month. */
export function lookAt(city: CityId, elevation: number, hourAngle: number): SkyLook {
  const [left, right] = SIDES[city];
  const night = nightAt(elevation);
  const height = HEIGHT_AT_HORIZON + HEIGHT_PER_DEG * Math.min(70, Math.max(-8, elevation));
  const low = smoothstep(2, 25, elevation);
  // The moon stands opposite the sun, as a full moon would: up through the night, highest at midnight.
  const moonHour = ((hourAngle + 360) % 360) - 180;
  const m = across(moonHour);
  return {
    elevation,
    night,
    dusk: smoothstep(-10, -2.5, elevation) * (1 - smoothstep(4, 14, elevation)),
    ...palette(city, elevation),
    sun: {
      azimuth: left + (right - left) * across(hourAngle),
      height,
      shown: smoothstep(-6, -0.5, elevation),
      colour: mix(rgb('#ffa25a'), rgb('#ffeccb'), low),
    },
    moon: {
      azimuth: left + (right - left) * m,
      height: 3 + 24 * Math.sin(Math.PI * m),
      shown: smoothstep(0.35, 0.8, night) * smoothstep(0, 0.06, m) * (1 - smoothstep(0.94, 1, m)),
    },
    stars: Math.pow(smoothstep(0.55, 1, night), 1.5),
  };
}

/** The look of `city`'s sky at `date`, by its own sun. */
export function skyLook(city: CityId, date: Date): SkyLook {
  const { elevation, hourAngle } = solarPosition(CITIES[city], date);
  return lookAt(city, elevation, hourAngle);
}

/** Both skies at once; when both cities are dark the moon shows only in the sky where it stands higher. */
export function windowLook(date: Date): { sf: SkyLook; delhi: SkyLook; moonAge: number } {
  return oneMoon(skyLook('sf', date), skyLook('delhi', date), moonAge(date));
}

/** Keeps one moon over the window: the lower of two fades as the other rises above it. */
export function oneMoon(sf: SkyLook, delhi: SkyLook, age: number) {
  const lead = smoothstep(-3, 3, sf.moon.height - delhi.moon.height);
  const both = Math.min(sf.moon.shown, delhi.moon.shown);
  return {
    sf: { ...sf, moon: { ...sf.moon, shown: sf.moon.shown - both * (1 - lead) } },
    delhi: { ...delhi, moon: { ...delhi.moon, shown: delhi.moon.shown - both * lead } },
    moonAge: age,
  };
}
