// The room's payload (PLAN 3.9, 11.3): the transfer size of every request `/` makes after the first contentful
// paint, on the production build, split in two.
//   initial:   everything requested before the room became interactive (the intro glide ended, no input yet):
//              models, textures, posters, decoders, scene code, the monitor's OS. Budget 6,000,000 B.
//   on demand: everything a visit then pulls in: the projector reel (once its screen is in view), the live diary
//              for its cards, the print wall's pictures, the photography chunk, the room's sound and music (first
//              input; here a press of the Sound button), the Photographs program (one turn of the dial) and the album
//              (opened, three pages turned). Caps: reel 1,500,000 B, music 1,200,000 B (PLAN 11.3). Room files a visit
//              can still ask for but this one did not (the window's other day/night pictures) are listed with sizes.
// Also checks "text before 3D": first contentful paint happens before the first .glb/.ktx2 response ends.
//
//   node scripts/measure-payload.mjs [--no-build] [--url https://…]
import { readdir, stat } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const BUDGET = 6_000_000;
const REEL_CAP = 1_500_000;
const MUSIC_CAP = 1_200_000;

const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !args.includes('--no-build') });
// SwiftShader so headless Chromium has WebGL and loads the room, as a desktop visitor's browser would.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const finished = [];
  page.on('requestfinished', (request) => finished.push(request));
  const room = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 60_000 });
  const settle = () => room(() => window.__room && !window.__room.moving);
  const click = async (name) => {
    const point = await page.evaluate((n) => window.__room.point(n), name);
    if (!point) throw new Error(`${name} is not on screen`);
    await page.mouse.click(point.x, point.y);
  };

  await page.goto(new URL('/', server.url).href);
  await page.waitForFunction(() => window.__room && window.__room.phase === 'idle' && !window.__room.moving, null, { timeout: 180_000 });
  const { origin, interactiveAt } = await page.evaluate(() => ({ origin: performance.timeOrigin, interactiveAt: window.__room.interactiveAt }));
  const interactiveEpoch = origin + interactiveAt;

  // What the room pulls in by itself once interactive: the reel (its screen is in the idle view) and the prints.
  await room(() => ['playing', 'paused', 'failed'].includes(window.__room.reel?.state ?? 'failed'));
  await room(() => window.__room.world.prints.length === 0 || window.__room.world.prints.every((p) => p.shown > 0));
  // A visit: sound, one turn of the projector's dial, the album opened and paged.
  await page.locator('[data-room-sound]').click();
  // The sound the first input loads: the room's twelve recordings and the music's three stems.
  await room(() => {
    const sounds = performance.getEntriesByType('resource').map((e) => e.name);
    return sounds.filter((name) => name.includes('/audio/room/')).length >= 12 && sounds.filter((name) => name.includes('/audio/music/')).length >= 3;
  });
  await click('hit_projector_dial');
  await room(() => window.__room.world.projector?.program === 'photographs' && window.__room.world.projector.state !== 'loading');
  await page.waitForTimeout(8000);
  await page.evaluate(() => window.__room.goto('idle'));
  await settle();
  await click('hit_album');
  await room(() => window.__room.world.album?.state === 'open');
  for (let i = 0; i < 3; i++) {
    await click('album_right');
    await room(() => window.__room.world.album?.state === 'open');
  }
  await page.keyboard.press('Escape');
  await room(() => window.__room.world.album?.state === 'closed');
  await page.waitForLoadState('networkidle');

  const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN);
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
      rows.push({ pathname, type: request.resourceType(), bytes: Math.max(0, sizes.responseBodySize), initial: timing.startTime < interactiveEpoch });
    }
  }
  rows.sort((a, b) => Number(b.initial) - Number(a.initial) || b.bytes - a.bytes);
  const sum = (list) => list.reduce((total, r) => total + r.bytes, 0);
  const initial = rows.filter((r) => r.initial);
  const onDemand = rows.filter((r) => !r.initial);
  const reel = sum(rows.filter((r) => r.pathname === '/room/reel.mp4'));
  const music = sum(rows.filter((r) => r.pathname.startsWith('/audio/music/')));
  const textFirst = fcpEpoch < firstModelEnd;

  console.log('bytes      type        when       request (made after first contentful paint)');
  for (const r of rows) console.log(`${String(r.bytes).padStart(9)}  ${r.type.padEnd(10)}  ${r.initial ? 'initial  ' : 'on demand'}  ${r.pathname}`);

  // Room files this visit never asked for (they load only when needed, such as the window's other time of day).
  if (!option('--url')) {
    const requested = new Set(rows.map((r) => r.pathname));
    const dir = new URL('../.vercel/output/static/room/', import.meta.url);
    for (const name of (await readdir(dir)).filter((n) => /^window_.*\.ktx2$/.test(n)).sort()) {
      if (!requested.has(`/room/${name}`)) console.log(`${String((await stat(new URL(name, dir))).size).padStart(9)}  (not needed in this visit)  /room/${name}`);
    }
  }

  console.log(`requests: ${rows.length} (${initial.length} initial, ${onDemand.length} on demand)`);
  console.log(`initial bytes (until the room is interactive, no input): ${sum(initial)} (budget ${BUDGET})`);
  console.log(`on-demand bytes (this visit): ${sum(onDemand)}; of which reel ${reel} (cap ${REEL_CAP}), music ${music} (cap ${MUSIC_CAP})`);
  console.log(`total bytes: ${sum(rows)}`);
  console.log(`first contentful paint: ${fcp.toFixed(0)} ms; room interactive: ${interactiveAt.toFixed(0)} ms`);
  console.log(`first .glb/.ktx2 response end: ${Number.isFinite(firstModelEnd) ? (firstModelEnd - origin).toFixed(0) + ' ms' : 'none'}`);
  console.log(`text-before-3D: ${textFirst}`);
  ok = sum(initial) <= BUDGET && reel <= REEL_CAP && music <= MUSIC_CAP && textFirst;
  console.log(ok ? 'payload: pass' : 'payload: FAIL');
} finally {
  await browser.close();
  await server.close();
}
process.exit(ok ? 0 : 1);
