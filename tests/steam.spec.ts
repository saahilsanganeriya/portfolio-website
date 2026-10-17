import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// The steam over the coffee on the desk (after Henry Heffernan's): it rises over time, and holds still for a visitor who
// asked for less motion. A frame strip of it is attached to the report.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial', timeout: 240_000 });

async function atDesk(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 200_000 });
  await page.waitForFunction(() => window.__room!.world.interactive, null, { timeout: 30_000 });
  await page.evaluate(() => window.__room!.goto('desk'));
  await page.waitForFunction(() => window.__room!.phase === 'desk' && !window.__room!.moving, null, { timeout: 60_000 });
}

function frames(page: Page, n: number) {
  return page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const next = () => (--left <= 0 ? resolve(null) : requestAnimationFrame(next));
        requestAnimationFrame(next);
      }),
    n,
  );
}

/** Catches steam that never appears over the mug, or a plume frozen for everyone. */
test('the coffee steams, rising over time', async ({ page }, info) => {
  await atDesk(page);
  const steam = () => page.evaluate(() => window.__room!.world.coffeeSteam);
  const first = (await steam())!;
  expect(first.moving).toBe(true);
  const point = await page.evaluate(() => window.__room!.point('coffee_steam_plume'));
  for (let i = 0; i < 4; i++) {
    await frames(page, 20);
    const clip = point ? { x: Math.max(0, point.x - 90), y: Math.max(0, point.y - 200), width: 180, height: 260 } : undefined;
    await info.attach(`steam frame ${i}`, { body: await page.screenshot({ clip }), contentType: 'image/png' });
  }
  expect((await steam())!.time).toBeGreaterThan(first.time);
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  /** Catches a plume that keeps moving when the visitor asked for less motion. */
  test('the steam holds still', async ({ page }) => {
    await atDesk(page);
    const before = (await page.evaluate(() => window.__room!.world.coffeeSteam))!;
    expect(before.moving).toBe(false);
    await frames(page, 40);
    expect((await page.evaluate(() => window.__room!.world.coffeeSteam))!.time).toBe(before.time);
  });
});
