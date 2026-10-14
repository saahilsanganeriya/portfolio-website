import { devices, expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// Headless Chromium only has WebGL through SwiftShader; the room needs it. Every test here runs under the autoplay
// policy browsers apply to visitors (sound only after a click, tap or key), which Playwright does not set by itself.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const AUTOPLAY_POLICY = '--autoplay-policy=document-user-activation-required';
test.use({ launchOptions: { args: [...WEBGL_ARGS, AUTOPLAY_POLICY] }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const graph = (page: Page) => page.evaluate(() => window.__room!.audio!.graph());
const os = (page: Page) => page.frameLocator('.room-monitor iframe');
const musicLoaded = (page: Page) =>
  page.waitForFunction(() => (window.__room?.audio?.graph().loaded ?? ([] as string[])).filter((k) => k.startsWith('music/')).length === 3, null, {
    timeout: 60_000,
  });

/** The arrival has landed at the desk. */
async function arrived(page: Page) {
  await page.waitForFunction(() => window.__room?.phase === 'desk' && !window.__room.moving, null, { timeout: 120_000 });
}

/** Catches any sound file (music, props, city) fetched before the visitor's first input, and music that never starts. */
test('no sound loads before the first input; the first key press starts the room and the music', async ({ page }) => {
  const sounds: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/audio/')) sounds.push(pathname);
  });
  await page.goto('/');
  await arrived(page);
  expect(sounds).toEqual([]);
  expect((await graph(page)).context).toBe('none');

  await page.keyboard.press('KeyA');
  await musicLoaded(page);
  const after = await graph(page);
  expect(after.context).toBe('running');
  expect(after.state).toBe('room');
  expect(sounds.filter((p) => p.startsWith('/audio/music/')).sort()).toEqual(['/audio/music/beat.webm', '/audio/music/keys.webm', '/audio/music/melody.webm']);
});

/**
 * Catches sound running before any gesture, a first click that leaves the room's context suspended under the
 * browser's autoplay policy, a jump to full level instead of the fade of about a second, and a Sound toggle that never
 * shows there is sound to turn on.
 */
test('under the autoplay policy nothing plays before a gesture; the first click starts the room with a 1 s fade', async ({ page }) => {
  // The policy is live here: a context made at page load, before any gesture, stays suspended.
  await page.addInitScript(() => {
    const probe = new AudioContext();
    setTimeout(() => {
      (window as unknown as { policyState: string }).policyState = probe.state;
      void probe.close();
    }, 300);
  });
  await page.goto('/');
  await arrived(page);
  expect(await page.evaluate(() => (window as unknown as { policyState?: string }).policyState)).toBe('suspended');
  expect((await graph(page)).context).toBe('none');
  const sound = page.getByRole('button', { name: 'Sound' });
  await expect(sound).toHaveAttribute('data-hint', '');

  await page.mouse.click(720, 880);
  const first = await graph(page);
  expect(first.master).toBeLessThan(0.5);
  await expect.poll(async () => (await graph(page)).context).toBe('running');
  await expect(sound).not.toHaveAttribute('data-hint');
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  // About a second: once the context has run 1.05 s the master is at the full volume (gain 1 at 100 %).
  await page.waitForFunction(() => (window.__room!.audio!.graph().time ?? 0) > 1.05, null, { timeout: 30_000 });
  expect((await graph(page)).master).toBeGreaterThan(0.99);
});

/** Catches a first click inside SaahilOS (its own document in the monitor) that never reaches the room, leaving it silent. */
test('a first click inside SaahilOS on the monitor starts the sound', async ({ page }) => {
  await page.goto('/about');
  await arrived(page);
  const about = os(page).getByRole('dialog', { name: 'About' });
  await expect(about).toBeVisible();
  expect((await graph(page)).context).toBe('none');
  await about.click();
  await expect.poll(async () => (await graph(page)).context, { timeout: 15_000 }).toBe('running');
});

test.describe('on a phone', () => {
  const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
  test.use(iPhone13);

  /** Catches a phone deep link whose first tap lands inside SaahilOS (the drawn monitor's own document) and starts nothing. */
  test('a first tap inside SaahilOS on a phone starts the sound', async ({ page }) => {
    await page.goto('/about');
    await page.waitForFunction(() => /room-os|room-2d/.test(document.documentElement.className), null, { timeout: 120_000 });
    // Too slow here for the light room: the drawn monitor took over, and it has no room (or room sound) behind it.
    test.skip((await page.locator('html.room-2d').count()) > 0, 'the light room fell back to the drawn monitor on this machine');
    const about = page.frameLocator('[data-monitor-glass] iframe').getByRole('dialog', { name: 'About' });
    await expect(about).toBeVisible();
    expect((await graph(page)).context).toBe('none');
    await about.tap();
    await expect.poll(async () => (await graph(page)).context, { timeout: 15_000 }).toBe('running');
  });
});

/** Catches a volume or mute that resets on the next visit, and a remembered mute that the first input overrides. */
test('volume and mute are remembered; a remembered mute keeps the first input silent until Sound is pressed', async ({ page }) => {
  await page.goto('/');
  await arrived(page);
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
  await arrived(page);
  await expect(volume).toHaveValue('80');
  // A visitor who turned the sound off is not nagged by the glow, and neither a key nor a click turns it back on.
  await expect(sound).not.toHaveAttribute('data-hint');
  await expect(page.locator('[data-room-status]')).toHaveText(/sound is off, as you left it/);
  await page.keyboard.press('KeyA');
  await page.mouse.click(720, 880);
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
