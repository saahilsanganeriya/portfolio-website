import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { bandingOf, findDarkGradients } from '../scripts/lib/banding.mjs';
import type {} from '../src/scene/Application/Application';
import type {} from '../src/scene/Application/Renderer';

const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

type Clip = { x: number; y: number; width: number; height: number };

/** The mean of the steepest 5% of luma gradients in a shot (levels per pixel): aliased edges step harder. */
async function edgeSteepness(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const y = (x: number, r: number) => {
    const i = (r * width + x) * 3;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const steps: number[] = [];
  for (let r = 1; r < height - 1; r++) {
    for (let x = 1; x < width - 1; x++) steps.push(Math.hypot(y(x + 1, r) - y(x - 1, r), y(x, r + 1) - y(x, r - 1)) / 2);
  }
  steps.sort((a, b) => b - a);
  const top = steps.slice(0, Math.ceil(steps.length * 0.05));
  return top.reduce((sum, v) => sum + v, 0) / top.length;
}

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
      window.__finish!.set({ grade: { tone: 'aces', exposure: 2, toe: [0, 0.001], keepHue: 0, strength: 1 }, bloom: 4, vignette: 0.6 });
    },
    [os, room],
  );
  // The CRT glass animates (scanline roll, grain) whenever the room draws: a second plain shot is the noise floor.
  const [osAgain] = await shoot(page, () => (window.__finish!.force = { grade: false, bloom: false, film: false }), [os]);
  const floor = await difference(osPlain, osAgain);
  expect(await difference(roomPlain, roomLoud), 'the room is finished').toBeGreaterThan(10);
  expect(await difference(osPlain, osLoud), 'the OS is untouched').toBeLessThan(floor + 1);
});

/**
 * Catches the room's edges losing their antialiasing on a machine that holds the top tier: the scene target without
 * samples, or the room drawn straight onto the canvas (antialias: false). The keyboard's keys and the monitor's
 * edges step from pixel to pixel without it.
 */
test('the top tier draws antialiased edges', async ({ page }) => {
  await page.addInitScript(() => ((window as unknown as { __roomTier: number }).__roomTier = 0));
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null && !window.__room.moving, null, { timeout: 180_000 });
  await page.evaluate(() => window.__room!.goto('desk'));
  await page.waitForFunction(() => window.__room!.phase === 'desk' && !window.__room!.moving, null, { timeout: 60_000 });
  await page.mouse.move(2, 2);
  await page.locator('[data-room-pause]').click();
  const monitor = (await page.evaluate(() => window.__room!.point('monitor')))!;
  const edges: Clip = { x: monitor.x - 260, y: monitor.y + 60, width: 520, height: 220 };
  const [shipped] = await shoot(page, () => window.__roomDebug!.reset(), [edges]);
  const [aliased] = await shoot(page, () => window.__roomDebug!.set({ samples: 0 }), [edges]);
  expect(await edgeSteepness(shipped), 'MSAA softens the steepest steps').toBeLessThan((await edgeSteepness(aliased)) * 0.97);
});

/**
 * Catches banding coming back in the room's dark gradients: the output dither missing, too weak to break the flat
 * steps, or left with nothing to place on a tier with no vignette or bloom (an 8-bit scene target, or the room drawn
 * straight onto the canvas, as tiers 4–5 and phones were); and a dither that moves from frame to frame, which would
 * crawl while the camera drifts. On the darkest smooth gradient of the wide view, the flat steps shrink, and two
 * redraws of the still room differ no more with the dither than without it.
 */
for (const { tier, shrink } of [
  { tier: 0, shrink: 0.5 },
  // Tier 4 draws 0.4 device px per CSS px, so the dither's grain is upscaled too: steps shrink by about 45%, not 85%.
  { tier: 4, shrink: 0.75 },
]) {
  test(`dark gradients are dithered with a pattern that never moves (tier ${tier})`, async ({ page }) => {
    await page.addInitScript((t) => ((window as unknown as { __roomTier: number }).__roomTier = t), tier);
    await page.goto('/');
    await page.waitForFunction(() => window.__room?.landedAt != null && !window.__room.moving, null, { timeout: 180_000 });
    await page.evaluate(() => window.__room!.goto('idle'));
    await page.waitForFunction(() => window.__room!.phase === 'idle' && !window.__room!.moving, null, { timeout: 60_000 });
    await page.mouse.move(2, 2);
    await page.locator('[data-room-pause]').click();
    const frame: Clip = { x: 0, y: 0, width: 1440, height: 900 };
    const decode = async (png: Buffer) => (await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })).data;

    const [plain] = await shoot(page, () => window.__roomDebug!.set({ dither: 0 }), [frame]);
    const [plainAgain] = await shoot(page, () => window.__roomDebug!.set({ dither: 0 }), [frame]);
    const [dithered] = await shoot(page, () => window.__roomDebug!.reset(), [frame]);
    const [ditheredAgain] = await shoot(page, () => window.__roomDebug!.reset(), [frame]);
    const plainRgb = await decode(plain);
    const [rect] = findDarkGradients(plainRgb, 1440, 900, 1, { count: 1 });
    expect(rect, 'the wide view has a dark gradient to measure').toBeTruthy();
    const crop = (png: Buffer) => sharp(png).extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }).png().toBuffer();

    const before = bandingOf(plainRgb, 1440, 900, rect, 1);
    const after = bandingOf(await decode(dithered), 1440, 900, rect, 1);
    expect(after.run, `flat steps ${before.run} → ${after.run} CSS px`).toBeLessThan(before.run * shrink);
    const roomNoise = await difference(await crop(plain), await crop(plainAgain));
    expect(await difference(await crop(dithered), await crop(ditheredAgain)), 'the dither is the same every frame').toBeLessThanOrEqual(roomNoise + 0.02);
  });
}
