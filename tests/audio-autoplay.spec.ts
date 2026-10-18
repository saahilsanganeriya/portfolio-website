import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// Chromium's own policy in a headless run lets a page start sound without a gesture, as Chrome does for a site its
// visitor often plays media on (media engagement): the room must take that chance.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const graph = (page: Page) => page.evaluate(() => window.__room!.audio!.graph());

/** Catches a room that waits for a gesture even where the browser would let the music start with the room. */
test('where the browser allows it, the music starts with the room, before any input', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await expect.poll(async () => (await graph(page)).context, { timeout: 15_000 }).toBe('running');
  await expect(page.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-room-status]')).toHaveText(/Music is on/);
});
