import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD_SCALE } from '../src/scene/Application/RoomModel';
import { BLEND_HALF_WIDTH_M, completeDome, skyColour, type SkyFrame } from '../src/scene/World/sky';

// The sky behind the window as the orbit sees it, on the shipped room (public/room/room.glb, read here without the
// site's loader): its dome, the mask round the view, the pane, the back wall and the orbit's limits. World units are
// millimetres, as in the room.

interface Node {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extras?: Record<string, number>;
}
interface Gltf {
  nodes: Node[];
  meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number; normalized?: boolean; type: string }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number; extensions?: { EXT_meshopt_compression?: Meshopt } }[];
}
interface Meshopt {
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';
  filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL';
}

const glb = readFileSync(new URL('../public/room/room.glb', import.meta.url));
const jsonLength = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()) as Gltf;
const bin = glb.subarray(28 + jsonLength, 28 + jsonLength + glb.readUInt32LE(20 + jsonLength));
const parentOf = new Map<number, number>();
gltf.nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));
const nodeIndex = (name: string) => gltf.nodes.findIndex((n) => n.name === name);

/** The node's world matrix in the room's units (the site scales the glTF's metres by WORLD_SCALE). */
function worldOf(i: number) {
  const m = new THREE.Matrix4();
  for (let at: number | undefined = i; at !== undefined; at = parentOf.get(at)) {
    const n = gltf.nodes[at];
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...((n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number])),
      new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
    );
    m.premultiply(local);
  }
  return m.premultiply(new THREE.Matrix4().makeScale(WORLD_SCALE, WORLD_SCALE, WORLD_SCALE));
}

function view(index: number) {
  const bv = gltf.bufferViews[index];
  const ext = bv.extensions?.EXT_meshopt_compression;
  if (!ext) return new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength);
  const out = new Uint8Array(ext.count * ext.byteStride);
  const source = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset ?? 0), ext.byteLength);
  MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, source, ext.mode, ext.filter ?? 'NONE');
  return out;
}

function accessor(i: number) {
  const a = gltf.accessors[i];
  const bytes = view(a.bufferView);
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]!;
  const stride = gltf.bufferViews[a.bufferView].byteStride ?? 0;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(a.count * size);
  const read = {
    5126: (o: number) => data.getFloat32(o, true),
    5125: (o: number) => data.getUint32(o, true),
    5123: (o: number) => data.getUint16(o, true),
    5122: (o: number) => (a.normalized ? Math.max(data.getInt16(o, true) / 32767, -1) : data.getInt16(o, true)),
  }[a.componentType as 5126 | 5125 | 5123 | 5122];
  const width = { 5126: 4, 5125: 4, 5123: 2, 5122: 2 }[a.componentType as 5126]!;
  for (let k = 0; k < a.count; k++)
    for (let c = 0; c < size; c++) out[k * size + c] = read((a.byteOffset ?? 0) + k * (stride || width * size) + c * width);
  return out;
}

/** A mesh node as the room has it: its own geometry and world matrix. */
function meshNode(name: string) {
  const i = nodeIndex(name);
  const primitive = gltf.meshes[gltf.nodes[i].mesh!].primitives[0];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(accessor(primitive.attributes.POSITION), 3));
  geometry.setIndex(Array.from(accessor(primitive.indices)));
  return { geometry, matrix: worldOf(i) };
}

const point = (name: string) => new THREE.Vector3().setFromMatrixPosition(worldOf(nodeIndex(name)));
const boxOf = ({ geometry, matrix }: ReturnType<typeof meshNode>) => {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone().applyMatrix4(matrix);
};

let frame: SkyFrame;
let sky: ReturnType<typeof meshNode>;
let mask: THREE.Box3;

beforeAll(async () => {
  await MeshoptDecoder.ready;
  sky = meshNode('window_sky');
  mask = boxOf(meshNode('window_view_mask'));
  const centre = point('window_sky_centre');
  const eye = point('window_sky_eye');
  const out = centre.clone().sub(eye).setY(0).normalize();
  frame = { centre, eye, out, right: new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0)).normalize(), band: BLEND_HALF_WIDTH_M * WORLD_SCALE };
});

/** Every eye of the orbit (its centre and limits from orbit_center) from which the back wall stands whole. */
function orbitEyes() {
  const centre = point('orbit_center');
  const limits = gltf.nodes[nodeIndex('orbit_center')].extras!;
  const wallFace = boxOf(meshNode('wall_back')).max.z;
  const eyes: THREE.Vector3[] = [];
  for (let az = -180; az < 180; az += 5)
    for (const polar of [limits.minPolarDeg, 50, 59, 70, limits.maxPolarDeg])
      for (const radius of [limits.minDist, 4, 5.7, limits.maxDist]) {
        const [a, p, r] = [THREE.MathUtils.degToRad(az), THREE.MathUtils.degToRad(polar), radius * WORLD_SCALE];
        const eye = new THREE.Vector3(Math.sin(a) * Math.sin(p) * r, Math.cos(p) * r, Math.cos(a) * Math.sin(p) * r).add(centre);
        // Diorama.ts: the wall starts to fade (and hides what lies outside it) 0.2 m before the eye reaches its plane.
        if (eye.z >= wallFace + 0.2 * WORLD_SCALE) eyes.push(eye);
      }
  return eyes;
}

/** The pane (the window's glass: width_m x height_m about its node), as a box in the world. */
function pane() {
  const { width_m: w, height_m: h } = gltf.nodes[nodeIndex('window_glass')].extras!;
  const centre = point('window_glass');
  const half = new THREE.Vector3(w / 2, h / 2, 0).multiplyScalar(WORLD_SCALE);
  return { centre, w, h, min: centre.clone().sub(half), max: centre.clone().add(half) };
}

/** Points on the pane, a grid inset from its edges. */
function panePoints(n = 5, inset = 0.04) {
  const { centre, w, h } = pane();
  const points: THREE.Vector3[] = [];
  for (let u = 0; u < n; u++)
    for (let v = 0; v < n; v++) {
      const [fu, fv] = [inset + ((1 - 2 * inset) * u) / (n - 1), inset + ((1 - 2 * inset) * v) / (n - 1)];
      points.push(centre.clone().add(new THREE.Vector3((fu - 0.5) * w, (fv - 0.5) * h, 0).multiplyScalar(WORLD_SCALE)));
    }
  return points;
}

const placed = (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, side: THREE.Side) => {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side }));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(matrix);
  mesh.matrixWorld.copy(matrix);
  return mesh;
};
let halves: THREE.Mesh[] | null = null;

/**
 * How many of the eyes see the void somewhere on the pane: a ray through it that meets no front face of the sky, nor
 * (asked only then, they are big) either city's land and water.
 */
function unfilled(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) {
  const mesh = placed(geometry, matrix, THREE.FrontSide);
  halves ??= ['window_view_sf', 'window_view_delhi'].map((name) => {
    const half = meshNode(name);
    return placed(half.geometry, half.matrix, THREE.DoubleSide);
  });
  const raycaster = new THREE.Raycaster();
  const panes = panePoints();
  const { min, max } = pane();
  const missed: string[] = [];
  const eyes = orbitEyes();
  for (const eye of eyes)
    for (const p of panes) {
      const d = p.clone().sub(eye).normalize();
      // The opening runs back from the pane to the wall's back face (the mask's front): a ray that leaves it on the way
      // meets the reveal, which is the frame on screen, not the void.
      const back = eye.clone().addScaledVector(d, (mask.max.z - eye.z) / d.z);
      if (back.x < min.x || back.x > max.x || back.y < min.y || back.y > max.y) continue;
      raycaster.set(eye, d);
      if (!raycaster.intersectObject(mesh, false).length && !raycaster.intersectObjects(halves, false).length) {
        missed.push(eye.toArray().map(Math.round).join(','));
        break;
      }
    }
  return { eyes: eyes.length, missed };
}

describe('the sky behind the window, from every angle the orbit allows', () => {
  /**
   * Catches the void through the pane at steep orbit angles: the build culled the dome's faces no framing saw (San
   * Francisco's whole flank and the cap), so from about 55° round to the right the pane showed black. Without
   * completeDome, 215 of its 918 eyes see the void (sky, land and water as shipped, 2026-10-18).
   */
  it('fills the pane from every eye where the back wall stands whole', () => {
    const { geometry, filledCells } = completeDome(sky.geometry, sky.matrix, frame, mask);
    const { eyes, missed } = unfilled(geometry, sky.matrix);
    expect(eyes).toBeGreaterThan(500);
    expect(missed, `${missed.length} of ${eyes} eyes see past the sky, e.g. ${missed.slice(0, 3).join(' | ')}`).toEqual([]);
    // The shipped dome has holes today; a dome built whole needs nothing filled, and this test still holds for it.
    expect(filledCells).toBeGreaterThanOrEqual(0);
  });

  /**
   * Catches a completion that redraws the window framing: every face and vertex the room drew stays as it was (so its
   * colour, worked out per vertex from where it is, stays too), and the added sky stays inside the mask's box, which
   * the diorama needs to hold all of the view to show it from the side.
   */
  it('keeps every face the room drew and stays inside the mask', () => {
    const before = sky.geometry.getAttribute('position');
    const { geometry } = completeDome(sky.geometry, sky.matrix, frame, mask);
    const after = geometry.getAttribute('position');
    const [i0, i1] = [Array.from(sky.geometry.getIndex()!.array), Array.from(geometry.getIndex()!.array)];
    expect(i1.slice(0, i0.length)).toEqual(i0);
    for (let i = 0; i < before.count; i++)
      for (let c = 0; c < 3; c++) expect(after.getComponent(i, c)).toBeCloseTo(before.getComponent(i, c), 6);
    const held = mask.clone().expandByScalar(0.01 * WORLD_SCALE);
    const box = new THREE.Box3().setFromBufferAttribute(after as THREE.BufferAttribute).applyMatrix4(sky.matrix);
    expect(held.containsBox(box), `${box.min.toArray().map(Math.round)} .. ${box.max.toArray().map(Math.round)}`).toBe(true);
    // The added sky is sky: San Francisco's on its far left, never the void.
    const far = new THREE.Vector3(mask.min.x + 100, frame.centre.y + 600, frame.centre.z - 400);
    expect(skyColour(far, frame)[2]).toBeGreaterThan(0.2);
  });
});
