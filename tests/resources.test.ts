import * as THREE from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomRenderer } from '../src/scene/Application/Renderer';
import { AtlasStreamer, halveTextures, textureWidths } from '../src/scene/Application/Resources';

/** A room with one compressed atlas of `size`² and its full mip chain. */
function roomWith(size: number) {
  const mipmaps = [];
  for (let s = size; s >= 1; s /= 2) mipmaps.push({ data: new Uint8Array((Math.max(4, s) * Math.max(4, s)) / 2), width: s, height: s });
  const texture = new THREE.CompressedTexture(mipmaps, size, size, THREE.RGB_ETC1_Format);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: texture })));
  return root;
}

describe('the light tier textures', () => {
  /**
   * Catches phones getting a 512² room: room.glb now embeds a 1024² first-frame set, and dropping the top mip level of
   * every atlas (the rule for the old 4096² atlases) would halve it again.
   */
  it('keeps a first-frame atlas as it is and halves only atlases above 2048²', () => {
    const small = roomWith(1024);
    const large = roomWith(4096);
    halveTextures(small);
    halveTextures(large);
    expect(textureWidths(small)).toEqual([1024]);
    expect(textureWidths(large)).toEqual([2048]);
  });
});

describe('atlas streaming', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Catches a phone downloading the full set: the light tier keeps the first-frame atlases room.glb embeds. */
  it('never fetches the atlas list on the light tier, and does on the full one', async () => {
    const fetches: string[] = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', async (url: string) => (fetches.push(url), new Response('[]')));
    const stream = (light: boolean) => new AtlasStreamer(new THREE.Scene(), {} as RoomRenderer, {} as KTX2Loader, { light, onSwap() {} }).start();
    await stream(true);
    expect(fetches).toEqual([]);
    await stream(false);
    expect(fetches).toEqual(['/room/atlases.json']);
  });
});
