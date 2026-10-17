// Shared by the capture scripts: a WebGL-capable Chromium, viewports, a page whose time only moves when the script
// says (Playwright's clock: Date, timers, requestAnimationFrame, performance), a seeded Math.random, and an optional
// mock of the streamed atlases (public/room/atlases.json and the files it lists) served from a local folder.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

/** Chromium switches per GL mode. The devbox has no GPU: every mode falls back to SwiftShader (the probe says which). */
export const GL_MODES = {
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  egl: ['--use-gl=egl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  default: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
};

// The window's skies follow each city's clock; every capture shows the same moment of day.
export const CAPTURE_TIME = Date.parse('2026-10-17T19:00:00Z');

export async function launch(mode = 'swiftshader') {
  if (!GL_MODES[mode]) throw new Error(`unknown --gl ${mode} (${Object.keys(GL_MODES).join(', ')})`);
  return chromium.launch({ args: GL_MODES[mode] });
}

/** What WebGL the page really got: the unmasked renderer string, or 'none'. */
export function glRenderer(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
}

/**
 * `1440x900@1,1280x720@2` → viewports. W×H are CSS pixels; the device pixels are W×H×dpr (1280x720@2 is a
 * 2560×1440 frame, the brief's "2560×1440 at DPR 2").
 */
export function parseViewports(spec) {
  return spec.split(',').map((item) => {
    const match = /^(\d+)x(\d+)@(\d+(?:\.\d+)?)$/.exec(item.trim());
    if (!match) throw new Error(`bad viewport ${item} (want WxH@dpr)`);
    const [, width, height, dpr] = match;
    return { width: Number(width), height: Number(height), dpr: Number(dpr), label: `${Number(width) * Number(dpr)}x${Number(height) * Number(dpr)}` };
  });
}

/** A page at `viewport` with a seeded Math.random, the quality tier pinned, and a paused clock. */
export async function openPage(browser, viewport, { tier = 0, seed = 7, mock = null, time = CAPTURE_TIME } = {}) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr });
  const page = await context.newPage();
  await page.addInitScript(
    ({ tier, seed }) => {
      if (tier !== null) window.__roomTier = tier;
      // mulberry32: whatever the room draws at random is the same on every run.
      let a = seed >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    { tier, seed },
  );
  if (mock) await routeMock(page, mock);
  await page.clock.install({ time });
  return page;
}

/**
 * Serves the room's files from a mock folder instead of the build: room.glb from `room-low.glb`, and any other
 * /room/ path (atlases.json, atlas/*, window pictures, floorplan.json) the folder has; the rest from the build.
 */
export async function routeMock(page, dir) {
  const TYPES = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.avif': 'image/avif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2', '.png': 'image/png', '.hdr': 'image/vnd.radiance' };
  await page.route('**/room/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/room\//, '');
    const file = join(dir, path === 'room.glb' ? 'room-low.glb' : path);
    if (path.includes('..') || !existsSync(file)) return route.continue();
    await route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' });
  });
}

/**
 * Moves page time `ms` forward and fires what is due once: one requestAnimationFrame, so one rendered frame of `ms`.
 * The room clamps a frame to 0.1 s, so steps above 100 ms only shorten the waits between them.
 */
export const tick = (page, ms) => page.clock.fastForward(ms);

/** Steps page time in `ms` frames until `predicate` holds in the page, giving the network real time between steps. */
export async function stepUntil(page, predicate, { ms = 50, realMs = 30, timeoutMs = 240_000, arg } = {}) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(predicate, arg)) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${predicate}`);
    await tick(page, ms);
    if (realMs) await sleep(realMs);
  }
}

/**
 * Loads `url` and brings the camera to rest at `station` with page time under the script's control: the arrival runs
 * in coarse steps, then `settleMs` of page time passes at the station (the idle sway fades in over about 5 s). Until
 * the room starts, frames are `frameMs` long: a phone-width page (the light tier) measures its frame rate first and
 * shows the drawn monitor instead if the frames look slow, so it needs 16.
 */
export async function driveTo(page, url, station = 'idle', { settleMs = 6000, frameMs = 50 } = {}) {
  await page.goto(url, { waitUntil: 'commit' });
  await page.clock.pauseAt(CAPTURE_TIME + 1000);
  await stepUntil(page, () => window.__room?.startedAt != null, { ms: frameMs });
  // The arrival glides by page time: 100 ms steps pass it in about fifty frames.
  await stepUntil(page, () => window.__room.landedAt != null, { ms: 100, realMs: 0 });
  await page.evaluate((s) => window.__room.goto(s), station);
  await stepUntil(page, (s) => window.__room.phase === s && !window.__room.moving, { arg: station, realMs: 0 });
  for (let t = 0; t < settleMs; t += 100) await tick(page, 100);
  // Fonts and the monitor's OS document have had real time to arrive; one more frame draws them.
  await page.waitForLoadState('networkidle').catch(() => {});
  await tick(page, 16);
}
