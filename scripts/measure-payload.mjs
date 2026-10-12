// The room's payload (PLAN 3.9): the transfer size of every request `/` makes after the text index paints (models,
// textures, decoders, scene code, the monitor's OS), on the production build, through START to the idle view, and
// everything START itself loads (the room's sound, the projector reel, the live diary for the reel's cards).
// Also checks "text before 3D": first contentful paint happens before the first .glb/.ktx2 response ends.
//
//   node scripts/measure-payload.mjs [--no-build] [--url https://…]
import { chromium } from 'playwright';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const BUDGET = 6_000_000;

const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !args.includes('--no-build') });
// SwiftShader so headless Chromium has WebGL and loads the room, as a desktop visitor's browser would.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const finished = [];
  page.on('requestfinished', (request) => finished.push(request));

  await page.goto(new URL('/', server.url).href);
  await page.locator('[data-boot-button]').waitFor({ state: 'visible', timeout: 180_000 });
  const startEpoch = await page.evaluate(() => performance.timeOrigin + performance.now());
  await page.locator('[data-boot-button]').click();
  await page.waitForFunction(() => window.__room && window.__room.phase === 'idle' && !window.__room.moving, null, { timeout: 60_000 });
  // START's own loads: every sound, and the reel (which loads once, then plays in view).
  await page.waitForFunction(
    () =>
      ['playing', 'paused', 'failed'].includes(window.__room.reel?.state ?? 'failed') &&
      performance.getEntriesByType('resource').filter((e) => e.name.includes('/room/audio/')).length >= 12,
    null,
    { timeout: 60_000 },
  );
  await page.waitForLoadState('networkidle');

  const { fcp, origin } = await page.evaluate(() => ({
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN,
    origin: performance.timeOrigin,
  }));
  const fcpEpoch = origin + fcp;

  const rows = [];
  let firstModelEnd = Infinity;
  for (const request of finished) {
    const timing = request.timing();
    // A response served from the memory cache reports zero (or a small negative) body size: nothing crossed the wire.
    const sizes = await request.sizes();
    const { pathname } = new URL(request.url());
    if (/\.(glb|ktx2)$/.test(pathname)) firstModelEnd = Math.min(firstModelEnd, timing.startTime + timing.responseEnd);
    if (timing.startTime >= fcpEpoch) {
      rows.push({ pathname, type: request.resourceType(), bytes: Math.max(0, sizes.responseBodySize), afterStart: timing.startTime >= startEpoch });
    }
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  const total = rows.reduce((sum, r) => sum + r.bytes, 0);
  const textFirst = fcpEpoch < firstModelEnd;

  console.log('bytes      type        when          request (made after first contentful paint)');
  for (const r of rows) console.log(`${String(r.bytes).padStart(9)}  ${r.type.padEnd(10)}  ${r.afterStart ? 'after START ' : 'before START'}  ${r.pathname}`);
  const afterStart = rows.filter((r) => r.afterStart);
  console.log(`requests: ${rows.length} (${afterStart.length} after START)`);
  console.log(`bytes before START: ${total - afterStart.reduce((sum, r) => sum + r.bytes, 0)}; after START: ${afterStart.reduce((sum, r) => sum + r.bytes, 0)}`);
  console.log(`total bytes: ${total} (budget ${BUDGET})`);
  console.log(`first contentful paint: ${fcp.toFixed(0)} ms`);
  console.log(`first .glb/.ktx2 response end: ${Number.isFinite(firstModelEnd) ? (firstModelEnd - origin).toFixed(0) + ' ms' : 'none'}`);
  console.log(`text-before-3D: ${textFirst}`);
  ok = total <= BUDGET && textFirst;
  console.log(ok ? 'payload: pass' : 'payload: FAIL');
} finally {
  await browser.close();
  await server.close();
}
process.exit(ok ? 0 : 1);
