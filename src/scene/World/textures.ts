import * as THREE from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// The album and the projector often want the same photograph; a few recent downloads are kept for both.
const KEPT_PICTURES = 6;

/**
 * Textures the world fetches by itself (poster art, the window's day and night views, photographs), each fetched
 * once. KTX2 files go through the room's own transcoder; photographs decode off the main thread.
 */
export class TextureStore {
  private readonly compressed = new Map<string, Promise<THREE.Texture>>();
  private readonly pictures = new Map<string, Promise<Blob>>();
  private readonly abort = new AbortController();

  constructor(private readonly ktx2Loader: KTX2Loader) {}

  /** A KTX2 file as a GPU texture. Like the room's own textures it keeps glTF's top-down rows (flipY false). */
  ktx2(url: string): Promise<THREE.Texture> {
    let texture = this.compressed.get(url);
    if (!texture) {
      texture = this.ktx2Loader.loadAsync(url);
      texture.catch(() => this.compressed.delete(url));
      this.compressed.set(url, texture);
    }
    return texture;
  }

  /** A picture decoded off the main thread, for drawing into a canvas. The caller closes it. */
  async bitmap(url: string): Promise<ImageBitmap> {
    let blob = this.pictures.get(url);
    if (blob) this.pictures.delete(url);
    else {
      blob = fetch(url, { signal: this.abort.signal }).then((response) => {
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return response.blob();
      });
      blob.catch(() => this.pictures.delete(url));
    }
    this.pictures.set(url, blob);
    while (this.pictures.size > KEPT_PICTURES) this.pictures.delete(this.pictures.keys().next().value!);
    return createImageBitmap(await blob);
  }

  /** An SVG string drawn at `width` x `height` into a canvas (for posters drawn at runtime). */
  async svg(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image(width, height);
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(image, 0, 0, width, height);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  dispose() {
    this.abort.abort();
    for (const texture of this.compressed.values()) void texture.then((t) => t.dispose()).catch(() => {});
  }
}

const WINDOW_PICTURE = /\/window_[a-z]+_(day|night)\.ktx2$/;

/**
 * While the room loads, `ktx2` hands back a placeholder for the window views' pictures that room.glb references:
 * WindowView fetches each city's day or night picture only when that city needs it. Returns the undo.
 */
export function deferWindowPictures(ktx2: KTX2Loader): () => void {
  const load = ktx2.load.bind(ktx2);
  ktx2.load = (url, onLoad, onProgress, onError) => {
    if (!WINDOW_PICTURE.test(url)) return load(url, onLoad, onProgress, onError);
    const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    placeholder.userData.deferredWindowPicture = true;
    placeholder.needsUpdate = true;
    queueMicrotask(() => onLoad?.(placeholder as unknown as THREE.CompressedTexture));
  };
  return () => {
    ktx2.load = load;
  };
}

/** A canvas as a texture in the room's conventions: sRGB colour, glTF's top-down rows. */
export function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
}
