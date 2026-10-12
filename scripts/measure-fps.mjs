// Frame rate of the room on the "2020 laptop" profile (PLAN 3.9): Playwright Chromium at 1440x900, device scale 2,
// software WebGL (SwiftShader) standing in for a 2020 integrated GPU. Counts requestAnimationFrame frames for 10 s in
// each of idle, desk, monitor and across camera moves; passes when every phase's median is at least 50 fps. The reel
// column is the share of frames in which the projector reel was playing (it plays only while its screen is in view);
// --reel-always plays it in every phase, in view or not, for a worst case; --no-reel blocks it (the screen keeps its
// baked still), as a baseline.
//
//   node scripts/measure-fps.mjs [--no-build] [--url https://…] [--seconds 10] [--reel-always | --no-reel]
import { cpus, loadavg } from 'node:os';
import { chromium } from 'playwright';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const seconds = Number(option('--seconds', '10'));
const MIN_FPS = 50;

const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !flag('--no-build') });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  if (flag('--no-reel')) await page.route('**/room/reel.mp4', (route) => route.abort());
  await page.goto(new URL('/', server.url).href);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  await page.locator('[data-boot-button]').waitFor({ state: 'visible', timeout: 180_000 });
  await page.locator('[data-boot-button]').click();
  const settle = () => page.waitForFunction(() => window.__room && !window.__room.moving, null, { timeout: 30_000 });
  await settle();
  await page.waitForFunction(() => window.__room.reel?.state !== 'loading' && window.__room.reel?.state !== 'waiting', null, { timeout: 60_000 });
  if (flag('--reel-always')) await page.evaluate(() => window.__room.forceReel(true));

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
  for (const phase of ['idle', 'desk', 'monitor', 'move']) {
    if (phase !== 'idle' && phase !== 'move') {
      await page.evaluate((p) => window.__room.goto(p), phase);
      await settle();
    }
    if (phase === 'move') {
      await page.evaluate(() => window.__room.goto('desk'));
      await settle();
    }
    const { times, tier, reel } = await count(seconds * 1000, phase === 'move');
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
  }

  console.log(`renderer: ${gpu}`);
  // SwiftShader runs on the CPU, so other work on the machine lowers these numbers; the load is printed with them.
  console.log(`load average (1 min): ${loadavg()[0].toFixed(1)} on ${cpus().length} cores`);
  console.log(`viewport 1440x900 @2x, ${seconds} s per phase, pass = median >= ${MIN_FPS} fps${flag('--reel-always') ? ', reel forced on' : ''}${flag('--no-reel') ? ', reel blocked' : ''}`);
  console.log('phase    frames  mean   median  p5     tier  reel  pass');
  for (const r of rows) {
    console.log(
      `${r.phase.padEnd(8)} ${String(r.frames).padStart(6)}  ${r.mean.padStart(5)}  ${r.median.padStart(6)}  ${r.p5.padStart(5)}  ${String(r.tier).padStart(4)}  ${r.reel.padStart(4)}  ${r.pass}`,
    );
  }
  console.log(failed ? 'fps: FAIL' : 'fps: pass');
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
