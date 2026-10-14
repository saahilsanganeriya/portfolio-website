import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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

async function settled(page: Page, phase: 'idle' | 'desk' | 'monitor' | 'projector', timeout = 120_000) {
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
  await settled(page, 'desk');
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
  await settled(page, 'desk');
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

/** Catches a shared project link loading a page instead of the room, gliding in, or not opening that window. */
test('a project address lands at the desk at once with that project open', async ({ page }) => {
  await page.goto(`/projects/${PROJECT.slug}`);
  await expect(page).toHaveTitle(new RegExp(`^${PROJECT.title}`));
  await settled(page, 'desk', 60_000);
  expect(await page.evaluate(() => window.__room!.arrival)).toBeNull();
  await expect(os(page).getByRole('dialog', { name: PROJECT.title })).toBeVisible();
  // The window focused itself inside SaahilOS; that is not the visitor moving, so the camera stays at the desk.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__room!.destination)).toBe('desk');
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}$`));
  expect(await seriousAxeViolations(page)).toEqual([]);
});

/** Catches a bare /os playing the arrival instead of landing at the desk with SaahilOS's desktop. */
test('a bare /os lands at the desk with SaahilOS', async ({ page }) => {
  await page.goto('/os');
  await expect(page).toHaveURL(/\/#os$/);
  await settled(page, 'desk', 60_000);
  expect(await page.evaluate(() => window.__room!.arrival)).toBeNull();
  await expect(os(page).locator('.os-desktop')).toBeVisible();
});

/**
 * Catches an arrival that is cut short or drags on (brief §1: a 4–6 s glide), that lands anywhere but the desk, or
 * that something moves on from afterwards (the old first drift).
 */
test('the arrival on / glides to the desk in 4 to 6 seconds and stays there', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.arrival?.landedAt != null, null, { timeout: 120_000 });
  const { arrival, phase, moving } = await page.evaluate(() => ({ arrival: window.__room!.arrival!, phase: window.__room!.phase, moving: window.__room!.moving }));
  const seconds = (arrival.landedAt! - arrival.startedAt) / 1000;
  test.info().annotations.push({ type: 'arrival seconds', description: seconds.toFixed(3) });
  expect(seconds).toBeGreaterThanOrEqual(4);
  expect(seconds).toBeLessThanOrEqual(6);
  expect({ phase, moving }).toEqual({ phase: 'desk', moving: false });
  await expect(page.locator('[data-boot]')).toBeHidden();
  await expect(os(page).getByRole('dialog').first()).toBeVisible();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => ({ phase: window.__room!.phase, moving: window.__room!.moving }))).toEqual({ phase: 'desk', moving: false });
});

/** Catches an arrival the visitor has to sit through: any key lands the glide at the desk at once. */
test('a key press during the arrival lands it at the desk', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.moving, null, { timeout: 120_000 });
  await page.keyboard.press('k');
  expect(await page.evaluate(() => ({ phase: window.__room!.phase, moving: window.__room!.moving }))).toEqual({
    phase: 'desk',
    moving: false,
  });
});

/** Catches the arrival gliding for a visitor who asked for reduced motion: the camera is at the desk the moment the room starts. */
test('with reduced motion / goes straight to the desk', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.arrival, null, { timeout: 120_000 });
  const arrival = await page.evaluate(() => ({ ...window.__room!.arrival!, phase: window.__room!.phase, moving: window.__room!.moving }));
  expect(arrival).toMatchObject({ phase: 'desk', moving: false });
  expect(arrival.landedAt! - arrival.startedAt).toBeLessThan(50);
});

/**
 * Catches any content address that glides, lands anywhere but the desk, takes over a second to get there once the room
 * starts (the boot screen leaves and input reaches the room), or opens the wrong window (brief §1: deep links land
 * ready). Every address in the sitemap is visited. Also records when the first frame at the desk was drawn, which
 * waits on the machine as well as on the room.
 */
test('every content address lands at the desk within a second of the room starting, with its window open', async ({ page, context }) => {
  test.setTimeout(900_000);
  const sitemap = await (await page.request.get('/sitemap-0.xml')).text();
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(([, loc]) => new URL(loc).pathname)
    .filter((path) => !['/', '/os/', '/story/'].includes(path));
  expect(paths.length).toBeGreaterThan(30);
  // Notes, in the page, the first frame drawn with the camera at rest at the desk once the room has started.
  await context.addInitScript(() => {
    const watch = () => {
      const room = window.__room;
      if (room?.startedAt != null && room.phase === 'desk' && !room.moving) (window as unknown as { deskAt: number }).deskAt = performance.now();
      else requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  const results: { path: string; open: string; front: string; ms: number; firstFrameMs: number; phase: string }[] = [];
  const visit = async (path: string) => {
    const tab = await context.newPage();
    try {
      await tab.goto(path);
      const open = (await tab.locator('[data-open]').getAttribute('data-open')) ?? '';
      await tab.waitForFunction(() => window.__room?.startedAt != null, null, { timeout: 120_000 });
      const firstFrameMs = await (
        await tab.waitForFunction(() => {
          const deskAt = (window as unknown as { deskAt?: number }).deskAt;
          return deskAt === undefined ? null : deskAt - window.__room!.startedAt!;
        }, null, { timeout: 10_000 })
      ).jsonValue();
      const ms = await tab.evaluate(() => (window.__room!.landedAt ?? Infinity) - window.__room!.startedAt!);
      await tab.frameLocator('.room-monitor iframe').getByRole('dialog').first().waitFor({ timeout: 30_000 });
      await expect.poll(() => tab.evaluate(() => document.querySelector<HTMLIFrameElement>('.room-monitor iframe')!.contentWindow!.location.hash.slice(1)), { timeout: 15_000 }).toBe(open);
      const front = await tab.evaluate(() => document.querySelector<HTMLIFrameElement>('.room-monitor iframe')!.contentWindow!.location.hash.slice(1));
      results.push({ path, open, front, ms, firstFrameMs: firstFrameMs!, phase: await tab.evaluate(() => window.__room!.phase) });
    } finally {
      await tab.close();
    }
  };
  // One tab at a time: each is a whole room on software WebGL, and the other workers' rooms share the machine.
  for (const path of paths) await visit(path);
  test.info().attach('deep-links.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results.map((r) => r.path).sort()).toEqual([...paths].sort());
  for (const r of results) {
    expect(r.open, `${r.path} names a window`).not.toBe('');
    expect(r.phase, `${r.path} stays at the desk once its window is open`).toBe('desk');
    expect(r.ms, `${r.path} reached the desk ${r.ms.toFixed(0)} ms after the room started`).toBeLessThanOrEqual(1000);
  }
});

/** Catches a prop proxy that is not hit-tested, or a hotspot that zooms in without telling the OS what to open. */
test('hovering the mango plant labels it, and clicking it opens About in SaahilOS', async ({ page }) => {
  await page.goto('/');
  await settled(page, 'desk');
  await page.evaluate(() => window.__room!.goto('idle'));
  await settled(page, 'idle');
  const mango = await screenPoint(page, 'hit_mango');
  await page.mouse.move(mango.x, mango.y);
  await expect(page.locator('.room-label')).toHaveText('About');
  await page.mouse.click(mango.x, mango.y);
  await settled(page, 'monitor', 15_000);
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();
});

/** Catches the projector opening a window straight away instead of flying to its framing first (owner 07:56Z). */
test('clicking the projector glides to it and opens nothing', async ({ page }) => {
  await page.goto('/');
  await settled(page, 'desk');
  await page.evaluate(() => window.__room!.goto('idle'));
  await settled(page, 'idle');
  const projector = await screenPoint(page, 'hit_projector');
  await page.mouse.move(projector.x, projector.y);
  await expect(page.locator('.room-label')).toHaveText('Projector');
  await page.mouse.click(projector.x, projector.y);
  await settled(page, 'projector', 30_000);
  expect(await page.evaluate(() => window.__room!.destination)).toBe('projector');
});

/** Catches a reel that never plays on the projector screen, or one that keeps playing in a hidden tab or out of view. */
test('the projector reel plays while its screen is in view, and pauses in a hidden tab and out of view', async ({ page }) => {
  await page.goto('/');
  await settled(page, 'desk');
  await page.evaluate(() => window.__room!.goto('idle'));
  await settled(page, 'idle');
  const reel = () => page.evaluate(() => window.__room!.reel!);
  await page.waitForFunction(() => window.__room?.reel?.state === 'playing', null, { timeout: 30_000 });
  expect((await reel()).inView).toBe(true);
  const started = (await reel()).time;
  await page.waitForFunction((t) => window.__room!.reel!.time > t + 0.5, started, { timeout: 15_000 });

  // Headless Chromium never hides a tab, so the test sets what the page reads and fires the event it listens for.
  const setHidden = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await page.waitForFunction(() => window.__room?.reel?.state === 'paused', null, { timeout: 5_000 });
  await setHidden(false);
  await page.waitForFunction(() => window.__room?.reel?.state === 'playing', null, { timeout: 5_000 });

  // The desk framing looks away from the screen.
  await page.evaluate(() => window.__room!.goto('desk'));
  await page.waitForFunction(() => window.__room?.phase === 'desk' && !window.__room.moving, null, { timeout: 15_000 });
  expect(await reel()).toMatchObject({ inView: false, state: 'paused' });
});

/** Catches a keyboard or screen-reader visitor with no way into SaahilOS (Review Focus 3), or motion that cannot be paused. */
test('"Open SaahilOS" is the first tab stop and opens it on the monitor; motion can be paused', async ({ page }) => {
  await page.goto('/');
  await settled(page, 'desk');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Open SaahilOS' })).toBeFocused();
  await page.keyboard.press('Enter');
  await settled(page, 'monitor', 15_000);
  await expect(os(page).getByRole('dialog', { name: 'Projects' })).toBeVisible();

  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.getByRole('button', { name: 'Pause motion' })).toHaveAttribute('aria-pressed', 'true');
});

/**
 * Catches the camera staying at the desk while the keyboard is back inside SaahilOS, or staying at the monitor once
 * the keyboard has left it again: a Tab between the page and the frame moves focus in Chromium without focus or blur
 * events on the frame element.
 */
test('tabbing out of SaahilOS backs out to the desk, and tabbing back in and out again follows', async ({ page }) => {
  await page.goto('/');
  await settled(page, 'desk');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await settled(page, 'monitor', 15_000);
  const focusInMonitor = () => page.evaluate(() => document.activeElement?.matches('.room-monitor iframe') ?? false);
  const tabUntil = async (inMonitor: boolean) => {
    for (let i = 0; i < 80 && (await focusInMonitor()) !== inMonitor; i++) await page.keyboard.press('Tab');
    expect(await focusInMonitor()).toBe(inMonitor);
  };
  await tabUntil(false);
  await expect.poll(() => page.evaluate(() => window.__room!.destination)).toBe('desk');
  await tabUntil(true);
  await expect.poll(() => page.evaluate(() => window.__room!.destination)).toBe('monitor');
  await settled(page, 'monitor', 15_000);
  await tabUntil(false);
  await expect.poll(() => page.evaluate(() => window.__room!.destination)).toBe('desk');
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
  await settled(page, 'desk');
  await check('room');
});

/** Catches the reduced-motion visitor getting camera glides or running effects. */
test('with reduced motion the room starts paused and lands at the desk with the window', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/about');
  await page.waitForFunction(() => window.__room?.phase === 'desk', null, { timeout: 120_000 });
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
