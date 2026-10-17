import * as THREE from 'three';
import { POSTER_SLOTS } from '../hotspots';
import { WORLD_SCALE, type RoomNodes } from '../Application/RoomModel';
import type { CityId } from './daylight';

// The room's runtime nodes (PLAN 11.1, 12.1, PLAN-ROUND-7 §3 and §7), read by name like RoomModel reads PLAN 3.6.
// Every one is optional: a room without a node simply has no such effect.

export interface WindowViewNode {
  city: CityId;
  mesh: THREE.Mesh;
  /** The day picture's file under /room/, from the node's extras (`texture_day`). */
  dayFile: string | null;
}

/** The sky over the window: its dome, where sky directions start, and the window framing's eye. */
export interface WindowSkyNode {
  mesh: THREE.Mesh;
  centre: THREE.Vector3;
  eye: THREE.Vector3;
}

/** Where the window's motif hangs (local +Z toward the room, +X toward Delhi's side) and its size in metres. */
export interface WindowMotifNode {
  anchor: THREE.Object3D;
  widthM: number;
  heightM: number;
}

/** Where the coffee's steam starts (local +Y up) and how wide and tall it rises, in metres. */
export interface CoffeeSteamNode {
  anchor: THREE.Object3D;
  widthM: number;
  heightM: number;
}

/** A runtime art surface (poster, print, sticky note): its slot and the shape of its face. */
export interface ArtNode {
  slot: number;
  mesh: THREE.Mesh;
  /** Width over height of the visible face. */
  aspect: number;
}

/** A sticky note and the paper colour the room gives it. */
export interface StickyNode extends ArtNode {
  paper: THREE.Color;
}

/** A part that turns on a pivot empty: its rest pose, the axis it turns about (local) and how far it goes. */
export interface PivotNode {
  pivot: THREE.Object3D;
  axis: THREE.Vector3;
  rest: THREE.Quaternion;
  angleDeg: number;
}

export interface EspressoNodes {
  /** The coffee's surface in the cup, at its full height as authored, and how far below that the cup is empty. */
  coffee: THREE.Mesh;
  fillDepth: number;
  /** Where the stream leaves the spouts and where the cup's steam rises (world units). */
  spout: THREE.Vector3;
  steam: THREE.Vector3;
}

export interface OvenNodes {
  door: PivotNode | null;
  glow: THREE.Mesh | null;
  croissant: THREE.Object3D | null;
  croissantProxy: THREE.Mesh | null;
  /** The oven's own proxy: the croissant's must reach out in front of it. */
  ovenProxy: THREE.Mesh | null;
  /** The oven body's centre: the door opens away from it. */
  body: THREE.Vector3;
}

export interface WorldNodes {
  windowViews: WindowViewNode[];
  windowSky: WindowSkyNode | null;
  windowMotif: WindowMotifNode | null;
  coffeeSteam: CoffeeSteamNode | null;
  /** Leaves and prints that sway in the breeze (`plant_sway_*`; vertex colour R is how far each vertex may move). */
  sway: THREE.Mesh[];
  posters: ArtNode[];
  /** The Pale Blue Dot print on the space wall and its picture's file beside the room (public/room/). */
  paleBlueDot: { node: ArtNode; file: string } | null;
  stickies: StickyNode[];
  lava: { glass: THREE.Mesh; light: THREE.Vector3 } | null;
  espresso: EspressoNodes | null;
  /** The cup's steam, also when the room has no coffee to pour. */
  steam: THREE.Vector3 | null;
  oven: OvenNodes | null;
}

// Props the round-8 set no longer has (PLAN-ROUND-8 §4): the first room still carries them, so the room hides them and
// drops their hotspot boxes. The corner set has none of these names.
const RETIRED_MESHES = [
  'projector',
  'projector_dial',
  'projector_reel_front',
  'projector_reel_rear',
  'props_projector_dial_plate',
  'roller_screen',
  'roller_screen_housing',
  'projection_surface',
  'photo_album',
];
const RETIRED_PROXIES = new Set(['hit_projector', 'hit_projector_dial', 'hit_projection', 'hit_album', 'hit_photo_board', 'hit_photo_wall']);

/** Hides the retired props and drops their boxes from the room's hotspots. */
function retire(root: THREE.Object3D, proxies: THREE.Mesh[]) {
  for (const name of RETIRED_MESHES) {
    const node = root.getObjectByName(name);
    if (node) node.visible = false;
  }
  for (let i = proxies.length - 1; i >= 0; i--) if (RETIRED_PROXIES.has(proxies[i].name)) proxies.splice(i, 1);
}

const AXES: Record<string, THREE.Vector3> = {
  '+X': new THREE.Vector3(1, 0, 0),
  '-X': new THREE.Vector3(-1, 0, 0),
  '+Y': new THREE.Vector3(0, 1, 0),
  '-Y': new THREE.Vector3(0, -1, 0),
  '+Z': new THREE.Vector3(0, 0, 1),
  '-Z': new THREE.Vector3(0, 0, -1),
};

// A proxy nested in a larger one (the croissant in the oven's box) is grown this far out
// of it, through the faces it nearly shares with it (or else its nearest face), so a ray reaches it before the larger box.
const NESTED_REACH_M = 0.015;
const FLUSH_M = 0.02;

/** Replaces each proxy that sits inside another with one that reaches out of it. */
function exposeNestedProxies(root: THREE.Object3D, proxies: THREE.Mesh[]) {
  const boxes = proxies.map((p) => new THREE.Box3().setFromObject(p));
  const volume = (b: THREE.Box3) => b.getSize(new THREE.Vector3()).toArray().reduce((a, v) => a * v, 1);
  const flush = FLUSH_M * WORLD_SCALE;
  const reach = NESTED_REACH_M * WORLD_SCALE;
  const replacements: [number, THREE.Box3][] = [];
  boxes.forEach((box, i) => {
    const o = boxes.find((other, j) => j !== i && volume(other) > volume(box) && other.clone().expandByScalar(flush).containsBox(box));
    if (!o) return;
    const grown = box.clone();
    const faces = (['x', 'y', 'z'] as const).flatMap((axis) => [
      { axis, side: 'max' as const, gap: o.max[axis] - box.max[axis] },
      { axis, side: 'min' as const, gap: box.min[axis] - o.min[axis] },
    ]);
    const nearest = Math.min(...faces.map((f) => f.gap));
    for (const { axis, side, gap } of faces) {
      if (gap >= flush && gap > nearest) continue;
      if (side === 'max') grown.max[axis] = o.max[axis] + reach;
      else grown.min[axis] = o.min[axis] - reach;
    }
    replacements.push([i, grown]);
  });
  for (const [i, grown] of replacements) {
    const inner = proxies[i];
    const size = grown.getSize(new THREE.Vector3()).divideScalar(WORLD_SCALE);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
    proxy.name = inner.name;
    proxy.userData = inner.userData;
    proxy.position.copy(root.worldToLocal(grown.getCenter(new THREE.Vector3())));
    proxy.visible = false;
    root.add(proxy);
    proxy.updateMatrixWorld();
    inner.name = `${inner.name}_nested`;
    proxies[i] = proxy;
  }
}

const axisOf = (node: THREE.Object3D, fallback = '+Y') =>
  (AXES[String(node.userData.turn_axis ?? fallback).toUpperCase()] ?? AXES[fallback]).clone();

/** Face size of a flat mesh from its extras, else from its bounds (the thinnest axis is its depth). */
function faceAspect(mesh: THREE.Mesh) {
  const width = Number(mesh.userData.width_m);
  const height = Number(mesh.userData.height_m);
  if (width > 0 && height > 0) return width / height;
  const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  return Math.max(size.x, size.z) / size.y;
}

/** The world direction a flat mesh's front face looks (its first triangle, counter-clockwise as glTF draws it). */
function frontOf(mesh: THREE.Mesh): THREE.Vector3 {
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const index = mesh.geometry.getIndex();
  if (!position || position.count < 3) return new THREE.Vector3(0, 0, 1);
  mesh.updateWorldMatrix(true, false);
  const [a, b, c] = [0, 1, 2].map((i) => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld));
  return b.sub(a).cross(c.sub(a)).normalize();
}

/**
 * Whether a flat art mesh's first UV set runs against the picture's reading direction, per axis: u should grow to the
 * viewer's right and v downward (glTF's top-down rows) as the surface is seen from its front face. Returns 1 for an
 * axis to flip, else 0.
 */
export function artUvFlip(mesh: THREE.Mesh): THREE.Vector2 {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const index = geometry.getIndex();
  if (!position || !uv || position.count < 3) return new THREE.Vector2();
  const [a, b, c] = [0, 1, 2].map((i) => (index ? index.getX(i) : i));
  mesh.updateWorldMatrix(true, false);
  const p = [a, b, c].map((i) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  const t = [a, b, c].map((i) => new THREE.Vector2().fromBufferAttribute(uv, i));
  const e1 = p[1].clone().sub(p[0]);
  const e2 = p[2].clone().sub(p[0]);
  const [du1, dv1, du2, dv2] = [t[1].x - t[0].x, t[1].y - t[0].y, t[2].x - t[0].x, t[2].y - t[0].y];
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-9) return new THREE.Vector2();
  // Where u and v grow in the world; the viewer faces the front, so their right is the front's left-hand side.
  const alongU = e1.clone().multiplyScalar(dv2).sub(e2.clone().multiplyScalar(dv1)).divideScalar(det);
  const alongV = e2.clone().multiplyScalar(du1).sub(e1.clone().multiplyScalar(du2)).divideScalar(det);
  const right = frontOf(mesh).negate().cross(new THREE.Vector3(0, 1, 0));
  return new THREE.Vector2(alongU.dot(right) < 0 ? 1 : 0, alongV.y > 0 ? 1 : 0);
}

/** `prefix_0`, `prefix_1`, ... in slot order, however many the room has. */
function numbered(byName: Map<string, THREE.Object3D>, prefix: string): { n: number; mesh: THREE.Mesh }[] {
  const pattern = new RegExp(`^${prefix}_(\\d+)$`);
  return [...byName]
    .map(([name, node]) => ({ n: Number(pattern.exec(name)?.[1] ?? NaN), node }))
    .filter(({ n, node }) => Number.isInteger(n) && node instanceof THREE.Mesh)
    .map(({ n, node }) => ({ n, mesh: node as THREE.Mesh }))
    .sort((a, b) => a.n - b.n);
}

/** A box a few centimetres deep in front of a flat art mesh, named `name`, so it wins over the wall's proxy behind it. */
function proxyInFront(root: THREE.Object3D, art: THREE.Mesh, name: string, depthM = 0.03) {
  const box = new THREE.Box3().setFromObject(art);
  const size = box.getSize(new THREE.Vector3()).divideScalar(WORLD_SCALE);
  const facesX = size.x < size.z;
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(facesX ? depthM : size.x, size.y, facesX ? size.z : depthM));
  proxy.name = name;
  proxy.position.copy(root.worldToLocal(box.getCenter(new THREE.Vector3())));
  // Toward the room: the side the art's front face looks at.
  const normal = new THREE.Vector3(facesX ? 1 : 0, 0, facesX ? 0 : 1);
  const sign = Math.sign(frontOf(art).dot(normal)) || 1;
  proxy.position.addScaledVector(normal, (sign * depthM) / 2);
  proxy.visible = false;
  root.add(proxy);
  proxy.updateMatrixWorld();
  return proxy;
}

/**
 * The motif's anchor: the room's window_motif, or in a room without it a stand-in behind the window's click box, high in
 * the window where the sky shows (1.24 x 0.48 m, as the room's own).
 */
function motifOf(root: THREE.Object3D, motif: THREE.Object3D | null, hit: THREE.Object3D | null): WindowMotifNode | null {
  if (motif) {
    return { anchor: motif, widthM: Number(motif.userData.width_m) || 1.24, heightM: Number(motif.userData.height_m) || 0.48 };
  }
  if (!hit) return null;
  const box = new THREE.Box3().setFromObject(hit);
  const anchor = new THREE.Object3D();
  anchor.name = 'window_motif';
  const at = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    box.min.y + (box.max.y - box.min.y) * 0.72,
    box.min.z - 0.04 * WORLD_SCALE,
  );
  anchor.position.copy(root.worldToLocal(at));
  root.add(anchor);
  anchor.updateMatrixWorld();
  return { anchor, widthM: 1.24, heightM: 0.48 };
}

/** Where the coffee's steam starts: the room's coffee_steam, or in a room without it just under the desk mug's rim. */
function steamOf(root: THREE.Object3D, empty: THREE.Object3D | null, mug: THREE.Object3D | null): CoffeeSteamNode | null {
  if (empty) {
    return { anchor: empty, widthM: Number(empty.userData.width_m) || 0.07, heightM: Number(empty.userData.height_m) || 0.16 };
  }
  if (!mug) return null;
  const box = new THREE.Box3().setFromObject(mug);
  const anchor = new THREE.Object3D();
  anchor.name = 'coffee_steam';
  anchor.position.copy(root.worldToLocal(new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - 0.012 * WORLD_SCALE, (box.min.z + box.max.z) / 2)));
  root.add(anchor);
  anchor.updateMatrixWorld();
  return { anchor, widthM: 0.07, heightM: 0.16 };
}

function pivotOf(node: THREE.Object3D | null, fallbackAngle: number, fallbackAxis = '+Y'): PivotNode | null {
  if (!node) return null;
  return {
    pivot: node,
    axis: axisOf(node, fallbackAxis),
    rest: node.quaternion.clone(),
    angleDeg: Number(node.userData.open_angle_deg) || fallbackAngle,
  };
}

/**
 * Reads the world nodes from a room that readRoom has already scaled, and names the poster, print and sticky-note
 * proxies by slot (`hit_poster_<slot>`, `hit_photo_print_<slot>`, `hit_sticky_note_<slot>`) so the hotspot table can
 * address them.
 */
export function readWorld(room: RoomNodes): WorldNodes {
  const { root } = room;
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((node) => node.name && byName.set(node.name, node));
  const find = (name: string) => byName.get(name) ?? null;
  const mesh = (name: string) => {
    const node = find(name);
    return node instanceof THREE.Mesh ? node : null;
  };
  const worldPosition = (node: THREE.Object3D) => node.getWorldPosition(new THREE.Vector3());
  const centre = (node: THREE.Object3D) => new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());

  // Proxies added after readRoom (stand-ins) are hidden and hit-tested like the room's own.
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && node.name.startsWith('hit_') && !room.proxies.includes(node)) {
      node.visible = false;
      room.proxies.push(node);
    }
  });

  retire(root, room.proxies);
  exposeNestedProxies(root, room.proxies);

  const windowViews: WindowViewNode[] = [];
  for (const city of ['sf', 'delhi'] as const) {
    const view = mesh(`window_view_${city}`);
    if (view) {
      windowViews.push({
        city,
        mesh: view,
        dayFile: typeof view.userData.texture_day === 'string' ? view.userData.texture_day : null,
      });
    }
  }

  const skyMesh = mesh('window_sky');
  const skyCentre = find('window_sky_centre');
  const skyEye = find('window_sky_eye');
  const windowSky =
    skyMesh && skyCentre && skyEye ? { mesh: skyMesh, centre: worldPosition(skyCentre), eye: worldPosition(skyEye) } : null;
  const windowMotif = motifOf(root, find('window_motif'), find('hit_window'));
  const coffeeSteam = steamOf(root, find('coffee_steam'), find('desk_mug'));
  const sway: THREE.Mesh[] = [];
  root.traverse((node) => node instanceof THREE.Mesh && node.name.startsWith('plant_sway_') && sway.push(node));

  const posters: ArtNode[] = [];
  for (let n = 0; n < POSTER_SLOTS; n++) {
    const art = mesh(`poster_art_${n}`);
    if (art) posters.push({ slot: Number(art.userData.poster_slot ?? n), mesh: art, aspect: faceAspect(art) });
  }
  // The posters' proxies carry the room's film ids; order them by slot (extras, else farthest along +z first).
  const posterProxies = room.proxies.filter((p) => /^hit_poster_/.test(p.name) && !/^hit_poster_\d$/.test(p.name));
  posterProxies
    .map((proxy) => ({ proxy, z: centre(proxy).z }))
    .sort((a, b) => b.z - a.z)
    .forEach(({ proxy }, rank) => (proxy.name = `hit_poster_${Number(proxy.userData.poster_slot ?? rank)}`));

  const dot = mesh('print_pale_blue_dot');
  const dotFile = dot?.userData.texture;
  const paleBlueDot = dot && typeof dotFile === 'string' ? { node: { slot: 0, mesh: dot, aspect: faceAspect(dot) }, file: dotFile } : null;

  const stickies: StickyNode[] = numbered(byName, 'sticky_note').map(({ n, mesh: note }) => {
    room.proxies.push(proxyInFront(root, note, `hit_sticky_note_${n}`, 0.008));
    const paper = typeof note.userData.paper === 'string' ? note.userData.paper : '#E8C547';
    return { slot: n, mesh: note, aspect: faceAspect(note), paper: new THREE.Color(paper) };
  });

  const glass = mesh('lava_lamp_glass');
  const lightNode = find('lava_lamp_light');
  const steam = find('espresso_steam');
  const coffee = mesh('espresso_coffee');
  const spout = find('espresso_spout');
  const oven = find('countertop_oven');

  const proxyNamed = (name: string) => room.proxies.find((proxy) => proxy.name === name) ?? null;

  return {
    windowViews,
    windowSky,
    windowMotif,
    coffeeSteam,
    sway,
    posters,
    paleBlueDot,
    stickies,
    lava: glass ? { glass, light: lightNode ? worldPosition(lightNode) : centre(glass) } : null,
    espresso:
      coffee && spout && steam
        ? {
            coffee,
            fillDepth: (Number(coffee.userData.fill_depth_m) || 0.026) * WORLD_SCALE,
            spout: worldPosition(spout),
            steam: worldPosition(steam),
          }
        : null,
    steam: steam ? worldPosition(steam) : null,
    oven: oven
      ? {
          // The door's hinge runs along the bottom edge; 82 degrees is a countertop oven's drop-down stop.
          door: pivotOf(find('oven_door'), 82, '+X'),
          glow: mesh('oven_glow'),
          croissant: find('croissant'),
          croissantProxy: proxyNamed('hit_croissant'),
          ovenProxy: proxyNamed('hit_oven'),
          body: centre(oven),
        }
      : null,
  };
}
