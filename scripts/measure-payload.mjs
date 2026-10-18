// The room's payload (PLAN 3.9, 11.3, brief §1.3): the transfer size of every request `/` makes after the first
// contentful paint, on the production build, split in two.
//   initial:   everything requested before the room was first shown (the dark screen began to fade, no input yet):
//              models, the full-quality atlases the arrival shows (public/room/atlases.json, on the GPU before the
//              first frame), posters, decoders, scene code, the monitor's OS. Budget 16,000,000 B (PLAN-ROUND-9 §2.1:
//              the arrival never shows a small atlas, so the first frame is past round 8's 6,000,000 B).
//   on demand: everything a visit then pulls in: an atlas that missed the arrival's deadline, the photographs and the
//              photography chunk, the room's sound and music (they load once the room is shown, and play at the first
//              input; here a press of the Sound button) and a look out of the window close up. Caps: music
//              1,200,000 B (PLAN 11.3), the photographs' prints 1,500,000 B (PLAN-ROUND-7 §7), each sound effect
//              150,000 B. Each on-demand request is put in a kind by its path, and pictures by the step of the visit
//              that asked for them. Window pictures this visit never asked for are listed with their file sizes.
// --full also waits, before the visit, until every atlas has arrived (window.__roomStats.done) and checks the full
// room (initial + any streamed atlases) against 25,000,000 B.
// Also checks "text before 3D": first contentful paint happens before the first .glb/.ktx2 response ends (PLAN 3.9),
// and before the first byte of any 3D response arrives (PLAN 12.3): the models, textures, the Basis transcoder and the
// scene's code chunk.
//
// --at <ISO time> shifts the page's Date to that moment (the window's pictures follow each city's clock); request
// timings keep the real clock.
//
// --mock <dir> serves room.glb, atlases.json and atlas/* from a folder instead (a stand-in for the exported set).
//
//   node scripts/measure-payload.mjs [--no-build] [--url https://…] [--at 2026-11-10T01:07:00Z] [--full] [--mock dir]
import { readdir, readFile, stat } from 'node:fs/promises';
import { chromium } from 'playwright';
import { routeMock } from './lib/room-capture.mjs';
import { serveBuild } from './lib/serve-build.mjs';

/** How many recordings the room's first input fetches: RoomAudio loads every name in mix.ts's LOOPS and SHOTS. */
async function roomRecordingCount() {
  const source = await readFile(new URL('../src/scene/audio/mix.ts', import.meta.url), 'utf8');
  const list = (name) => {
    const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(source);
    if (!match) throw new Error(`measure-payload: no ${name} list in src/scene/audio/mix.ts`);
    return match[1].split(',').map((item) => item.trim()).filter(Boolean);
  };
  const keys = list('KEYS').length;
  return [...list('LOOPS'), ...list('SHOTS')].reduce((count, item) => count + (item === '...KEYS' ? keys : 1), 0);
}

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const BUDGET = 16_000_000;
const FULL_BUDGET = 25_000_000;
const full = args.includes('--full');
const MUSIC_CAP = 1_200_000;
const BOARD_CAP = 1_500_000;
const SFX_CAP = 150_000;

const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !args.includes('--no-build') });
// SwiftShader so headless Chromium has WebGL and loads the room, as a desktop visitor's browser would.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  if (option('--at')) {
    // Only Date moves: Playwright's clock would also replace performance, which the request timings below need.
    await page.addInitScript((at) => {
      const RealDate = Date;
      const offset = at - RealDate.now();
      class ShiftedDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [RealDate.now() + offset]));
        }
        static now() {
          return RealDate.now() + offset;
        }
      }
      window.Date = ShiftedDate;
    }, Date.parse(option('--at')));
    console.log(`page clock: ${option('--at')}`);
  }
  if (option('--mock')) await routeMock(page, option('--mock'));
  const finished = [];
  page.on('requestfinished', (request) => finished.push(request));
  const room = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 60_000 });
  const settle = () => room(() => window.__room && !window.__room.moving);
  // The browser's clock, the one request timings use.
  const now = () => page.evaluate(() => performance.timeOrigin + performance.now());
  const steps = [];
  const step = async (name) => steps.push({ name, at: await now() });

  await page.goto(new URL('/', server.url).href);
  // The first frame the visitor sees: the room's start, when the dark screen begins to fade.
  await page.waitForFunction(() => window.__room?.interactiveAt != null, null, { timeout: 180_000 });
  const { origin, interactiveAt } = await page.evaluate(() => ({ origin: performance.timeOrigin, interactiveAt: window.__room.startedAt }));
  const interactiveEpoch = origin + interactiveAt;
  steps.push({ name: 'by itself', at: interactiveEpoch });
  let streamedEpoch = null;
  let gpu = null;
  if (full) {
    // The full-quality atlases stream after the first frame, one at a time.
    await page.waitForFunction(() => !window.__roomStats || window.__roomStats.done || window.__roomStats.skipped, null, { timeout: 300_000 });
    streamedEpoch = await now();
    gpu = await page.evaluate(() => window.__roomStats && { atlases: window.__roomStats.atlases, skipped: window.__roomStats.skipped, gpu: window.__roomStats.gpu });
  }

  // A visit: the darkroom's photographs, sound, the window close up. Stops the room lacks are skipped.
  await step('photos');
  const atPhotos = await page.evaluate(() => (window.__room.goto('photos'), window.__room.destination === 'photos'));
  if (atPhotos) {
    await settle();
    await room(() => !window.__room.world.darkroom || window.__room.world.darkroom.prints.every((p) => p.shown > 0));
  }
  await page.evaluate(() => window.__room.goto('idle'));
  await settle();
  await step('sound');
  await page.locator('[data-room-sound]').click();
  // The sound the first input loads: the room's recordings and the music's three stems.
  await room((recordings) => {
    const sounds = performance.getEntriesByType('resource').map((e) => e.name);
    return sounds.filter((name) => name.includes('/audio/room/')).length >= recordings && sounds.filter((name) => name.includes('/audio/music/')).length >= 3;
  }, await roomRecordingCount());
  // Close up at the window, each city also shows the picture the other city's time of day needs near the seam.
  await step('window');
  await page.evaluate(() => window.__room.goto('window'));
  await settle();
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle');

  const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN);
  const fcpEpoch = origin + fcp;

  const rows = [];
  let firstModelEnd = Infinity;
  let first3dByte = { at: Infinity, pathname: '' };
  for (const request of finished) {
    const timing = request.timing();
    // A response served from the memory cache reports zero (or a small negative) body size: nothing crossed the wire.
    const sizes = await request.sizes();
    const { pathname } = new URL(request.url());
    if (/\.(glb|ktx2)$/.test(pathname)) firstModelEnd = Math.min(firstModelEnd, timing.startTime + timing.responseEnd);
    const is3d = /\.(glb|ktx2)$/.test(pathname) || pathname.startsWith('/room/basis/') || /^\/_astro\/main\.[^/]+\.js$/.test(pathname);
    // A memory-cache hit reports no response start (-1); it carried no bytes over the wire.
    if (is3d && timing.responseStart >= 0 && timing.startTime + timing.responseStart < first3dByte.at) {
      first3dByte = { at: timing.startTime + timing.responseStart, pathname };
    }
    if (timing.startTime >= fcpEpoch) {
      const asked = steps.filter((s) => s.at <= timing.startTime).at(-1)?.name ?? 'by itself';
      rows.push({
        pathname,
        type: request.resourceType(),
        bytes: Math.max(0, sizes.responseBodySize),
        initial: timing.startTime < interactiveEpoch,
        streamed: streamedEpoch !== null && timing.startTime >= interactiveEpoch && timing.startTime < streamedEpoch,
        step: asked,
      });
    }
  }
  rows.sort((a, b) => Number(b.initial) - Number(a.initial) || b.bytes - a.bytes);
  const sum = (list) => list.reduce((total, r) => total + r.bytes, 0);
  const initial = rows.filter((r) => r.initial);
  const onDemand = rows.filter((r) => !r.initial);
  const streamed = rows.filter((r) => r.streamed);
  const kindOf = (r) => {
    const p = r.pathname;
    if (p.startsWith('/room/atlas/') || p === '/room/atlases.json') return 'atlases, streamed';
    if (p.startsWith('/audio/music/')) return 'music';
    if (p.startsWith('/audio/city/')) return 'city sound';
    if (p.startsWith('/audio/sfx/')) return 'sound effects';
    if (p.startsWith('/audio/')) return 'room sound';
    if (/^\/room\/window_.*\.ktx2$/.test(p)) return 'window, other pictures';
    if (p === '/api/films.json') return 'live diary';
    if (r.type === 'font') return 'fonts';
    if (/\.(webp|avif|jpe?g|png)$/.test(p) || /\/photographs\.[^/]*\.js$/.test(p)) {
      return r.step === 'photos' ? 'photographs' : 'photos, other';
    }
    return 'other';
  };
  // The prints' cap counts the photographs kind only: atlases still streaming during the photos step are not prints.
  const board = sum(onDemand.filter((r) => kindOf(r) === 'photographs'));
  const biggestSfx = Math.max(0, ...rows.filter((r) => r.pathname.startsWith('/audio/sfx/')).map((r) => r.bytes));
  const music = sum(rows.filter((r) => r.pathname.startsWith('/audio/music/')));
  const textFirst = fcpEpoch < firstModelEnd;
  const textBeforeFirstByte = fcpEpoch < first3dByte.at;

  console.log('bytes      type        when       step        request (made after first contentful paint)');
  for (const r of rows) {
    const when = r.initial ? 'initial  ' : r.streamed ? 'streamed ' : 'on demand';
    console.log(`${String(r.bytes).padStart(9)}  ${r.type.padEnd(10)}  ${when}  ${(r.initial ? '' : r.step).padEnd(10)}  ${r.pathname}`);
  }

  // Window pictures this visit never asked for (each loads only when its city's time of day, or the close-up, needs it).
  const requested = new Set(rows.map((r) => r.pathname));
  const roomDir = new URL(option('--url') ? '../public/room/' : '../.vercel/output/static/room/', import.meta.url);
  let unneeded = 0;
  for (const name of (await readdir(roomDir)).filter((n) => /^window_.*\.ktx2$/.test(n)).sort()) {
    if (requested.has(`/room/${name}`)) continue;
    const { size } = await stat(new URL(name, roomDir));
    unneeded += size;
    console.log(`${String(size).padStart(9)}  (not needed in this visit; file size)  /room/${name}`);
  }

  const caps = { music: MUSIC_CAP, photographs: BOARD_CAP };
  const kinds = new Map();
  for (const r of rows.filter((x) => !x.initial)) {
    const k = kindOf(r);
    const entry = kinds.get(k) ?? { bytes: 0, requests: 0 };
    entry.bytes += r.bytes;
    entry.requests += 1;
    kinds.set(k, entry);
  }
  console.log('on demand by kind:');
  for (const [k, { bytes, requests }] of [...kinds].sort((a, b) => b[1].bytes - a[1].bytes)) {
    const cap = caps[k] ? `cap ${caps[k]}, ${bytes <= caps[k] ? 'within' : 'OVER'}` : 'no byte cap';
    console.log(`  ${k.padEnd(24)} ${String(bytes).padStart(9)} B  ${String(requests).padStart(3)} requests  (${cap})`);
  }
  console.log(`  ${'window, never needed'.padEnd(24)} ${String(unneeded).padStart(9)} B  (file sizes; not loaded in this visit)`);

  console.log(`requests: ${rows.length} (${initial.length} initial, ${onDemand.length} on demand)`);
  console.log(`initial bytes (until the room is first shown, no input): ${sum(initial)} (budget ${BUDGET})`);
  console.log(`on-demand bytes (this visit): ${sum(onDemand)}; of which music ${music} (cap ${MUSIC_CAP}), photographs ${board} (cap ${BOARD_CAP}), largest sound effect ${biggestSfx} (cap ${SFX_CAP})`);
  const fullRoom = sum(initial) + sum(streamed);
  if (full) {
    console.log(`streamed atlases (after the first frame, before any input): ${sum(streamed)} B in ${streamed.length} requests`);
    console.log(`full room (initial + streamed): ${fullRoom} (budget ${FULL_BUDGET})`);
    if (gpu) {
      console.log(`atlases: ${gpu.skipped ? `none streamed (${gpu.skipped})` : gpu.atlases.map((a) => `${a.name} ${a.state} ${a.px}px ${a.bytes} B${a.ms ? ` ${a.ms} ms` : ''}`).join('; ')}`);
      console.log(`GPU memory (estimate): textures ${gpu.gpu.textureBytes} B, render targets ${gpu.gpu.targetBytes} B, total ${gpu.gpu.totalBytes} B (three.js counts ${gpu.gpu.info.textures} textures)`);
    }
  }
  console.log(`total bytes: ${sum(rows)}`);
  console.log(`first contentful paint: ${fcp.toFixed(0)} ms; room first shown: ${interactiveAt.toFixed(0)} ms`);
  console.log(`first .glb/.ktx2 response end: ${Number.isFinite(firstModelEnd) ? (firstModelEnd - origin).toFixed(0) + ' ms' : 'none'}`);
  console.log(`first 3D byte: ${Number.isFinite(first3dByte.at) ? `${(first3dByte.at - origin).toFixed(0)} ms (${first3dByte.pathname})` : 'none'}`);
  console.log(`text-before-3D: ${textFirst}; text before the first 3D byte: ${textBeforeFirstByte}`);
  ok = sum(initial) <= BUDGET && (!full || fullRoom <= FULL_BUDGET) && music <= MUSIC_CAP && board <= BOARD_CAP && biggestSfx <= SFX_CAP && textFirst && textBeforeFirstByte;
  console.log(ok ? 'payload: pass' : 'payload: FAIL');
} finally {
  await browser.close();
  await server.close();
}
process.exit(ok ? 0 : 1);
