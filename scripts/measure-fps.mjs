// Frame rate of the room on the "2020 laptop" profile (PLAN 3.9): Playwright Chromium at 1440x900, device scale 2,
// software WebGL (SwiftShader) standing in for a 2020 integrated GPU. Counts requestAnimationFrame frames during the
// arrival glide on / (no input), then for 10 s in each phase: every framing the room has (the desk, the monitor and the
// tour's stops among them), a hovered prop, across camera moves, the tour's map open while the camera flies to a stop
// (when the room has a floor plan), and the photo album open with a page turning every 1.2 s; passes when every
// phase's median is at least 50 fps. By default everything moves at once after the arrival
// (PLAN 11.3, 12.3): the fan at its top speed, the espresso machine brewing and the projector playing in view or not;
// --calm leaves the room as a visitor finds it. --phone measures the light tier on an emulated iPhone 13 instead: the
// arrival, the glide into the monitor until SaahilOS takes over, the wide view, the desk and moves. The reel column is the share of frames in which the projector was playing;
// --reel-always plays only the reel in every phase; --no-reel blocks it (the screen keeps its baked still), as a
// baseline. The light tier has no reel.
//
//   node scripts/measure-fps.mjs [--no-build] [--url https://…] [--seconds 10] [--phone] [--calm | --reel-always | --no-reel]
import { cpus, loadavg } from 'node:os';
import { chromium, devices } from 'playwright';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const seconds = Number(option('--seconds', '10'));
const phone = flag('--phone');
const MIN_FPS = 50;

const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !flag('--no-build') });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
  const page = await browser.newPage(phone ? iPhone13 : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  if (flag('--no-reel')) await page.route('**/room/reel.mp4', (route) => route.abort());
  await page.goto(new URL('/', server.url).href);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const settle = (station) =>
    page.waitForFunction((s) => window.__room && !window.__room.moving && (!s || window.__room.phase === s), station, { timeout: 60_000 });
  await page.waitForFunction(() => window.__room?.arrival && window.__room.moving, null, { timeout: 180_000 });

  const everything = !phone && !flag('--calm') && !flag('--reel-always') && !flag('--no-reel');

  /** Frame times for `ms`; 'move' keeps the camera gliding between the desk and the wide view, 'album' turns pages. */
  const count = (ms, mode = 'still') =>
    page.evaluate(
      ([ms, mode]) =>
        new Promise((resolve) => {
          const times = [];
          let reelFrames = 0;
          const start = performance.now();
          let next = 'desk';
          let lastTurn = start;
          let forward = true;
          const frame = (t) => {
            times.push(t);
            const projector = window.__room.world?.projector;
            if (projector ? projector.state === 'playing' : window.__room.reel?.state === 'playing') reelFrames++;
            if (mode === 'arrival' && !window.__room.moving) return resolve({ times, tier: window.__room.tier, reel: reelFrames / times.length });
            if (mode === 'move' && !window.__room.moving) {
              window.__room.goto(next);
              next = next === 'desk' ? 'idle' : 'desk';
            }
            if (mode === 'album' && t - lastTurn > 1200) {
              // Through the album and back, with its own keys.
              const album = window.__room.world.album;
              if (album.spread >= album.spreads - 1) forward = false;
              if (album.spread <= 0) forward = true;
              window.dispatchEvent(new KeyboardEvent('keydown', { key: forward ? 'ArrowRight' : 'ArrowLeft' }));
              lastTurn = t;
            }
            if (t - start < ms) requestAnimationFrame(frame);
            else resolve({ times, tier: window.__room.tier, reel: reelFrames / times.length });
          };
          requestAnimationFrame(frame);
        }),
      [ms, mode],
    );

  const rows = [];
  const record = (phase, { times, tier, reel }) => {
    const fps = times
      .slice(1)
      .map((t, i) => 1000 / (t - times[i]))
      .sort((a, b) => a - b);
    const pick = (q) => fps[Math.min(fps.length - 1, Math.floor(q * fps.length))];
    const row = {
      phase,
      frames: times.length,
      mean: ((times.length - 1) / ((times.at(-1) - times[0]) / 1000)).toFixed(1),
      median: pick(0.5).toFixed(1),
      p5: pick(0.05).toFixed(1),
      tier,
      reel: `${Math.round(reel * 100)}%`,
      pass: pick(0.5) >= MIN_FPS,
    };
    rows.push(row);
    if (!row.pass) failed = true;
  };

  // The arrival glide on /, from the boot framing to the desk, measured while nothing touches the page.
  record('arrival', await count(30_000, 'arrival'));
  await settle('desk');

  if (phone) {
    // The phone holds the desk briefly, then glides into the monitor by itself: measure that glide first.
    await page.waitForFunction(() => window.__room.moving, null, { timeout: 30_000 });
    const zoomMs = await page.evaluate(() => {
      const start = performance.now();
      return new Promise((resolve) => {
        const wait = () => (window.__room.moving ? requestAnimationFrame(wait) : resolve(performance.now() - start));
        requestAnimationFrame(wait);
      });
    });
    console.log(`glide into the monitor: ${Math.round(zoomMs)} ms, then SaahilOS takes over: ${await page.evaluate(() => document.documentElement.classList.contains('room-os'))}`);
    await page.getByRole('button', { name: 'Back to the room' }).tap();
    await settle('idle');
    for (const phase of ['idle', 'desk', 'move']) {
      if (phase === 'desk') {
        await page.evaluate(() => window.__room.goto('desk'));
        await settle('desk');
      }
      record(phase, await count(seconds * 1000, phase === 'move' ? 'move' : 'still'));
    }
  } else {
    // The reel loads once the room is interactive; it plays while its screen is in the wide view.
    await page.evaluate(() => window.__room.goto('idle'));
    await settle('idle');
    await page.waitForFunction(() => !window.__room.reel || (window.__room.reel.state !== 'loading' && window.__room.reel.state !== 'waiting'), null, { timeout: 60_000 });
    if (flag('--reel-always')) await page.evaluate(() => window.__room.forceReel(true));
    if (everything) await page.evaluate(() => window.__room.forceEverything(true));
    const stations = await page.evaluate(() => window.__room.stations);
    for (const station of ['idle', ...stations.filter((s) => s !== 'idle')]) {
      await page.evaluate((s) => window.__room.goto(s), station);
      await settle(station);
      record(station, await count(seconds * 1000));
    }
    // A prop under the pointer, entered and left every 0.7 s: lifts and glints the whole time.
    await page.evaluate(() => window.__room.goto('idle'));
    await settle('idle');
    const mango = await page.evaluate(() => window.__room.point('hit_mango'));
    const hovered = count(seconds * 1000);
    const end = Date.now() + seconds * 1000;
    for (let on = true; Date.now() < end; on = !on) {
      await page.mouse.move(on ? mango.x : mango.x - 260, on ? mango.y : mango.y + 200);
      await page.waitForTimeout(700);
    }
    record('hover', await hovered);
    await page.mouse.move(0, 0);
    record('move', await count(seconds * 1000, 'move'));
    // The map open (its you-are-here mark redrawn every frame) while the camera flies to its second stop and rests.
    const tour = page.locator('[data-tour-open]');
    if (await tour.isVisible()) {
      await tour.click();
      const flying = count(seconds * 1000);
      await page.locator('[data-tour-stops] button').nth(1).click();
      record('map', await flying);
      await page.keyboard.press('Escape');
    }
    // The album open in front of the desk framing, turning a page every 1.2 s.
    await page.evaluate(() => window.__room.goto('idle'));
    await settle('idle');
    const album = await page.evaluate(() => window.__room.point('hit_album'));
    await page.mouse.click(album.x, album.y);
    await page.waitForFunction(() => window.__room.world.album?.state === 'open', null, { timeout: 30_000 });
    await settle();
    record('album', await count(seconds * 1000, 'album'));
  }

  console.log(`renderer: ${gpu}`);
  // SwiftShader runs on the CPU, so other work on the machine lowers these numbers; the load is printed with them.
  console.log(`load average (1 min): ${loadavg()[0].toFixed(1)} on ${cpus().length} cores`);
  console.log(
    phone
      ? `iPhone 13 (390x664 @3x), light tier, ${seconds} s per phase, pass = median >= ${MIN_FPS} fps`
      : `viewport 1440x900 @2x, ${seconds} s per phase, pass = median >= ${MIN_FPS} fps${everything ? ', everything moving after the arrival (fan top speed, steam, projector forced on)' : ''}${flag('--reel-always') ? ', reel forced on' : ''}${flag('--no-reel') ? ', reel blocked' : ''}`,
  );
  console.log('phase      frames  mean   median  p5     tier  reel  pass');
  for (const r of rows) {
    console.log(
      `${r.phase.padEnd(10)} ${String(r.frames).padStart(6)}  ${r.mean.padStart(5)}  ${r.median.padStart(6)}  ${r.p5.padStart(5)}  ${String(r.tier).padStart(4)}  ${r.reel.padStart(4)}  ${r.pass}`,
    );
  }
  console.log(failed ? 'fps: FAIL' : 'fps: pass');
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
