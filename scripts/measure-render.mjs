// Frame time and GPU memory of the room on the M-series profile (PLAN-ROUND-9 §2.7): Playwright Chromium and WebKit at
// 1512x982 and 2560x1440 CSS px, both at DPR 2. Per run, four phases as requestAnimationFrame gaps (median, p95, p99):
// the arrival (start to landing), the wide view's idle drift, the desk view, and a drag orbit from the wide view. GPU
// memory comes from the page's own WebGL calls (scripts/lib/gpu-tracker.mjs: textures by format with their mips,
// render targets including MSAA renderbuffers, geometry buffers, the canvas), beside the room's own estimate
// (window.__roomStats.gpu) and three.js's counts (window.__room.gpu). Works on any build of the site, so a before and
// an after are measured by the same script.
//
// The devbox has no GPU: both browsers render on the CPU (Chromium on SwiftShader, WebKit on its software GL), so frame
// times compare two builds on the same machine at the same load and are not an Apple GPU's numbers. The 1-minute load
// is printed at the start and end of every run; a frame-time run counts only if it starts under 16.
//
//   node scripts/measure-render.mjs [--url http://…] [--no-build] [--browsers chromium,webkit]
//     [--viewports 1512x982@2,2560x1440@2] [--seconds 8] [--tier free|0..6] [--out dir] [--label name]
//     [--mock dir]   (serves /room/ files from a folder first, as capture-crawl's --mock)
//     [--platform mac|native] [--switches '{"smaa":true}']   (window.__roomDebug switches, set once the room has landed)
//
// --platform mac (the default) reports navigator.platform as a Mac's: three's KTX2Loader turns ASTC and ETC2 off on
// Linux, so on this box UASTC would transcode to BC7 and ETC1S to BC7 too, where a Mac gets ASTC 4x4 and ETC2.
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { gpuTrackerScript } from './lib/gpu-tracker.mjs';
import { parseViewports, routeMock } from './lib/room-capture.mjs';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const seconds = Number(option('--seconds', '8'));
const tierOption = option('--tier', 'free');
const tier = tierOption === 'free' ? null : Number(tierOption);
const viewports = parseViewports(option('--viewports', '1512x982@2,2560x1440@2'));
const browsers = option('--browsers', 'chromium,webkit').split(',');
const out = option('--out', null);
const label = option('--label', 'build');
const mock = option('--mock', null);
const platform = option('--platform', 'mac');
const switches = option('--switches', null);
const LAUNCH = {
  chromium: () => chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }),
  webkit: () => webkit.launch(),
};
const TIMEOUT = { landing: 600_000, streamed: 900_000, settle: 300_000 };

/** Records every animation frame's timestamp from the first script on (a bounded ring), and pins the tier if asked. */
const frameRecorder = (pinned) => `
  ${pinned === null ? '' : `window.__roomTier = ${pinned};`}
  ${platform === 'mac' ? "Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel', configurable: true });" : ''}
  if (window === window.top) {
    const ring = { t: new Float64Array(1 << 16), n: 0 };
    window.__frameTimes = ring;
    const frame = (t) => { ring.t[ring.n % ring.t.length] = t; ring.n++; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }`;

/** Frame gaps (ms) between performance.now() times `from` and `to`. */
const gapsBetween = (page, from, to) =>
  page.evaluate(([from, to]) => {
    const { t, n } = window.__frameTimes;
    const times = [];
    for (let i = Math.max(0, n - t.length); i < n; i++) {
      const v = t[i % t.length];
      if (v >= from && v <= to) times.push(v);
    }
    return times.slice(1).map((v, i) => v - times[i]);
  }, [from, to]);

const now = (page) => page.evaluate(() => performance.now());

/** median, p95, p99 and the rest of one phase's frame gaps. */
function frameStats(gaps) {
  const sorted = [...gaps].sort((a, b) => a - b);
  const pick = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : null);
  const total = gaps.reduce((s, g) => s + g, 0);
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return { frames: gaps.length, median: round(pick(0.5)), p95: round(pick(0.95)), p99: round(pick(0.99)), longest: round(sorted.at(-1) ?? null), fps: gaps.length ? round((1000 * gaps.length) / total) : null };
}

const settle = (page, station) =>
  page.waitForFunction((s) => window.__room && !window.__room.moving && window.__room.phase === s, station, { timeout: TIMEOUT.settle });

async function phase(page, run, name, act) {
  const from = await now(page);
  await act();
  const to = await now(page);
  run.phases[name] = frameStats(await gapsBetween(page, from, to));
}

async function measure(browserName, browser, viewport, url) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr });
  const page = await context.newPage();
  await page.addInitScript({ content: gpuTrackerScript() });
  await page.addInitScript({ content: frameRecorder(tier) });
  if (mock) await routeMock(page, mock);
  const run = { browser: browserName, browserVersion: browser.version(), viewport: `${viewport.width}x${viewport.height}@${viewport.dpr}`, device: viewport.label, tier: tierOption, platform, switches, load: { start: Number(loadavg()[0].toFixed(2)) }, phases: {}, memory: {} };
  const started = Date.now();
  try {
    await page.goto(new URL('/', url).href, { waitUntil: 'commit' });
    run.renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER), maxSamples: gl?.getParameter(gl.MAX_SAMPLES) };
    });
    await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: TIMEOUT.landing, polling: 250 });
    const { startedAt, landedAt, calibration } = await page.evaluate(() => ({ startedAt: window.__room.startedAt, landedAt: window.__room.landedAt, calibration: window.__room.calibration }));
    run.phases.arrival = { ...frameStats(await gapsBetween(page, startedAt, landedAt)), ms: Math.round(landedAt - startedAt) };
    run.calibration = calibration;
    if (switches) await page.evaluate((s) => window.__roomDebug.set(JSON.parse(s)), switches);
    run.memory.landed = await page.evaluate(() => window.__gpuTracker.snapshot());

    // The full atlases (streamed after the landing on round-8 builds; before the room appears on later ones).
    await page.waitForFunction(() => !window.__roomStats || window.__roomStats.done || window.__roomStats.skipped, null, { timeout: TIMEOUT.streamed, polling: 500 });
    run.atlases = await page.evaluate(() => window.__roomStats?.atlases.map((a) => ({ name: a.name, state: a.state, px: a.px, bytes: a.bytes, ms: a.ms })) ?? null);

    await page.evaluate(() => window.__room.goto('idle'));
    await settle(page, 'idle');
    await phase(page, run, 'wide', () => page.waitForTimeout(seconds * 1000));

    await page.evaluate(() => window.__room.goto('desk'));
    await settle(page, 'desk');
    await phase(page, run, 'desk', () => page.waitForTimeout(seconds * 1000));

    // A drag orbit from the wide view: the pointer swings left and right through the middle of the screen.
    await page.evaluate(() => window.__room.goto('idle'));
    await settle(page, 'idle');
    const cx = viewport.width / 2;
    const cy = viewport.height * 0.55;
    await page.mouse.move(cx, cy);
    await phase(page, run, 'orbit', async () => {
      await page.mouse.down();
      const end = Date.now() + seconds * 1000;
      for (let step = 0; Date.now() < end; step++) {
        await page.mouse.move(cx + Math.sin(step / 12) * viewport.width * 0.3, cy + Math.sin(step / 31) * viewport.height * 0.05);
        await page.waitForTimeout(33);
      }
      await page.mouse.up();
    });

    run.memory.end = await page.evaluate(() => window.__gpuTracker.snapshot());
    run.room = await page.evaluate(() => ({
      tier: window.__room.tier,
      pixelRatio: window.__roomDebug?.pixelRatio ?? null,
      info: window.__room.gpu,
      estimate: window.__roomStats?.gpu ? { textureBytes: window.__roomStats.gpu.textureBytes, targetBytes: window.__roomStats.gpu.targetBytes, totalBytes: window.__roomStats.gpu.totalBytes, textures: window.__roomStats.gpu.textures } : null,
    }));
  } catch (error) {
    run.error = String(error?.message ?? error).split('\n')[0];
  } finally {
    run.load.end = Number(loadavg()[0].toFixed(2));
    run.seconds = Math.round((Date.now() - started) / 1000);
    await context.close();
  }
  return run;
}

const MB = (bytes) => (bytes / 1e6).toFixed(1);

function print(run) {
  console.log(`\n${run.browser} ${run.browserVersion}  ${run.viewport} (${run.device} device px)  tier ${run.tier}${run.switches ? ` switches ${run.switches}` : ''}  load ${run.load.start} -> ${run.load.end}  ${run.seconds} s`);
  if (run.renderer) console.log(`  renderer: ${run.renderer.renderer}, MAX_SAMPLES ${run.renderer.maxSamples}`);
  if (run.error) console.log(`  ERROR: ${run.error}`);
  console.log('  phase    frames  median   p95     p99     longest  fps');
  for (const [name, s] of Object.entries(run.phases)) {
    const cell = (v) => String(v ?? '-').padStart(7);
    console.log(`  ${name.padEnd(8)} ${String(s.frames).padStart(6)} ${cell(s.median)} ${cell(s.p95)} ${cell(s.p99)} ${cell(s.longest)}  ${cell(s.fps)}`);
  }
  const m = run.memory.end ?? run.memory.landed;
  if (m) {
    console.log(`  GPU (tracker, MB): textures ${MB(m.totals.textures)}  targets ${MB(m.totals.targets)}  buffers ${MB(m.totals.buffers)}  canvas ${MB(m.totals.canvases)}  all ${MB(m.totals.all)}  peak ${MB(m.peak)}`);
    for (const [kind, map] of [['texture', m.textures], ['target', m.targets], ['renderbuffer', m.renderbuffers], ['buffer', m.buffers]]) {
      for (const [key, e] of Object.entries(map).sort((a, b) => b[1].bytes - a[1].bytes)) if (e.bytes > 1e6) console.log(`    ${kind.padEnd(12)} ${key.padEnd(34)} x${e.count}  ${MB(e.bytes)} MB`);
    }
  }
  if (run.room) console.log(`  room: tier ${run.room.tier}, pixel ratio ${run.room.pixelRatio}, draw calls ${run.room.info?.calls}; own estimate ${run.room.estimate ? `${MB(run.room.estimate.totalBytes)} MB` : '-'}`);
}

const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !flag('--no-build') });
const runs = [];
try {
  console.log(`${label}: ${server.url}  load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores  ${seconds} s per phase  tier ${tierOption}`);
  for (const name of browsers) {
    const browser = await LAUNCH[name]();
    try {
      for (const viewport of viewports) {
        const run = await measure(name, browser, viewport, server.url);
        print(run);
        runs.push(run);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
if (out) {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, `render-${label}.json`), JSON.stringify({ label, url: server.url, seconds, tier: tierOption, runs }, null, 2));
}
process.exit(runs.some((r) => r.error) ? 1 : 0);
