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

async function settled(page: Page, phase: string, timeout = 120_000) {
  await page.waitForFunction((p) => window.__room?.phase === p && !window.__room.moving, phase, { timeout });
}

/** The arrival has ended: the camera rests at the monitor (or the visitor took it on the way). */
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

/**
 * Catches a loading screen whose log or line is not the room's own loading (a fixed script, a line that runs back, a file
 * that never shows its bytes arriving), one that offers to skip to a room that is not ready, and a room shown before
 * every full atlas is on the GPU: the owner saw the desk and the monitor blocky for a moment, then sharpen. The wide view
 * the room opens on also holds the darkroom line and the Pale Blue Dot, which once showed bare strings and a black
 * square in that first frame.
 */
test('the BIOS screen logs the room’s real loading and hands over only once every full atlas is on the GPU', async ({ page }) => {
  // In the page: the line's values as they change, the desk atlas's line as it changes, and the moment the screen fades.
  await page.addInitScript(() => {
    const marks = {
      values: [] as number[],
      desk: [] as string[],
      revealAt: null as number | null,
      shown: null as { prints: number[]; paleBlueDot: number | null } | null,
    };
    (window as unknown as { marks: typeof marks }).marks = marks;
    const watch = () => {
      const boot = document.querySelector('[data-boot]');
      if (boot) {
        const value = Number(boot.querySelector('[data-boot-progress]')?.getAttribute('aria-valuenow'));
        if (marks.values.at(-1) !== value) marks.values.push(value);
        const desk = [...boot.querySelectorAll('[data-boot-log] li')].find((li) => li.querySelector('.name')?.textContent?.startsWith('desk.'));
        const state = desk?.querySelector('.state')?.textContent ?? null;
        if (state !== null && marks.desk.at(-1) !== state) marks.desk.push(state);
        if (marks.revealAt === null && Number(getComputedStyle(boot).opacity) < 1) {
          marks.revealAt = performance.now();
          const world = window.__room?.world;
          marks.shown = { prints: world?.darkroom?.prints.map((p) => p.shown) ?? [], paleBlueDot: world?.paleBlueDot ?? null };
        }
      }
      if (marks.revealAt === null) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  // A line slow enough for the log to show each file part way: the arrival set (~22 MB) takes about 2 s at 100 Mbit/s.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 5, downloadThroughput: 12.5e6, uploadThroughput: 12.5e6 });
  await page.goto('/');
  const boot = page.locator('[data-boot]');
  await expect(boot).toBeVisible();
  await expect(boot).toHaveCSS('background-color', 'rgb(20, 17, 15)');
  await expect(boot.getByRole('progressbar', { name: 'Loading the room' })).toBeAttached();
  await expect(boot).toContainText('SAAHIL BIOS');
  await expect(boot).toContainText('(C) 2026 Saahil Sanganeriya');
  await expect(boot.getByText('Press any key for sound')).toBeVisible();
  expect(await boot.innerText(), 'nothing to skip to: the room shows itself once it is ready').not.toMatch(/skip|intro/i);

  await settled(page, 'monitor');
  await expect(boot).toBeHidden();
  const { values, desk, revealAt, shown } = await page.evaluate(
    () =>
      (window as unknown as { marks: { values: number[]; desk: string[]; revealAt: number; shown: { prints: number[]; paleBlueDot: number | null } } })
        .marks,
  );
  expect(values.at(-1)).toBe(100);
  expect(values, 'the line never goes back').toEqual([...values].sort((x, y) => x - y));
  const percents = desk.filter((d) => /^\d+%$/.test(d)).map((d) => parseInt(d, 10));
  expect(percents.filter((n) => n > 0 && n < 100).length, `the desk atlas's line followed its bytes: ${desk.join(' ')}`).toBeGreaterThan(1);
  expect(percents, 'its percent never goes back').toEqual([...percents].sort((x, y) => x - y));
  expect(desk.at(-1)).toBe('OK');

  const atlases = await page.evaluate(() => window.__roomStats!.atlases);
  expect(atlases.length).toBeGreaterThan(0);
  for (const atlas of atlases) {
    expect(atlas, `${atlas.name} full before the first visible frame`).toMatchObject({ state: 'full', beforeFirstFrame: true });
    expect(atlas.uploadedAt!, `${atlas.name} uploaded before the fade`).toBeLessThan(revealAt);
  }
  expect(shown.prints.length, 'the darkroom prints hung before the first visible frame').toBeGreaterThan(0);
  expect(shown.prints, 'every print drawn before the first visible frame').toEqual(shown.prints.map(() => 1));
  expect(shown.paleBlueDot, 'the Pale Blue Dot drawn before the first visible frame').toBe(1);
  // Every file the arrival loads and every step after them has its line, and each one is done.
  const log = await boot.evaluate((el) => [...el.querySelectorAll('[data-boot-log] li')].map((li) => [li.querySelector('.name')!.textContent, li.querySelector('.state')!.textContent]));
  const files = await page.evaluate(async () => ((await (await fetch('/room/atlases.json')).json()) as { full: { uri: string } }[]).map((a) => a.full.uri.split('/').pop()!));
  expect(Object.fromEntries(log)).toEqual({
    'room.glb': 'OK',
    ...Object.fromEntries(files.map((file) => [file, 'OK'])),
    SaahilOS: 'OK',
    'Posters and window': 'OK',
    Shaders: 'OK',
    'GPU test': 'OK',
    'Upload to GPU': 'OK',
  });
  await expect(page.locator('[data-room-status]')).toHaveText(/^The room has loaded\./);
});

/**
 * Catches SaahilOS's wallpaper sharpening as the camera reaches the glass (it used to wait for the landing): at the
 * room's first visible frame the monitor already holds the full-size picture, loaded.
 */
test('SaahilOS has its full-size wallpaper from the room’s first visible frame', async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const watch = () => {
      if (window.__room?.startedAt != null) {
        const img = document.querySelector<HTMLIFrameElement>('.room-monitor iframe')?.contentDocument?.querySelector<HTMLImageElement>('.os-wallpaper img');
        (window as unknown as { wallpaper: unknown }).wallpaper = img ? { full: img.closest('[data-full]') !== null, complete: img.complete, src: img.currentSrc } : null;
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { wallpaper?: unknown }).wallpaper !== undefined, null, { timeout: 120_000 });
  const wallpaper = await page.evaluate(() => (window as unknown as { wallpaper: { full: boolean; complete: boolean; src: string } | null }).wallpaper);
  expect(wallpaper).toMatchObject({ full: true, complete: true });
  expect(wallpaper!.src).not.toMatch(/preview-/);
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
 * Catches a shared project link loading a page instead of the room, landing anywhere but in front of the monitor
 * (where the page draws at about 12 px; T52 fix 1), or without that window open when the camera gets there.
 */
test('a project address flies in like the arrival and lands in front of the monitor with that project open', async ({ page }) => {
  await page.goto(`/projects/${PROJECT.slug}`);
  await expect(page).toHaveTitle(new RegExp(`^${PROJECT.title}`));
  // The same BIOS screen while the room loads; a key there only asks for the sound, it skips nothing.
  await expect(page.locator('[data-boot]')).toContainText('SAAHIL BIOS');
  await page.keyboard.press('KeyA');
  await expect(page.locator('[data-boot]')).toBeVisible();
  await settled(page, 'monitor', 120_000);
  await expect(os(page).getByRole('dialog', { name: PROJECT.title })).toBeVisible();
  // The window focused itself inside SaahilOS; that is not the visitor moving, so the camera stays where it landed.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__room!.destination)).toBe('monitor');
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}$`));
  expect(await seriousAxeViolations(page)).toEqual([]);
});

/** Catches a bare /os playing anything but the arrival into the monitor with SaahilOS's desktop. */
test('a bare /os lands at the monitor with SaahilOS', async ({ page }) => {
  await page.goto('/os');
  await expect(page).toHaveURL(/\/#os$/);
  await settled(page, 'monitor', 120_000);
  await expect(os(page).locator('.os-desktop')).toBeVisible();
});

type ArrivalFrame = { t: number; phase: string; destination: string; moving: boolean; eye: number[]; d: number };
/**
 * Records the camera every frame from the room's start until half a second after it first rests at the monitor (or
 * 30 s): where it is, how far from the glass, and where it heads.
 */
async function watchArrival(page: Page) {
  await page.addInitScript(() => {
    const frames: { t: number; phase: string; destination: string; moving: boolean; eye: number[]; d: number }[] = [];
    (window as unknown as { frames: typeof frames }).frames = frames;
    let restedAt: number | null = null;
    const watch = () => {
      const room = window.__room;
      const now = performance.now();
      if (room?.startedAt != null) {
        const eye = room.eye;
        const d = Math.hypot(...eye.map((v, i) => v - room.monitorAt[i]));
        frames.push({ t: now, phase: room.phase, destination: room.destination, moving: room.moving, eye, d });
        if (restedAt === null && room.phase === 'monitor' && !room.moving) restedAt = now;
      }
      const stop = (restedAt !== null && now - restedAt > 500) || (room?.startedAt != null && now - room.startedAt > 30_000);
      if (!stop) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
}
/** The frames from the one that leaves the wide view to the first at rest at the monitor. */
const flightOf = (frames: ArrivalFrame[]) => {
  const from = frames.findIndex((f) => f.destination !== 'idle');
  const to = frames.findIndex((f, i) => i >= from && f.phase === 'monitor' && !f.moving);
  return frames.slice(from, to + 1);
};
const arrivalFrames = (page: Page) => page.evaluate(() => (window as unknown as { frames: ArrivalFrame[] }).frames);

/**
 * Catches an arrival that starts anywhere but the wide view (the one Escape returns to), leaves it at once or holds it
 * too long, lands anywhere but the monitor, opens anything but About, or moves on by itself once there.
 */
test('the arrival on / fades in at the wide view, holds, then goes into the monitor with About and stays', async ({ page }) => {
  await watchArrival(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  const { startedAt, landedAt, phase } = await page.evaluate(() => ({ startedAt: window.__room!.startedAt!, landedAt: window.__room!.landedAt!, phase: window.__room!.phase }));
  expect(phase).toBe('monitor');
  const frames = await arrivalFrames(page);
  expect(frames[0]).toMatchObject({ phase: 'idle', destination: 'idle', moving: false });
  const leftAt = frames.find((f) => f.destination === 'monitor')!.t;
  // The fade (0.5 s) and the hold after it (0.5 s); a loaded machine may fire the timer a little late.
  const hold = (leftAt - startedAt) / 1000;
  test.info().annotations.push({ type: 'wide view held (s)', description: hold.toFixed(3) }, { type: 'flight (s)', description: ((landedAt - leftAt) / 1000).toFixed(3) });
  expect(hold).toBeGreaterThanOrEqual(0.95);
  expect(hold).toBeLessThan(2);
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => ({ phase: window.__room!.phase, moving: window.__room!.moving }))).toEqual({ phase: 'monitor', moving: false });
});

/**
 * Catches an arc, a detour past the window or any swing on the way in (the owner found round 8's path wonky): from
 * the wide view to the glass, the camera's distance to the monitor shrinks at every frame and its eye stays on the
 * straight line between the two framings.
 */
test('the arrival is one direct move from the wide view to the monitor', async ({ page }) => {
  await watchArrival(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__room?.phase === 'monitor' && !window.__room.moving, null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  const frames = flightOf(await arrivalFrames(page));
  expect(frames.length, 'frames drawn in flight').toBeGreaterThan(5);
  expect(new Set(frames.map((f) => f.destination)), 'the only place it heads for').toEqual(new Set(['monitor']));
  for (let i = 1; i < frames.length; i++) expect(frames[i].d, `frame ${i}: no step away from the glass (m)`).toBeLessThanOrEqual(frames[i - 1].d + 0.001);
  const [a, b] = [frames[0].eye, frames.at(-1)!.eye];
  const ab = b.map((v, i) => v - a[i]);
  const length = Math.hypot(...ab);
  const offLine = (p: number[]) => {
    const t = Math.max(0, Math.min(1, p.reduce((sum, v, i) => sum + (v - a[i]) * ab[i], 0) / (length * length)));
    return Math.hypot(...p.map((v, i) => v - (a[i] + t * ab[i])));
  };
  const widest = Math.max(...frames.map((f) => offLine(f.eye)));
  test.info().annotations.push({ type: 'widest step off the straight line (m)', description: widest.toFixed(4) });
  // The wide view's slow sway fading out is the only bend; a detour past the window bent it by metres.
  expect(widest).toBeLessThan(0.05);
});

/** Catches an arrival the visitor has to sit through: any key while it holds or flies lands it at the monitor at once. */
test('a key press during the arrival lands it at the monitor at once', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.startedAt != null && window.__room.landedAt == null, null, { timeout: 120_000, polling: 50 });
  await page.keyboard.press('k');
  expect(await page.evaluate(() => ({ phase: window.__room!.phase, moving: window.__room!.moving }))).toEqual({ phase: 'monitor', moving: false });
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();
});

/** Catches a drag during the arrival that the flight overrides: the visitor's drag takes the camera from where it is. */
test('a drag during the arrival takes the camera over', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.startedAt != null && window.__room.landedAt == null, null, { timeout: 120_000, polling: 50 });
  await page.mouse.move(200, 450);
  await page.mouse.down();
  for (let x = 210; x <= 320; x += 10) await page.mouse.move(x, 450);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__room!.destination)).toBe('orbit');
  // The arrival ended there: the ways on appear, and nothing flies the camera to the monitor afterwards.
  expect(await page.evaluate(() => window.__room!.landedAt)).not.toBeNull();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__room!.destination)).toBe('orbit');
});

/**
 * Catches the arrival gliding for a visitor who asked for reduced motion: the room fades in at the wide view, then the
 * camera is at the monitor with no frame in between.
 */
test('with reduced motion the arrival fades in, then cuts to the monitor', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await watchArrival(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await page.waitForTimeout(600);
  const frames = await arrivalFrames(page);
  const [wide, glass] = [frames[0].d, frames.at(-1)!.d];
  expect(frames[0].phase).toBe('idle');
  expect(frames.at(-1)!.phase).toBe('monitor');
  for (const f of frames) expect(Math.min(Math.abs(f.d - wide), Math.abs(f.d - glass)), 'every frame at one framing or the other (m)').toBeLessThan(0.02);
});

/**
 * Catches any content address that lands anywhere but in front of the monitor (T52 fix 1), takes longer than the
 * arrival's hold and flight to get there, or opens the wrong window (brief §1: deep links land with their window).
 * Every address in the sitemap is visited. Also records when the first frame at the monitor was drawn.
 */
test('every content address lands at the monitor after the arrival, with its window open', async ({ page, context }) => {
  test.setTimeout(1_200_000);
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
        }, null, { timeout: 30_000 })
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
    // The fade and hold (1 s) and the flight, which runs on frame time: software WebGL stretches it, never past this.
    expect(r.ms, `${r.path} reached the monitor ${r.ms.toFixed(0)} ms after the room started`).toBeLessThanOrEqual(12_000);
  }
});

/**
 * Catches a prop proxy that is not hit-tested, or a hotspot that zooms in without telling the OS what to open. Since
 * round 9 §10.2 the first click flies to the plant and shows its card; the second opens About.
 */
test('hovering the mango plant labels it, and clicking it twice opens About in SaahilOS', async ({ page }) => {
  await page.goto('/');
  await arrived(page);
  await page.evaluate(() => window.__room!.goto('idle'));
  await settled(page, 'idle');
  const mango = await screenPoint(page, 'hit_mango');
  await page.mouse.move(mango.x, mango.y);
  await expect(page.locator('.room-label')).toHaveText('About');
  await page.mouse.click(mango.x, mango.y);
  await settled(page, 'object:hit_mango', 15_000);
  const atPlant = await screenPoint(page, 'hit_mango');
  await page.mouse.click(atPlant.x, atPlant.y);
  await settled(page, 'monitor', 15_000);
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();
});

/**
 * Catches a round-7 prop that opens the wrong window or none (books, the Japanese literature print, the Voyager record,
 * the Pale Blue Dot print), a bookshelf that opens Books before flying to it, or a Georgia Tech pennant whose card does
 * not lead to About (round 9 §10.2: every prop flies to itself first, and its second click or Learn more opens it).
 */
test('the new props open their windows on a second click, and the Georgia Tech pennant’s card leads to About', async ({ page }) => {
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
  // Either of the pennant's two boxes (the set's, and the one derived from its mesh) names the framing.
  await page.waitForFunction(() => window.__room!.phase.startsWith('object:hit_pennant') && !window.__room!.moving, null, { timeout: 30_000 });
  await page.getByRole('group', { name: 'Georgia Tech' }).getByRole('button', { name: 'Learn more' }).click();
  await settled(page, 'monitor', 30_000);
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();

  for (const [proxy, title, from] of [
    ['hit_voyager', 'Voyager Golden Record', 'idle'],
    ['hit_pale_blue_dot', 'A pale blue dot', 'idle'],
    // From the wide view the print stands at the stage's right edge, where the idle sway can swing it out of view.
    ['hit_print_japanese_lit', 'Books', 'shelf'],
  ] as const) {
    await page.evaluate((f) => window.__room!.goto(f), from);
    await settled(page, from);
    await click(proxy);
    await settled(page, `object:${proxy}`, 30_000);
    await click(proxy);
    await settled(page, 'monitor', 30_000);
    await expect(os(page).getByRole('dialog', { name: title }), `${proxy} opens ${title}`).toBeVisible();
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

/** Catches WCAG failures on the loading screen and the room's own controls (the OS's windows are checked with it open). */
test('the room has no axe violations, while loading and in the room', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-boot]')).toBeVisible();
  const check = async (when: string) => {
    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude('iframe').analyze();
    expect(violations.map((v) => `${when}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  };
  await check('loading');
  await settled(page, 'monitor');
  await check('room');
});

/** Catches the reduced-motion visitor getting camera glides, running effects, a weaving BIOS screen or a fade. */
test('with reduced motion the room starts paused and lands at the monitor with the window', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/about');
  // The BIOS screen sits still (no gate weave over its scanlines) and leaves by a cut, not a fade.
  await expect(page.locator('[data-boot] .boot-screen')).toHaveCSS('animation-name', 'none');
  const fade = await page.locator('[data-boot]').evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  expect(fade, 'the hand-over is a cut (the site shortens any transition left to 0.01 ms)').toBeLessThan(0.001);
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
