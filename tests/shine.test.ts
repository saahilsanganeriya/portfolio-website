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
   * Catches reflections of the void showing as a grey veil (its world colour, which AgX lifts to sRGB ~49,42,37 against
   * the site's #14110F): the zenith's radiance comes off, so the void reflects nothing, and the rest keeps its light at
   * the bake's exposure.
   */
  it('takes the void above the set off and keeps the lit set’s light at the bake’s exposure', () => {
    const out = prepareProbe(probe([[8, 4]]), W, H, 2.8);
    expect(luma(out, 0, 0)).toBe(0);
    expect(Math.max(...[...Array(W * H).keys()].map((i) => luma(out, i % W, Math.floor(i / W))))).toBeCloseTo((5 - VOID[1]) * 2 ** 2.8, 1);
  });

  /**
   * Catches a mirrored or turned probe (the desk reflecting the window side of the room): the probe's centre column
   * looks at −z (the back wall); three's equirect puts −z a quarter of the width left of its centre, rows bottom-up.
   */
  it('lays the probe out in three’s equirect: −z a quarter from the left, the zenith in the last row', () => {
    const out = prepareProbe(probe([[W / 2, 1]]), W, H, 2.8);
    expect(luma(out, W / 4, H - 2)).toBeGreaterThan(1);
    expect(luma(out, W / 2, H - 2)).toBe(0);
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

/** A room: three tagged meshes (the CRT glass beside the screen among them) and one untagged. */
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
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
  pane.name = 'window_glass';
  pane.userData.gloss = 0.05;
  root.add(mug, wall, glass, pane);
  root.updateMatrixWorld(true);
  const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), width: 1, height: 1 };
  return { root, mug, wall, glass, pane, screen: { glass, pose } };
}

describe('the shine overlays', () => {
  /**
   * Catches the CRT's shine vanishing with its hidden glow (a child of an invisible mesh never draws), and shine on a
   * surface the set did not tag or the A/B turned down: one hidden overlay per listed gloss mesh, riding on it, the
   * CRT's beside it, after the OS hole.
   */
  it('puts one overlay on each listed gloss mesh, and the CRT glass’s beside it', () => {
    const { root, mug, wall, glass, pane, screen } = room();
    const box = { probeAt: new THREE.Vector3(), min: new THREE.Vector3(-1, -1, -1), max: new THREE.Vector3(1, 1, 1) };
    const overlays = addShine(root, new THREE.Texture(), box, screen, { coffee_mug: 1, crt_glow: 0.25, wall_back: 1 });
    expect(overlays.map((o) => o.name).sort()).toEqual(['coffee_mug_shine', 'crt_glow_shine']);
    expect(overlays.every((o) => !o.visible)).toBe(true);
    expect(mug.children.map((c) => c.name)).toEqual(['coffee_mug_shine']);
    expect(wall.children).toHaveLength(0);
    expect(pane.children).toHaveLength(0);
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
