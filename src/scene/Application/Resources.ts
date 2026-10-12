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
