import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
// Software WebGL is slow; the camera glides are timed, so slow frames only stretch the waits.
test.describe.configure({ timeout: 180_000 });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const PROJECT = { slug: 'entity-resolution-and-anonymization', title: 'Entity resolution and anonymization at Mercor' };
const os = (page: Page) => page.frameLocator('.room-monitor iframe');
const drawnOs = (page: Page) => page.frameLocator('[data-monitor-glass] iframe');

async function settled(page: Page, phase: 'idle' | 'monitor', timeout = 120_000) {
  await page.waitForFunction((p) => window.__room?.phase === p && !window.__room.moving, phase, { timeout });
}

async function screenPoint(page: Page, name: string) {
  const point = await page.evaluate((n) => window.__room!.point(n), name);
  expect(point, `${name} is on screen`).not.toBeNull();
  return point!;
}

/** Serious and critical axe findings, the OS's frame included. */
async function seriousAxeViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length})`);
}

/** Catches the room waiting for a click to start, and sound starting before the visitor's first input. */
test('the boot screen hands over to the room by itself; the first click starts the sound', async ({ page }) => {
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
  const audioContexts = () => page.evaluate(() => (window as unknown as { audioContexts: number }).audioContexts);
  await page.goto('/');
  await settled(page, 'idle');
  await expect(page.locator('[data-boot]')).toBeHidden();
  expect(await audioContexts()).toBe(0);
  await expect(page.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');

  await page.mouse.click(720, 880);
  await expect.poll(audioContexts).toBe(1);
  await expect(page.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Sound' }).click();
  await expect(page.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');
  expect(await audioContexts()).toBe(1);
});

/** Catches a scroll-down site, a link list or any other page content around the room on `/`. */
test('/ is the room alone: nothing to scroll to and no links beside it', async ({ page }) => {
  await page.goto('/');
  await settled(page, 'idle');
  const size = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    viewport: { height: innerHeight, width: innerWidth },
  }));
  expect({ height: size.height, width: size.width }).toEqual(size.viewport);
  await page.mouse.wheel(0, 2000);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  // The one link is the screen-reader shortcut into SaahilOS, hidden until focused.
  await expect(page.getByRole('link')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Open SaahilOS' })).not.toBeInViewport();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

/** Catches a shared project link loading a page instead of the room, or the room not opening that window. */
test('a project address ends on the monitor with that project open', async ({ page }) => {
  await page.goto(`/projects/${PROJECT.slug}`);
  await expect(page).toHaveTitle(new RegExp(`^${PROJECT.title}`));
  await settled(page, 'monitor', 60_000);
  await expect(os(page).getByRole('dialog', { name: PROJECT.title })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}$`));
  expect(await seriousAxeViolations(page)).toEqual([]);
});

/** Catches an intro the visitor has to sit through: any key lands the glide at once. */
test('a key press during the intro skips it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.moving, null, { timeout: 120_000 });
  await page.keyboard.press('k');
  expect(await page.evaluate(() => ({ phase: window.__room!.phase, moving: window.__room!.moving }))).toEqual({
    phase: 'idle',
    moving: false,
  });
});

/** Catches a prop proxy that is not hit-tested, or a hotspot that zooms in without telling the OS what to open. */
test('hovering the mango plant labels it, and clicking it opens About in SaahilOS', async ({ page }) => {
  await page.goto('/');
  await settled(page, 'idle');
  const mango = await screenPoint(page, 'hit_mango');
  await page.mouse.move(mango.x, mango.y);
  await expect(page.locator('.room-label')).toHaveText('About');
  await page.mouse.click(mango.x, mango.y);
  await settled(page, 'monitor', 15_000);
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();
});

/** Catches a keyboard or screen-reader visitor with no way into SaahilOS (Review Focus 3), or motion that cannot be paused. */
test('"Open SaahilOS" is the first tab stop and opens it on the monitor; motion can be paused', async ({ page }) => {
  await page.goto('/');
  await settled(page, 'idle');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Open SaahilOS' })).toBeFocused();
  await page.keyboard.press('Enter');
  await settled(page, 'monitor', 15_000);
  await expect(os(page).getByRole('dialog', { name: 'Projects' })).toBeVisible();

  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.getByRole('button', { name: 'Pause motion' })).toHaveAttribute('aria-pressed', 'true');
});

/** Catches WCAG failures on the boot screen and the room's own controls (the OS's windows are checked with it open). */
test('the room has no axe violations, while booting and in the room', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-boot]')).toBeVisible();
  const check = async (when: string) => {
    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude('iframe').analyze();
    expect(violations.map((v) => `${when}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  };
  await check('boot');
  await settled(page, 'idle');
  await check('room');
});

/** Catches the reduced-motion visitor getting camera glides or running effects. */
test('with reduced motion the room starts paused and cuts to the window', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/about');
  await page.waitForFunction(() => window.__room?.phase === 'monitor', null, { timeout: 120_000 });
  expect(await page.evaluate(() => window.__room!.moving)).toBe(false);
  await expect(page.getByRole('button', { name: 'Pause motion' })).toHaveAttribute('aria-pressed', 'true');
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();
});

/** Catches a browser without WebGL getting a blank canvas or a plain page instead of SaahilOS on the monitor (Review Focus 1). */
test('without WebGL the drawn monitor shows SaahilOS with the window open', async ({ playwright, baseURL }) => {
  const browser = await playwright.chromium.launch({ args: ['--disable-webgl'] });
  try {
    // axe reads the OS's frame only on a page from a context it can see.
    const page = await (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage();
    const sceneRequests: string[] = [];
    page.on('request', (r) => /\/_astro\/main\.|\.glb$|\.ktx2$/.test(r.url()) && sceneRequests.push(r.url()));
    await page.goto(`/projects/${PROJECT.slug}`);
    await expect(page.locator('html')).toHaveClass(/room-2d/);
    await expect(drawnOs(page).getByRole('dialog', { name: PROJECT.title })).toBeVisible();
    await expect(page.locator('[data-boot]')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(900);
    expect(await seriousAxeViolations(page)).toEqual([]);
    expect(sceneRequests).toEqual([]);
  } finally {
    await browser.close();
  }
});

test.describe('on a phone', () => {
  const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
  test.use(iPhone13);

  /** Catches a phone loading the desktop room or a plain page instead of SaahilOS on the drawn monitor. */
  test('an iPhone 13 gets SaahilOS on the drawn monitor, at the same address', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/room-2d/);
    await expect(drawnOs(page).getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});
