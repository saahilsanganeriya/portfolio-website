import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Framing, RoomNodes } from '../src/scene/Application/RoomModel';
import { RoomCamera } from '../src/scene/Camera/RoomCamera';

// Room v3's framings (millimetres, as the room shows them): the boot framing, three arrival waypoints, the desk.
const framing = (position: number[], target: number[]): Framing => ({
  position: new THREE.Vector3(...position).multiplyScalar(1000),
  target: new THREE.Vector3(...target).multiplyScalar(1000),
  fov: 35,
});
const WAYPOINTS = [framing([2.75, 1.95, 2.85], [1.85, 1.45, -0.42]), framing([1.3, 1.45, 1.1], [1.44, 1.1, -0.35]), framing([0.4, 1.42, 1.8], [0, 1.05, 0])];
const nodes = {
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

/** Catches an arrival that skips its waypoints (straight to the desk) or lands early, late, or somewhere else. */
describe('the arrival path', () => {
  it('passes through every waypoint and lands at the desk when its time is up, whatever the frame rate', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const camera = new RoomCamera(nodes, ASPECT);
    let landedAt: number | null = null;
    camera.flyPath(WAYPOINTS, 'desk', 4.8, () => (landedAt = now));
    const pointer = new THREE.Vector2();
    const path: THREE.Vector3[] = [];
    // Frames 5 ms apart, so the closest frame to each waypoint is within a few millimetres of it.
    while (camera.moving && now < 10_000) {
      now += 5;
      camera.update(0.005, 0, pointer);
      path.push(camera.instance.position.clone());
    }
    expect(landedAt).toBe(4800);
    expect(camera.phase).toBe('desk');
    expect(camera.instance.position.distanceTo(nodes.framings.desk.position)).toBeLessThan(1);
    for (const w of WAYPOINTS) expect(Math.min(...path.map((p) => p.distanceTo(w.position)))).toBeLessThan(15);
  });

  /** Catches a glide stretched by slow frames: a 4 fps machine still lands on time, it only sees fewer frames. */
  it('keeps its time at four frames a second', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const camera = new RoomCamera(nodes, ASPECT);
    let landedAt: number | null = null;
    camera.flyPath(WAYPOINTS, 'desk', 4.8, () => (landedAt = now));
    while (camera.moving && now < 10_000) {
      now += 250;
      camera.update(0.1, 0, new THREE.Vector2());
    }
    expect(landedAt).toBe(5000);
  });
});
