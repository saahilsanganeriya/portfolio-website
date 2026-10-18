import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import type {} from '../src/scene/Application/Application';

// The set's edge in the void, zoomed out as far as the room allows from the wide view, on the M-series profile.

const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
test.describe.configure({ timeout: 300_000 });

// The set's right edge on a row: its rightmost run of EDGE_RUN_PX pixels that are not the void (any channel more than
// NOT_VOID_BY off the void's). A line pixel past it: LIGHTER_BY brighter than the void, the void on both sides SIDE_PX off.
const EDGE_RUN_PX = 12;
const NOT_VOID_BY = 8;
const VOID_WITHIN = 4;
const LIGHTER_BY = 6;
const SIDE_PX = 4;

/**
 * Catches the hairline at the set's right edge (T98: a 1 px light dotted line in the void, zoomed out; T95: window_sky
 * and Delhi's half reaching past the back wall's free end, seen edge-on): in the void past the set's right edge, no
 * more than a few pixels are a thin light line (219 on the build before the fix, 3 after: noise in the void's grain).
 */
test('zoomed out, no light line shows in the void past the set’s right edge', async ({ page }, info) => {
  await page.addInitScript(() => ((window as unknown as { __roomTier: number }).__roomTier = 0));
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 200_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await page.waitForFunction(() => window.__room!.phase === 'idle' && !window.__room!.moving, null, { timeout: 60_000 });
  await page.mouse.move(4, 4);
  // Out to the far limit: '-' zooms out a step at a time until the radius stops growing.
  let radius = 0;
  for (let k = 0; k < 30; k++) {
    await page.keyboard.press('-');
    await page.waitForFunction(() => window.__room!.orbit !== null && !window.__room!.moving, null, { timeout: 30_000 });
    const next = (await page.evaluate(() => window.__room!.orbit!.radius))!;
    if (Math.abs(next - radius) < 1e-3) break;
    radius = next;
  }
  const shot = await page.screenshot();
  writeFileSync(info.outputPath('zoomed-out.png'), shot);
  const { data, info: size } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const colour = (x: number, y: number) => {
    const i = (y * size.width + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const voidColour = colour(8, 8);
  const isVoid = (c: number[], within: number) => c.every((v, k) => Math.abs(v - voidColour[k]) <= within);
  const lines: [number, number][] = [];
  for (let y = 0; y < size.height * 0.85; y++) {
    let [run, edge] = [0, -1];
    for (let x = size.width - 1; x >= 0; x--) {
      run = isVoid(colour(x, y), NOT_VOID_BY) ? 0 : run + 1;
      if (run >= EDGE_RUN_PX) {
        edge = x + EDGE_RUN_PX - 1;
        break;
      }
    }
    for (let x = Math.max(edge + SIDE_PX + 2, Math.round(size.width / 2)); x < size.width - SIDE_PX; x++)
      if (luma(colour(x, y)) >= luma(voidColour) + LIGHTER_BY && isVoid(colour(x - SIDE_PX, y), VOID_WITHIN) && isVoid(colour(x + SIDE_PX, y), VOID_WITHIN)) lines.push([x, y]);
  }
  const voidLuma = luma(voidColour);
  test.info().annotations.push({ type: 'line pixels', description: `${lines.length} at radius ${radius.toFixed(2)}, void luma ${voidLuma.toFixed(1)}, e.g. ${JSON.stringify(lines.slice(0, 6))}` });
  expect(lines.length, `line pixels in the void, e.g. ${JSON.stringify(lines.slice(0, 6))}`).toBeLessThan(20);
});
