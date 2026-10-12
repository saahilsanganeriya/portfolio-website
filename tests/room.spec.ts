import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import { HOTSPOTS } from '../src/scene/hotspots';

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
// Software WebGL is slow; the camera glides are timed, so slow frames only stretch the waits.
test.describe.configure({ timeout: 180_000 });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const os = (page: Page) => page.frameLocator('iframe[title^="SaahilOS"]');

async function enterRoom(page: Page) {
  await page.goto('/');
  await page.locator('[data-boot-button]').click({ timeout: 120_000 });
  await page.waitForFunction(() => window.__room?.phase === 'idle' && !window.__room.moving, null, { timeout: 30_000 });
}

async function screenPoint(page: Page, name: string) {
  const point = await page.evaluate((n) => window.__room!.point(n), name);
  expect(point, `${name} is on screen`).not.toBeNull();
  return point!;
}

/** Catches sound starting before the visitor's START click, and a room that never leaves the boot screen. */
test('START unlocks sound and glides to the room; the monitor then opens SaahilOS', async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    (window as unknown as { audioContexts: number }).audioContexts = 0;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        (window as unknown as { audioContexts: number }).audioContexts += 1;
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('[data-boot-button]')).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => (window as unknown as { audioContexts: number }).audioContexts)).toBe(0);

  await page.locator('[data-boot-button]').click();
  await page.waitForFunction(() => window.__room?.phase === 'idle' && !window.__room.moving, null, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { audioContexts: number }).audioContexts)).toBe(1);
  await expect(page.locator('[data-boot]')).toBeHidden();

  const monitor = await screenPoint(page, 'monitor');
  await page.mouse.move(monitor.x, monitor.y);
  await page.mouse.click(monitor.x, monitor.y);
  await page.waitForFunction(() => window.__room?.phase === 'monitor', null, { timeout: 15_000 });
  await expect(os(page).locator('.os-desktop')).toBeVisible();
  await expect(os(page).getByRole('dialog', { name: 'Projects' })).toBeVisible();
});

/** Catches a prop proxy that is not hit-tested, or a hotspot that zooms in without telling the OS what to open. */
test('hovering the mango plant labels it, and clicking it opens About in SaahilOS', async ({ page }) => {
  await enterRoom(page);
  const mango = await screenPoint(page, 'hit_mango');
  await page.mouse.move(mango.x, mango.y);
  await expect(page.locator('.room-label')).toHaveText('About');
  await page.mouse.click(mango.x, mango.y);
  await page.waitForFunction(() => window.__room?.phase === 'monitor', null, { timeout: 15_000 });
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();
});

/** Catches a keyboard or screen-reader visitor being trapped in the room (Review Focus 3). */
test('"Skip the room" is the first tab stop, every prop has a real link, and motion can be paused', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip the room' })).toBeFocused();

  const inTheRoom = page.getByRole('region', { name: 'In the room' });
  for (const { label, href } of HOTSPOTS) {
    await expect(inTheRoom.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
  }
  await expect(page.getByRole('button', { name: 'Pause motion' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.getByRole('button', { name: 'Pause motion' })).toHaveAttribute('aria-pressed', 'true');
});

/** Catches WCAG failures on the boot screen and the room's own controls (the OS inside the monitor is T5's). */
test('the room has no axe violations, before and after START', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-boot-button]')).toBeVisible({ timeout: 120_000 });
  const check = async (when: string) => {
    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude('iframe').analyze();
    expect(violations.map((v) => `${when}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  };
  await check('boot');
  await page.locator('[data-boot-button]').click();
  await page.waitForFunction(() => window.__room?.phase === 'idle' && !window.__room.moving, null, { timeout: 30_000 });
  await check('room');
});

/** Catches the reduced-motion visitor getting camera motion, or downloading the scene they will not see. */
test('reduced motion shows a still of the room and loads no scene code', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sceneRequests: string[] = [];
  page.on('request', (r) => /\/_astro\/main\.|\.glb$|\.ktx2$/.test(r.url()) && sceneRequests.push(r.url()));
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/room-still/);
  await expect(page.locator('.room-still figcaption')).toBeVisible();
  await expect(page.locator('[data-boot]')).toBeHidden();
  await page.waitForLoadState('networkidle');
  expect(sceneRequests).toEqual([]);
});

/** Catches a browser without WebGL getting a blank canvas instead of the text index (Review Focus 1). */
test('without WebGL the text index shows, with a note about the room', async ({ playwright, baseURL }) => {
  const browser = await playwright.chromium.launch({ args: ['--disable-webgl'] });
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto('/');
    expect(await page.evaluate(() => document.createElement('canvas').getContext('webgl'))).toBeNull();
    await expect(page.locator('html')).toHaveClass(/room-off/);
    await expect(page.getByRole('heading', { level: 1, name: 'Saahil Sanganeriya' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Site index' }).getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(page.getByText('needs WebGL')).toBeVisible();
    await expect(page.locator('#room')).toBeHidden();
  } finally {
    await browser.close();
  }
});

test.describe('on a phone', () => {
  const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
  test.use(iPhone13);

  /** Catches a phone loading the desktop room instead of SaahilOS (Review Focus 1). */
  test('an iPhone 13 opening / ends at /os', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/os$/);
  });
});
