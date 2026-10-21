import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type {} from '../src/scene/Application/Application';
import type {} from '../src/scene/World/Shine';

const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

/** Opens the room at a pinned quality tier and waits until it has landed and the visitor can act. */
async function landAt(page: Page, tier: number) {
  await page.addInitScript((t) => ((window as unknown as { __roomTier: number }).__roomTier = t), tier);
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.interactiveAt != null && !window.__room.moving, null, { timeout: 180_000 });
}

/** Mean absolute difference per channel (0–255) between two shots of the same clip. */
async function difference(a: Buffer, b: Buffer) {
  const [pa, pb] = await Promise.all([a, b].map((png) => sharp(png).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < pa.length; i++) sum += Math.abs(pa[i] - pb[i]);
  return sum / pa.length;
}

/**
 * Catches the shine loading but never drawing (a shader that fails to compile draws nothing, and three only logs it)
 * and shine on a surface the A/B turned down: at the top tier the probe loads before the room is shown, only the
 * desk top, the CRT glass and the chairs' leather shine, and turning the shine on changes the desk's pixels.
 */
test('the top tier loads the probe, and the desk top, the CRT glass and the chairs’ leather shine', async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && /WebGLProgram|shader/i.test(m.text()) && shaderErrors.push(m.text()));
  await landAt(page, 0);
  await page.evaluate(() => window.__room!.goto('desk'));
  await page.waitForFunction(() => window.__room!.phase === 'desk' && !window.__room!.moving, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__shine?.state === 'ready', null, { timeout: 60_000 });
  expect((await page.evaluate(() => window.__shine!.surfaces.map((s) => s.name))).sort()).toEqual(['crt_glow', 'desk_chair_leather', 'desk_desk_top', 'props_lounge_chair_leather']);

  await page.mouse.move(2, 2);
  await page.locator('[data-room-pause]').click();
  const desk = { x: 0, y: 600, width: 1440, height: 240 };
  const shot = async (on: boolean) => {
    // Four times the shipped strength, so the check does not hang on how bright the probe's window is.
    await page.evaluate((v) => (window.__shine!.set(v), window.__shine!.tune('desk_desk_top', { strength: 1 })), on);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
    return page.screenshot({ clip: desk });
  };
  const off = await shot(false);
  const on = await shot(true);
  const offAgain = await shot(false);
  // A second plain shot is the noise floor (the steam and the screen keep drawing).
  expect(await difference(off, on), 'the desk top shines').toBeGreaterThan((await difference(off, offAgain)) + 1);
  expect(shaderErrors).toEqual([]);
});

/**
 * Catches the probe downloading on a machine the ladder has stepped down (its bytes and the prefiltering pass spent
 * for nothing): the load starts once the room's tier is measured, so on a tier without shine the shine is still
 * waiting when the room lands, with no request for the probe.
 */
test('a tier without shine never fetches the probe', async ({ page }) => {
  const probeRequests: string[] = [];
  page.on('request', (r) => r.url().includes('/room/probe/') && probeRequests.push(r.url()));
  // FULL's tier 4 (resolution 0.4, no MSAA) is the first without shine; a pinned tier never climbs back.
  await landAt(page, 4);
  expect(await page.evaluate(() => window.__shine!.state)).toBe('waiting');
  expect(probeRequests).toEqual([]);
});
