import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const graph = (page: Page) => page.evaluate(() => window.__room!.audio!.graph());
const musicLoaded = (page: Page) =>
  page.waitForFunction(() => (window.__room?.audio?.graph().loaded ?? ([] as string[])).filter((k) => k.startsWith('music/')).length === 3, null, {
    timeout: 60_000,
  });

async function idle(page: Page) {
  await page.waitForFunction(() => window.__room?.phase === 'idle' && !window.__room.moving, null, { timeout: 120_000 });
}

/** Catches any sound file (music, props, city) fetched before the visitor's first input, and music that never starts. */
test('no sound loads before the first input; the first key press starts the room and the music', async ({ page }) => {
  const sounds: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/audio/')) sounds.push(pathname);
  });
  await page.goto('/');
  await idle(page);
  expect(sounds).toEqual([]);
  expect((await graph(page)).context).toBe('none');

  await page.keyboard.press('KeyA');
  await musicLoaded(page);
  const after = await graph(page);
  expect(after.context).toBe('running');
  expect(after.state).toBe('room');
  expect(sounds.filter((p) => p.startsWith('/audio/music/')).sort()).toEqual(['/audio/music/beat.webm', '/audio/music/keys.webm', '/audio/music/melody.webm']);
});

/** Catches a volume or mute that resets on the next visit, and a remembered mute that the first input overrides. */
test('volume and mute are remembered; a remembered mute keeps the first input silent until Sound is pressed', async ({ page }) => {
  await page.goto('/');
  await idle(page);
  const volume = page.getByRole('slider', { name: 'Volume' });
  const sound = page.getByRole('button', { name: 'Sound' });
  await page.keyboard.press('KeyA');
  await musicLoaded(page);
  await volume.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await expect(volume).toHaveValue('80');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  expect(await graph(page)).toMatchObject({ volume: 0.8, muted: true });

  await page.reload();
  await idle(page);
  await expect(volume).toHaveValue('80');
  await page.keyboard.press('KeyA');
  expect(await graph(page)).toMatchObject({ context: 'none', muted: true, volume: 0.8 });
  await expect(sound).toHaveAttribute('aria-pressed', 'false');

  await sound.click();
  await musicLoaded(page);
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  const unmuted = await graph(page);
  expect(unmuted).toMatchObject({ context: 'running', muted: false, volume: 0.8 });
  // The slider is a loudness control: the master gain is its square.
  await expect.poll(async () => (await graph(page)).master).toBeCloseTo(0.64, 2);
});

/** Catches music that ignores where the visitor is: the monitor must muffle it, Films must bring in the melody stem. */
test('the music follows the visitor: the monitor muffles it, Films trades the beat for the melody, each by a glide', async ({ page }) => {
  await page.goto('/');
  await idle(page);
  await page.keyboard.press('KeyA');
  await musicLoaded(page);
  const room = await graph(page);
  expect(room.state).toBe('room');
  expect(room.cutoff!.to).toBe(11000);

  await page.evaluate(() => window.__room!.goto('monitor'));
  await page.waitForFunction(() => window.__room?.audio?.graph().state === 'os', null, { timeout: 30_000 });
  const os = await graph(page);
  expect(os.cutoff!.to).toBe(1400);
  expect(os.stems!.beat.to).toBe(0.7);
  // A glide, not a jump: the filter lands later than it was told to move, and the node itself gets there.
  expect(os.cutoff!.at).toBeGreaterThan(os.time!);
  await expect.poll(async () => (await graph(page)).cutoff!.now, { timeout: 10_000 }).toBeLessThan(1500);

  const osFrame = page.frames().find((frame) => frame.url().includes('/os'));
  await osFrame!.evaluate(() => (location.hash = '#films'));
  await page.waitForFunction(() => window.__room?.audio?.graph().state === 'projector', null, { timeout: 15_000 });
  const films = await graph(page);
  expect(films.stems).toMatchObject({ melody: { to: 0.95 }, beat: { to: 0 }, keys: { to: 0.75 } });
  expect(films.cutoff!.to).toBe(11000);
});
