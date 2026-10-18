import { devices, expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// Safari's trackpad pinch (brief round 9 §1.5): WebKit sends gesturestart / gesturechange / gestureend with a scale,
// not a wheel. Run in Playwright's WebKit on the M-series profile (MacBook Pro 14": 1512×982 CSS px at DPR 2). Linux
// WebKit has no GestureEvent of its own, so the events are built as Safari's carry them: a type and a scale.

const { defaultBrowserType: _webkit, ...safari } = devices['Desktop Safari'];
test.use({ ...safari, browserName: 'webkit', viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });
test.describe.configure({ timeout: 240_000 });

const orbit = (page: Page) => page.evaluate(() => window.__room!.orbit);

async function inRoom(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 180_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await page.waitForFunction(() => window.__room?.phase === 'idle' && !window.__room.moving, null, { timeout: 30_000 });
}

const orbitRests = (page: Page) => page.waitForFunction(() => window.__room!.orbit !== null && !window.__room!.moving, null, { timeout: 30_000 });

/**
 * Catches a Safari pinch (gesturestart / gesturechange with a scale / gestureend, not a wheel) that zooms the page,
 * zooms the room the wrong way, or is counted twice.
 */
test('Safari’s gesture events pinch the room and never zoom the page', async ({ page }) => {
  await inRoom(page);
  await page.mouse.wheel(0, -5);
  await orbitRests(page);
  const start = (await orbit(page))!.radius;
  const gesture = (scales: number[]) =>
    page.evaluate(async (list) => {
      const stage = document.querySelector('[data-room-world]')!;
      const fire = (type: string, scale: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'scale', { value: scale });
        return stage.dispatchEvent(event);
      };
      const kept = [fire('gesturestart', 1)];
      for (const scale of list) {
        kept.push(fire('gesturechange', scale));
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      kept.push(fire('gestureend', list.at(-1)!));
      return kept;
    }, scales);
  // Fingers apart to 1.5×: the room comes 1.5× nearer.
  const apart = await gesture([1.1, 1.2, 1.35, 1.5]);
  expect(apart.every((notCancelled) => !notCancelled), 'every gesture event was kept from the page').toBe(true);
  await orbitRests(page);
  const nearer = (await orbit(page))!.radius;
  expect(start / nearer).toBeGreaterThan(1.45);
  expect(start / nearer).toBeLessThan(1.55);
  await gesture([0.9, 0.8, 0.7]);
  await orbitRests(page);
  expect((await orbit(page))!.radius / nearer).toBeGreaterThan(1.35);
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
});
