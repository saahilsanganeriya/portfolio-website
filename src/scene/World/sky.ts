import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { CityId } from './daylight';

// The sky over the window at one fixed moment (owner): San Francisco at 7 PM, the sun setting into the fog, amber at
// the horizon through rose to a dusky violet-blue; New Delhi at 7:30 AM, the same moment, the sun rising through a pale
// gold haze to a clear pale blue. One gradient runs between them with no seam. It never changes, so each vertex of the
// dome gets its colour once, here, and the sky's shader only draws it.

export type RGB = readonly [number, number, number];

/**
 * Half-width of the blend from San Francisco's sky to Delhi's, on the window's plane, in metres (the window is 1.5 m
 * wide): the change runs across most of the window, so neither half reads as a block.
 */
export const BLEND_HALF_WIDTH_M = 0.62;

/** Each city's sky from the horizon up: three stops, on a smooth curve (the middle one bends it, it is not reached). */
export const SKY: Record<CityId, { horizon: string; middle: string; zenith: string }> = {
  sf: { horizon: '#f2b07e', middle: '#d9909a', zenith: '#5d6aa8' },
  delhi: { horizon: '#f1dcae', middle: '#cdd5d3', zenith: '#8eb3da' },
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

/** One city's sky at height `up` (the sine of the direction's elevation from the dome's centre): horizon to zenith, the horizon band kept wide. */
function cityAt(city: CityId, up: number): RGB {
  const [h, m, z] = [SKY[city].horizon, SKY[city].middle, SKY[city].zenith].map(linearOf);
  const t = smoothstep(0, 1, Math.pow(Math.min(1, Math.max(0, up)), 0.55));
  const [a, b, c] = [(1 - t) * (1 - t), 2 * t * (1 - t), t * t];
  return [a * h[0] + b * m[0] + c * z[0], a * h[1] + b * m[1] + c * z[1], a * h[2] + b * m[2] + c * z[2]];
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
  return [linearOf(SKY.sf.horizon), linearOf(SKY.delhi.horizon)];
}

// ---- the dome, completed for the orbit ----
//
// The build culls the faces of the dome that no framing of its day could see through the window, so from the orbit's
// steep angles the pane looked past the dome into the void: San Francisco's whole flank (about 48° of its half-circle)
// and the cap were gone. The dome is a grid of rings (elevations) by columns (azimuths) about its centre; here the grid
// is read back from the vertices, the missing cells get a radius from their ring, and faces are added only where none
// were, so every face the room drew stays as it was. A skirt drops from the lowest ring to a floor just above the
// mask's, under the land and water, for rays that pass below the horizon where the build culled the land too.

/** How far inside the mask's box the added sky stays, in metres (the diorama counts on the mask holding it). */
const MASK_INSET_M = 0.005;
/** Without a mask, how far below the lowest ring the floor lies (and beyond the dome it reaches), in metres. */
const FLOOR_DROP_M = 0.15;
/** The floor's grid: fine enough across that the blend from one city's horizon to the other's reads on it. */
const FLOOR_CELLS_X = 32;
const FLOOR_CELLS_Z = 6;

export interface DomeCompletion {
  geometry: THREE.BufferGeometry;
  /** Grid cells (ring by column, plus the cap) that had no vertex, and triangles added in all. */
  filledCells: number;
  addedTriangles: number;
}

interface GridVertex {
  ring: number;
  column: number;
}

const cluster = (values: number[], gap: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  const centres: number[][] = [];
  for (const v of sorted) {
    const last = centres.at(-1);
    if (last && v - last[last.length - 1] < gap) last.push(v);
    else centres.push([v]);
  }
  return centres.map((c) => c.reduce((s, v) => s + v, 0) / c.length);
};

/**
 * The dome with its culled cells filled and a skirt and floor under it, in the mesh's own space (`toWorld` carries it
 * to the world). `bounds` is the mask's box in the world, which the added sky stays inside. The geometry is returned
 * unchanged when its vertices do not lie on a ring-by-column grid about the frame's centre.
 */
export function completeDome(geometry: THREE.BufferGeometry, toWorld: THREE.Matrix4, frame: SkyFrame, bounds: THREE.Box3 | null): DomeCompletion {
  const unchanged = { geometry, filledCells: 0, addedTriangles: 0 };
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index || position.count < 3) return unchanged;
  const up = new THREE.Vector3(0, 1, 0);
  const world: THREE.Vector3[] = [];
  const polar: { az: number; el: number; r: number }[] = [];
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(toWorld);
    world.push(p);
    const d = p.clone().sub(frame.centre);
    const r = d.length();
    const az = THREE.MathUtils.radToDeg(Math.atan2(d.dot(frame.out), d.dot(frame.right)));
    polar.push({
      // The half-circle runs 0..180°; its far end, rounded a hair in front of the centre, comes back as -180°.
      az: az < -90 ? az + 360 : az,
      el: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y / Math.max(r, 1e-9), -1, 1))),
      r,
    });
  }
  const isCap = (el: number) => el > 89.5;
  const rings = cluster(polar.filter((p) => !isCap(p.el)).map((p) => p.el), 0.5);
  const azimuths = cluster(polar.filter((p) => !isCap(p.el)).map((p) => p.az), 0.2);
  const steps = azimuths.slice(1).map((a, i) => a - azimuths[i]);
  if (rings.length < 2 || !steps.length) return unchanged;
  const columns = Math.round(180 / Math.min(...steps));
  const step = 180 / columns;
  const cells = new Map<number, number>();
  const at = (ring: number, column: number) => ring * (columns + 1) + column;
  const grid: (GridVertex | 'cap')[] = [];
  let cap = -1;
  for (const [i, p] of polar.entries()) {
    if (isCap(p.el)) {
      grid.push('cap');
      cap = cap < 0 ? i : cap;
      continue;
    }
    const column = Math.round(p.az / step);
    const ring = rings.findIndex((e) => Math.abs(e - p.el) < 0.5);
    if (ring < 0 || column < 0 || column > columns || Math.abs(p.az - column * step) > step / 4) return unchanged;
    grid.push({ ring, column });
    if (!cells.has(at(ring, column))) cells.set(at(ring, column), i);
  }

  // Each missing cell's radius: between the nearest kept cells of its ring, or held from the one on its side; a ring
  // with none takes the nearest ring's.
  const radius: (number | null)[][] = rings.map((_, k) =>
    Array.from({ length: columns + 1 }, (_, c) => (cells.has(at(k, c)) ? polar[cells.get(at(k, c))!].r : null)),
  );
  for (const row of radius) {
    for (let c = 0; c <= columns; c++) {
      if (row[c] !== null) continue;
      let lo = c - 1;
      while (lo >= 0 && row[lo] === null) lo--;
      let hi = c + 1;
      while (hi <= columns && row[hi] === null) hi++;
      const [a, b] = [lo >= 0 ? row[lo] : null, hi <= columns ? row[hi] : null];
      if (a !== null && b !== null) row[c] = a + ((b - a) * (c - lo)) / (hi - lo);
      else row[c] = a ?? b;
    }
  }
  for (let k = 0; k < rings.length; k++) {
    if (radius[k][0] !== null) continue;
    for (let off = 1; off < rings.length; off++) {
      const near = [k - off, k + off].find((j) => j >= 0 && j < rings.length && radius[j][0] !== null);
      if (near !== undefined) {
        radius[k] = [...radius[near]];
        break;
      }
    }
  }
  if (radius.some((row) => row[0] === null)) return unchanged;

  const inset = MASK_INSET_M * WORLD_SCALE;
  const inner = bounds && bounds.clone().expandByScalar(-inset);
  const keepInside = (p: THREE.Vector3) => (inner && !inner.isEmpty() ? inner.clampPoint(p, p) : p);
  const direction = (az: number, el: number) => {
    const [a, e] = [THREE.MathUtils.degToRad(az), THREE.MathUtils.degToRad(el)];
    return frame.right.clone().multiplyScalar(Math.cos(e) * Math.cos(a)).addScaledVector(frame.out, Math.cos(e) * Math.sin(a)).addScaledVector(up, Math.sin(e));
  };
  let filledCells = 0;
  const vertexAt = (k: number, c: number) => {
    const key = at(k, c);
    if (!cells.has(key)) {
      cells.set(key, world.length);
      world.push(keepInside(frame.centre.clone().addScaledVector(direction(c * step, rings[k]), radius[k][c]!)));
      filledCells++;
    }
    return cells.get(key)!;
  };
  if (cap < 0) {
    const top = radius[rings.length - 1].reduce<number>((sum, r) => sum + r!, 0) / (columns + 1);
    cap = world.length;
    world.push(keepInside(frame.centre.clone().addScaledVector(up, top)));
    filledCells++;
  }

  // Which quads (and cap triangles) the room already draws.
  const covered = new Set<number>();
  const triangles: number[] = Array.from(index.array as ArrayLike<number>);
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [grid[triangles[t]], grid[triangles[t + 1]], grid[triangles[t + 2]]].filter((g): g is GridVertex => g !== 'cap');
    if (!corners.length) continue;
    const ring = Math.min(...corners.map((g) => g.ring));
    const column = Math.min(...corners.map((g) => g.column));
    covered.add(corners.length < 3 ? -1 - column : at(ring, column));
  }
  const before = triangles.length;
  const toRoom = frame.out.clone().negate();
  /** A triangle whose front faces `facing`, by default the dome's centre (as the room's own faces do, seen from inside). */
  const add = (a: number, b: number, c: number, facing?: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(world[b], world[a]).cross(new THREE.Vector3().subVectors(world[c], world[a]));
    if (n.dot(facing ?? new THREE.Vector3().subVectors(frame.centre, world[a])) < 0) [b, c] = [c, b];
    triangles.push(a, b, c);
  };
  const vertex = (p: THREE.Vector3) => world.push(p) - 1;
  for (let k = 0; k + 1 < rings.length; k++)
    for (let c = 0; c < columns; c++) {
      if (covered.has(at(k, c))) continue;
      const [a, b, d, e] = [vertexAt(k, c), vertexAt(k, c + 1), vertexAt(k + 1, c + 1), vertexAt(k + 1, c)];
      add(a, b, d);
      add(a, d, e);
    }
  const top = rings.length - 1;
  for (let c = 0; c < columns; c++) if (!covered.has(-1 - c)) add(vertexAt(top, c), vertexAt(top, c + 1), cap);

  // The skirt from the lowest ring down to the floor; the floor, a grid over the mask's footprint (or the dome's, out to
  // the wall), so a ray below the horizon meets it anywhere behind the pane, the slot in front of the dome included.
  const lowest = Array.from({ length: columns + 1 }, (_, c) => vertexAt(0, c));
  const footprint = inner && !inner.isEmpty() ? inner : new THREE.Box3().setFromPoints(world).expandByScalar(FLOOR_DROP_M * WORLD_SCALE);
  const floorY = inner && !inner.isEmpty() ? inner.min.y : Math.min(...lowest.map((i) => world[i].y)) - FLOOR_DROP_M * WORLD_SCALE;
  const skirt = lowest.map((i) => {
    world.push(new THREE.Vector3(world[i].x, floorY, world[i].z));
    return world.length - 1;
  });
  for (let c = 0; c < columns; c++) {
    add(lowest[c], lowest[c + 1], skirt[c + 1]);
    add(lowest[c], skirt[c + 1], skirt[c]);
  }
  const [nx, nz] = [FLOOR_CELLS_X, FLOOR_CELLS_Z];
  const floor = (i: number, j: number) => first + j * (nx + 1) + i;
  const first = world.length;
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++)
      world.push(new THREE.Vector3(THREE.MathUtils.lerp(footprint.min.x, footprint.max.x, i / nx), floorY, THREE.MathUtils.lerp(footprint.min.z, footprint.max.z, j / nz)));
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const [a, b, c, d] = [floor(i, j), floor(i + 1, j), floor(i + 1, j + 1), floor(i, j + 1)];
      add(a, d, c, up);
      add(a, c, b, up);
    }

  // The fin: the dome's front plane outside its outline (the two edge columns, the cap and the skirt's front edges), out
  // to the mask's sides and top; then the mask's sides in the slot between that plane and the wall. A ray along the slot
  // from a steep eye meets one of them, and each starts on the dome's own edge, so the colour runs on without a step.
  if (inner && !inner.isEmpty()) {
    for (const [column, edgeX, inward] of [
      [columns, inner.min.x, 1],
      [0, inner.max.x, -1],
    ] as const) {
      const outline = [skirt[column], ...rings.map((_, k) => vertexAt(k, column)), cap];
      const capTop = vertex(new THREE.Vector3(world[cap].x, inner.max.y, world[cap].z));
      const edge = [...outline, capTop];
      const matched = edge.map((i) => vertex(new THREE.Vector3(edgeX, world[i].y, world[i].z)));
      const slot = matched.map((i) => vertex(new THREE.Vector3(edgeX, world[i].y, inner.max.z)));
      const side = new THREE.Vector3(inward, 0, 0);
      for (let j = 0; j + 1 < edge.length; j++) {
        add(edge[j], edge[j + 1], matched[j + 1], toRoom);
        add(edge[j], matched[j + 1], matched[j], toRoom);
        add(matched[j], matched[j + 1], slot[j + 1], side);
        add(matched[j], slot[j + 1], slot[j], side);
      }
    }
  }

  const toLocal = toWorld.clone().invert();
  const positions = new Float32Array(world.length * 3);
  for (const [i, p] of world.entries()) positions.set(p.clone().applyMatrix4(toLocal).toArray(), i * 3);
  const completed = new THREE.BufferGeometry();
  completed.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  completed.setIndex(triangles);
  return { geometry: completed, filledCells, addedTriangles: (triangles.length - before) / 3 };
}
