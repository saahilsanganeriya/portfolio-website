import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type {} from '../src/scene/Application/Application';

// The window over San Francisco (left) and New Delhi (right): one fixed moment at any hour (San Francisco's dusk,
// Delhi's morning), one sky whose colour runs from one city's to the other's with no line between them, only the two
// pictures fetched, the motif (a red and white airliner on a dotted arc from New Delhi to San Francisco, a passport
// stamp under each end) over the sky, and sky through the pane from every side the orbit reaches. Each test loads the
// room with a mocked clock and reads the pixels of the window framing; the screenshots are attached to the report.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial', timeout: 300_000 });

// Hours far apart on both cities' clocks: noon in San Francisco (1:30 am in Delhi), the reverse, and dusk in one city
// with dawn in the other. Time no longer matters, so all three must look the same.
const HOURS = ['2026-06-21T20:00:00Z', '2026-06-22T08:00:00Z', '2026-11-10T01:07:00Z'] as const;

/** Mean colour (0–255 per channel) of a strip of the shot, centred at (x, y). */
function colourAt(pixels: Buffer, width: number, x: number, y: number, w = 50, h = 24) {
  const sum = [0, 0, 0];
  for (let row = y - h / 2; row < y + h / 2; row++)
    for (let col = x - w / 2; col < x + w / 2; col++) {
      const i = (row * width + col) * 3;
      for (let c = 0; c < 3; c++) sum[c] += pixels[i + c];
    }
  return sum.map((v) => v / (w * h));
}

const brightness = (rgb: number[]) => (rgb[0] + rgb[1] + rgb[2]) / 3;
/** The largest change of any channel between two colours: the cities' skies differ more in hue than in brightness. */
const change = (a: number[], b: number[]) => Math.max(...a.map((v, c) => Math.abs(v - b[c])));

/** Loads the room at `at`, logging every window picture it fetches, and settles at the window framing. */
async function windowAt(page: Page, at: string) {
  await page.addInitScript(() => {
    // One quality tier at every hour, whatever the machine's load: the ladder would draw each load at its own resolution.
    (window as unknown as { __roomTier: number }).__roomTier = 0;
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
  // The HUD's clock shows the visitor's hour by design; the window behind it must not.
  await page.addStyleTag({ content: '[data-room-hud] { visibility: hidden !important; }' });
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

/** A feature's screen point from the room's probe (the plane's nose and tail, the pane's corners). */
const pointOf = (page: Page, name: string) => page.evaluate((n) => window.__room!.point(n), name);

/** How long the plane looks on screen, in CSS px. */
async function planeLength(page: Page) {
  const [nose, tail] = [await pointOf(page, 'window_plane_nose'), await pointOf(page, 'window_plane_tail')];
  expect(nose && tail, 'the plane is on screen').toBeTruthy();
  return Math.hypot(nose!.x - tail!.x, nose!.y - tail!.y);
}

/** The share of pixels inside the pane (shrunk 6 % toward its middle) that are the void's colour, #14110F, within 6. */
async function voidInPane(page: Page, shot: Buffer) {
  const corners = await Promise.all([0, 1, 2, 3].map((i) => pointOf(page, `window_pane_${i}`)));
  expect(corners.every(Boolean), 'the pane is on screen').toBe(true);
  const { data, info } = await pixelsOf(shot);
  const cx = corners.reduce((sum, p) => sum + p!.x, 0) / 4;
  const cy = corners.reduce((sum, p) => sum + p!.y, 0) / 4;
  const poly = corners.map((p) => [cx + (p!.x - cx) * 0.94, cy + (p!.y - cy) * 0.94]);
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if (poly[i][1] > y !== poly[j][1] > y && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) hit = !hit;
    return hit;
  };
  let [n, dark] = [0, 0];
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (!inside(x, y)) continue;
      const i = (y * info.width + x) * 3;
      n++;
      if (Math.abs(data[i] - 20) <= 6 && Math.abs(data[i + 1] - 17) <= 6 && Math.abs(data[i + 2] - 15) <= 6) dark++;
    }
  return { pixels: n, share: dark / Math.max(n, 1) };
}

const wrap = (a: number) => ((a % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

/** Turns the set by dragging until the orbit's azimuth is within about a degree of `deg` and it has come to rest. */
async function orbitTo(page: Page, deg: number) {
  const { width, height } = page.viewportSize()!;
  for (let k = 0; k < 10; k++) {
    const orbit = await page.evaluate(() => window.__room!.orbit);
    const delta = orbit ? wrap((deg * Math.PI) / 180 - orbit.azimuth) : 0.05;
    if (orbit && Math.abs(delta) < 0.02 && !orbit.turning) return;
    // About 0.0038 rad a pixel of drag (the orbit's default); the loop corrects whatever it really is.
    const dx = Math.max(-width * 0.4, Math.min(width * 0.4, -delta / ((Math.PI * 1.1) / 900)));
    await page.mouse.move(width / 2, height * 0.58);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(width / 2 + (dx * i) / 12, height * 0.58);
    await page.mouse.up();
    await page.mouse.move(width - 4, height - 4);
    await page.waitForFunction(() => !window.__room!.orbit?.turning, null, { timeout: 30_000 });
  }
  throw new Error(`the orbit did not settle at ${deg}°`);
}

test.describe('under reduced motion (the plane holds still)', () => {
  test.use({ reducedMotion: 'reduce' });

  /**
   * Catches a seam between the cities' skies (the old halves met in a hard line at the central bar), a window that
   * still follows a clock (a night city, or a different picture at another hour) and night pictures being fetched.
   */
  test('the window is the same view at any hour, one sky with no line between the cities', async ({ browser }, info) => {
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
        const near = (dx: number, w = 30) => colourAt(data, meta.width, cx + dx, y, w);
        // A seam is a step between the cities bigger than the gradient on either side of it, in any channel.
        const [l1, l2, r1, r2] = [near(-105), near(-45), near(45), near(105)];
        const slope = Math.max(change(l2, l1), change(r2, r1)) / 60;
        const step = change(r1, l2) / 90;
        const [farLeft, farRight] = [brightness(near(-380, 50)), brightness(near(380, 50))];
        const show = (c: number[]) => c.map((v) => v.toFixed(0)).join('/');
        const row = `${at} row ${y}: far left ${farLeft.toFixed(0)}, by the middle ${show(l1)} ${show(l2)} | ${show(r1)} ${show(r2)}, far right ${farRight.toFixed(0)}`;
        expect(step, row).toBeLessThan(2 * slope + 0.2);
        // Lit on both sides: dusk and morning, never night.
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

  /** Catches a motif that never draws, or a plane that keeps flying, or leaves a trail, when the visitor asked for less motion. */
  test('the motif is drawn over the sky and its plane holds still', async ({ page }, info) => {
    await windowAt(page, HOURS[0]);
    const before = (await page.evaluate(() => window.__room!.world.window!.motif))!;
    expect(before).toMatchObject({ drawn: true, moving: false, trail: 0 });
    await frames(page, 60);
    expect((await page.evaluate(() => window.__room!.world.window!.motif))!.plane).toBe(before.plane);
    await info.attach('window with the motif', { body: await page.screenshot(), contentType: 'image/png' });
  });

  /**
   * Catches the plane left at its old size, or shrunk again: round 8's silhouette (4.1 cm on the motif) measured about
   * 25 px at the window framing and 7 px from the wide view at this viewport, too small to read as a plane.
   */
  test('the plane reads at the window framing and from the wide view', async ({ page }) => {
    await windowAt(page, HOURS[0]);
    expect(await planeLength(page), 'at the window framing').toBeGreaterThan(40);
    await page.evaluate(() => window.__room!.goto('idle'));
    await page.waitForFunction(() => window.__room!.phase === 'idle' && !window.__room!.moving, null, { timeout: 60_000 });
    expect(await planeLength(page), 'from the wide view').toBeGreaterThan(11);
  });

  /**
   * Catches the void through the pane at the orbit's steep angles: the build culled the sky dome's faces no framing saw,
   * so from about 55° round to the right San Francisco's side of the pane was black. From the left it showed sky; both
   * sides are held. Under reduced motion, so the camera cuts to the wide view and neither it nor the orbit sways.
   */
  test('at steep orbit angles the pane shows sky on both sides, never the void', async ({ page }, info) => {
    await windowAt(page, HOURS[0]);
    await page.evaluate(() => window.__room!.goto('idle'));
    await page.waitForFunction(() => window.__room!.phase === 'idle' && !window.__room!.moving, null, { timeout: 60_000 });
    for (const deg of [75, -75]) {
      await orbitTo(page, deg);
      await frames(page, 4);
      const back = (await page.evaluate(() => window.__room!.walls.find((w) => w.name === 'back')))!;
      expect(back.outside.every((o) => o.shown), `the view is shown at ${deg}°`).toBe(true);
      const shot = await page.screenshot();
      await info.attach(`orbit ${deg}°`, { body: shot, contentType: 'image/png' });
      const { pixels, share } = await voidInPane(page, shot);
      expect(pixels).toBeGreaterThan(5000);
      expect(share, `void through the pane at ${deg}°`).toBeLessThan(0.01);
    }
  });
});

/**
 * Catches the plane flying out of the top of the window framing (T98: at 1512x982 it rode the frame's top edge, at
 * 2560x1440 its fin was cut off): its nose and tail stay inside the framing, with room for the fin above them, at
 * every point of the route, on the MacBook's 1.54:1 stage, a 16:9 one and the tests' 16:10, with the pointer at the
 * bottom of the stage, where the view leans furthest down and the sky's top comes nearest the edge.
 */
test('the plane stays inside the window framing all along its route, at every stage shape', async ({ page }) => {
  await windowAt(page, HOURS[0]);
  for (const [width, height] of [[1440, 900], [1512, 982], [2560, 1440]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.__room!.goto('window'));
    await page.waitForFunction(() => window.__room!.phase === 'window' && !window.__room!.moving, null, { timeout: 60_000 });
    await page.mouse.move(width / 2, height - 2, { steps: 4 });
    // The lean follows the pointer on a spring of about half a second.
    await expect.poll(() => page.evaluate(() => window.__room!.look.pitch), { timeout: 30_000 }).toBeLessThan(-0.033);
    const route = await page.evaluate(() =>
      Array.from({ length: 87 }, (_, i) => {
        const u = 0.07 + i * 0.01;
        return { u, nose: window.__room!.point(`window_plane_nose@${u}`), tail: window.__room!.point(`window_plane_tail@${u}`) };
      }),
    );
    for (const { u, nose, tail } of route) {
      expect(nose && tail, `the plane at ${u.toFixed(2)} (${width}x${height})`).toBeTruthy();
      // The fin stands about a third of the plane's length above its nose-to-tail line.
      const fin = 0.35 * Math.hypot(nose!.x - tail!.x, nose!.y - tail!.y);
      for (const [part, p] of [['nose', nose!], ['tail', tail!]] as const) {
        const where = `${part} at ${u.toFixed(2)} (${width}x${height}): ${p.x.toFixed(0)}, ${p.y.toFixed(0)}`;
        expect(p.y, where).toBeGreaterThan(fin);
        expect(p.y, where).toBeLessThan(height);
        expect(p.x, where).toBeGreaterThan(0);
        expect(p.x, where).toBeLessThan(width);
      }
    }
  }
});

/**
 * Catches the black pane on the way back to the front (T98: Home from behind the set showed the back wall whole and the
 * window void for about a second): in no frame of the swing round does the wall stand over 0.9 with its view hidden.
 */
test('coming home from behind the set, the window shows its view as soon as the wall is back', async ({ page }) => {
  // A smaller stage draws faster in software; what is tested is the walls' state each frame, not pixels.
  await page.setViewportSize({ width: 960, height: 600 });
  await windowAt(page, HOURS[0]);
  await page.evaluate(() => window.__room!.goto('idle'));
  await page.waitForFunction(() => window.__room!.phase === 'idle' && !window.__room!.moving, null, { timeout: 60_000 });
  // Round behind the back wall by the arrow keys (15° a press; four at a time stay under the coast's top speed).
  for (let round = 0; round < 3; round++) {
    for (let press = 0; press < 4; press++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__room!.orbit !== null && !window.__room!.moving, null, { timeout: 60_000 });
  }
  await page.evaluate(() => {
    const seen: { opacity: number; shown: boolean }[] = [];
    (window as unknown as { seen: typeof seen }).seen = seen;
    const sample = () => {
      const back = window.__room!.walls.find((w) => w.name === 'back')!;
      seen.push({ opacity: back.opacity, shown: back.outside.every((o) => o.shown) });
      if (window.__room!.phase !== 'idle' || window.__room!.moving) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press('h');
  await page.waitForFunction(() => window.__room!.phase === 'idle' && !window.__room!.moving, null, { timeout: 120_000 });
  const seen = await page.evaluate(() => (window as unknown as { seen: { opacity: number; shown: boolean }[] }).seen);
  expect(seen.some((s) => s.opacity < 0.5), 'the swing started behind the wall').toBe(true);
  const dark = seen.filter((s) => s.opacity > 0.9 && !s.shown);
  expect(dark.map((s) => s.opacity.toFixed(3)), 'frames with the wall back and the pane void').toEqual([]);
});

/**
 * Catches a plane parked on the arc for everyone, one that races across (a crossing under 40 s), runs backwards, flies
 * level through the turn, or leaves no trail: with motion allowed it flies on toward San Francisco, slowly, banked at
 * mid-route, with its trail behind it.
 */
test('with motion allowed the plane flies the arc slowly toward San Francisco, banked, with a trail', async ({ page }) => {
  await windowAt(page, HOURS[0]);
  const motif = () => page.evaluate(() => ({ ...window.__room!.world.window!.motif!, at: performance.now() }));
  const a = await motif();
  expect(a).toMatchObject({ drawn: true, moving: true });
  await frames(page, 60);
  const b = await motif();
  expect(b.plane, 'the plane moved').not.toBe(a.plane);
  // Off the arc (-1) between crossings is allowed; on it, the plane only moves toward San Francisco, and slowly.
  if (a.plane >= 0 && b.plane >= 0) {
    expect(b.plane).toBeGreaterThan(a.plane);
    expect((b.plane - a.plane) / ((b.at - a.at) / 1000), 'route per second').toBeLessThan(1 / 40);
  } else expect(a.plane >= 0 || b.plane >= 0).toBe(true);
  for (const m of [a, b].filter((m) => m.plane > 0.3 && m.plane < 0.7)) {
    expect(m.bankDeg, 'banked at mid-route').toBeGreaterThan(5);
    expect(m.trail, 'a trail behind it').toBeGreaterThan(0.2);
  }
});
