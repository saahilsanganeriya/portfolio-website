import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { backPanel } from '../src/scene/World/art';

type P = [number, number, number];

/** A mesh as `backPanel` reads it, built from quads (two triangles each, counter-clockwise seen from their front). */
function build(quads: P[][]) {
  const world: number[] = [];
  const corners: number[] = [];
  for (const quad of quads) {
    const base = world.length / 3;
    world.push(...quad.flat());
    corners.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { world, corners };
}
const facing = (x0: number, y0: number, x1: number, y1: number, z: number): P[] => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
const backing = (x0: number, y0: number, x1: number, y1: number, z: number): P[] => [[x0, y0, z], [x0, y1, z], [x1, y1, z], [x1, y0, z]];

describe('the back of a framed piece', () => {
  // Catches the picture, the frame's wooden back edge or an easel's strut drawn as card (or the panel missed): an easel-back
  // print facing +z, with its picture in front, a back panel, the frame's back edge 3 mm proud of it, and a strut leaning
  // out 2–12 cm behind.
  it('is the back panel alone, not the picture, the frame or the strut', () => {
    const { world, corners } = build([
      facing(-0.15, -0.2, 0.15, 0.2, 0.01), // picture: triangles 0, 1
      backing(-0.14, -0.19, 0.14, 0.19, -0.01), // back panel: 2, 3
      backing(-0.15, 0.19, 0.15, 0.2, -0.013), // the frame's top edge, 3 mm proud of the panel: 4, 5
      [[0.02, 0.15, -0.02], [0.02, -0.18, -0.12], [-0.02, -0.18, -0.12], [-0.02, 0.15, -0.02]], // strut, leaning back: 6, 7
      [[0.15, -0.2, 0.01], [0.15, -0.2, -0.01], [0.15, 0.2, -0.01], [0.15, 0.2, 0.01]], // a side of the frame: 8, 9
    ]);
    expect(backPanel(world, corners, new THREE.Vector3(0, 0, 10), 0.0003).sort((a, b) => a - b)).toEqual([2, 3]);
  });
});
