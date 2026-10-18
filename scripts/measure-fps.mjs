// Frame rate of the room on the "2020 laptop" profile (PLAN 3.9): Playwright Chromium at 1440x900, device scale 2,
// software WebGL (SwiftShader) standing in for a 2020 integrated GPU. Counts requestAnimationFrame frames during the
// arrival glide on / (no input), then for 10 s in each phase: every framing the room has (the desk, the monitor and the
// tour's stops among them), a hovered prop, across camera moves, and the tour's map open while the camera flies to a
// stop (when the room has a floor plan); passes when every phase's median is at least 50 fps. After the arrival it
// waits for the full-quality atlases to stream in (window.__roomStats; --low measures the first-frame set instead), so
// the phases run at full quality. By default everything moves at once after the arrival (PLAN 11.3, 12.3,
// PLAN-ROUND-7 §4): the lava lamp changing colour, an espresso shot pouring again and again with its steam; --calm
// leaves the room as a visitor finds it. --phone measures the light tier on an emulated iPhone 13 instead: the arrival,
// the glide into the monitor until SaahilOS takes over, the wide view, the desk and moves. --record <id> puts a record
// from the crate on after the arrival (a key press first, the gesture sound needs) and keeps it playing through every
// phase; the rec column says whether it was still playing at the end. The tier column is where the quality ladder
// stood at the end of the phase; the summary gives the pixel ratio and the GPU memory the room held.
//
//   node scripts/measure-fps.mjs [--no-build] [--url https://…] [--seconds 10] [--phone] [--calm] [--low] [--record <id>]
import { cpus, loadavg } from 'node:os';
import { chromium, devices } from 'playwright';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const seconds = Number(option('--seconds', '10'));
const phone = flag('--phone');
const recordId = option('--record', null);
const MIN_FPS = 50;

const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !flag('--no-build') });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
  const page = await browser.newPage(phone ? iPhone13 : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(new URL('/', server.url).href);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const settle = (station) =>
    page.waitForFunction((s) => window.__room && !window.__room.moving && (!s || window.__room.phase === s), station, { timeout: 60_000 });
  await page.waitForFunction(() => window.__room?.startedAt != null && window.__room.moving, null, { timeout: 180_000 });

  const everything = !phone && !flag('--calm');

  /** Frame times for `ms`; 'move' keeps the camera gliding between the desk and the wide view. */
  const countFrames = (ms, mode = 'still') =>
    page.evaluate(
      ([ms, mode]) =>
        new Promise((resolve) => {
          const times = [];
          const start = performance.now();
          let next = 'desk';
          const frame = (t) => {
            times.push(t);
            if (mode === 'arrival' && !window.__room.moving) return resolve({ times, tier: window.__room.tier });
            if (mode === 'move' && !window.__room.moving) {
              window.__room.goto(next);
              next = next === 'desk' ? 'idle' : 'desk';
            }
            if (t - start < ms) requestAnimationFrame(frame);
            else resolve({ times, tier: window.__room.tier });
          };
          requestAnimationFrame(frame);
        }),
      [ms, mode],
    );

  /** A record on the turntable, chosen through the crate, which is closed again so it does not cover the room. */
  const putRecordOn = async () => {
    await page.keyboard.press('KeyA');
    await page.evaluate(() => window.__room.openRecords());
    await page.locator(`[data-record="${recordId}"]`).click();
    await page.waitForFunction(() => window.__room.audio.graph().deck?.playing === true, null, { timeout: 60_000 });
    await page.keyboard.press('Escape');
  };
  const recordPlaying = () => page.evaluate(() => window.__room.audio.graph().deck?.playing === true);
  /** Frames for a phase; with --record the record is put back on if it has ended, and noted if it played to the end. */
  const count = async (ms, mode = 'still') => {
    if (!recordId || mode === 'arrival') return countFrames(ms, mode);
    if (!(await recordPlaying())) await putRecordOn();
    const result = await countFrames(ms, mode);
    return { ...result, onRecord: await recordPlaying() };
  };

  const rows = [];
  const record = (phase, { times, tier, onRecord }) => {
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
      rec: onRecord === undefined ? '-' : onRecord ? 'yes' : 'no',
      pass: pick(0.5) >= MIN_FPS,
    };
    rows.push(row);
    if (!row.pass) failed = true;
  };

  // The arrival on /, its flight from the wide view into the monitor, measured while nothing touches the page.
  record('arrival', await count(30_000, 'arrival'));
  // Wherever the arrival comes to rest: round 9's flight lands at the monitor (round 8's glide rested at the desk).
  await settle(null);
  // The full-quality atlases stream in after the arrival; the phases measure the room with them.
  if (!flag('--low')) await page.waitForFunction(() => !window.__roomStats || window.__roomStats.done || window.__roomStats.skipped, null, { timeout: 300_000 });
  const streaming = await page.evaluate(() => window.__roomStats && { skipped: window.__roomStats.skipped, atlases: window.__roomStats.atlases.map((a) => `${a.name} ${a.state} ${a.px}px`) });

  if (phone) {
    // A phone that rested short of the monitor glides into it by itself: measure that glide first. (Round 9's arrival
    // flies straight to the monitor, so the arrival phase above already holds that flight.)
    if ((await page.evaluate(() => window.__room.phase)) !== 'monitor') {
      await page.waitForFunction(() => window.__room.moving, null, { timeout: 30_000 });
      const zoomMs = await page.evaluate(() => {
        const start = performance.now();
        return new Promise((resolve) => {
          const wait = () => (window.__room.moving ? requestAnimationFrame(wait) : resolve(performance.now() - start));
          requestAnimationFrame(wait);
        });
      });
      console.log(`glide into the monitor: ${Math.round(zoomMs)} ms`);
    }
    console.log(`SaahilOS takes over: ${await page.evaluate(() => document.documentElement.classList.contains('room-os'))}`);
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
    await page.evaluate(() => window.__room.goto('idle'));
    await settle('idle');
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
  }
  const held = await page.evaluate(() => ({ pixelRatio: window.__roomDebug?.pixelRatio ?? null, gpu: window.__roomStats?.gpu ?? null }));

  console.log(`renderer: ${gpu}`);
  // SwiftShader runs on the CPU, so other work on the machine lowers these numbers; the load is printed with them.
  console.log(`load average (1 min): ${loadavg()[0].toFixed(1)} on ${cpus().length} cores`);
  console.log(
    phone
      ? `iPhone 13 (390x664 @3x), light tier, ${seconds} s per phase, pass = median >= ${MIN_FPS} fps`
      : `viewport 1440x900 @2x, ${seconds} s per phase, pass = median >= ${MIN_FPS} fps${everything ? ', everything moving after the arrival (lava lamp changing, espresso pouring with its steam)' : ''}`,
  );
  if (streaming) console.log(`atlases: ${streaming.skipped ? `first-frame set only (${streaming.skipped})` : streaming.atlases.join('; ')}`);
  if (held.pixelRatio !== null) console.log(`pixel ratio at the end: ${held.pixelRatio}`);
  if (held.gpu) console.log(`GPU memory (estimate): textures ${held.gpu.textureBytes} B, render targets ${held.gpu.targetBytes} B, total ${held.gpu.totalBytes} B`);
  if (recordId) console.log(`record: ${recordId} playing from the end of the arrival (rec = still playing as the phase ended)`);
  console.log('phase      frames  mean   median  p5     tier  rec  pass');
  for (const r of rows) {
    console.log(
      `${r.phase.padEnd(10)} ${String(r.frames).padStart(6)}  ${r.mean.padStart(5)}  ${r.median.padStart(6)}  ${r.p5.padStart(5)}  ${String(r.tier).padStart(4)}  ${r.rec.padStart(3)}  ${r.pass}`,
    );
  }
  console.log(failed ? 'fps: FAIL' : 'fps: pass');
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
