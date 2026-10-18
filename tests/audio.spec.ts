import { devices, expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';
import { musicTests, strictAutoplay } from './music';

// Headless Chromium only has WebGL through SwiftShader; the room needs it. Every test here runs under the autoplay
// policy browsers apply to visitors (sound only after a click, tap or key), which Playwright does not set by itself.
// Playwright's evaluate calls (and every waitForFunction poll) count as a gesture in Chromium, so a test that needs the
// sound held back until its own press uses strictAutoplay, Safari's rule enforced in the page (tests/music.ts).
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const AUTOPLAY_POLICY = '--autoplay-policy=document-user-activation-required';
test.use({ launchOptions: { args: [...WEBGL_ARGS, AUTOPLAY_POLICY] }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const graph = (page: Page) => page.evaluate(() => window.__room!.audio!.graph());
const musicLoaded = (page: Page) =>
  page.waitForFunction(() => (window.__room?.audio?.graph().loaded ?? ([] as string[])).filter((k) => k.startsWith('music/')).length === 3, null, {
    timeout: 60_000,
  });

/** The arrival has ended at the monitor, and the camera is back at the desk. */
async function arrived(page: Page) {
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await page.evaluate(() => window.__room!.goto('desk'));
  await page.waitForFunction(() => window.__room?.phase === 'desk' && !window.__room.moving, null, { timeout: 30_000 });
}

/**
 * Catches a sound file (music, props, city) fetched while the room's own files are still loading (it would delay the
 * room), a context that runs under the policy without a gesture, and music that never starts after one.
 */
test('no sound loads before the room is ready; under the policy the first key press starts the music', async ({ page }) => {
  await page.addInitScript(strictAutoplay);
  await page.goto('/');
  await arrived(page);
  const early = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => new URL(e.name).pathname.startsWith('/audio/') && e.startTime < window.__room!.startedAt!)
      .map((e) => e.name),
  );
  expect(early).toEqual([]);
  expect((await graph(page)).context).toBe('suspended');

  await page.keyboard.press('KeyA');
  await musicLoaded(page);
  await expect.poll(async () => (await graph(page)).context, { timeout: 15_000 }).toBe('running');
  expect((await graph(page)).state).toBe('room');
  const music = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => new URL(e.name).pathname)
      .filter((p) => p.startsWith('/audio/music/'))
      .sort(),
  );
  expect(music).toEqual(['/audio/music/beat.webm', '/audio/music/keys.webm', '/audio/music/melody.webm']);
});

musicTests();

test.describe('on a phone', () => {
  const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
  test.use(iPhone13);

  /** Catches a phone deep link whose first tap lands inside SaahilOS (the drawn monitor's own document) and starts nothing. */
  test('a first tap inside SaahilOS on a phone starts the sound', async ({ page }) => {
    await page.addInitScript(strictAutoplay);
    await page.goto('/about');
    await page.waitForFunction(() => /room-os|room-2d/.test(document.documentElement.className), null, { timeout: 120_000 });
    // Too slow here for the light room: the drawn monitor took over, and it has no room (or room sound) behind it.
    test.skip((await page.locator('html.room-2d').count()) > 0, 'the light room fell back to the drawn monitor on this machine');
    const about = page.frameLocator('[data-monitor-glass] iframe').getByRole('dialog', { name: 'About' });
    await expect(about).toBeVisible();
    expect((await graph(page)).context).not.toBe('running');
    await about.tap();
    await expect.poll(async () => (await graph(page)).context, { timeout: 15_000 }).toBe('running');
  });
});

/** Catches music that ignores where the visitor is: the monitor must muffle it, Films must bring in the melody stem. */
test('the music follows the visitor: the monitor muffles it, Films trades the beat for the melody, each by a glide', async ({ page }) => {
  await page.goto('/');
  await arrived(page);
  await page.keyboard.press('KeyA');
  await musicLoaded(page);
  const room = await graph(page);
  expect(room.state).toBe('room');
  expect(room.cutoff!.to).toBe(11000);

  await page.evaluate(() => window.__room!.goto('monitor'));
  // The graph as it is in the first frame that reports the new state.
  const os = await (
    await page.waitForFunction(
      () => {
        const g = window.__room?.audio?.graph();
        return g?.state === 'os' ? g : null;
      },
      null,
      { timeout: 30_000 },
    )
  ).jsonValue();
  expect(os!.cutoff!.to).toBe(1400);
  expect(os!.stems!.beat.to).toBe(0.7);
  // A glide, not a jump: the filter node is still near the open room's 11 kHz as the state flips, then gets to 1.4 kHz.
  expect(os!.cutoff!.now).toBeGreaterThan(5000);
  await expect.poll(async () => (await graph(page)).cutoff!.now, { timeout: 10_000 }).toBeLessThan(1500);

  const osFrame = page.frames().find((frame) => frame.url().includes('/os'));
  await osFrame!.evaluate(() => (location.hash = '#films'));
  await page.waitForFunction(() => window.__room?.audio?.graph().state === 'projector', null, { timeout: 15_000 });
  const films = await graph(page);
  expect(films.stems).toMatchObject({ melody: { to: 0.95 }, beat: { to: 0 }, keys: { to: 0.75 } });
  expect(films.cutoff!.to).toBe(11000);
});

/**
 * Catches the window's city beds following a clock again: at San Francisco's noon (half past midnight in Delhi) and
 * at its midnight (Delhi's midday) the room must load the same two day beds at the same levels, and no night bed.
 */
test('the window sounds the same at noon and at midnight: both cities by day', async ({ browser }) => {
  // Two room loads in SwiftShader.
  test.setTimeout(420_000);
  const heard: { beds: Record<string, number>; files: string[] }[] = [];
  for (const at of ['2026-06-21T19:00:00Z', '2026-06-22T07:00:00Z']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const files: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/audio/city/')) files.push(pathname);
    });
    await page.clock.setFixedTime(at);
    await page.goto('/');
    await arrived(page);
    await page.keyboard.press('KeyA');
    await page.waitForFunction(() => Object.keys(window.__room?.audio?.graph().beds ?? {}).length === 2, null, { timeout: 60_000 });
    const { beds } = await graph(page);
    heard.push({ beds: Object.fromEntries(Object.entries(beds!).map(([name, gain]) => [name, gain!.to])), files: files.sort() });
    await page.close();
  }
  expect(Object.keys(heard[0].beds).sort()).toEqual(['delhi-day', 'sf']);
  expect(heard[1]).toEqual(heard[0]);
  expect(heard[0].files.filter((file) => file.includes('night'))).toEqual([]);
});
