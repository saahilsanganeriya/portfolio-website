import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type {} from '../src/scene/Application/Application';

// Frame backs (owner, round 9): the walls turn see-through in the orbit, and from behind a framed piece shows plain
// card, never its picture. The Murakami print stands free on the bookcase, so its back is what the orbit shows most.

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

/** Radians per CSS pixel of drag on the 900 px stage (the orbit turns 1.6 pi per stage height). */
const RAD_PER_PX = (Math.PI * 1.6) / 900;

/** Drags across the stage by dx in steps, letting go only after a rest (no coast), and waits for the orbit to settle. */
async function turn(page: Page, dx: number) {
  await page.mouse.move(720, 520);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(720 + (dx * i) / 12, 520);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForFunction(() => window.__room!.orbit !== null && !window.__room!.moving, null, { timeout: 30_000 });
}

/** Mean colour (0–255) and the spread of luma in a screenshot clip. */
async function patch(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const mean = [0, 0, 0];
  const lumas: number[] = [];
  for (let i = 0; i < n; i++) {
    const [r, g, b] = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
    mean[0] += r / n;
    mean[1] += g / n;
    mean[2] += b / n;
    lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const average = lumas.reduce((s, v) => s + v, 0) / n;
  return { mean, spread: Math.sqrt(lumas.reduce((s, v) => s + (v - average) ** 2, 0) / n) };
}

const hex = (colour: string) => [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));

/**
 * Catches the Murakami print showing its picture (flipped or not) or the bake's own back from behind: seen from behind
 * the set, its back is one flat patch of the backing card's colour. The picture's red sun and lettering would spread the
 * patch's luma by tens of levels; the bake's white back is ~200 levels brighter than the card.
 */
test('the Murakami print shows plain card from behind', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await page.waitForFunction(() => window.__room!.phase === 'idle' && !window.__room!.moving, null, { timeout: 30_000 });
  const backs = await page.evaluate(() => window.__room!.world.frameBacks);
  expect(backs.pieces.map((p) => p.name)).toContain('print_japanese_lit');

  // 120° round from the wide view: behind the back wall (faded), the print's back toward the camera, left of centre.
  for (let k = 0; k < 2; k++) await turn(page, -(Math.PI / 3) / RAD_PER_PX);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const at = await page.evaluate(() => window.__room!.point('backing:print_japanese_lit'));
  expect(at, 'the print’s back is on screen').not.toBeNull();
  const { mean, spread } = await patch(await page.screenshot({ clip: { x: at!.x - 5, y: at!.y - 5, width: 10, height: 10 } }));
  expect(spread, 'luma spread across the back (levels)').toBeLessThan(4);
  mean.forEach((v, i) => expect(Math.abs(v - hex(backs.colour)[i]), `channel ${i} against the card`).toBeLessThan(12));
});
