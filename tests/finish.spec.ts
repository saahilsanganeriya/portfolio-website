import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type {} from '../src/scene/Application/Application';
import type {} from '../src/scene/Application/Renderer';

const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

type Clip = { x: number; y: number; width: number; height: number };

/** Mean absolute difference per channel (0–255) between two shots of the same clip. */
async function difference(a: Buffer, b: Buffer) {
  const [pa, pb] = await Promise.all([a, b].map((png) => sharp(png).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < pa.length; i++) sum += Math.abs(pa[i] - pb[i]);
  return sum / pa.length;
}

/** Applies a look and redraws once: a paused room only draws when something changed, so it is unpaused for a moment. */
async function shoot(page: Page, look: () => void, clips: Clip[]) {
  await page.evaluate(look);
  const pause = page.locator('[data-room-pause]');
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await pause.click();
  await frames();
  await pause.click();
  await frames();
  return Promise.all(clips.map((clip) => page.screenshot({ clip })));
}

/**
 * Catches the finishing pass grading, blooming or darkening the OS on the monitor (PLAN 1: no effect over reading
 * text): at an exaggerated look the room changes a lot and the OS no more than the glass's own flicker.
 */
test('the finishing pass changes the room but never the OS on the monitor', async ({ page }) => {
  await page.addInitScript(() => ((window as unknown as { __roomTier: number }).__roomTier = 0));
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null && !window.__room.moving, null, { timeout: 180_000 });
  await page.evaluate(() => window.__room!.goto('desk'));
  await page.waitForFunction(() => window.__room!.phase === 'desk' && !window.__room!.moving, null, { timeout: 60_000 });
  await page.mouse.move(2, 2);
  await page.locator('[data-room-pause]').click();
  const monitor = (await page.evaluate(() => window.__room!.point('monitor')))!;
  const os: Clip = { x: monitor.x - 40, y: monitor.y - 30, width: 80, height: 60 };
  const room: Clip = { x: 40, y: 200, width: 300, height: 300 };

  const [osPlain, roomPlain] = await shoot(page, () => (window.__finish!.force = { grade: false, bloom: false, film: false }), [os, room]);
  const [osLoud, roomLoud] = await shoot(
    page,
    () => {
      window.__finish!.force = { grade: true, bloom: true, film: true };
      window.__finish!.set({ grade: { tone: 'aces', exposure: 2, toe: [0, 0.001], keepHue: 0, strength: 1 }, bloom: 4, grain: 0, vignette: 0.6 });
    },
    [os, room],
  );
  // The CRT glass animates (scanline roll, grain) whenever the room draws: a second plain shot is the noise floor.
  const [osAgain] = await shoot(page, () => (window.__finish!.force = { grade: false, bloom: false, film: false }), [os]);
  const floor = await difference(osPlain, osAgain);
  expect(await difference(roomPlain, roomLoud), 'the room is finished').toBeGreaterThan(10);
  expect(await difference(osPlain, osLoud), 'the OS is untouched').toBeLessThan(floor + 1);
});
