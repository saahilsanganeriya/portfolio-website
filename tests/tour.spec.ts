import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type {} from '../src/scene/Application/Application';
import type { FloorPlan } from '../src/components/RoomTourMap';

// "Take the tour" and its map of the room (brief §0, §1). Until room v3 ships its own public/room/floorplan.json, the
// room's current framings stand in through a fixture.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const FIXTURE = readFileSync(new URL('./fixtures/floorplan-current-room.json', import.meta.url), 'utf8');
const PLAN = JSON.parse(FIXTURE) as FloorPlan;
const station = (stop: FloorPlan['stops'][number]) => stop.camera.replace(/^cam_/, '');

async function arrived(page: Page) {
  await page.route('**/room/floorplan.json', (route) => route.fulfill({ body: FIXTURE, contentType: 'application/json' }));
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.phase === 'desk' && !window.__room.moving, null, { timeout: 120_000 });
}

const settledAt = (page: Page, at: string, timeout = 30_000) =>
  page.waitForFunction((s) => window.__room?.phase === s && !window.__room.moving, at, { timeout });

const map = (page: Page) => page.getByRole('region', { name: 'Map of the room' });
const stopButtons = (page: Page) => map(page).getByRole('list', { name: 'Stops' }).getByRole('button');

/**
 * Catches a map that does not open, a stop that does not fly the camera there, a you-are-here mark that stays put, a
 * played tour that skips a stop or never returns to the desk, and an Escape that leaves the map open.
 */
test('the map opens, a stop flies the camera there, the tour plays every stop and returns, Escape closes it', async ({ page }) => {
  await arrived(page);
  const open = page.getByRole('button', { name: 'Take the tour' });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(map(page)).toBeVisible();
  await expect(stopButtons(page)).toHaveText(PLAN.stops.map((s, i) => `${i + 1}${s.label}`));
  // The camera rests at the desk, the first stop: the map says so.
  await expect(stopButtons(page).first()).toHaveAttribute('aria-current', 'location');

  const second = PLAN.stops[1];
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

  // Play: every stop in order, then back to the desk.
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
  await expect(page.locator('[data-tour-caption]')).toHaveText(`1 of ${PLAN.stops.length} · ${PLAN.stops[0].label}`);
  await expect(page.locator('[data-tour-caption]')).toHaveText('Back at the desk.', { timeout: 120_000 });
  await settledAt(page, 'desk');
  await expect(map(page).getByRole('button', { name: 'Play the tour' })).toBeVisible();
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen).toEqual([station(second), ...PLAN.stops.map(station), 'desk'].filter((s, i, all) => s !== all[i - 1]));

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
  await page.waitForFunction((s) => window.__room!.destination === s, station(PLAN.stops[1]), { timeout: 30_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await expect(map(page).getByRole('button', { name: 'Play the tour' })).toBeVisible();
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
  // The arrows moved between stops only; the room did not take them as steps.
  expect(await page.evaluate(() => window.__room!.destination)).toBe('desk');
  await page.keyboard.press('Enter');
  await settledAt(page, station(PLAN.stops[2]));
  await page.keyboard.press('Escape');
  await expect(map(page)).toBeHidden();
  await expect(open).toBeFocused();
});
