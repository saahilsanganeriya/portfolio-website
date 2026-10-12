import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ProgressReporter } from './Resources';

// Development stand-in until the Blender room lands: Henry Heffernan's three baked models from public/room-dev/
// (gitignored, never shipped), wrapped with the PLAN 3.6 empties and proxies the real room.glb carries.
// Delete this file when public/room/room.glb is on main.

const DEV_DIR = '/room-dev/';
const MODELS = [
  { glb: 'environment.glb', texture: 'baked_environment.jpg' },
  { glb: 'computer_setup.glb', texture: 'baked_computer.jpg' },
  { glb: 'decor.glb', texture: 'baked_decor_modified.jpg' },
];
// Henry's units scaled so his 1280-unit screen is 0.344 m wide, the size of the CRT glass in the Blender room.
const METRES_PER_HENRY_UNIT = 0.344 / 1280;
const MODEL_SCALE = 900 * METRES_PER_HENRY_UNIT;
const h = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).multiplyScalar(METRES_PER_HENRY_UNIT);

export async function loadDevRoom(onProgress: ProgressReporter): Promise<THREE.Object3D> {
  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const root = new THREE.Group();
  const total = MODELS.length * 2;
  let done = 0;
  const tick = (label: string) => onProgress(++done / total, label);

  await Promise.all(
    MODELS.map(async ({ glb, texture }) => {
      const [gltf, map] = await Promise.all([
        gltfLoader.loadAsync(DEV_DIR + glb).then((g) => (tick(glb), g)),
        textureLoader.loadAsync(DEV_DIR + texture).then((t) => (tick(texture), t)),
      ]);
      map.flipY = false;
      map.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map });
      gltf.scene.traverse((node) => {
        if (node instanceof THREE.Mesh) node.material = material;
      });
      gltf.scene.scale.setScalar(MODEL_SCALE);
      root.add(gltf.scene);
    }),
  );

  addContractNodes(root);
  return root;
}

function empty(parent: THREE.Object3D, name: string, position: THREE.Vector3, userData: Record<string, unknown> = {}) {
  const node = new THREE.Object3D();
  node.name = name;
  node.position.copy(position);
  node.userData = userData;
  parent.add(node);
  return node;
}

function box(parent: THREE.Object3D, name: string, center: THREE.Vector3, size: THREE.Vector3, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.name = name;
  mesh.position.copy(center);
  parent.add(mesh);
  return mesh;
}

function addContractNodes(root: THREE.Group) {
  // Henry's camera keyframes, converted to metres.
  const frames: Record<string, [THREE.Vector3, THREE.Vector3]> = {
    loading: [h(-35000, 35000, 35000), h(0, -5000, 0)],
    idle: [h(-20000, 9000, 20000), h(0, -1000, 0)],
    desk: [h(0, 1800, 5575), h(0, 500, 0)],
    monitor: [h(0, 950, 2000), h(0, 950, 0)],
  };
  for (const [name, [position, target]] of Object.entries(frames)) {
    empty(root, `cam_${name}`, position, { fov_deg: 35 });
    empty(root, `cam_${name}_target`, target);
  }

  const screenWidth = 0.344;
  const screen = empty(root, 'monitor_screen', h(0, 950, 255), { width_m: screenWidth, height_m: screenWidth * (1024 / 1280) });
  screen.rotation.x = -3 * THREE.MathUtils.DEG2RAD;

  // No projector in Henry's set: the beam crosses the dark floor to the left of the desk.
  empty(root, 'projector_lens', new THREE.Vector3(-1.25, -0.45, 0.85));
  empty(root, 'projector_screen_center', new THREE.Vector3(-1.75, 0.15, -0.9));

  const proxy = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
  proxy.name = 'proxy';
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  box(root, 'hit_mango', v(0.99, -0.31, -0.01), v(0.6, 0.99, 0.73), proxy);
  box(root, 'hit_nas', v(0.5, 0.01, -0.15), v(0.2, 0.33, 0.25), proxy);
  box(root, 'hit_fujifilm_a', v(-0.55, -0.08, 0.27), v(0.13, 0.08, 0.09), proxy);
  box(root, 'hit_fujifilm_b', v(-0.44, 0.0, -0.06), v(0.13, 0.08, 0.09), proxy);
  box(root, 'hit_fujifilm_c', v(-0.78, 0.1, 0.12), v(0.13, 0.08, 0.09), proxy);
  box(root, 'hit_super8', v(-0.78, 0.1, -0.08), v(0.1, 0.12, 0.14), proxy);
  box(root, 'hit_projector', v(-1.3, -0.55, 0.95), v(0.25, 0.25, 0.3), proxy);
  ['the-odyssey-2026', 'la-la-land', 'chungking-express', 'marty-supreme'].forEach((id, i) =>
    box(root, `hit_poster_${id}`, v(-1.55 + i * 0.36, 0.45, -0.6), v(0.3, 0.45, 0.03), proxy),
  );

  const ledMaterial = new THREE.MeshBasicMaterial({ color: 0x223036 });
  for (let i = 0; i < 4; i++) box(root, `nas_led_${i}`, v(0.44, 0.12 - i * 0.025, -0.02), v(0.006, 0.006, 0.004), ledMaterial);

  const glow = new THREE.Mesh(new THREE.PlaneGeometry(screenWidth, screenWidth * 0.8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  glow.name = 'crt_glow';
  glow.position.copy(screen.position);
  glow.rotation.copy(screen.rotation);
  glow.translateZ(0.001);
  root.add(glow);

  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe3b0 }));
  bulb.name = 'lamp_bulb';
  bulb.position.set(-0.86, 0.12, -0.05);
  root.add(bulb);
}
