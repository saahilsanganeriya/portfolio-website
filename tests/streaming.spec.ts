import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';
import type {} from '../src/scene/Application/Application';
import type {} from '../src/scene/Application/Resources';

const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

interface Gltf {
  materials: { name: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
  textures: { extensions?: { KHR_texture_basisu?: { source: number } } }[];
  images: { bufferView?: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
}

/** The desk's atlas (room_desk, the surfaces below the monitor), every material sharing it, and its KTX2 bytes. */
function embeddedAtlas() {
  const glb = readFileSync('public/room/room.glb');
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()) as Gltf;
  const bin = 20 + jsonLength + 8;
  const textureOf = (m: Gltf['materials'][number]) => m.pbrMetallicRoughness?.baseColorTexture?.index;
  const atlas = json.materials.find((m) => m.name === 'room_desk' && textureOf(m) !== undefined)!;
  const index = textureOf(atlas)!;
  const view = json.bufferViews[json.images[json.textures[index].extensions!.KHR_texture_basisu!.source].bufferView!];
  return {
    materials: json.materials.filter((m) => textureOf(m) === index).map((m) => m.name),
    ktx2: glb.subarray(bin + (view.byteOffset ?? 0), bin + (view.byteOffset ?? 0) + view.byteLength),
  };
}

const entry = (materials: string[], uri: string, format: string, bytes: number) => ({
  name: 'test',
  materials,
  low: { uri: '/room/room.glb', px: 1024, bytes: 0 },
  full: { uri, px: 2048, bytes, format },
});

/** Serves atlases.json and one atlas file; the file waits for `release` so the test can look before the swap. */
async function serveAtlas(page: Page, json: object, uri: string, body: Buffer, contentType: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const requested: number[] = [];
  await page.route('**/room/atlases.json', (route) => route.fulfill({ json }));
  await page.route(`**${uri}`, async (route: Route) => {
    requested.push(Date.now());
    await released;
    await route.fulfill({ body, contentType });
  });
  return { release, requested };
}

/** At the desk, motion paused: two shots differ only if the room's pixels did. */
async function stillAtDesk(page: Page) {
  await page.addInitScript(() => (window.__roomTier = 0));
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null && !window.__room.moving, null, { timeout: 180_000 });
  await page.evaluate(() => window.__room!.goto('desk'));
  await page.waitForFunction(() => window.__room!.phase === 'desk' && !window.__room!.moving, null, { timeout: 60_000 });
  await page.mouse.move(2, 2);
  await page.locator('[data-room-pause]').click();
  const monitor = (await page.evaluate(() => window.__room!.point('monitor')))!;
  // The keyboard and the desk below the monitor: desk atlas only, away from the CRT glass's own animation.
  return { x: Math.round(monitor.x - 150), y: Math.round(monitor.y + 140), width: 300, height: 120 };
}

async function meanRgb(png: Buffer) {
  const { channels } = await sharp(png).stats();
  return channels.slice(0, 3).map((c) => c.mean);
}

const done = (page: Page) => page.waitForFunction(() => window.__roomStats?.done === true, null, { timeout: 120_000 });

/**
 * Catches the full atlases loading before the first frame (they would count against the 6 MB first-frame budget),
 * a swap that leaves a material on the small texture or keeps both on the GPU, and a visible jump when the same
 * picture arrives at full size (wrong colour space, orientation or UV set on the streamed texture).
 */
test('a KTX2 atlas streams after the room is interactive and swaps in without a jump', async ({ page }) => {
  const { materials, ktx2 } = embeddedAtlas();
  const uri = '/room/atlas/test.ktx2';
  const atlas = await serveAtlas(page, [entry(materials, uri, 'ktx2-etc1s', ktx2.length)], uri, ktx2, 'image/ktx2');
  const clip = await stillAtDesk(page);
  const interactive = await page.evaluate(() => performance.timeOrigin + window.__room!.interactiveAt!);
  const texturesBefore = await page.evaluate(() => window.__roomStats!.gpu.info.textures);
  const before = await page.screenshot({ clip });
  atlas.release();
  await done(page);

  expect(atlas.requested.length, 'the atlas was requested').toBe(1);
  expect(atlas.requested[0], 'not before the room is interactive').toBeGreaterThanOrEqual(interactive);
  const stats = await page.evaluate(() => ({ atlases: window.__roomStats!.atlases, textures: window.__roomStats!.gpu.info.textures }));
  expect(stats.atlases[0].state).toBe('full');
  expect(stats.textures, 'the GPU holds as many textures as before: the first-frame one was freed').toBe(texturesBefore);
  const after = await page.screenshot({ clip });
  const [a, b] = [await meanRgb(before), await meanRgb(after)];
  for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c]), `channel ${c} holds its level`).toBeLessThan(1.5);
});

/** Catches an image atlas (AVIF, WebP, JPEG) never reaching the materials, or reaching them upside down or unlit. */
test('an image atlas decoded off the main thread replaces the first-frame texture on screen', async ({ page }) => {
  const { materials } = embeddedAtlas();
  const uri = '/room/atlas/test.png';
  const magenta = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#ff00ff' } }).png().toBuffer();
  const atlas = await serveAtlas(page, [entry(materials, uri, 'png', magenta.length)], uri, magenta, 'image/png');
  const clip = await stillAtDesk(page);
  const [r0, g0] = await meanRgb(await page.screenshot({ clip }));
  atlas.release();
  await done(page);
  const [r1, g1, b1] = await meanRgb(await page.screenshot({ clip }));
  expect(r1 - g1, 'the desk shows the streamed picture').toBeGreaterThan(r0 - g0 + 40);
  expect(b1 - g1).toBeGreaterThan(40);
  const texture = await page.evaluate(() => window.__roomStats!.gpu.textures.find((t) => t.width === 2048 && t.format === 'RGBA8'));
  expect(texture?.bytes, 'GPU memory counts the full atlas with its mipmaps').toBe(Math.round(2048 * 2048 * 4 * (4 / 3)));
});
