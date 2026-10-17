import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type {} from '../src/scene/Application/Application';

// The window over San Francisco (left) and New Delhi (right): both cities by day at any hour, one sky whose colour runs
// from one city's to the other's with no line between them, only the two day pictures fetched, and the motif (a plane
// on a dotted arc from New Delhi to San Francisco, both names in his hand) drawn over the sky. Each test loads the room
// with a mocked clock and reads the pixels of the window framing; the screenshots are attached to the report.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial', timeout: 300_000 });

// Hours far apart on both cities' clocks: noon in San Francisco (1:30 am in Delhi), the reverse, and dusk in one city
// with dawn in the other. Time no longer matters, so all three must look the same.
const HOURS = ['2026-06-21T20:00:00Z', '2026-06-22T08:00:00Z', '2026-11-10T01:07:00Z'] as const;

/** Mean brightness (0–255) of a strip of the shot, centred at (x, y). */
function brightness(pixels: Buffer, width: number, x: number, y: number, w = 50, h = 24) {
  let sum = 0;
  for (let row = y - h / 2; row < y + h / 2; row++)
    for (let col = x - w / 2; col < x + w / 2; col++) {
      const i = (row * width + col) * 3;
      sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    }
  return sum / (w * h * 3);
}

/** Loads the room at `at`, logging every window picture it fetches, and settles at the window framing. */
async function windowAt(page: Page, at: string) {
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __pictures: string[] }).__pictures = log;
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const match = url.match(/\/room\/(window_[a-z]+_[a-z]+\.ktx2)$/);
      if (match) log.push(match[1]);
      return fetch(input, init);
    };
  });
  await page.clock.setFixedTime(at);
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 200_000 });
  await page.waitForFunction(() => window.__room!.world.interactive, null, { timeout: 30_000 });
  await page.evaluate(() => window.__room!.goto('window'));
  await page.waitForFunction(() => window.__room!.phase === 'window' && !window.__room!.moving, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__room!.world.window?.motif?.drawn !== false, null, { timeout: 30_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Lets the room draw `n` more frames (counted, not timed). */
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

async function pixelsOf(shot: Buffer) {
  return sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

test.describe('under reduced motion (the plane holds still)', () => {
  test.use({ reducedMotion: 'reduce' });

  /**
   * Catches a seam between the cities' skies (the old halves met in a hard line at the central bar), a window that
   * still follows a clock (a night city, or a different picture at another hour) and night pictures being fetched.
   */
  test('the window is the same day view at any hour, one sky with no line between the cities', async ({ browser }, info) => {
    const shots: Buffer[] = [];
    for (const at of HOURS) {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      await windowAt(page, at);
      const state = (await page.evaluate(() => window.__room!.world.window))!;
      expect(state.sf).toMatchObject({ name: 'San Francisco', loaded: true });
      expect(state.delhi).toMatchObject({ name: 'New Delhi', loaded: true });
      const pictures = await page.evaluate(() => (window as unknown as { __pictures: string[] }).__pictures);
      expect(pictures.every((file) => file.endsWith('_day.ktx2')), pictures.join(', ')).toBe(true);
      expect(new Set(pictures).size).toBeLessThanOrEqual(2);

      const shot = await page.screenshot();
      shots.push(shot);
      await info.attach(`window at ${at}`, { body: shot, contentType: 'image/png' });
      const { data, info: meta } = await pixelsOf(shot);
      const centre = (await page.evaluate(() => window.__room!.point('hit_window')))!;
      const cx = Math.round(centre.x);
      for (const y of [Math.round(centre.y) - 300, Math.round(centre.y) - 110]) {
        const near = (dx: number, w = 30) => brightness(data, meta.width, cx + dx, y, w);
        // A seam is a step between the cities bigger than the gradient on either side of it.
        const [l1, l2, r1, r2] = [near(-105), near(-45), near(45), near(105)];
        const slope = Math.max(Math.abs(l2 - l1), Math.abs(r2 - r1)) / 60;
        const step = Math.abs(r1 - l2) / 90;
        const [farLeft, farRight] = [near(-380, 50), near(380, 50)];
        const row = `${at} row ${y}: far left ${farLeft.toFixed(0)}, by the middle ${l1.toFixed(0)} ${l2.toFixed(0)} | ${r1.toFixed(0)} ${r2.toFixed(0)}, far right ${farRight.toFixed(0)}`;
        expect(step, row).toBeLessThan(2 * slope + 0.2);
        // Daylight on both sides.
        expect(Math.min(farLeft, farRight), row).toBeGreaterThan(110);
      }
      await page.close();
    }
    // Every hour draws the same window.
    const [first, ...rest] = await Promise.all(shots.map(pixelsOf));
    for (const [i, other] of rest.entries()) {
      let diff = 0;
      for (let k = 0; k < first.data.length; k++) diff += Math.abs(first.data[k] - other.data[k]);
      expect(diff / first.data.length, `${HOURS[0]} against ${HOURS[i + 1]}`).toBeLessThan(1.5);
    }
  });

  /** Catches a motif that never draws, or a plane that keeps flying when the visitor asked for less motion. */
  test('the motif is drawn over the sky and its plane holds still', async ({ page }, info) => {
    await windowAt(page, HOURS[0]);
    const before = (await page.evaluate(() => window.__room!.world.window!.motif))!;
    expect(before).toMatchObject({ drawn: true, moving: false });
    await frames(page, 60);
    expect((await page.evaluate(() => window.__room!.world.window!.motif))!.plane).toBe(before.plane);
    await info.attach('window with the motif', { body: await page.screenshot(), contentType: 'image/png' });
  });
});

/** Catches a plane parked on the arc for everyone: with motion allowed it flies from New Delhi toward San Francisco. */
test('with motion allowed the plane flies along the arc from New Delhi toward San Francisco', async ({ page }) => {
  await windowAt(page, HOURS[0]);
  const motif = () => page.evaluate(() => window.__room!.world.window!.motif!);
  expect(await motif()).toMatchObject({ drawn: true, moving: true });
  const a = (await motif()).plane;
  await frames(page, 60);
  const b = (await motif()).plane;
  expect(b, 'the plane moved').not.toBe(a);
  // Off the arc (-1) between crossings is allowed; on it, the plane only moves toward San Francisco.
  if (a >= 0 && b >= 0) expect(b).toBeGreaterThan(a);
  else expect(a >= 0 || b >= 0).toBe(true);
});
