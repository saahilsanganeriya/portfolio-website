import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD_SCALE } from '../src/scene/Application/RoomModel';
import { lampUniforms } from '../src/scene/World/art';
import { affineUv, Darkroom, hangOrder, printSize } from '../src/scene/World/Darkroom';
import type { Photograph, Picture } from '../src/scene/World/photographs';

const clip = (line: number, k: number, y: number, along: number, hero = false) => ({ line, k, y, along, hero });

describe('the darkroom line', () => {
  /** Catches the set's first photograph off the hero clip, and lines hung out of their order (the hero's, above, below). */
  it('hangs the hero clip first, then its line, the lines above, the lines below, each left to right', () => {
    const clips = [
      clip(2, 1, 1.28, 0.2), clip(0, 0, 2.17, -0.1), clip(1, 1, 1.71, 0.2), clip(1, 0, 1.71, -0.1, true),
      clip(2, 0, 1.28, -0.1), clip(0, 1, 2.17, 0.2), clip(1, 2, 1.71, 0.5),
    ];
    expect(hangOrder(clips).map((c) => `${c.line}_${c.k}`)).toEqual(['1_0', '1_1', '1_2', '0_0', '0_1', '2_0', '2_1']);
  });

  /** Catches a print that spills out of its clip's box, or one smaller than the box allows for its photograph's shape. */
  it('makes each print as big as its photograph’s shape allows inside the clip’s box', () => {
    for (const [maxW, maxH, aspect] of [[0.45, 0.38, 1.4], [0.22, 0.34, 0.8], [0.24, 0.36, 1.78], [0.33, 0.3, 1.33]]) {
      const size = printSize(maxW, maxH, aspect);
      expect(size.paperW).toBeLessThanOrEqual(maxW + 1e-9);
      expect(size.paperH).toBeLessThanOrEqual(maxH + 1e-9);
      expect(Math.max(maxW - size.paperW, maxH - size.paperH)).toBeGreaterThan(0);
      expect(Math.min(maxW - size.paperW, maxH - size.paperH)).toBeCloseTo(0, 9);
      expect(size.photoW / size.photoH).toBeCloseTo(aspect, 9);
    }
  });

  /** Catches prints that read the bake from the wrong place of the atlas, or from a wall whose UVs are not one map. */
  it('reads the wall’s UV map from its face toward the room, and refuses a face that is not one affine map', () => {
    // A wall face at x = -3150 mm, 3.4 m high and 4.4 m long, as T71's first pass maps it into the atlas.
    const face = [[-3150, 0, -540], [-3150, 3400, -540], [-3150, 3400, 3900], [-3150, 0, 3900]];
    const uv = [[0.6001, 0.1279], [0.338, 0.1279], [0.338, 0.4702], [0.6001, 0.4702]];
    const fit = affineUv(face.flat(), uv.flat(), 4)!;
    const at = new THREE.Vector4(-3150, 1700, 1680, 1);
    expect(at.dot(fit.u)).toBeCloseTo((0.6001 + 0.338) / 2, 6);
    expect(at.dot(fit.v)).toBeCloseTo((0.1279 + 0.4702) / 2, 6);
    const twoIslands = [...uv.slice(0, 3), [0.9, 0.9]];
    expect(affineUv(face.flat(), twoIslands.flat(), 4)).toBeNull();
  });
});

const picture = (width: number, height: number): Picture => ({ src: '', width, height });
const photo = (slug: string): Photograph => ({
  slug,
  title: slug,
  year: 2022,
  caption: '',
  camera: 'Canon A-1, 50mm f/1.4',
  order: 0,
  small: picture(480, 320),
  medium: picture(960, 640),
  large: picture(1440, 960),
});

/** A room with one line of `n` clips `spacingM` apart on a wall facing +x, the clip at `heroK` the hero. */
function roomWithClips(n: number, spacingM: number, heroK: number) {
  const root = new THREE.Group();
  root.scale.setScalar(WORLD_SCALE);
  for (let k = 0; k < n; k++) {
    const empty = new THREE.Object3D();
    empty.name = `darkroom_clip_0_${k}`;
    // Local +Z out of the wall (+x in the room), +Y up; the line runs along -z, left to right from the room.
    empty.position.set(-3.1, 1.7, 1 - k * spacingM);
    empty.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    empty.userData = { maxW_m: 0.3, maxH_m: 0.3, tiltDeg: 0, hero: k === heroK };
    root.add(empty);
  }
  root.updateMatrixWorld(true);
  return root;
}

describe('overlapping prints', () => {
  /** Catches a click on two overlapping prints finding the one underneath (the boxes' depth order against the prints'). */
  it('resolve a click to the print on top', () => {
    const root = roomWithClips(3, 0.2, 1);
    const proxies: THREE.Mesh[] = [];
    const darkroom = new Darkroom(root, proxies, [], lampUniforms(), null, false);
    darkroom.hang([photo('hero'), photo('left'), photo('right')]);
    // The renderer updates the new prints' matrices every frame; here, once.
    root.updateMatrixWorld(true);
    const printOf = (name: string) => root.getObjectByName(name.replace('hit_darkroom_print_', 'darkroom_print_'))!;
    // Between the hero (0.3 m wide, 0.2 m from each neighbour) and its left neighbour, both papers cover the point.
    const raycaster = new THREE.Raycaster();
    for (const z of [0.88, 0.92]) {
      raycaster.set(new THREE.Vector3(0, 1.62 * WORLD_SCALE, z * WORLD_SCALE), new THREE.Vector3(-1, 0, 0));
      const papers = raycaster.intersectObjects(root.children.flatMap((c) => c.children.filter((m) => /^darkroom_print_\d+$/.test(m.name))), false);
      expect(papers.length, `two prints overlap at z = ${z}`).toBe(2);
      const hit = raycaster.intersectObjects(proxies, false)[0].object;
      expect(printOf(hit.name)).toBe(papers[0].object);
    }
    expect(darkroom.slugAt(0)).toBe('hero');
  });
});

describe('print density', () => {
  /** Catches prints left soft at the darkroom framing on a big screen, or the close-up set loading for the wide view. */
  it('asks for the close-up set at the darkroom framing on 2560x1440 DPR 2, and the cheap set at 1440x900', () => {
    const darkroom = new Darkroom(roomWithClips(3, 0.3, 1), [], [], lampUniforms(), null, false);
    // cam_photos: 2.35 m in front of the line, 35 degrees vertical.
    const camera = new THREE.PerspectiveCamera(35, 16 / 9);
    camera.position.set(-0.75 * WORLD_SCALE, 1.55 * WORLD_SCALE, 0.7 * WORLD_SCALE);
    camera.updateMatrixWorld(true);
    expect(darkroom.densityFor(camera, 1440 * 2)).toBe('large');
    expect(darkroom.densityFor(camera, 900)).toBe('small');
  });
});
