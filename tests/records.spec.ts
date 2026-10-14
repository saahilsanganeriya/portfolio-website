import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// Headless Chromium only has WebGL through SwiftShader; the room needs it. The browser's autoplay policy is on, as
// for visitors.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: [...WEBGL_ARGS, '--autoplay-policy=document-user-activation-required'] }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const graph = (page: Page) => page.evaluate(() => window.__room!.audio!.graph());
const crate = (page: Page) => page.getByRole('region', { name: 'Records' });

/** Landed at the desk, the sound started by a key press and the lo-fi stems playing. */
async function soundOn(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.phase === 'desk' && !window.__room.moving, null, { timeout: 120_000 });
  await page.keyboard.press('KeyA');
  await page.waitForFunction(() => (window.__room?.audio?.graph().loaded ?? []).filter((k) => k.startsWith('music/')).length === 3, null, {
    timeout: 60_000,
  });
}

/**
 * Catches a record that never becomes the music (the bed keeps playing, or the stream never starts), a record fetched
 * before it is chosen, and a Stop that leaves the room silent instead of bringing the lo-fi bed back.
 */
test('choosing a record makes it the room’s music; Stop brings the lo-fi bed back', async ({ page }) => {
  const records: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/audio/records/')) records.push(pathname);
  });
  await soundOn(page);
  await page.evaluate(() => window.__room!.openRecords());
  await expect(crate(page)).toBeVisible();
  expect(records).toEqual([]);

  await crate(page).getByRole('button', { name: /^Night in Venice/ }).click();
  await expect(crate(page).getByRole('button', { name: /^Night in Venice/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(crate(page).getByText('Now playing: Night in Venice, Kevin MacLeod')).toBeVisible();
  const playing = await graph(page);
  expect(playing.musicSource).toBe('night-in-venice');
  expect(playing.bed!.to).toBe(0);
  expect(playing.record!.to).toBeGreaterThan(0.5);
  // The stream itself plays and moves on, after the needle's lead-in.
  await expect.poll(async () => (await graph(page)).deck?.time ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
  expect((await graph(page)).deck).toMatchObject({ record: 'night-in-venice', playing: true, needleDown: true, src: '/audio/records/night-in-venice.webm' });
  expect(records.filter((p) => !/needle|crackle/.test(p)).every((p) => p.startsWith('/audio/records/night-in-venice.'))).toBe(true);

  await crate(page).getByRole('button', { name: 'Stop' }).click();
  const stopped = await graph(page);
  expect(stopped.musicSource).toBeNull();
  expect(stopped.bed!.to).toBe(1);
  expect(stopped.record!.to).toBe(0);
  await expect.poll(async () => (await graph(page)).deck?.playing, { timeout: 10_000 }).toBe(false);
  await expect(crate(page).getByRole('button', { name: 'Stop' })).toBeDisabled();
});

/**
 * Catches a crate a keyboard cannot use (focus not moved in, arrows that step the camera instead, Enter that does not
 * play, Escape that flies the camera out instead of closing it) and WCAG failures in it.
 */
test('the crate works from the keyboard and has no serious or critical axe violations', async ({ page }) => {
  await soundOn(page);
  await page.evaluate(() => window.__room!.openRecords());
  await expect(crate(page)).toBeVisible();
  await expect(crate(page).getByRole('button', { name: /^Washed Up/ })).toBeFocused();

  const { violations } = await new AxeBuilder({ page })
    .include('#room-records')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);

  await page.keyboard.press('ArrowRight');
  await expect(crate(page).getByRole('button', { name: /^Night in Venice/ })).toBeFocused();
  expect(await page.evaluate(() => window.__room!.phase)).toBe('desk');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await graph(page)).musicSource).toBe('night-in-venice');

  const stop = crate(page).getByRole('button', { name: 'Stop' });
  for (let i = 0; i < 6 && !(await stop.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(stop).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await graph(page)).musicSource).toBeNull();

  await page.keyboard.press('Escape');
  await expect(crate(page)).toBeHidden();
  await expect(page.locator('[data-room]')).toBeFocused();
  // Escape closed the crate only: a flight out would have set the camera's destination as the key was handled.
  expect(await page.evaluate(() => ({ destination: window.__room!.destination, moving: window.__room!.moving }))).toEqual({ destination: 'desk', moving: false });
});
