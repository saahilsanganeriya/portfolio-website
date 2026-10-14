import * as THREE from 'three';

// The room is authored in metres (PLAN 3.6) and shown in millimetres: CSS3D maps one world unit to one CSS pixel,
// so a 0.34 m screen at metre scale would ask the browser to magnify a sub-pixel element thousands of times.
export const WORLD_SCALE = 1000;

const REQUIRED_FRAMINGS = ['loading', 'idle', 'desk', 'monitor'] as const;
// Close-ups and stops the room may add (PLAN-ROUND-7 §3); the camera skips any the room lacks.
const OPTIONAL_FRAMINGS = ['window', 'projector', 'shelf', 'photos', 'espresso', 'oven'] as const;
const TOUR_FRAMING = /^tour_(\d+)$/;
const ARRIVAL_FRAMING = /^arrival_(\d+)$/;
/** A framing the camera can rest at: every framing but the boot one, the tour's stops (`tour_<n>`) included. */
export type StationName = Exclude<(typeof REQUIRED_FRAMINGS)[number], 'loading'> | (typeof OPTIONAL_FRAMINGS)[number] | `tour_${number}`;

export interface Framing {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export interface MonitorPose {
  position: THREE.Vector3;
  /** Local +Z points out of the glass. */
  quaternion: THREE.Quaternion;
  width: number;
  height: number;
}

export interface ProjectorPose {
  lens: THREE.Vector3;
  screenCenter: THREE.Vector3;
}

export interface RoomNodes {
  root: THREE.Object3D;
  framings: Record<(typeof REQUIRED_FRAMINGS)[number], Framing> & Partial<Record<StationName, Framing>>;
  /** The tour's stops (`cam_tour_<n>`) in their numbered order. */
  tour: Extract<StationName, `tour_${number}`>[];
  /** The waypoints the arrival on `/` passes between the boot framing and the desk (`cam_arrival_<n>`), in order. */
  arrival: Framing[];
  monitor: MonitorPose;
  projector: ProjectorPose | null;
  proxies: THREE.Mesh[];
  leds: THREE.Mesh[];
  crtGlow: THREE.Mesh | null;
  lampBulb: THREE.Mesh | null;
  /** The projected picture baked on the projector screen (`props_projection`); the reel plays over it. */
  projection: THREE.Mesh | null;
  /** The screen's fabric (`props_projector_screen_surface`), baked lit by the projector's open gate. */
  screenSurface: THREE.Mesh | null;
}

// Props that come as art meshes with no proxy box of their own: the room raycasts a box around the mesh instead.
const DERIVED_PROXIES = ['print_japanese_lit', 'pennant_gatech'];

/** Reads the PLAN 3.6 node contract from a loaded room (metres), after scaling it to world units. Throws on a missing required node. */
export function readRoom(root: THREE.Object3D): RoomNodes {
  root.scale.setScalar(WORLD_SCALE);
  root.updateMatrixWorld(true);

  const byName = new Map<string, THREE.Object3D>();
  root.traverse((node) => {
    if (node.name) byName.set(node.name, node);
  });
  const find = (name: string) => byName.get(name) ?? null;
  const require = (name: string) => {
    const node = find(name);
    if (!node) throw new Error(`room.glb: missing node ${name}`);
    return node;
  };
  const worldPosition = (node: THREE.Object3D) => node.getWorldPosition(new THREE.Vector3());

  const framing = (name: string): Framing | null => {
    const cam = find(`cam_${name}`);
    const target = find(`cam_${name}_target`);
    if (!cam || !target) return null;
    return { position: worldPosition(cam), target: worldPosition(target), fov: Number(cam.userData.fov_deg) || 35 };
  };
  const framings = {} as RoomNodes['framings'];
  for (const name of REQUIRED_FRAMINGS) {
    const f = framing(name);
    if (!f) throw new Error(`room.glb: missing cam_${name} or cam_${name}_target`);
    framings[name] = f;
  }
  for (const name of OPTIONAL_FRAMINGS) {
    const f = framing(name);
    if (f) framings[name] = f;
  }
  const numbered = (pattern: RegExp) =>
    [...byName.keys()]
      .map((node) => /^cam_(.+)$/.exec(node)?.[1] ?? '')
      .map((name) => ({ name, n: Number(pattern.exec(name)?.[1] ?? NaN) }))
      .filter(({ n }) => Number.isInteger(n))
      .sort((a, b) => a.n - b.n);
  const tour: RoomNodes['tour'] = [];
  for (const { name } of numbered(TOUR_FRAMING)) {
    const f = framing(name);
    if (!f) continue;
    const station = name as `tour_${number}`;
    framings[station] = f;
    tour.push(station);
  }
  const arrival = numbered(ARRIVAL_FRAMING).flatMap(({ name }) => framing(name) ?? []);

  const screen = require('monitor_screen');
  const width = Number(screen.userData.width_m);
  const height = Number(screen.userData.height_m);
  if (!(width > 0 && height > 0)) throw new Error('room.glb: monitor_screen needs width_m and height_m');
  const monitor: MonitorPose = {
    position: worldPosition(screen),
    quaternion: screen.getWorldQuaternion(new THREE.Quaternion()),
    width: width * WORLD_SCALE,
    height: height * WORLD_SCALE,
  };

  const lens = find('projector_lens');
  const screenCenter = find('projector_screen_center');
  const projector = lens && screenCenter ? { lens: worldPosition(lens), screenCenter: worldPosition(screenCenter) } : null;

  const proxies: THREE.Mesh[] = [];
  const leds: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node.name.startsWith('hit_')) {
      node.visible = false;
      proxies.push(node);
    } else if (/^nas_led_\d$/.test(node.name)) {
      leds.push(node);
    }
  });
  leds.sort((a, b) => a.name.localeCompare(b.name));

  const mesh = (name: string) => {
    const node = find(name);
    return node instanceof THREE.Mesh ? node : null;
  };

  for (const name of DERIVED_PROXIES) {
    const art = find(name);
    if (!art || find(`hit_${name}`)) continue;
    const box = new THREE.Box3().setFromObject(art);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).divideScalar(WORLD_SCALE).toArray()));
    proxy.name = `hit_${name}`;
    proxy.position.copy(root.worldToLocal(box.getCenter(new THREE.Vector3())));
    proxy.visible = false;
    root.add(proxy);
    proxy.updateMatrixWorld();
    proxies.push(proxy);
  }

  return {
    root,
    framings,
    tour,
    arrival,
    monitor,
    projector,
    proxies,
    leds,
    crtGlow: mesh('crt_glow'),
    lampBulb: mesh('lamp_bulb'),
    projection: mesh('props_projection'),
    screenSurface: mesh('props_projector_screen_surface'),
  };
}
