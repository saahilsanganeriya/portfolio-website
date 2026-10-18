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
