import * as THREE from 'three';
import blendGlsl from '../shaders/window_blend.glsl?raw';
import landFrag from '../shaders/window.frag.glsl?raw';
import landVert from '../shaders/window_land.vert.glsl?raw';
import planeFrag from '../shaders/window_plane.frag.glsl?raw';
import planeVert from '../shaders/window_plane.vert.glsl?raw';
import skyFrag from '../shaders/window_sky.frag.glsl?raw';
import skyVert from '../shaders/window_sky.vert.glsl?raw';
import trailFrag from '../shaders/window_trail.frag.glsl?raw';
import trailVert from '../shaders/window_trail.vert.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import { CITIES, type CityId } from './daylight';
import { loadHand, seedOf, writeHand } from './handwriting';
import { BLEND_HALF_WIDTH_M, completeDome, horizons, skyColour, type SkyFrame } from './sky';
import type { WindowMotifNode, WindowSkyNode, WindowViewNode } from './nodes';
import type { TextureStore } from './textures';

// The window looks out on San Francisco (left) and New Delhi (right), both by day. One sky spans them (window_sky): its
// colour runs from San Francisco's day sky to Delhi's with no seam, worked out once per vertex (sky.ts), and where the
// build culled the dome the sky is filled in, so no angle of the orbit sees the void through the pane. Each city's land
// is its day picture, loaded with the room. Across the sky a red and white airliner flies a dotted arc from New Delhi to
// San Francisco with a fading trail, the two names written in his hand (window_motif); under reduced motion it holds
// still, with no trail.

const ROOM_PATH = '/room/';
// Without the sky's markers (an older room), how far in front of the window the eye stands.
const FALLBACK_EYE_M = 3;
const CITY_ORDER: CityId[] = ['sf', 'delhi'];

export interface CityState {
  name: string;
  /** Whether its day picture has arrived. */
  loaded: boolean;
}

export interface MotifState {
  drawn: boolean;
  /** Where the plane is along the arc (a fraction of its length): 0 over New Delhi, 1 over San Francisco; -1 while it is off the arc. */
  plane: number;
  moving: boolean;
  /** The trail's strength (0 none, under reduced motion always). */
  trail: number;
  /** How far the plane is banked, in degrees. */
  bankDeg: number;
}

const vec3 = () => new THREE.Vector3();
const withBlend = (glsl: string) => glsl.replace('#include <window_blend>', blendGlsl);

interface View {
  node: WindowViewNode;
  material: THREE.ShaderMaterial;
  day: THREE.Texture | null;
}

export class WindowView {
  private readonly views: View[];
  private readonly frame: SkyFrame;
  private readonly skyMaterial: THREE.ShaderMaterial | null;
  /** Grid cells of the dome the build had culled and this filled, and the triangles added (0 for a whole dome). */
  private readonly skyFilled = { cells: 0, triangles: 0 };
  private readonly motif: Motif | null;
  /** The pane's corners in the world (bottom left, bottom right, top right, top left), for tests. */
  private readonly pane: THREE.Vector3[];

  constructor(
    nodes: WindowViewNode[],
    skyNode: WindowSkyNode | null,
    motifNode: WindowMotifNode | null,
    private readonly textures: TextureStore,
    options: { reducedMotion?: boolean } = {},
  ) {
    this.frame = placeBlend(nodes, skyNode);
    const [sfHorizon, delhiHorizon] = horizons();
    const shared = {
      uCentre: { value: this.frame.centre },
      uEye: { value: this.frame.eye },
      uOut: { value: this.frame.out },
      uRight: { value: this.frame.right },
      uBand: { value: this.frame.band },
      uHorizonSide: { value: [new THREE.Vector3(...sfHorizon), new THREE.Vector3(...delhiHorizon)] },
      uHaze: { value: farLand(nodes, this.frame) },
    };
    this.views = nodes.map((node) => {
      const old = node.mesh.material as THREE.MeshBasicMaterial;
      // The room's own material carries the day picture when the exporter embedded it (not a deferred placeholder).
      const deferred = old.map?.userData.deferredWindowPicture === true;
      if (deferred) old.map!.dispose();
      const day = deferred ? null : (old.map ?? null);
      const material = new THREE.ShaderMaterial({
        vertexShader: withBlend(landVert),
        fragmentShader: landFrag,
        uniforms: { uDay: { value: day }, ...shared },
      });
      node.mesh.material = material;
      return { node, material, day };
    });
    if (skyNode) {
      const mask = skyNode.mesh.parent?.getObjectByName('window_view_mask');
      skyNode.mesh.updateWorldMatrix(true, false);
      const done = completeDome(skyNode.mesh.geometry, skyNode.mesh.matrixWorld, this.frame, mask ? new THREE.Box3().setFromObject(mask) : null);
      if (done.geometry !== skyNode.mesh.geometry) {
        skyNode.mesh.geometry.dispose();
        skyNode.mesh.geometry = done.geometry;
      }
      Object.assign(this.skyFilled, { cells: done.filledCells, triangles: done.addedTriangles });
    }
    this.skyMaterial = skyNode ? paintSky(skyNode.mesh, this.frame) : null;
    const glass = (skyNode?.mesh.parent ?? motifNode?.anchor.parent)?.getObjectByName('window_glass');
    const box = glass ? new THREE.Box3().setFromObject(glass) : null;
    const z = box ? (box.min.z + box.max.z) / 2 : 0;
    this.pane = box ? [[box.min.x, box.min.y], [box.max.x, box.min.y], [box.max.x, box.max.y], [box.min.x, box.max.y]].map(([x, y]) => new THREE.Vector3(x, y, z)) : [];
    this.motif = motifNode ? new Motif(motifNode, options.reducedMotion ?? false) : null;
  }

  /** Loads each city's day picture and draws the motif before the room is shown. */
  async load() {
    await Promise.all([...this.views.map((view) => this.fetch(view)), this.motif?.draw()]);
  }

  update(dt: number) {
    this.motif?.update(Math.max(dt, 0));
  }

  /** A feature in the world by name, for tests: the plane (`window_plane`, `_nose`, `_tail`) and the pane's corners (`window_pane_0`..`3`). */
  point(name: string): THREE.Vector3 | null | undefined {
    const plane = /^window_plane(?:_(nose|tail))?$/.exec(name);
    if (plane) return this.motif?.planeWorld((plane[1] as 'nose' | 'tail' | undefined) ?? 'centre') ?? null;
    const corner = /^window_pane_([0-3])$/.exec(name);
    if (corner) return this.pane[Number(corner[1])]?.clone() ?? null;
    return undefined;
  }

  /** "San Francisco and New Delhi" */
  label() {
    return CITY_ORDER.map((id) => CITIES[id].name).join(' and ');
  }

  state(): { sf?: CityState; delhi?: CityState; motif: MotifState | null; sky: boolean; skyFilled: { cells: number; triangles: number } } {
    const cities = Object.fromEntries(this.views.map((v) => [v.node.city, { name: CITIES[v.node.city].name, loaded: v.day != null }]));
    return { ...cities, motif: this.motif?.state() ?? null, sky: this.skyMaterial != null, skyFilled: { ...this.skyFilled } };
  }

  dispose() {
    this.skyMaterial?.dispose();
    this.motif?.dispose();
    for (const view of this.views) {
      view.material.dispose();
      view.day?.dispose();
    }
  }

  private async fetch(view: View) {
    const file = view.node.dayFile;
    if (view.day || !file) return;
    try {
      view.day = await this.textures.ktx2(ROOM_PATH + file);
      view.material.uniforms.uDay.value = view.day;
    } catch (error) {
      console.warn(`room: the window's ${view.node.city} view did not load`, error);
    }
  }
}

/** Where the sky's directions start, the eye the blend is seen from, and the window's out and right directions. */
function placeBlend(nodes: WindowViewNode[], skyNode: WindowSkyNode | null): SkyFrame {
  const centre = vec3();
  const eye = vec3();
  if (skyNode) {
    centre.copy(skyNode.centre);
    eye.copy(skyNode.eye);
  } else {
    // An older room: the window's seam between the halves, facing the room's front (glTF +Z), the eye in front of it.
    const bounds = nodes.map((n) => new THREE.Box3().setFromObject(n.mesh));
    const all = bounds.reduce((box, b) => box.union(b), new THREE.Box3());
    const sf = bounds[nodes.findIndex((n) => n.city === 'sf')];
    const delhi = bounds[nodes.findIndex((n) => n.city === 'delhi')];
    centre.set(sf && delhi ? (sf.max.x + delhi.min.x) / 2 : all.getCenter(vec3()).x, all.min.y, all.max.z);
    eye.copy(centre).add(new THREE.Vector3(0, 0, FALLBACK_EYE_M * WORLD_SCALE));
  }
  const out = vec3().subVectors(centre, eye).setY(0).normalize();
  const right = vec3().crossVectors(out, new THREE.Vector3(0, 1, 0)).normalize();
  return { centre, eye, out, right, band: BLEND_HALF_WIDTH_M * WORLD_SCALE };
}

/** The far land hazes into the sky's horizon: from about half the land's depth behind the window to its far edge. */
function farLand(nodes: WindowViewNode[], frame: SkyFrame) {
  let far = 0;
  for (const node of nodes) {
    const box = new THREE.Box3().setFromObject(node.mesh);
    for (const x of [box.min.x, box.max.x])
      for (const z of [box.min.z, box.max.z]) far = Math.max(far, new THREE.Vector3(x, frame.centre.y, z).sub(frame.centre).dot(frame.out));
  }
  return new THREE.Vector2(far * 0.45, far);
}

/** Gives every vertex of the dome its sky colour (it never changes) and a material that only draws it. */
function paintSky(mesh: THREE.Mesh, frame: SkyFrame) {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const p = vec3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    colours.set(skyColour(p, frame), i * 3);
  }
  mesh.geometry.setAttribute('aSky', new THREE.BufferAttribute(colours, 3));
  const material = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag });
  mesh.material = material;
  return material;
}

// ---- the motif: a plane on a dotted arc from New Delhi to San Francisco ----

// The arc on the motif's canvas (fractions of its width and height): New Delhi's end, the control point, San
// Francisco's end. A route fraction (0 over New Delhi, 1 over San Francisco) measures along the arc's length.
const ARC: [number, number][] = [[0.87, 0.64], [0.5, -0.04], [0.13, 0.64]];
const MOTIF_PX = 2048;
// Dark slate, as pencil marks read against a day sky, with a faint pale halo where the sky is deep blue.
const INK = '#1f2b3a';
const HALO = 'rgba(255, 255, 255, 0.4)';
// The names sit under the arc's ends: their box's centre below each end and its half-size (fractions of the width).
const LABEL_DROP = 0.17;
const LABEL_HALF = [0.12, 0.02] as const;

// The flight: the plane takes off a little past New Delhi's ring and lands short of San Francisco's (ROUTE), crossing in
// FLIGHT_S at an even pace that eases at both ends, fading in and out over FADE of the time; then GROUND_S off the arc
// while its trail fades. Under reduced motion it holds at PARKED_AT with no trail.
const ROUTE = [0.07, 0.93] as const;
const FLIGHT_S = 72;
const GROUND_S = 12;
const FADE = 0.05;
const EASE = 0.3;
const PARKED_AT = 0.62;
// The plane: an airliner LENGTH_M long for the room's 1.24 m motif (the round-8 silhouette was 0.041 m), standing
// LIFT_M in front of the arc; it turns from heading a little toward the room to a little away (YAW_DEG) and banks into
// that turn (BANK_DEG at mid-route).
export const PLANE_LENGTH_M = 0.086;
const MOTIF_WIDTH_M = 1.24;
const LIFT_M = 0.02;
const YAW_DEG = 16;
const BANK_DEG = 14;
// Its livery: white with a pale belly, a red tail, cheatline and winglets, grey wings and engine intakes.
const LIVERY = { white: '#f3f1ec', belly: '#d6d8db', red: '#b3222c', wing: '#c5c9ce', dark: '#2b3038' } as const;
// The diorama's sun (up, to the left and toward the room), for the plane's light.
const SUN = new THREE.Vector3(-0.45, 0.85, 0.35).normalize();
// The trail: TRAIL_ROUTE of the route long, TRAIL_WIDTH_M wide at the plane and at its end, at TRAIL_OPACITY.
const TRAIL_ROUTE = 0.24;
const TRAIL_WIDTH_M = [0.0014, 0.0042] as const;
const TRAIL_OPACITY = 0.5;
const TRAIL_LIFT_M = 0.0015;

function arcPoint(s: number, w: number, h: number): [number, number] {
  const [a, b, c] = ARC;
  const u = 1 - s;
  return [(u * u * a[0] + 2 * u * s * b[0] + s * s * c[0]) * w, (u * u * a[1] + 2 * u * s * b[1] + s * s * c[1]) * h];
}

/** The arc on the motif's plane (metres, +y up) by route fraction, and the boxes of the two names under its ends. */
export function flightPath(width: number, height: number) {
  const at = (s: number) => {
    const [x, y] = arcPoint(s, 1, 1);
    return new THREE.Vector2((x - 0.5) * width, (0.5 - y) * height);
  };
  const STEPS = 512;
  const lengths = [0];
  for (let i = 1; i <= STEPS; i++) lengths.push(lengths[i - 1] + at(i / STEPS).distanceTo(at((i - 1) / STEPS)));
  const total = lengths[STEPS];
  /** The curve's own parameter where the route fraction `u` lies. */
  const curveAt = (u: number) => {
    const target = THREE.MathUtils.clamp(u, 0, 1) * total;
    let i = 1;
    while (i < STEPS && lengths[i] < target) i++;
    return (i - 1 + (target - lengths[i - 1]) / Math.max(lengths[i] - lengths[i - 1], 1e-9)) / STEPS;
  };
  const point = (u: number) => at(curveAt(u));
  const heading = (u: number) => at(Math.min(curveAt(u) + 1e-3, 1)).sub(at(Math.max(curveAt(u) - 1e-3, 0))).normalize();
  const labels = [0, 1].map((s) => {
    const end = at(s);
    const centre = new THREE.Vector2(end.x, end.y - LABEL_DROP * height);
    const half = new THREE.Vector2(LABEL_HALF[0] * width, LABEL_HALF[1] * width);
    return new THREE.Box2(centre.clone().sub(half), centre.clone().add(half));
  });
  return { length: total, point, heading, labels };
}

/** Where the plane is along the route `k` of the way through its flight time: even in the middle, easing at the ends. */
export function routeAt(k: number) {
  return ROUTE[0] + (ROUTE[1] - ROUTE[0]) * (k - (EASE * Math.sin(2 * Math.PI * k)) / (2 * Math.PI));
}

function canvasTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Collects flat-coloured triangles with their normals (one colour per face, so the livery's edges stay crisp). */
class Faces {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colours: number[] = [];

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colour: THREE.Color, normals?: THREE.Vector3[]) {
    const flat = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    [a, b, c].forEach((p, i) => {
      this.positions.push(p.x, p.y, p.z);
      const n = normals?.[i] ?? flat;
      this.normals.push(n.x, n.y, n.z);
      this.colours.push(colour.r, colour.g, colour.b);
    });
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, colour: THREE.Color, normals?: THREE.Vector3[]) {
    this.tri(a, b, c, colour, normals && [normals[0], normals[1], normals[2]]);
    this.tri(a, c, d, colour, normals && [normals[0], normals[2], normals[3]]);
  }

  /** A thin plate: the quad `top` (counter-clockwise seen from `out`) and its copy `thickness` behind, closed round. */
  slab(top: THREE.Vector3[], out: THREE.Vector3, thickness: number, colour: THREE.Color) {
    const half = out.clone().normalize().multiplyScalar(thickness / 2);
    const a = top.map((p) => p.clone().add(half));
    const b = top.map((p) => p.clone().sub(half));
    this.quad(a[0], a[1], a[2], a[3], colour);
    this.quad(b[3], b[2], b[1], b[0], colour);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(b[i], b[j], a[j], a[i], colour);
    }
  }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('aColour', new THREE.Float32BufferAttribute(this.colours, 3));
    return geometry;
  }
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * A twin-engined airliner `length` long, nose along +x, up +y, right wing +z: a round fuselage with an upswept tail cone,
 * swept wings with winglets, two engines, the tailplane and the fin. In proportion with a narrow-body jet, no one's
 * livery: white, a pale belly, a red cheatline, tail and winglets.
 */
function airliner(length: number) {
  const L = length;
  const R = 0.052 * L;
  const c = Object.fromEntries(Object.entries(LIVERY).map(([k, hex]) => [k, new THREE.Color().setStyle(hex, THREE.SRGBColorSpace)])) as Record<
    keyof typeof LIVERY,
    THREE.Color
  >;
  const faces = new Faces();

  // Fuselage: rings along x from the tail (t 0) to the nose (t 1).
  const radius = (t: number) => {
    if (t < 0.24) return R * (0.16 + 0.84 * Math.sqrt(1 - (1 - t / 0.24) ** 2));
    if (t > 0.84) return R * Math.sqrt(Math.max(0, 1 - ((t - 0.84) / 0.16) ** 2));
    return R;
  };
  const centreY = (t: number) => (t < 0.24 ? R * 0.62 * (1 - t / 0.24) ** 2 : t > 0.84 ? -R * 0.12 * ((t - 0.84) / 0.16) ** 2 : 0);
  const STATIONS = [0, 0.03, 0.07, 0.12, 0.18, 0.24, 0.35, 0.5, 0.65, 0.78, 0.84, 0.88, 0.915, 0.945, 0.97, 0.988, 1];
  const AROUND = 40;
  const ring = (t: number) =>
    Array.from({ length: AROUND + 1 }, (_, j) => {
      const theta = (2 * Math.PI * j) / AROUND;
      return v3(-L / 2 + t * L, centreY(t) + radius(t) * Math.cos(theta), radius(t) * Math.sin(theta));
    });
  const normalAt = (t: number, j: number) => {
    const theta = (2 * Math.PI * j) / AROUND;
    const slope = (radius(Math.min(t + 0.01, 1)) - radius(Math.max(t - 0.01, 0))) / (0.02 * L);
    return v3(-slope, Math.cos(theta), Math.sin(theta)).normalize();
  };
  const paint = (t: number, fromTop: number) => {
    const deg = THREE.MathUtils.radToDeg(fromTop);
    if (t > 0.885 && t < 0.935 && deg > 50 && deg < 76) return c.dark;
    if (t > 0.1 && t < 0.88 && deg > 76 && deg < 102) return c.red;
    if (deg > 128) return c.belly;
    return c.white;
  };
  for (let i = 0; i + 1 < STATIONS.length; i++) {
    const [t0, t1] = [STATIONS[i], STATIONS[i + 1]];
    const [r0, r1] = [ring(t0), ring(t1)];
    for (let j = 0; j < AROUND; j++) {
      const mid = (2 * Math.PI * (j + 0.5)) / AROUND;
      const fromTop = Math.acos(Math.cos(mid));
      const n = [normalAt(t0, j), normalAt(t0, j + 1), normalAt(t1, j + 1), normalAt(t1, j)];
      faces.quad(r0[j], r0[j + 1], r1[j + 1], r1[j], paint((t0 + t1) / 2, fromTop), n);
    }
  }

  // Wings, low on the fuselage, swept 27° with 5° of dihedral; a red winglet at each tip; an engine under each.
  const wingY = -0.45 * R;
  const half = 0.475 * L;
  const sweep = Math.tan(THREE.MathUtils.degToRad(27));
  const dihedral = Math.tan(THREE.MathUtils.degToRad(5));
  const rootLE = 0.07 * L;
  const [rootChord, tipChord] = [0.21 * L, 0.065 * L];
  for (const side of [1, -1]) {
    const z0 = side * 0.85 * R;
    const z1 = side * half;
    const tipLE = rootLE - (half - 0.85 * R) * sweep;
    const tipY = wingY + (half - 0.85 * R) * dihedral;
    const top = [v3(rootLE, wingY, z0), v3(rootLE - rootChord, wingY, z0), v3(tipLE - tipChord, tipY, z1), v3(tipLE, tipY, z1)];
    faces.slab(side > 0 ? top : [top[0], top[3], top[2], top[1]], v3(0, 1, 0), 0.012 * L, c.wing);
    const lean = side * 0.25;
    const winglet = [v3(tipLE - 0.01 * L, tipY, z1), v3(tipLE - tipChord, tipY, z1), v3(tipLE - tipChord - 0.02 * L, tipY + 0.055 * L, z1 + lean * 0.055 * L), v3(tipLE - tipChord + 0.012 * L, tipY + 0.055 * L, z1 + lean * 0.055 * L)];
    faces.slab(side > 0 ? winglet : [winglet[0], winglet[3], winglet[2], winglet[1]], v3(0, 0, side), 0.006 * L, c.red);
    // The engine: a nacelle hung below and ahead of the wing at a third of its half-span.
    const ez = side * 0.17 * L;
    const ex = rootLE - (0.17 * L - 0.85 * R) * sweep - 0.03 * L;
    const ey = wingY + (0.17 * L - 0.85 * R) * dihedral - 0.055 * L;
    const profile: [number, number][] = [[0.05, 0.62], [0.035, 0.95], [0.0, 1], [-0.07, 0.92], [-0.11, 0.55]];
    const SEG = 16;
    const nacelle = (k: number) =>
      Array.from({ length: SEG + 1 }, (_, j) => {
        const a = (2 * Math.PI * j) / SEG;
        const [dx, r] = profile[k];
        return v3(ex + dx * L, ey + 0.042 * L * r * Math.cos(a), ez + 0.042 * L * r * Math.sin(a));
      });
    for (let k = 0; k + 1 < profile.length; k++) {
      const [a, b] = [nacelle(k), nacelle(k + 1)];
      for (let j = 0; j < SEG; j++) faces.quad(a[j], a[j + 1], b[j + 1], b[j], c.white);
    }
    const lip = nacelle(0);
    const intake = v3(ex + 0.045 * L, ey, ez);
    for (let j = 0; j < SEG; j++) faces.tri(intake, lip[j + 1], lip[j], c.dark);
  }

  // The tailplane on the tail cone, and the red fin on top of it.
  const stabY = 0.25 * R;
  for (const side of [1, -1]) {
    const [rootX, span] = [-0.33 * L, 0.17 * L];
    const tipX = rootX - span * Math.tan(THREE.MathUtils.degToRad(30));
    const top = [v3(rootX, stabY, side * 0.3 * R), v3(rootX - 0.12 * L, stabY, side * 0.3 * R), v3(tipX - 0.05 * L, stabY + 0.01 * L, side * span), v3(tipX, stabY + 0.01 * L, side * span)];
    faces.slab(side > 0 ? top : [top[0], top[3], top[2], top[1]], v3(0, 1, 0), 0.008 * L, c.white);
  }
  const fin = [v3(-0.27 * L, 0.85 * R, 0), v3(-0.42 * L, 0.85 * R + 0.2 * L, 0), v3(-0.515 * L, 0.85 * R + 0.2 * L, 0), v3(-0.49 * L, 0.5 * R, 0)];
  faces.slab(fin, v3(0, 0, 1), 0.012 * L, c.red);
  return faces.geometry();
}

/** The trail's ribbon along the whole route; the shader shows only the part behind the plane. */
function trailRibbon(path: ReturnType<typeof flightPath>) {
  const N = 320;
  const centres: number[] = [];
  const across: number[] = [];
  const route: number[] = [];
  const side: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const p = path.point(u);
    const h = path.heading(u);
    for (const s of [-1, 1]) {
      centres.push(p.x, p.y, TRAIL_LIFT_M);
      across.push(-h.y, h.x, 0);
      route.push(u);
      side.push(s);
    }
    if (i < N) index.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(centres, 3));
  geometry.setAttribute('aCentre', new THREE.Float32BufferAttribute(centres, 3));
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 3));
  geometry.setAttribute('aRoute', new THREE.Float32BufferAttribute(route, 1));
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  geometry.setIndex(index);
  return geometry;
}

class Motif {
  private readonly arc: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly plane: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly trail: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly path: ReturnType<typeof flightPath>;
  private readonly width: number;
  private readonly height: number;
  private readonly canvasH: number;
  private readonly planeLength: number;
  private clock = 0;
  private drawn = false;
  private bank = 0;
  /** Route fraction of the plane, or -1 while it is off the arc. */
  private u = PARKED_AT;

  constructor(
    node: WindowMotifNode,
    private readonly still: boolean,
  ) {
    this.width = node.widthM;
    this.height = node.heightM;
    this.canvasH = Math.round((MOTIF_PX * this.height) / this.width);
    this.path = flightPath(this.width, this.height);
    this.arc = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, this.height),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }),
    );
    this.arc.name = 'window_motif_arc';
    this.planeLength = PLANE_LENGTH_M * (this.width / MOTIF_WIDTH_M);
    this.plane = new THREE.Mesh(
      airliner(this.planeLength),
      new THREE.ShaderMaterial({
        vertexShader: planeVert,
        fragmentShader: planeFrag,
        uniforms: { uSun: { value: SUN.clone() }, uOpacity: { value: 0 } },
        transparent: true,
      }),
    );
    this.plane.name = 'window_motif_plane';
    this.trail = new THREE.Mesh(
      trailRibbon(this.path),
      new THREE.ShaderMaterial({
        vertexShader: trailVert,
        fragmentShader: trailFrag,
        uniforms: {
          uHead: { value: 0 },
          uLength: { value: TRAIL_ROUTE },
          uWidth: { value: new THREE.Vector2(...TRAIL_WIDTH_M).multiplyScalar(this.width / MOTIF_WIDTH_M) },
          uColour: { value: new THREE.Color(1, 1, 1) },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.trail.name = 'window_motif_trail';
    this.trail.visible = !still;
    node.anchor.add(this.arc, this.trail, this.plane);
    this.clock = ((PARKED_AT - ROUTE[0]) / (ROUTE[1] - ROUTE[0])) * FLIGHT_S;
    this.place(PARKED_AT, 0);
  }

  async draw() {
    await loadHand();
    const arc = document.createElement('canvas');
    arc.width = MOTIF_PX;
    arc.height = this.canvasH;
    const ctx = arc.getContext('2d')!;
    const [w, h] = [arc.width, arc.height];
    ctx.shadowColor = HALO;
    ctx.shadowBlur = 6;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    // Dots every GAP px along the arc, measured along its length, clear of the end markers.
    const GAP = w * 0.0118;
    const steps = 2000;
    let travelled = 0;
    let next = GAP * 2.2;
    let [px, py] = arcPoint(0, w, h);
    let length = 0;
    for (let i = 1; i <= steps; i++) {
      const [x, y] = arcPoint(i / steps, w, h);
      length += Math.hypot(x - px, y - py);
      [px, py] = [x, y];
    }
    [px, py] = arcPoint(0, w, h);
    for (let i = 1; i <= steps; i++) {
      const [x, y] = arcPoint(i / steps, w, h);
      travelled += Math.hypot(x - px, y - py);
      [px, py] = [x, y];
      if (travelled >= next && travelled <= length - GAP * 2.2) {
        ctx.beginPath();
        ctx.arc(x, y, w * 0.0017, 0, Math.PI * 2);
        ctx.globalAlpha = 0.85;
        ctx.fill();
        next += GAP;
      }
    }
    ctx.globalAlpha = 1;
    const names: [string, number][] = [[CITIES.delhi.name, 0], [CITIES.sf.name, 1]];
    for (const [name, s] of names) {
      const [x, y] = arcPoint(s, w, h);
      ctx.lineWidth = w * 0.0017;
      ctx.beginPath();
      ctx.arc(x, y, w * 0.0049, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, w * 0.0017, 0, Math.PI * 2);
      ctx.fill();
      writeHand(ctx, name, x, y + h * LABEL_DROP, {
        size: w * 0.033,
        slant: 0.06,
        turn: s === 0 ? -0.025 : 0.02,
        colour: INK,
        weight: 0.045,
        maxWidth: w * LABEL_HALF[0] * 2,
        maxLines: 1,
        lineHeight: 1.1,
        seed: seedOf(name),
      });
    }
    this.arc.material.map = canvasTexture(arc);
    this.arc.material.opacity = 1;
    this.arc.material.needsUpdate = true;
    this.drawn = true;
    this.place(this.u < 0 ? PARKED_AT : this.u, 1);
  }

  update(dt: number) {
    if (this.still || !this.drawn) return;
    this.clock = (this.clock + dt) % (FLIGHT_S + GROUND_S);
    const trail = this.trail.material.uniforms;
    if (this.clock > FLIGHT_S) {
      // On the ground: no plane; the trail stays where it ended and fades.
      this.u = -1;
      this.plane.visible = false;
      trail.uHead.value = ROUTE[1];
      trail.uOpacity.value = TRAIL_OPACITY * Math.max(0, 1 - (this.clock - FLIGHT_S) / GROUND_S) ** 2;
      return;
    }
    const k = this.clock / FLIGHT_S;
    const fade = Math.min(1, k / FADE, (1 - k) / FADE);
    this.place(routeAt(k), fade);
    // The trail starts at the plane's tail.
    trail.uHead.value = this.u - (0.5 * this.planeLength) / this.path.length;
    trail.uOpacity.value = TRAIL_OPACITY * Math.min(1, k / FADE);
  }

  state(): MotifState {
    return {
      drawn: this.drawn,
      plane: Number(this.u.toFixed(3)),
      moving: !this.still && this.drawn,
      trail: this.trail.visible ? Number(this.trail.material.uniforms.uOpacity.value.toFixed(3)) : 0,
      bankDeg: Number(this.bank.toFixed(2)),
    };
  }

  /** The plane's centre, nose or tail in the world, for tests (null while it is off the arc). */
  planeWorld(part: 'centre' | 'nose' | 'tail' = 'centre') {
    if (this.u < 0 || !this.plane.visible) return null;
    const x = part === 'nose' ? this.planeLength / 2 : part === 'tail' ? -this.planeLength / 2 : 0;
    return this.plane.localToWorld(new THREE.Vector3(x, 0, 0));
  }

  dispose() {
    this.arc.material.map?.dispose();
    for (const mesh of [this.arc, this.plane, this.trail]) {
      mesh.material.dispose();
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
  }

  /** Puts the plane at route fraction `u`, heading along the arc as it turns and banks, at opacity `fade`. */
  private place(u: number, fade: number) {
    this.u = u;
    const p = this.path.point(u);
    const along = this.path.heading(u);
    const progress = THREE.MathUtils.clamp((u - ROUTE[0]) / (ROUTE[1] - ROUTE[0]), 0, 1);
    const forward = new THREE.Vector3(along.x, along.y, 0);
    // Up in the motif's plane, on the sky side of the arc.
    const up = new THREE.Vector3(along.y, -along.x, 0);
    if (up.y < 0) up.negate();
    // Heading a little toward the room at take-off and away at landing; banked into that turn, most at mid-route.
    this.bank = BANK_DEG * Math.sin(Math.PI * progress);
    forward.applyAxisAngle(up, THREE.MathUtils.degToRad(YAW_DEG) * Math.cos(Math.PI * progress));
    up.applyAxisAngle(forward, THREE.MathUtils.degToRad(this.bank));
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    up.crossVectors(right, forward).normalize();
    this.plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, right));
    this.plane.position.set(p.x, p.y, LIFT_M);
    this.plane.visible = true;
    this.plane.material.uniforms.uOpacity.value = this.drawn ? fade : 0;
  }
}
