import * as THREE from 'three';

// The room is authored in metres (PLAN 3.6) and shown in millimetres: CSS3D maps one world unit to one CSS pixel,
// so a 0.34 m screen at metre scale would ask the browser to magnify a sub-pixel element thousands of times.
export const WORLD_SCALE = 1000;

const REQUIRED_FRAMINGS = ['loading', 'idle', 'desk', 'monitor'] as const;
// cam_window and cam_photos come with the second room (PLAN 11.1, 12.1); the camera skips any the room lacks.
const OPTIONAL_FRAMINGS = ['window', 'projector', 'shelf', 'photos'] as const;
export type FramingName = (typeof REQUIRED_FRAMINGS)[number] | (typeof OPTIONAL_FRAMINGS)[number];
/** A framing the camera can rest at (every framing but the boot one). */
export type StationName = Exclude<FramingName, 'loading'>;

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
  framings: Record<(typeof REQUIRED_FRAMINGS)[number], Framing> & Partial<Record<(typeof OPTIONAL_FRAMINGS)[number], Framing>>;
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

/** The projector screen has no proxy in room.glb; this one, made from the screen's bounds, also opens Films. */
const SCREEN_PROXY = 'hit_projector_screen';

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

  const screenSurface = mesh('props_projector_screen_surface');
  if (screenSurface) {
    const box = new THREE.Box3().setFromObject(screenSurface);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).divideScalar(WORLD_SCALE).toArray()));
    proxy.name = SCREEN_PROXY;
    proxy.position.copy(root.worldToLocal(box.getCenter(new THREE.Vector3())));
    proxy.visible = false;
    root.add(proxy);
    proxy.updateMatrixWorld();
    proxies.push(proxy);
  }

  return {
    root,
    framings,
    monitor,
    projector,
    proxies,
    leds,
    crtGlow: mesh('crt_glow'),
    lampBulb: mesh('lamp_bulb'),
    projection: mesh('props_projection'),
    screenSurface,
  };
}
