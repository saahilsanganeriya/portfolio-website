import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addShine, prepareProbe, shineBox, shineGeometry } from '../src/scene/World/Shine';

const W = 16;
const H = 8;
const VOID = [0.0042, 0.0034, 0.0029];

/** A Radiance-file probe (top row first) of void, with `bright` at the given file pixels. */
function probe(bright: [number, number][]) {
  const src = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) src.set([...VOID, 1], i * 4);
  for (const [x, y] of bright) src.set([5, 5, 5, 1], (y * W + x) * 4);
  return src;
}

const luma = (out: Uint16Array, x: number, y: number) => THREE.DataUtils.fromHalfFloat(out[(y * W + x) * 4 + 1]);

describe('the room probe', () => {
  /**
   * Catches reflections of the void showing as AgX's lifted grey (sRGB ~49,42,37 against the site's #14110F): the
   * zenith's radiance comes off before the tone curve, so the void reflects as black.
   */
  it('shows the void above the set as black and the lit set as the bake would', () => {
    const out = prepareProbe(probe([[8, 4]]), W, H, 2.8);
    expect(luma(out, 0, 0)).toBeLessThan(0.001);
    expect(Math.max(...[...Array(W * H).keys()].map((i) => luma(out, i % W, Math.floor(i / W))))).toBeGreaterThan(0.9);
  });

  /**
   * Catches a mirrored or turned probe (the desk reflecting the window side of the room): the probe's centre column
   * looks at −z (the back wall); three's equirect puts −z a quarter of the width left of its centre, rows bottom-up.
   */
  it('lays the probe out in three’s equirect: −z a quarter from the left, the zenith in the last row', () => {
    const out = prepareProbe(probe([[W / 2, 1]]), W, H, 2.8);
    expect(luma(out, W / 4, H - 2)).toBeGreaterThan(0.9);
    expect(luma(out, W / 2, H - 2)).toBeLessThan(0.001);
  });
});

describe('the box reflections are projected on', () => {
  /**
   * Catches the window's reflection drawn off the wall it is on: the faded floor reaches past the walls (behind the
   * left wall to x = −4.76 m), but the box must stop at the walls themselves and take the floor's rim only on the open
   * sides.
   */
  it('stops at the two walls and reaches the floor’s faded rim on the open sides', () => {
    const corner: [number, number][] = [[-3.15, 3.9], [-3.15, -0.42], [3.45, -0.42]];
    const fadeOutline: [number, number][] = [[4.86, 1.4], [-4.76, 2], [0, 4.39], [0, -1.59]];
    const { min, max } = shineBox({ corner, fadeOutline }, new THREE.Vector3());
    expect(min.toArray()).toEqual([-3150, 0, -420]);
    expect(max.toArray()).toEqual([4860, 3400, 4390]);
  });
});

/** A room: two tagged meshes, one untagged, and the CRT glass beside the screen. */
function room() {
  const root = new THREE.Group();
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 12), new THREE.MeshBasicMaterial());
  mug.name = 'coffee_mug';
  mug.userData.gloss = 0.22;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  wall.name = 'wall_back';
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  glass.name = 'crt_glow';
  glass.userData.gloss = 0.12;
  glass.visible = false;
  root.add(mug, wall, glass);
  root.updateMatrixWorld(true);
  const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), width: 1, height: 1 };
  return { root, mug, wall, glass, screen: { glass, pose } };
}

describe('the shine overlays', () => {
  /**
   * Catches the CRT's shine vanishing with its hidden glow (a child of an invisible mesh never draws) and shine on
   * surfaces T71 did not tag: one hidden overlay per gloss mesh, riding on it, the CRT's beside it, after the OS hole.
   */
  it('puts one overlay on each gloss mesh, and the CRT glass’s beside it', () => {
    const { root, mug, wall, glass, screen } = room();
    const box = { probeAt: new THREE.Vector3(), min: new THREE.Vector3(-1, -1, -1), max: new THREE.Vector3(1, 1, 1) };
    const overlays = addShine(root, new THREE.Texture(), box, screen);
    expect(overlays.map((o) => o.name).sort()).toEqual(['coffee_mug_shine', 'crt_glow_shine']);
    expect(overlays.every((o) => !o.visible)).toBe(true);
    expect(mug.children.map((c) => c.name)).toEqual(['coffee_mug_shine']);
    expect(wall.children).toHaveLength(0);
    const crt = overlays.find((o) => o.name === 'crt_glow_shine')!;
    expect(crt.parent).toBe(root);
    expect(glass.children).toHaveLength(0);
    expect(crt.renderOrder).toBeGreaterThan(3);
  });

  /**
   * Catches normals worked out in the room file's quantized box: a slanted face of a mesh stretched by its node's scale
   * must come out perpendicular to the face as it stands in the room, or the reflection tilts.
   */
  it('gives a stretched mesh normals perpendicular to its faces as they stand', () => {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 0, 1, 1], 3)),
      new THREE.MeshBasicMaterial(),
    );
    mesh.scale.set(1, 0.05, 3);
    mesh.updateMatrixWorld(true);
    const geometry = shineGeometry(mesh);
    const at = (attribute: string, i: number) => new THREE.Vector3().fromBufferAttribute(geometry.getAttribute(attribute) as THREE.BufferAttribute, i);
    const world = [0, 1, 2].map((i) => at('position', i).applyMatrix4(mesh.matrixWorld));
    const normal = at('normal', 0).applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
    expect(Math.abs(normal.dot(world[1].clone().sub(world[0]).normalize()))).toBeLessThan(1e-5);
    expect(Math.abs(normal.dot(world[2].clone().sub(world[0]).normalize()))).toBeLessThan(1e-5);
  });
});
