import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type {} from '../src/scene/Application/Application';

// What hangs on a wall comes back with it: on the way home from the side or from behind the set, the back wall fades
// back in, and the posters and the Voyager record on it must be drawn over it, never under it. The room runs on
// Playwright's paused clock, so each step draws a known stretch of the swing and the shot shows that frame.

const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
// A small stage draws faster in software; the draw order under test does not depend on the size.
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1200, height: 780 } });
test.describe.configure({ timeout: 300_000 });

const PIECE = /^hit_(?:poster_|voyager)/;
const BOX_PX = 8;
const STEP_MS = 1000 / 30;

interface Frame {
  opacity: number;
  luma: Record<string, number>;
  shot: Buffer;
}

/** Mean luma (0–255) of a BOX_PX square of the shot at each piece's screen point; pieces off screen are left out. */
async function lumaAt(page: Page, names: string[]) {
  const points = await page.evaluate((list) => list.map((n) => [n, window.__room!.point(n)] as const), names);
  const shot = await page.screenshot();
  const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const luma: Record<string, number> = {};
  for (const [name, p] of points) {
    if (!p) continue;
    const [x0, y0] = [Math.round(p.x - BOX_PX / 2), Math.round(p.y - BOX_PX / 2)];
    if (x0 < 0 || y0 < 0 || x0 + BOX_PX > info.width || y0 + BOX_PX > info.height) continue;
    let sum = 0;
    for (let y = y0; y < y0 + BOX_PX; y++)
      for (let x = x0; x < x0 + BOX_PX; x++) {
        const i = (y * info.width + x) * 3;
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
    luma[name] = sum / (BOX_PX * BOX_PX);
  }
  return { luma, shot };
}

const atRest = (page: Page) => page.waitForFunction(() => window.__room!.phase === 'idle' && !window.__room!.moving, null, { timeout: 120_000 });

async function inRoom(page: Page) {
  await page.addInitScript(() => ((window as unknown as { __roomTier: number }).__roomTier = 0));
  await page.clock.install();
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 200_000 });
  await page.waitForFunction(() => window.__room!.world.interactive, null, { timeout: 60_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await atRest(page);
  await page.addStyleTag({ content: '[data-room-hud] { visibility: hidden !important; }' });
}

/** Turns the set `presses` × 15° by the arrow keys (four at a time stay under the coast's top speed), then Home, frame by frame. */
async function homeFrom(page: Page, presses: number, names: string[]) {
  for (let left = presses; left > 0; left -= 4) {
    for (let k = 0; k < Math.min(4, left); k++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__room!.orbit !== null && !window.__room!.moving, null, { timeout: 60_000 });
  }
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
  await page.keyboard.press('h');
  const frames: Frame[] = [];
  for (let k = 0; k < 150; k++) {
    await page.clock.runFor(STEP_MS);
    const opacity = await page.evaluate(() => window.__room!.walls.find((w) => w.name === 'back')!.opacity);
    frames.push({ opacity, ...(await lumaAt(page, names)) });
    if (k > 10 && opacity === 1 && (await page.evaluate(() => window.__room!.phase === 'idle' && !window.__room!.moving))) break;
  }
  await page.clock.resume();
  return frames;
}

/**
 * Catches the posters and the Voyager record drawn under their own wall while it fades back in (T98b: from 94° and from
 * 180° they showed as near-black slabs, the wall's shadowed texels behind them, for ~0.8 s after the wall was back): in
 * no frame with the back wall over 0.9 do half or more of the pieces on screen fall below half their luma at rest in
 * the wide view. The wall drew over all of them at once; the pendant lamp, swinging past in front, hides one or two.
 */
for (const [label, presses] of [
  ['from the side (90°)', 6],
  ['from behind (180°)', 12],
] as const) {
  test(`coming home ${label}, the posters and the Voyager record stay drawn as the wall comes back`, async ({ page }, info) => {
    await inRoom(page);
    const names = await page.evaluate((source) => {
      const back = window.__room!.walls.find((w) => w.name === 'back')!;
      return back.proxies.filter((n) => new RegExp(source).test(n));
    }, PIECE.source);
    expect(names.length, 'the back wall holds the posters and the record').toBeGreaterThanOrEqual(5);
    const { luma: rest } = await lumaAt(page, names);
    expect(Object.keys(rest).sort(), 'every piece on screen in the wide view').toEqual([...names].sort());
    const frames = await homeFrom(page, presses, names);
    expect(frames.some((f) => f.opacity < 0.9), 'the swing started with the wall faded').toBe(true);
    const dark = frames.flatMap((f, k) => {
      const low = Object.entries(f.luma).filter(([n, v]) => v < 0.5 * rest[n]);
      if (f.opacity <= 0.9 || low.length * 2 < Object.keys(f.luma).length) return [];
      return [`frame ${k} (wall ${f.opacity.toFixed(3)}): ${low.map(([n, v]) => `${n} ${v.toFixed(0)} of ${rest[n].toFixed(0)}`).join(', ')}`];
    });
    await info.attach('frames.json', { body: JSON.stringify({ rest, frames: frames.map(({ shot: _, ...f }) => f) }, null, 1), contentType: 'application/json' });
    // The swing's last stretch, the wall from half back to whole, kept beside the report for before/after sheets.
    for (const [k, f] of frames.entries()) if (f.opacity > 0.5 && f.opacity < 1) writeFileSync(info.outputPath(`frame-${String(k).padStart(3, '0')}.png`), f.shot);
    expect(dark, 'frames with a piece under its wall').toEqual([]);
  });
}
