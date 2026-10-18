import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Framing, RoomNodes } from '../src/scene/Application/RoomModel';
import { RoomCamera } from '../src/scene/Camera/RoomCamera';

// Room v3's framings (millimetres, as the room shows them): the boot framing, the wide view, the desk, the monitor.
const framing = (position: number[], target: number[]): Framing => ({
  position: new THREE.Vector3(...position).multiplyScalar(1000),
  target: new THREE.Vector3(...target).multiplyScalar(1000),
  fov: 35,
});
const nodes = {
  root: new THREE.Object3D(),
  framings: {
    loading: framing([3.8, 5, 13.9], [-0.45, 0.95, 1.35]),
    idle: framing([2.2, 2.75, 9.2], [-0.45, 0.95, 1.35]),
    desk: framing([0, 1.38, 1.59], [0, 1.01, 0]),
    monitor: framing([0, 1.14, 0.58], [0, 1.14, 0]),
  },
  monitor: { position: new THREE.Vector3(0, 1140, 85), quaternion: new THREE.Quaternion(), width: 344, height: 258 },
} as unknown as RoomNodes;
// 1440 x 900: the reference shape, so framings are used as authored.
const ASPECT = 1440 / 900;

afterEach(() => vi.restoreAllMocks());

/** Flies from the wide view into the monitor, as the arrival does, with frames `dt` seconds apart; returns the eyes. */
function flyIn(dt: number) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const camera = new RoomCamera(nodes, ASPECT);
  camera.fly('idle', 'fast', undefined, true);
  let landed = false;
  camera.fly('monitor', 'monitor', () => (landed = true));
  const eyes = [camera.instance.position.clone()];
  while (camera.moving && now < 20_000) {
    now += dt * 1000;
    camera.update(dt, 0, new THREE.Vector2());
    eyes.push(camera.instance.position.clone());
  }
  return { camera, eyes, landed };
}

const monitorAt = nodes.monitor.position;

/**
 * Catches an arrival that arcs, detours (round 8 passed the window and the mango plant) or overshoots into the glass:
 * from the wide view the camera's distance to the monitor shrinks at every frame and the eye stays on one straight line.
 */
describe('the arrival into the monitor', () => {
  it('is one straight move from the wide view that never steps away from the glass', () => {
    const { camera, eyes, landed } = flyIn(1 / 60);
    expect(landed).toBe(true);
    expect(camera.phase).toBe('monitor');
    for (let i = 1; i < eyes.length; i++) expect(eyes[i].distanceTo(monitorAt)).toBeLessThanOrEqual(eyes[i - 1].distanceTo(monitorAt) + 1e-6);
    const line = new THREE.Line3(eyes[0], eyes.at(-1)!);
    const off = Math.max(...eyes.map((eye) => line.closestPointToPoint(eye, true, new THREE.Vector3()).distanceTo(eye)));
    // World units are millimetres: within a millimetre of the straight line.
    expect(off).toBeLessThan(1);
  });

  /** Catches a flight that bends or overshoots when frames come slowly (a loaded machine): the same line at 4 fps. */
  it('keeps to the same line at four frames a second', () => {
    const fast = flyIn(1 / 60);
    const slow = flyIn(0.25);
    expect(slow.landed).toBe(true);
    expect(slow.eyes.at(-1)!.distanceTo(fast.eyes.at(-1)!)).toBeLessThan(1);
    for (let i = 1; i < slow.eyes.length; i++) expect(slow.eyes[i].distanceTo(monitorAt)).toBeLessThanOrEqual(slow.eyes[i - 1].distanceTo(monitorAt) + 1e-6);
  });
});
