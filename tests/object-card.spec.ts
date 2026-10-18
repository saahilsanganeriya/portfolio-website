import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// A click on a room object flies the camera to that object and shows its card beside it (brief round 9 §10.2, owner
// 2026-10-17): the title, one plain line and Learn more, which (as a second click on the object does) opens its window on
// the monitor. Escape or Home leaves.

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const room = (page: Page) => page.evaluate(() => ({ phase: window.__room!.phase, destination: window.__room!.destination, moving: window.__room!.moving, view: window.__room!.view }));
const os = (page: Page) => page.frameLocator('.room-monitor iframe');
const card = (page: Page) => page.locator('[data-room-card]');

async function settledAt(page: Page, station: string, timeout = 30_000) {
  await page.waitForFunction((s) => window.__room?.phase === s && !window.__room.moving, station, { timeout });
}

async function inRoom(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
}

/** Clicks a prop where it is on screen now (once the monitor's frame, a frame behind the camera, has moved off it). */
async function clickProp(page: Page, name: string) {
  const point = (await page.evaluate((n) => window.__room!.point(n), name))!;
  expect(point, `${name} is on screen`).not.toBeNull();
  await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).not.toBe('IFRAME');
  await page.mouse.click(point.x, point.y);
}

/**
 * At the object: the camera rests there, close (the fitted framing stands at most 2.6 m off, nearer for small things),
 * looking at it, with the object near the middle of the view.
 */
async function atObject(page: Page, proxy: string) {
  await settledAt(page, `object:${proxy}`);
  const { view } = await room(page);
  expect(Math.hypot(view.x - view.targetX, view.z - view.targetZ), 'a close-up (m)').toBeLessThan(2.7);
  const at = (await page.evaluate((n) => window.__room!.point(n), proxy))!;
  expect(Math.abs(at.x - 720), 'the object is near the middle across').toBeLessThan(220);
  expect(Math.abs(at.y - 450), 'and up and down').toBeLessThan(160);
  return at;
}

/**
 * Catches a click that still goes straight to the monitor, a card that never shows, sits over the object or lacks its
 * words, and a Learn more that does not open the object's window.
 */
test('a click on the Voyager record flies to it and shows its card; Learn more opens its window', async ({ page }) => {
  await inRoom(page);
  await clickProp(page, 'hit_voyager');
  const at = await atObject(page, 'hit_voyager');
  const shown = page.getByRole('group', { name: 'The Voyager Golden Record' });
  await expect(shown).toBeVisible();
  await expect(shown).toContainText('A copy of the gold record NASA sent out on both Voyager spacecraft in 1977.');
  const box = (await shown.boundingBox())!;
  expect(at.x < box.x || at.x > box.x + box.width, 'beside the object, not over it').toBe(true);
  await expect(page.locator('[data-room-card-status]')).toHaveText(/^The Voyager Golden Record\. A copy of the gold record/);
  await shown.getByRole('button', { name: 'Learn more' }).click();
  await settledAt(page, 'monitor');
  await expect(os(page).getByRole('dialog', { name: 'Voyager Golden Record' })).toBeVisible();
  await expect(card(page)).toBeHidden();
});

/** The proxies under a 7 × 4 grid of points over the card (the room's own hit test), but the object's and the line's it hangs on. */
async function underCard(page: Page, proxy: string) {
  const box = (await card(page).boundingBox())!;
  const points = Array.from({ length: 28 }, (_, i) => ({ x: box.x + ((i % 7) + 0.5) * (box.width / 7), y: box.y + (Math.floor(i / 7) + 0.5) * (box.height / 4) }));
  const hits = await page.evaluate((list) => list.map(({ x, y }) => window.__room!.hit(x, y)), points);
  return [...new Set(hits)].filter((hit): hit is string => hit !== null && hit !== proxy && hit !== 'hit_darkroom');
}

/**
 * Catches a card laid over the object next to the one it names (T98: Yi Yi's card printed over the Normal People
 * poster, Chinatown's over the next print, the Voyager record's over the Pale Blue Dot's frame) and an object that stops
 * looking picked once the pointer leaves it: the card covers no other object, and its own object stays lifted.
 */
test('the card sits clear of the neighbouring objects, and its object stays lifted while it shows', async ({ page }) => {
  await inRoom(page);
  for (const proxy of ['hit_poster_1', 'hit_darkroom_print_0', 'hit_voyager']) {
    await page.evaluate(() => window.__room!.goto('idle'));
    await settledAt(page, 'idle');
    await clickProp(page, proxy);
    await atObject(page, proxy);
    await expect(card(page)).toBeVisible();
    expect(await underCard(page, proxy), `objects under ${proxy}'s card`).toEqual([]);
  }
  // The record lifts off the wall on hover (posters are too large to lift; they only glint).
  await page.mouse.move(4, 4);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__room!.lift('hit_voyager')), 'the record still lifted, the pointer away').toBeGreaterThan(0.5);
});

/**
 * Catches a card that slides as the pointer reaches for Learn more (T98: 79-103 px, so a quick click missed and threw
 * the visitor out of the card): at an object's framing the view does not lean with the pointer.
 */
test('the card does not move while the pointer crosses the stage', async ({ page }) => {
  await inRoom(page);
  // A poster at its own fitted framing; the books at the shelf's named one.
  for (const [proxy, station] of [['hit_poster_1', 'object:hit_poster_1'], ['hit_books', 'shelf']]) {
    await page.evaluate(() => window.__room!.goto('idle'));
    await settledAt(page, 'idle');
    await clickProp(page, proxy);
    await settledAt(page, station);
    await expect(card(page)).toBeVisible();
    const before = (await card(page).boundingBox())!;
    for (const [x, y] of [[1430, 890], [10, 890], [10, 10], [1430, 10], [before.x + 20, before.y + before.height - 12]]) {
      await page.mouse.move(x, y, { steps: 4 });
      await page.waitForTimeout(700);
      const now = (await card(page).boundingBox())!;
      expect([now.x - before.x, now.y - before.y], `${proxy}'s card with the pointer at ${x}, ${y}`).toEqual([0, 0]);
    }
  }
});

/** Catches the view leaning with the pointer under prefers-reduced-motion (T98: the lean ran the same with it on). */
test('under reduced motion the view never leans with the pointer', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await inRoom(page);
  for (const [x, y] of [[40, 40], [1400, 860], [720, 450]]) {
    await page.mouse.move(x, y, { steps: 3 });
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__room!.look), `the lean with the pointer at ${x}, ${y}`).toEqual({ yaw: 0, pitch: 0 });
  }
  await context.close();
});

/** Catches a second click on the object that does nothing (or flies again), and an Escape or Home that leaves the card behind. */
test('a second click on the object opens its window; Escape and Home leave and take the card away', async ({ page }) => {
  await inRoom(page);
  await clickProp(page, 'hit_pale_blue_dot');
  await atObject(page, 'hit_pale_blue_dot');
  await expect(card(page)).toBeVisible();
  await clickProp(page, 'hit_pale_blue_dot');
  await settledAt(page, 'monitor');
  await expect(os(page).getByRole('dialog', { name: 'A pale blue dot' })).toBeVisible();

  for (const leave of ['Escape', 'Home'] as const) {
    await page.evaluate(() => window.__room!.goto('idle'));
    await settledAt(page, 'idle');
    await clickProp(page, 'hit_poster_1');
    await atObject(page, 'hit_poster_1');
    await expect(card(page)).toBeVisible();
    if (leave === 'Escape') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: 'Home', exact: true }).click();
    await settledAt(page, 'idle');
    await expect(card(page), `the card after ${leave}`).toBeHidden();
  }
});

/**
 * Catches a card the keyboard cannot reach or use, one a screen reader is not told about, focus stranded on a card
 * that went away, and serious axe findings on it.
 */
test('the keyboard reaches the card, Enter opens the window and takes focus into it, and axe finds nothing serious', async ({ page }) => {
  await inRoom(page);
  await clickProp(page, 'hit_nas');
  await atObject(page, 'hit_nas');
  await expect(card(page)).toBeVisible();
  // axe reads colours: wait out the card's 0.3 s fade-in, or it measures a blend (T9C's full-suite run).
  await expect(card(page)).toHaveCSS('opacity', '1');
  const { violations } = await new AxeBuilder({ page }).include('[data-room-card]').analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  const more = card(page).getByRole('button', { name: 'Learn more' });
  // After the click on the room, the next Tab is the card's (not on into the monitor's frame).
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  expect(await page.evaluate(() => window.__room!.destination), 'Tab did not take the camera into the monitor').toBe('object:hit_nas');
  await page.keyboard.press('Enter');
  await settledAt(page, 'monitor');
  await expect(os(page).getByRole('dialog', { name: /^projectionist/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.matches('.room-monitor iframe') ?? false), { message: 'focus went into the OS' }).toBe(true);
});
