import * as THREE from 'three';
import { POSTER_SLOTS } from '../hotspots';
import { WORLD_SCALE, type RoomNodes } from '../Application/RoomModel';
import type { CityId } from './daylight';

// The room's runtime nodes (PLAN 11.1, 12.1, PLAN-ROUND-7 §3 and §7), read by name like RoomModel reads PLAN 3.6.
// Every one is optional: a room without a node simply has no such effect.

export interface WindowViewNode {
  city: CityId;
  mesh: THREE.Mesh;
  /** File names under /room/ from the node's extras (`texture_day`, `texture_night`). */
  dayFile: string | null;
  nightFile: string | null;
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

export interface ProjectorNodes {
  /** The plane the film lands on (the roller screen's face when it is down, else the wall), and its size (world units). */
  surface: THREE.Mesh;
  width: number;
  height: number;
  lens: THREE.Vector3 | null;
  /** The reels turn while the film runs. */
  reels: PivotNode[];
  /** The pull-down roller screen, modelled down; rolled up when the projector rests. Null: the film lands on the wall. */
  roller: THREE.Object3D | null;
}

export interface WorldNodes {
  windowViews: WindowViewNode[];
  posters: ArtNode[];
  /** The Pale Blue Dot print on the space wall and its picture's file beside the room (public/room/). */
  paleBlueDot: { node: ArtNode; file: string } | null;
  /** The Instax board's slots (`instax_slot_N`), or the framed prints (`photo_print_N`) of a room without the board. */
  prints: ArtNode[];
  printsAreInstax: boolean;
  stickies: StickyNode[];
  lava: { glass: THREE.Mesh; light: THREE.Vector3 } | null;
  espresso: EspressoNodes | null;
  /** The cup's steam, also when the room has no coffee to pour. */
  steam: THREE.Vector3 | null;
  oven: OvenNodes | null;
  projector: ProjectorNodes | null;
  album: { closed: THREE.Object3D | null; anchor: THREE.Vector3; width: number; height: number } | null;
  /** The program dial's pivot, and the angle (degrees about its axis) that points the knob at each program's mark. */
  dial: { knob: THREE.Object3D; axis: THREE.Vector3; anglesDeg: Record<string, number> } | null;
}

const AXES: Record<string, THREE.Vector3> = {
  '+X': new THREE.Vector3(1, 0, 0),
  '-X': new THREE.Vector3(-1, 0, 0),
  '+Y': new THREE.Vector3(0, 1, 0),
  '-Y': new THREE.Vector3(0, -1, 0),
  '+Z': new THREE.Vector3(0, 0, 1),
  '-Z': new THREE.Vector3(0, 0, -1),
};

// A proxy nested in a larger one (the dial in the projector's box, the croissant in the oven's) is grown this far out
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

// A small part's proxy is its own bounds plus this much: the room's proxy for the dial (2 cm of padding round the
// knob and its plate) covered the middle of the projector's face, so a click meant for the projector turned the dial;
// 1.5 cm round the knob alone keeps the projector's middle its own and leaves the knob about 10 px wide from the wide
// view, the only framing that sees it.
const PART_PAD_M = 0.015;

/** Replaces the named proxy with a box round `part` (its meshes' bounds), a little padded. */
function shrinkToPart(root: THREE.Object3D, proxies: THREE.Mesh[], name: string, part: THREE.Object3D | null) {
  const i = proxies.findIndex((p) => p.name === name);
  if (i < 0 || !part) return;
  const box = new THREE.Box3().setFromObject(part).expandByScalar(PART_PAD_M * WORLD_SCALE);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3()).divideScalar(WORLD_SCALE);
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
  proxy.name = name;
  proxy.position.copy(root.worldToLocal(box.getCenter(new THREE.Vector3())));
  proxy.visible = false;
  root.add(proxy);
  proxy.updateMatrixWorld();
  proxies[i].name = `${name}_padded`;
  proxies[i] = proxy;
}

// Where the knob points for each program when the room does not say (the room's marks; it rests on Photographs).
const DIAL_ANGLES_DEG: Record<string, number> = { reel: 50, photographs: 0, short_films: -50 };

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

  shrinkToPart(root, room.proxies, 'hit_projector_dial', byName.get('projector_dial') ?? null);
  exposeNestedProxies(root, room.proxies);

  const windowViews: WindowViewNode[] = [];
  for (const city of ['sf', 'delhi'] as const) {
    const view = mesh(`window_view_${city}`);
    if (view) {
      windowViews.push({
        city,
        mesh: view,
        dayFile: typeof view.userData.texture_day === 'string' ? view.userData.texture_day : null,
        nightFile: typeof view.userData.texture_night === 'string' ? view.userData.texture_night : null,
      });
    }
  }

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

  // The Instax board when the room has it, else the framed prints of the first v3 export.
  const instax = numbered(byName, 'instax_slot');
  const printMeshes = instax.length ? instax : numbered(byName, 'photo_print');
  const prints: ArtNode[] = printMeshes.map(({ n, mesh: art }) => {
    const slot = Number(art.userData.photo_slot ?? n);
    room.proxies.push(proxyInFront(root, art, `hit_photo_print_${slot}`, instax.length ? 0.012 : 0.03));
    return { slot, mesh: art, aspect: Number(art.userData.aspect) || faceAspect(art) };
  });

  const stickies: StickyNode[] = numbered(byName, 'sticky_note').map(({ n, mesh: note }) => {
    room.proxies.push(proxyInFront(root, note, `hit_sticky_note_${n}`, 0.008));
    const paper = typeof note.userData.paper === 'string' ? note.userData.paper : '#E8C547';
    return { slot: n, mesh: note, aspect: faceAspect(note), paper: new THREE.Color(paper) };
  });

  // The picture on the wall answers a click too: from the projector's framing the projector is behind the camera.
  const roller = find('roller_screen');
  const surface = mesh('projection_surface') ?? (roller instanceof THREE.Mesh ? roller : null);
  if (surface) room.proxies.push(proxyInFront(root, surface, 'hit_projection', 0.02));

  const glass = mesh('lava_lamp_glass');
  const lightNode = find('lava_lamp_light');
  const steam = find('espresso_steam');
  const coffee = mesh('espresso_coffee');
  const spout = find('espresso_spout');
  const anchor = find('album_open_anchor');
  const dial = find('projector_dial');
  const oven = find('countertop_oven');
  const lens = find('projector_lens');

  const proxyNamed = (name: string) => room.proxies.find((proxy) => proxy.name === name) ?? null;

  return {
    windowViews,
    posters,
    paleBlueDot,
    prints,
    printsAreInstax: instax.length > 0,
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
    projector: surface
      ? {
          surface,
          width: (Number(surface.userData.width_m) || 1) * WORLD_SCALE,
          height: (Number(surface.userData.height_m) || 0.5625) * WORLD_SCALE,
          lens: lens ? worldPosition(lens) : null,
          reels: ['projector_reel_front', 'projector_reel_rear'].flatMap((name) => pivotOf(find(name), 0, '+Z') ?? []),
          roller,
        }
      : null,
    album: anchor
      ? {
          closed: find('photo_album'),
          anchor: worldPosition(anchor),
          width: (Number(anchor.userData.width_m) || 0.46) * WORLD_SCALE,
          height: (Number(anchor.userData.height_m) || 0.31) * WORLD_SCALE,
        }
      : null,
    dial: dial
      ? { knob: dial, axis: axisOf(dial), anglesDeg: { ...DIAL_ANGLES_DEG, ...(dial.userData.program_angles_deg as Record<string, number> | undefined) } }
      : null,
  };
}
