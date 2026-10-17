import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

declare global {
  interface Window {
    /** The quality tier a test starts the room on (Quality.ts reads it). */
    __roomTier?: number;
  }
}

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
// Software WebGL is slow; the camera glides are timed, so slow frames only stretch the waits.
test.describe.configure({ timeout: 180_000 });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const PROJECT = { slug: 'entity-resolution-and-anonymization', title: 'Entity resolution and anonymization at Mercor' };
const os = (page: Page) => page.frameLocator('.room-monitor iframe');
const drawnOs = (page: Page) => page.frameLocator('[data-monitor-glass] iframe');

async function settled(page: Page, phase: 'idle' | 'desk' | 'monitor' | 'shelf', timeout = 120_000) {
  await page.waitForFunction((p) => window.__room?.phase === p && !window.__room.moving, phase, { timeout });
}

/** The arrival has landed at the desk (the camera may already be on its way into the monitor). */
async function arrived(page: Page) {
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
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
  await settled(page, 'monitor');
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
  await settled(page, 'monitor');
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

/**
 * Catches a shared project link loading a page instead of the room, gliding in, stopping at the desk where the page
 * draws at about 5 px (T52 fix 1), or not opening that window.
 */
test('a project address lands in front of the monitor at once with that project open', async ({ page }) => {
  await page.goto(`/projects/${PROJECT.slug}`);
  await expect(page).toHaveTitle(new RegExp(`^${PROJECT.title}`));
  await settled(page, 'monitor', 60_000);
  expect(await page.evaluate(() => window.__room!.landedAt! - window.__room!.startedAt!)).toBeLessThan(50);
  await expect(os(page).getByRole('dialog', { name: PROJECT.title })).toBeVisible();
  // The window focused itself inside SaahilOS; that is not the visitor moving, so the camera stays where it landed.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__room!.destination)).toBe('monitor');
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}$`));
  expect(await seriousAxeViolations(page)).toEqual([]);
});

/** Catches a bare /os playing the arrival instead of landing at the monitor with SaahilOS's desktop. */
test('a bare /os lands at the monitor with SaahilOS', async ({ page }) => {
  await page.goto('/os');
  await expect(page).toHaveURL(/\/#os$/);
  await settled(page, 'monitor', 60_000);
  expect(await page.evaluate(() => window.__room!.landedAt! - window.__room!.startedAt!)).toBeLessThan(50);
  await expect(os(page).locator('.os-desktop')).toBeVisible();
});

/**
 * Catches an arrival that is cut short or drags on (brief §1: a 4–6 s glide), that lands anywhere but the desk, that
 * leaves the desk before its hold of about a second, or that never goes on into the monitor, where About reads
 * (T52 fix 1); and anything that moves the camera on from there by itself (the old first drift).
 */
test('the arrival on / glides to the desk in 4 to 6 seconds, holds, then goes into the monitor and stays', async ({ page }) => {
  // When the camera first set off from the desk, and first rested at the monitor, by the page's clock.
  await page.addInitScript(() => {
    const marks = {} as { leftDeskAt?: number; atMonitorAt?: number };
    (window as unknown as { marks: typeof marks }).marks = marks;
    const watch = () => {
      const room = window.__room;
      if (room?.landedAt != null) {
        if (marks.leftDeskAt === undefined && room.destination !== 'desk') marks.leftDeskAt = performance.now();
        if (marks.atMonitorAt === undefined && room.phase === 'monitor' && !room.moving) marks.atMonitorAt = performance.now();
      }
      if (marks.atMonitorAt === undefined) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  const { startedAt, landedAt, phase } = await page.evaluate(() => ({ startedAt: window.__room!.startedAt!, landedAt: window.__room!.landedAt!, phase: window.__room!.phase }));
  const seconds = (landedAt - startedAt) / 1000;
  test.info().annotations.push({ type: 'arrival seconds', description: seconds.toFixed(3) });
  expect(seconds).toBeGreaterThanOrEqual(4);
  expect(seconds).toBeLessThanOrEqual(6);
  expect(phase).toBe('desk');
  await expect(page.locator('[data-boot]')).toBeHidden();

  await settled(page, 'monitor', 30_000);
  const marks = await page.evaluate(() => (window as unknown as { marks: { leftDeskAt: number; atMonitorAt: number } }).marks);
  const hold = (marks.leftDeskAt - landedAt) / 1000;
  test.info().annotations.push({ type: 'desk hold seconds', description: hold.toFixed(3) });
  expect(hold).toBeGreaterThanOrEqual(0.9);
  expect(hold).toBeLessThan(2);
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => ({ phase: window.__room!.phase, moving: window.__room!.moving }))).toEqual({ phase: 'monitor', moving: false });
});

/** The cam_arrival_<n> empties in room.glb (top-level nodes, metres), read from the file the page loads. */
async function arrivalWaypoints(page: Page) {
  const glb = Buffer.from(await (await page.request.get('/room/room.glb')).body());
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as { nodes: { name?: string; translation?: number[] }[] };
  return json.nodes
    .filter((n) => /^cam_arrival_\d+$/.test(n.name ?? ''))
    .sort((a, b) => a.name!.localeCompare(b.name!, undefined, { numeric: true }))
    .map((n) => ({ name: n.name!, x: n.translation![0], z: n.translation![2] }));
}

/**
 * Catches an arrival that flies straight to the desk instead of past the window and the mango plant: in room v3 a
 * straight glide misses the first two waypoints by more than 1.3 m. (tests/arrival-path.test.ts proves the exact pass.)
 */
test('the arrival passes through each of the room’s arrival waypoints', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: { x: number; z: number }[] = [];
    (window as unknown as { seen: typeof seen }).seen = seen;
    const watch = () => {
      const room = window.__room;
      if (room?.startedAt != null && room.landedAt == null) seen.push({ x: room.view.x, z: room.view.z });
      if (room?.landedAt == null) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.goto('/');
  const waypoints = await arrivalWaypoints(page);
  expect(waypoints.length).toBeGreaterThanOrEqual(2);
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  const seen = await page.evaluate(() => (window as unknown as { seen: { x: number; z: number }[] }).seen);
  // Frames come far apart on a loaded machine (the first ones at the top quality tier): measure to the straight line
  // between each two frames, not to the frames, and allow for the curve bending between them.
  const toSegment = (w: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => {
    const [dx, dz] = [b.x - a.x, b.z - a.z];
    const t = Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(a.x + t * dx - w.x, a.z + t * dz - w.z);
  };
  for (const w of waypoints) {
    const nearest = Math.min(...seen.slice(1).map((b, i) => toSegment(w, seen[i], b)));
    expect(nearest, `closest pass to ${w.name} (m)`).toBeLessThan(0.75);
  }
});

/**
 * Catches an arrival the visitor has to sit through (any key lands the glide at the desk at once), and a skip that
 * strands the visitor at the desk instead of going on to the readable monitor.
 */
test('a key press during the arrival lands it at the desk, and the landing goes on into the monitor', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.moving, null, { timeout: 120_000 });
  await page.keyboard.press('k');
  expect(await page.evaluate(() => ({ phase: window.__room!.phase, moving: window.__room!.moving }))).toEqual({
    phase: 'desk',
    moving: false,
  });
  await settled(page, 'monitor', 30_000);
});

/** Catches the arrival gliding for a visitor who asked for reduced motion: the camera is at the monitor the moment the room starts. */
test('with reduced motion / goes straight to the monitor', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.startedAt != null, null, { timeout: 120_000 });
  const start = await page.evaluate(() => ({ startedAt: window.__room!.startedAt!, landedAt: window.__room!.landedAt, phase: window.__room!.phase, moving: window.__room!.moving }));
  expect(start).toMatchObject({ phase: 'monitor', moving: false });
  expect(start.landedAt! - start.startedAt).toBeLessThan(50);
});

/**
 * Catches any content address that glides, lands anywhere but in front of the monitor (T52 fix 1), takes over a second
 * to get there once the room starts (the boot screen leaves and input reaches the room), or opens the wrong window
 * (brief §1: deep links land ready). Every address in the sitemap is visited. Also records when the first frame at the
 * monitor was drawn, which waits on the machine as well as on the room.
 */
test('every content address lands at the monitor within a second of the room starting, with its window open', async ({ page, context }) => {
  test.setTimeout(900_000);
  const sitemap = await (await page.request.get('/sitemap-0.xml')).text();
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(([, loc]) => new URL(loc).pathname)
    .filter((path) => !['/', '/os/', '/story/'].includes(path));
  expect(paths.length).toBeGreaterThan(30);
  // Notes, in the page, the first frame drawn with the camera at rest at the monitor once the room has started.
  await context.addInitScript(() => {
    const watch = () => {
      const room = window.__room;
      if (room?.startedAt != null && room.phase === 'monitor' && !room.moving) (window as unknown as { landedAt: number }).landedAt = performance.now();
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
          const landedAt = (window as unknown as { landedAt?: number }).landedAt;
          return landedAt === undefined ? null : landedAt - window.__room!.startedAt!;
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
    expect(r.phase, `${r.path} stays at the monitor once its window is open`).toBe('monitor');
    expect(r.ms, `${r.path} reached the monitor ${r.ms.toFixed(0)} ms after the room started`).toBeLessThanOrEqual(1000);
  }
});

/** Catches a prop proxy that is not hit-tested, or a hotspot that zooms in without telling the OS what to open. */
test('hovering the mango plant labels it, and clicking it opens About in SaahilOS', async ({ page }) => {
  await page.goto('/');
  await arrived(page);
  await page.evaluate(() => window.__room!.goto('idle'));
  await settled(page, 'idle');
  const mango = await screenPoint(page, 'hit_mango');
  await page.mouse.move(mango.x, mango.y);
  await expect(page.locator('.room-label')).toHaveText('About');
  await page.mouse.click(mango.x, mango.y);
  await settled(page, 'monitor', 15_000);
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();
});

/**
 * Catches a round-7 prop that opens the wrong window or none (books, the Japanese literature print, the Voyager record,
 * the Pale Blue Dot print), a bookshelf that opens Books before flying to it, or a pennant that does more than label.
 */
test('the new props open their windows, and the Georgia Tech pennant only labels itself', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await arrived(page);
  const fromWideView = async () => {
    await page.evaluate(() => window.__room!.goto('idle'));
    await settled(page, 'idle');
  };
  const click = async (name: string) => {
    const point = await screenPoint(page, name);
    // The monitor's frame is a page element over the canvas; wait until it has moved off the prop with the camera.
    await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).not.toBe('IFRAME');
    await page.mouse.click(point.x, point.y);
  };

  await fromWideView();
  const pennant = await screenPoint(page, 'hit_pennant_gatech');
  await page.mouse.move(pennant.x, pennant.y);
  await expect(page.locator('.room-label')).toHaveText('Georgia Tech');
  await page.mouse.click(pennant.x, pennant.y);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__room!.destination)).toBe('idle');

  for (const [proxy, window] of [
    ['hit_voyager', 'Voyager Golden Record'],
    ['hit_pale_blue_dot', 'A pale blue dot'],
    ['hit_print_japanese_lit', 'Books'],
  ] as const) {
    await fromWideView();
    await click(proxy);
    await settled(page, 'monitor', 30_000);
    await expect(os(page).getByRole('dialog', { name: window }), `${proxy} opens ${window}`).toBeVisible();
  }

  await fromWideView();
  await click('hit_books');
  await page.waitForFunction(() => window.__room?.phase === 'shelf' && !window.__room.moving, null, { timeout: 30_000 });
  await click('hit_books');
  await settled(page, 'monitor', 30_000);
  await expect(os(page).getByRole('dialog', { name: 'Books' })).toBeVisible();
});

/**
 * Catches the wide view at 30 fps on a machine that composites in software: the live OS layer over the redrawing
 * canvas cost a frame interval of its own there (idle 30.0 against 59.9 with the layer transparent). On the slowest
 * tier the wide view shows a still picture of the screen; the OS stays in place for the keyboard, and the live screen
 * comes back as the camera leaves for the desk.
 */
test('on the slowest tier the wide view shows a still screen, and the live OS returns on the way to the desk', async ({ page }) => {
  await page.addInitScript(() => (window.__roomTier = 4));
  await page.goto('/');
  await arrived(page);
  await page.evaluate(() => window.__room!.goto('idle'));
  await settled(page, 'idle', 30_000);
  await expect.poll(() => page.evaluate(() => window.__room!.monitorStill)).toBe(true);
  await expect(page.locator('.room-monitor')).toHaveCSS('opacity', '0');
  await page.evaluate(() => window.__room!.goto('desk'));
  await expect.poll(() => page.evaluate(() => window.__room!.monitorStill)).toBe(false);
  await expect(page.locator('.room-monitor')).toHaveCSS('opacity', '1');
  await settled(page, 'desk', 30_000);
  // Back at the wide view, the keyboard still reaches SaahilOS, and the camera goes in with it.
  await page.keyboard.press('Escape');
  await settled(page, 'idle', 30_000);
  await expect.poll(() => page.evaluate(() => window.__room!.monitorStill)).toBe(true);
  await page.getByRole('link', { name: 'Open SaahilOS' }).focus();
  await page.keyboard.press('Enter');
  await settled(page, 'monitor', 30_000);
  expect(await page.evaluate(() => window.__room!.monitorStill)).toBe(false);
  await expect(os(page).getByRole('dialog').first()).toBeVisible();
});

/** Catches a keyboard or screen-reader visitor with no way into SaahilOS (Review Focus 3), or motion that cannot be paused. */
test('"Open SaahilOS" is the first tab stop and opens it on the monitor; motion can be paused', async ({ page }) => {
  await page.goto('/');
  await arrived(page);
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
  await arrived(page);
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
  await settled(page, 'monitor');
  await check('room');
});

/** Catches the reduced-motion visitor getting camera glides or running effects. */
test('with reduced motion the room starts paused and lands at the monitor with the window', async ({ page }) => {
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
