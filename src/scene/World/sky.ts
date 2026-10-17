import * as THREE from 'three';
import type { CityId } from './daylight';

// The sky over the window: San Francisco's day sky on the left, Delhi's on the right, one gradient between them with no
// seam. It never changes (both cities stay in daylight), so each vertex of the dome gets its colour once, here, and the
// sky's shader only draws it. San Francisco's horizon is cooler and greyer (the marine layer); Delhi's warmer and
// dustier.

export type RGB = readonly [number, number, number];

/**
 * Half-width of the blend from San Francisco's sky to Delhi's, on the window's plane, in metres (the window is 1.5 m
 * wide): the change runs across most of the window, so neither half reads as a block.
 */
export const BLEND_HALF_WIDTH_M = 0.62;

export const DAY_SKY: Record<CityId, { zenith: string; horizon: string }> = {
  sf: { zenith: '#2f64ab', horizon: '#b4c8dc' },
  delhi: { zenith: '#3a6aa8', horizon: '#d3cdb8' },
};

/** Where the blend from one city to the other is measured: the dome's centre, the window framing's eye, out and right. */
export interface SkyFrame {
  centre: THREE.Vector3;
  eye: THREE.Vector3;
  /** Unit vector out of the window (level) and to the right of it, seen from the room. */
  out: THREE.Vector3;
  right: THREE.Vector3;
  /** Half the width of the blend on the window's plane, in world units. */
  band: number;
}

/** A hex colour in linear values. */
export function linearOf(hex: string): RGB {
  const c = new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const ray = new THREE.Vector3();
const crossing = new THREE.Vector3();

/**
 * How far `p` lies toward Delhi's side, 0 (San Francisco) to 1 (Delhi): where the line from the eye through it crosses
 * the window's plane, eased across the band. The land's shader (window_blend.glsl) uses the same function.
 */
export function windowBlend(p: THREE.Vector3, f: SkyFrame): number {
  ray.subVectors(p, f.eye);
  const t = crossing.subVectors(f.centre, f.eye).dot(f.out) / Math.max(ray.dot(f.out), 1e-3);
  crossing.copy(f.eye).addScaledVector(ray, t).sub(f.centre);
  return smoothstep(-f.band, f.band, crossing.dot(f.right));
}

/** One city's sky in the direction `d` from the dome's centre: horizon to zenith, the horizon band kept wide. */
function cityAt(city: CityId, up: number): RGB {
  const zenith = linearOf(DAY_SKY[city].zenith);
  const horizon = linearOf(DAY_SKY[city].horizon);
  const t = smoothstep(0, 1, Math.pow(Math.min(1, Math.max(0, up)), 0.55));
  return [horizon[0] + (zenith[0] - horizon[0]) * t, horizon[1] + (zenith[1] - horizon[1]) * t, horizon[2] + (zenith[2] - horizon[2]) * t];
}

const direction = new THREE.Vector3();

/**
 * The sky's colour (linear) at world point `p` of the dome: each city's gradient by height, blended across the window in
 * display values (gamma 2), so the change looks centred between the cities rather than on the darker side.
 */
export function skyColour(p: THREE.Vector3, f: SkyFrame): RGB {
  const up = direction.subVectors(p, f.centre).normalize().y;
  const a = cityAt('sf', up);
  const b = cityAt('delhi', up);
  const w = windowBlend(p, f);
  const mix = (x: number, y: number) => {
    const c = Math.sqrt(x) + (Math.sqrt(y) - Math.sqrt(x)) * w;
    return c * c;
  };
  return [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])];
}

/** The horizon colours (linear) the far land hazes into, San Francisco's then Delhi's. */
export function horizons(): [RGB, RGB] {
  return [linearOf(DAY_SKY.sf.horizon), linearOf(DAY_SKY.delhi.horizon)];
}
