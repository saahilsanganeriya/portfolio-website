import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// The living room (PLAN 11.1, 12.1): the on-demand media, and what every hotspot does (the window has its own spec,
// window.spec.ts). Props are clicked where the room projects them on screen.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

const os = (page: Page) => page.frameLocator('.room-monitor iframe');
const world = (page: Page) => page.evaluate(() => window.__room!.world);

/** The room after the arrival, stepped back from the desk to the wide view, where every prop is in sight. */
async function inRoom(page: Page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 150_000 });
  await page.waitForFunction(() => window.__room!.world.interactive, null, { timeout: 10_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
}

/**
 * The camera rests at that framing and a frame has been drawn there: a cut (reduced motion) lands at once, but the
 * monitor's CSS layer follows on the next frame, and a click before it would land on the old screen.
 */
async function settledAt(page: Page, phase: string, timeout = 20_000) {
  await page.waitForFunction((p) => window.__room?.phase === p && !window.__room.moving, phase, { timeout });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function clickProp(page: Page, name: string) {
  const point = await page.evaluate((n) => window.__room!.point(n), name);
  expect(point, `${name} is on screen`).not.toBeNull();
  // The monitor's frame is a page element over the canvas: until a frame has moved it with the camera, it can still
  // cover a prop the camera has already turned to (seen under load with reduced motion, whose frames are the slowest).
  if (name.startsWith('hit_'))
    await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point!)).not.toBe('IFRAME');
  await page.mouse.click(point!.x, point!.y);
}

/** Rests the pointer on a prop (following it while the view leans toward the pointer). */
async function hoverProp(page: Page, name: string) {
  for (let i = 0; i < 4; i++) {
    const at = await page.evaluate((n) => window.__room!.point(n), name);
    if (!at) break;
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(400);
    if ((await page.evaluate(({ x, y }) => window.__room!.hit(x, y), at)) === name) return;
  }
}

/** A prop with a card (brief round 9 §10.2): the first click flies to it and shows its card, the second opens its window. */
async function openByTwoClicks(page: Page, name: string) {
  await clickProp(page, name);
  await settledAt(page, `object:${name}`);
  await clickProp(page, name);
}

async function backToIdle(page: Page) {
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
}

/**
 * Catches a prop that does nothing when clicked or opens the wrong window (PLAN 11.1, 12.1). The props that act in the
 * room (espresso, oven, lava lamp) are interactions.spec.ts's.
 */
test('every new hotspot does what it says', async ({ page }) => {
  test.setTimeout(420_000);
  await inRoom(page);

  // The window takes the camera to its framing first; so does the darkroom line (T75), unless the click lands on one of
  // its prints (the hero print hangs in the middle of the line), which then gets a framing of its own.
  for (const [proxy, framing] of [
    ['hit_window', 'window'],
    ['hit_darkroom', 'photos'],
  ] as const) {
    await backToIdle(page);
    const at = (await page.evaluate((n) => window.__room!.point(n), proxy))!;
    const hit = await page.evaluate(({ x, y }) => window.__room!.hit(x, y), at);
    await clickProp(page, proxy);
    await settledAt(page, hit?.startsWith('hit_darkroom_print_') ? `object:${hit}` : framing);
  }

  // At the darkroom line a print flies to itself with its card, and a second click opens that photograph in SaahilOS.
  await page.evaluate(() => window.__room!.goto('photos'));
  await settledAt(page, 'photos');
  await openByTwoClicks(page, 'hit_darkroom_print_0');
  await settledAt(page, 'monitor');
  await expect(os(page).getByRole('dialog', { name: 'Photographs' })).toBeVisible();

  // Round 8's labels: the NAS is the NAS (not a Terminal), the pennant says Georgia Tech, the CRT's badge explains itself.
  await backToIdle(page);
  for (const [proxy, label] of [
    ['hit_nas', 'The NAS'],
    ['hit_pennant', 'Georgia Tech'],
  ] as const) {
    await hoverProp(page, proxy);
    await expect(page.locator('.room-label'), `${proxy}'s label`).toHaveText(label);
  }
  await page.evaluate(() => window.__room!.goto('desk'));
  await settledAt(page, 'desk');
  await hoverProp(page, 'hit_crt_badge');
  await expect(page.locator('.room-label')).toHaveText('My family name and a thread spool, for my father’s spinning mill');
  await openByTwoClicks(page, 'hit_crt_badge');
  await settledAt(page, 'monitor');
  await expect(os(page).getByRole('dialog', { name: 'About' })).toBeVisible();

  // Props whose content lives in a SaahilOS window.
  for (const [proxy, window] of [
    ['hit_plaque', 'Films'],
    ['hit_poster_0', 'Films'],
    // The NAS runs projectionist: it opens that project, not the Terminal.
    ['hit_nas', /^projectionist/],
  ] as const) {
    await backToIdle(page);
    await openByTwoClicks(page, proxy);
    await settledAt(page, 'monitor');
    await expect(os(page).getByRole('dialog', { name: window }), `${proxy} opens ${window}`).toBeVisible();
  }
  // #films/favourites brings the four favourites into view.
  await expect(os(page).locator('#film-favourites')).toBeVisible();
});

/**
 * Catches on-demand media (prints, photographs, the Pale Blue Dot's picture) creeping into the room's
 * initial load, and a Pale Blue Dot print left as the bare white paper the room bakes under it.
 */
test('the prints and the photographs load only after the room is interactive', async ({ page }) => {
  const started: { url: string; at: number }[] = [];
  page.on('request', (request) => started.push({ url: request.url(), at: Date.now() }));
  await inRoom(page);
  await page.evaluate(() => window.__room!.goto('photos'));
  await page.waitForFunction(() => window.__room!.world.darkroom!.prints.every((p) => p.shown > 0), null, { timeout: 30_000 });
  const interactive = await page.evaluate(() => performance.timeOrigin + window.__room!.interactiveAt!);
  await page.waitForFunction(() => window.__room!.world.paleBlueDot! > 0, null, { timeout: 30_000 });
  // The darkroom's pictures by the URLs its prints were drawn from (About's photos of him are in the first view).
  const pictures = new Set((await world(page)).darkroom!.prints.map((p) => new URL(p.picture!, page.url()).href));
  const onDemand = started.filter(({ url }) => pictures.has(url) || /photographs\.[^/]*\.js|api\/films\.json|pale-blue-dot\.ktx2/.test(url));
  expect(onDemand.length).toBeGreaterThan(3);
  expect(onDemand.filter(({ at }) => at < interactive).map(({ url }) => url)).toEqual([]);
  // The posters hang in the first view, so they are part of it.
  expect((await world(page)).posters).toEqual([true, true, true, true]);
});
