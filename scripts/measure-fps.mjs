// Frame rate of the room on the "2020 laptop" profile (PLAN 3.9): Playwright Chromium at 1440x900, device scale 2,
// software WebGL (SwiftShader) standing in for a 2020 integrated GPU. Counts requestAnimationFrame frames for 10 s in
// each phase: the first drift (no input), every framing the room has, the monitor, a hovered prop, and across camera
// moves; passes when every phase's median is at least 50 fps. --phone measures the light tier on an emulated
// iPhone 13 instead: the wide view, the desk, moves, and the glide into the monitor until SaahilOS takes over.
// The reel column is the share of frames in which the projector reel was playing (it plays only while its screen is
// in view); --reel-always plays it in every phase, in view or not, for a worst case; --no-reel blocks it (the screen
// keeps its baked still), as a baseline. The light tier has no reel.
//
//   node scripts/measure-fps.mjs [--no-build] [--url https://…] [--seconds 10] [--phone] [--reel-always | --no-reel]
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
  await page.waitForFunction(() => window.__room?.phase === 'idle' && !window.__room.moving, null, { timeout: 180_000 });
  if (!phone) {
    await page.waitForFunction(() => window.__room.reel?.state !== 'loading' && window.__room.reel?.state !== 'waiting', null, { timeout: 60_000 });
    if (flag('--reel-always')) await page.evaluate(() => window.__room.forceReel(true));
  }

  /** Frame times for `ms`; `moving` keeps the camera gliding between the desk and the wide view. */
  const count = (ms, moving) =>
    page.evaluate(
      ([ms, moving]) =>
        new Promise((resolve) => {
          const times = [];
          let reelFrames = 0;
          const start = performance.now();
          let next = 'desk';
          const frame = (t) => {
            times.push(t);
            if (window.__room.reel?.state === 'playing') reelFrames++;
            if (moving && !window.__room.moving) {
              window.__room.goto(next);
              next = next === 'desk' ? 'idle' : 'desk';
            }
            if (t - start < ms) requestAnimationFrame(frame);
            else resolve({ times, tier: window.__room.tier, reel: reelFrames / times.length });
          };
          requestAnimationFrame(frame);
        }),
      [ms, moving],
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

  if (phone) {
    // The phone holds the wide view briefly, then glides into the monitor by itself: measure that glide first.
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
      record(phase, await count(seconds * 1000, phase === 'move'));
    }
  } else {
    // The drift starts by itself a moment after the intro; it is measured while nothing touches the page.
    await page.waitForFunction(() => window.__room.drifting && window.__room.moving, null, { timeout: 30_000 });
    record('drift', await count(seconds * 1000, false));
    const stations = await page.evaluate(() => window.__room.stations);
    for (const station of ['idle', ...stations.filter((s) => s !== 'idle')]) {
      await page.evaluate((s) => window.__room.goto(s), station);
      await settle(station);
      record(station, await count(seconds * 1000, false));
    }
    // A prop under the pointer, entered and left every 0.7 s: lifts and glints the whole time.
    await page.evaluate(() => window.__room.goto('idle'));
    await settle('idle');
    const mango = await page.evaluate(() => window.__room.point('hit_mango'));
    const hovered = count(seconds * 1000, false);
    const end = Date.now() + seconds * 1000;
    for (let on = true; Date.now() < end; on = !on) {
      await page.mouse.move(on ? mango.x : mango.x - 260, on ? mango.y : mango.y + 200);
      await page.waitForTimeout(700);
    }
    record('hover', await hovered);
    await page.mouse.move(0, 0);
    record('move', await count(seconds * 1000, true));
  }

  console.log(`renderer: ${gpu}`);
  // SwiftShader runs on the CPU, so other work on the machine lowers these numbers; the load is printed with them.
  console.log(`load average (1 min): ${loadavg()[0].toFixed(1)} on ${cpus().length} cores`);
  console.log(
    phone
      ? `iPhone 13 (390x664 @3x), light tier, ${seconds} s per phase, pass = median >= ${MIN_FPS} fps`
      : `viewport 1440x900 @2x, ${seconds} s per phase, pass = median >= ${MIN_FPS} fps${flag('--reel-always') ? ', reel forced on' : ''}${flag('--no-reel') ? ', reel blocked' : ''}`,
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
