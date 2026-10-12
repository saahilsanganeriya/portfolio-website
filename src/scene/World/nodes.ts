import * as THREE from 'three';
import { POSTER_SLOTS, PRINT_SLOTS } from '../hotspots';
import { WORLD_SCALE, type RoomNodes } from '../Application/RoomModel';
import type { CityId } from './daylight';

// The second room's runtime nodes (PLAN 11.1, 12.1), read by name like RoomModel reads PLAN 3.6. Every one is
// optional: a room without a node simply has no such effect.

export interface WindowViewNode {
  city: CityId;
  mesh: THREE.Mesh;
  /** File names under /room/ from the node's extras (`texture_day`, `texture_night`). */
  dayFile: string | null;
  nightFile: string | null;
}

/** A runtime art surface (poster or print): its slot and the shape of its face. */
export interface ArtNode {
  slot: number;
  mesh: THREE.Mesh;
  /** Width over height of the visible face. */
  aspect: number;
}

export interface WorldNodes {
  windowViews: WindowViewNode[];
  posters: ArtNode[];
  prints: ArtNode[];
  lava: { glass: THREE.Mesh; light: THREE.Vector3 } | null;
  fan: { blades: THREE.Object3D; axis: THREE.Vector3 } | null;
  steam: THREE.Vector3 | null;
  ovenGlow: THREE.Mesh | null;
  album: { closed: THREE.Object3D | null; anchor: THREE.Vector3; width: number; height: number } | null;
  /** The program dial's pivot, and the angle (degrees about its axis) that points the knob at each program's mark. */
  dial: { knob: THREE.Object3D; axis: THREE.Vector3; anglesDeg: Record<string, number> } | null;
  /** The x of the wall the posters hang on (world units), for the lava lamp's light on it. */
  posterWallX: number | null;
}

const AXES: Record<string, THREE.Vector3> = {
  '+X': new THREE.Vector3(1, 0, 0),
  '-X': new THREE.Vector3(-1, 0, 0),
  '+Y': new THREE.Vector3(0, 1, 0),
  '-Y': new THREE.Vector3(0, -1, 0),
  '+Z': new THREE.Vector3(0, 0, 1),
  '-Z': new THREE.Vector3(0, 0, -1),
};

// A proxy nested in a larger one (the dial in the projector's box) is grown this far out of it, through the faces
// it nearly shares with it (or else its nearest face), so a ray reaches it before the larger box.
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

// Where the knob points for each program when the room does not say (the second room's marks; it rests on Photographs).
const DIAL_ANGLES_DEG: Record<string, number> = { reel: 50, photographs: 0, short_films: -50 };

const axisOf = (node: THREE.Object3D) => (AXES[String(node.userData.turn_axis ?? '+Y').toUpperCase()] ?? AXES['+Y']).clone();

/** Face size of a flat mesh from its extras, else from its bounds (the thinnest axis is its depth). */
function faceAspect(mesh: THREE.Mesh) {
  const width = Number(mesh.userData.width_m);
  const height = Number(mesh.userData.height_m);
  if (width > 0 && height > 0) return width / height;
  const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  return Math.max(size.x, size.z) / size.y;
}

/**
 * Reads the world nodes from a room that readRoom has already scaled, and names the poster and print proxies by
 * slot (`hit_poster_<slot>`, `hit_photo_print_<slot>`) so the hotspot table can address them.
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

  // Proxies added after readRoom (stand-ins) are hidden and hit-tested like the room's own.
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && node.name.startsWith('hit_') && !room.proxies.includes(node)) {
      node.visible = false;
      room.proxies.push(node);
    }
  });

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
  // The posters' proxies carry the first room's film ids; order them by slot (extras, else farthest along +z first).
  const posterProxies = room.proxies.filter((p) => /^hit_poster_/.test(p.name) && !/^hit_poster_\d$/.test(p.name));
  const centreZ = (p: THREE.Object3D) => new THREE.Box3().setFromObject(p).getCenter(new THREE.Vector3()).z;
  posterProxies
    .map((proxy) => ({ proxy, z: centreZ(proxy) }))
    .sort((a, b) => b.z - a.z)
    .forEach(({ proxy }, rank) => (proxy.name = `hit_poster_${Number(proxy.userData.poster_slot ?? rank)}`));

  const prints: ArtNode[] = [];
  for (let n = 0; n < PRINT_SLOTS; n++) {
    const art = mesh(`photo_print_${n}`);
    if (!art) continue;
    const slot = Number(art.userData.photo_slot ?? n);
    prints.push({ slot, mesh: art, aspect: Number(art.userData.aspect) || faceAspect(art) });
    // A proxy a few centimetres deep in front of the print, so it wins over the wall's proxy behind it.
    const box = new THREE.Box3().setFromObject(art);
    const size = box.getSize(new THREE.Vector3()).divideScalar(WORLD_SCALE);
    const depth = 0.03;
    const facesX = size.x < size.z;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(facesX ? depth : size.x, size.y, facesX ? size.z : depth));
    proxy.name = `hit_photo_print_${slot}`;
    proxy.position.copy(root.worldToLocal(box.getCenter(new THREE.Vector3())));
    proxy.position.add(new THREE.Vector3(facesX ? depth / 2 : 0, 0, facesX ? 0 : depth / 2));
    proxy.visible = false;
    root.add(proxy);
    proxy.updateMatrixWorld();
    room.proxies.push(proxy);
  }

  const glass = mesh('lava_lamp_glass');
  const lightNode = find('lava_lamp_light');
  const fanBlades = find('ceiling_fan_blades');
  const steam = find('espresso_steam');
  const anchor = find('album_open_anchor');
  const dial = find('projector_dial');
  const wall = mesh('env_wall_left');
  const firstPoster = posters[0]?.mesh;

  return {
    windowViews,
    posters,
    prints,
    lava: glass
      ? { glass, light: lightNode ? worldPosition(lightNode) : new THREE.Box3().setFromObject(glass).getCenter(new THREE.Vector3()) }
      : null,
    fan: fanBlades ? { blades: fanBlades, axis: axisOf(fanBlades) } : null,
    steam: steam ? worldPosition(steam) : null,
    ovenGlow: mesh('oven_glow'),
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
    posterWallX: wall
      ? new THREE.Box3().setFromObject(wall).max.x
      : firstPoster
        ? new THREE.Box3().setFromObject(firstPoster).min.x - 0.03 * WORLD_SCALE
        : null,
  };
}
