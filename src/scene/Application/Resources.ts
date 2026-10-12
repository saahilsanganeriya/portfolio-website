import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Progress in [0, 1] with the name of what just loaded, for the BIOS resource list. */
export type ProgressReporter = (progress: number, label: string) => void;

export const ROOM_URL = '/room/room.glb';
const BASIS_PATH = '/room/basis/';

/** Loads the baked room (KTX2 textures, meshopt geometry). Byte progress drives the BIOS percent. */
export async function loadRoom(url: string, renderer: THREE.WebGLRenderer, onProgress: ProgressReporter): Promise<THREE.Object3D> {
  const ktx2 = new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const name = url.split('/').pop() ?? url;
  try {
    const gltf = await loader.loadAsync(url, (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(0.99, event.loaded / event.total), name);
    });
    onProgress(1, name);
    return gltf.scene;
  } finally {
    ktx2.dispose();
  }
}

function roomTextures(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const map = (material as THREE.MeshBasicMaterial).map;
      if (map) textures.add(map);
    }
  });
  return [...textures];
}

/**
 * The light tier's smaller textures, without a second download: the atlases carry full mip chains, so the largest
 * level is dropped and the next one becomes the base (a 4096² atlas becomes 2048², a quarter of the GPU memory).
 * Must run before the first upload.
 */
export function halveTextures(root: THREE.Object3D) {
  for (const texture of roomTextures(root)) {
    if (!(texture instanceof THREE.CompressedTexture) || texture.mipmaps.length < 2) continue;
    texture.mipmaps = texture.mipmaps.slice(1);
    const { width, height } = texture.mipmaps[0];
    texture.image = { width, height };
    texture.needsUpdate = true;
  }
}

/** Base width of each texture in the room, largest first. */
export function textureWidths(root: THREE.Object3D) {
  return roomTextures(root)
    .map((texture) => (texture.image as { width?: number } | null)?.width ?? 0)
    .sort((a, b) => b - a);
}
