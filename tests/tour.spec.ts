import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { TourStop } from '../src/components/RoomTourMap';
import type {} from '../src/scene/Application/Application';

// "Take the tour" and its map of the room (brief §0, §1): the stops of src/scene/tour.json on the room's own
// public/room/floorplan.json. Every stop's camera exists in today's room (the map leaves out a stop it cannot frame).
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const station = (stop: TourStop) => stop.camera.replace(/^cam_/, '');
const STOPS: TourStop[] = JSON.parse(readFileSync(new URL('../src/scene/tour.json', import.meta.url), 'utf8')).stops;

/** The arrival has landed and the tour's button has appeared. */
async function arrived(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Take the tour' })).toBeVisible({ timeout: 15_000 });
}

const settledAt = (page: Page, at: string, timeout = 30_000) =>
  page.waitForFunction((s) => window.__room?.phase === s && !window.__room.moving, at, { timeout });

const map = (page: Page) => page.getByRole('region', { name: 'Map of the room' });
const stopButtons = (page: Page) => map(page).getByRole('list', { name: 'Stops' }).getByRole('button');

/**
 * Catches a map that does not open, a stop that does not fly the camera there (or stands it as close as its node when
 * the stop asks for more room), a you-are-here mark that stays put, a played tour that skips a stop, keeps the full
 * panel over the frame or shows no caption (T52 fix 6), never returns to the desk, and an Escape that leaves the map open.
 */
test('the map opens, a stop flies the camera there, the tour plays every stop with its caption and returns, Escape closes it', async ({ page }) => {
  test.setTimeout(420_000);
  await arrived(page);
  const open = page.getByRole('button', { name: 'Take the tour' });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(map(page)).toBeVisible();
  await expect(stopButtons(page)).toHaveText(STOPS.map((s, i) => `${i + 1}${s.label}`));
  // The camera rests at the desk or its monitor, at the first stop: the map says so.
  await expect(stopButtons(page).first()).toHaveAttribute('aria-current', 'location');

  // A stop authored too close stands further back along its own line of sight.
  const far = STOPS.findIndex((s) => (s.distance ?? 1) > 1.2);
  const reach = () => page.evaluate(() => Math.hypot(window.__room!.view.x - window.__room!.view.targetX, window.__room!.view.z - window.__room!.view.targetZ));
  await stopButtons(page).nth(far).click();
  await settledAt(page, station(STOPS[far]));
  await expect(stopButtons(page).nth(far)).toHaveAttribute('aria-current', 'location');
  const pulled = await reach();
  await page.evaluate((s) => window.__room!.goto(s as never), station(STOPS[far]));
  await page.waitForFunction((r) => !window.__room!.moving && Math.hypot(window.__room!.view.x - window.__room!.view.targetX, window.__room!.view.z - window.__room!.view.targetZ) < r - 0.05, pulled, { timeout: 30_000 });
  expect(pulled / (await reach())).toBeCloseTo(STOPS[far].distance!, 1);

  const second = STOPS[1];
  await stopButtons(page).nth(1).click();
  await settledAt(page, station(second));
  await expect(stopButtons(page).nth(1)).toHaveAttribute('aria-current', 'location');
  // The mark sits where the camera is (plan coordinates are the room's x and z in metres).
  const mark = await page.evaluate(() => {
    const view = window.__room!.view;
    const transform = document.querySelector('[data-tour-here]')!.getAttribute('transform')!;
    const [, x, z] = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(transform)!.map(Number);
    return { view, x, z };
  });
  expect(mark.x).toBeCloseTo(mark.view.x, 2);
  expect(mark.z).toBeCloseTo(mark.view.z, 2);

  // Play: every stop in order with its caption, the map shrunk to an inset, then back to the desk.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const watch = () => {
      const at = window.__room!.destination;
      if (seen.at(-1) !== at) seen.push(at);
      requestAnimationFrame(watch);
    };
    watch();
  });
  await map(page).getByRole('button', { name: 'Play the tour' }).click();
  await expect(map(page).getByRole('button', { name: 'Stop the tour' })).toBeVisible();
  const caption = page.locator('[data-tour-caption]');
  await expect(caption).toHaveText(`1 of ${STOPS.length} · ${STOPS[0].label}. ${STOPS[0].caption}`);
  await expect(map(page).getByRole('list', { name: 'Stops' })).toBeHidden();
  const inset = (await map(page).boundingBox())!;
  expect(inset.height, 'the inset leaves the frame alone').toBeLessThan(200);
  expect(inset.width).toBeLessThan(450);
  await expect(caption).toHaveText(`2 of ${STOPS.length} · ${STOPS[1].label}. ${STOPS[1].caption}`, { timeout: 60_000 });
  await expect(caption).toHaveText('Back at the desk.', { timeout: 300_000 });
  await settledAt(page, 'desk');
  await expect(map(page).getByRole('button', { name: 'Play the tour' })).toBeVisible();
  await expect(map(page).getByRole('list', { name: 'Stops' })).toBeVisible();
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  // No film plays, so the projector's stop is passed.
  const played = STOPS.filter((s) => s.when !== 'film');
  expect(seen).toEqual([station(second), ...played.map(station), 'desk'].filter((s, i, all) => s !== all[i - 1]));

  await page.keyboard.press('Escape');
  await expect(map(page)).toBeHidden();
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  // Escape closed the map only; the camera did not also back out of the desk.
  expect(await page.evaluate(() => window.__room!.destination)).toBe('desk');
});

/** Catches a played tour that keeps pulling the camera after the visitor has taken it somewhere else. */
test('anything the visitor does with the camera ends the played tour', async ({ page }) => {
  await arrived(page);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await map(page).getByRole('button', { name: 'Play the tour' }).click();
  await page.waitForFunction((s) => window.__room!.destination === s, station(STOPS[1]), { timeout: 30_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await expect(map(page).getByRole('button', { name: 'Play the tour' })).toBeVisible();
  // The map is whole again, with its stops.
  await expect(map(page).getByRole('list', { name: 'Stops' })).toBeVisible();
  await settledAt(page, 'idle');
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__room!.destination)).toBe('idle');
});

/** Catches serious or critical WCAG failures on the map overlay. */
test('the map has no serious axe violations', async ({ page }) => {
  await arrived(page);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(map(page)).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).include('#room-tour').include('[data-tour-open]').withTags(AXE_TAGS).analyze();
  test.info().attach('axe-map.json', { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
});

/** Catches a tour the keyboard cannot reach or drive: Tab to the button, Enter, arrows and Tab through stops, Enter, Escape. */
test('the keyboard reaches the tour, walks its stops, flies to one and closes the map', async ({ page }) => {
  await arrived(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Open SaahilOS' })).toBeFocused();
  await page.keyboard.press('Tab');
  const open = page.getByRole('button', { name: 'Take the tour' });
  await expect(open).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(map(page)).toBeVisible();
  await expect(stopButtons(page).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(stopButtons(page).nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(stopButtons(page).nth(2)).toBeFocused();
  // The arrows moved between stops only; the room did not take them as steps (it stays where the arrival left it).
  expect(['desk', 'monitor']).toContain(await page.evaluate(() => window.__room!.destination));
  await page.keyboard.press('Enter');
  await settledAt(page, station(STOPS[2]));
  await page.keyboard.press('Escape');
  await expect(map(page)).toBeHidden();
  await expect(open).toBeFocused();
});
