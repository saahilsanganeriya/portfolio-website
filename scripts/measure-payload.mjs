// The room's payload (PLAN 3.9, 11.3): the transfer size of every request `/` makes after the first contentful
// paint, on the production build, split in two.
//   initial:   everything requested before the room became interactive (the intro glide ended, no input yet):
//              models, textures, posters, decoders, scene code, the monitor's OS. Budget 6,000,000 B.
//   on demand: everything a visit then pulls in: the Instax board's pictures and the photography chunk, the room's
//              sound and music (first input; here a press of the Sound button), the album (opened, three pages turned),
//              the projector's film (run from its framing) and a look out of the window close up (the other day/night
//              pictures its cities need there). Caps: film 1,500,000 B (the old reel's), music 1,200,000 B (PLAN 11.3),
//              the board's prints 1,500,000 B (PLAN-ROUND-7 §7), each sound effect 150,000 B; photos must stay lazy and
//              low-res (480 px on the board, 960 px in the album and on the projector; PLAN 12.3). Each
//              on-demand request is put in a kind by its path, and pictures by the step of the visit that asked for
//              them. Window pictures this visit never asked for are listed with their file sizes.
// Also checks "text before 3D": first contentful paint happens before the first .glb/.ktx2 response ends (PLAN 3.9),
// and before the first byte of any 3D response arrives (PLAN 12.3): the models, textures, the Basis transcoder and the
// scene's code chunk.
//
// --at <ISO time> shifts the page's Date to that moment (the window's pictures follow each city's clock); request
// timings keep the real clock.
//
//   node scripts/measure-payload.mjs [--no-build] [--url https://…] [--at 2026-11-10T01:07:00Z]
import { readdir, stat } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const BUDGET = 6_000_000;
const FILM_CAP = 1_500_000;
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
  const finished = [];
  page.on('requestfinished', (request) => finished.push(request));
  const room = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 60_000 });
  const settle = () => room(() => window.__room && !window.__room.moving);
  // The browser's clock, the one request timings use.
  const now = () => page.evaluate(() => performance.timeOrigin + performance.now());
  const steps = [];
  const step = async (name) => steps.push({ name, at: await now() });
  const click = async (name) => {
    const point = await page.evaluate((n) => window.__room.point(n), name);
    if (!point) throw new Error(`${name} is not on screen`);
    await page.mouse.click(point.x, point.y);
  };

  await page.goto(new URL('/', server.url).href);
  await page.waitForFunction(() => window.__room && window.__room.phase === 'desk' && !window.__room.moving, null, { timeout: 180_000 });
  const { origin, interactiveAt } = await page.evaluate(() => ({ origin: performance.timeOrigin, interactiveAt: window.__room.interactiveAt }));
  const interactiveEpoch = origin + interactiveAt;
  steps.push({ name: 'by itself', at: interactiveEpoch });

  // A visit: the Instax board, sound, the album opened and paged, the projector run, the window close up.
  await step('board');
  await page.evaluate(() => window.__room.goto('photos'));
  await settle();
  await room(() => !window.__room.world.instax || window.__room.world.instax.prints.every((p) => p.shown > 0));
  await page.evaluate(() => window.__room.goto('idle'));
  await settle();
  await step('sound');
  await page.locator('[data-room-sound]').click();
  // The sound the first input loads: the room's twelve recordings and the music's three stems.
  await room(() => {
    const sounds = performance.getEntriesByType('resource').map((e) => e.name);
    return sounds.filter((name) => name.includes('/audio/room/')).length >= 12 && sounds.filter((name) => name.includes('/audio/music/')).length >= 3;
  });
  await step('album');
  await click('hit_album');
  await room(() => window.__room.world.album?.state === 'open');
  for (let i = 0; i < 3; i++) {
    await click('album_right');
    await room(() => window.__room.world.album?.state === 'open');
  }
  await page.keyboard.press('Escape');
  await room(() => window.__room.world.album?.state === 'closed');
  await step('projector');
  await page.evaluate(() => window.__room.goto('idle'));
  await settle();
  await click('hit_projector');
  await room(() => !window.__room.world.projector || window.__room.world.projector.state === 'playing');
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
      rows.push({ pathname, type: request.resourceType(), bytes: Math.max(0, sizes.responseBodySize), initial: timing.startTime < interactiveEpoch, step: asked });
    }
  }
  rows.sort((a, b) => Number(b.initial) - Number(a.initial) || b.bytes - a.bytes);
  const sum = (list) => list.reduce((total, r) => total + r.bytes, 0);
  const initial = rows.filter((r) => r.initial);
  const onDemand = rows.filter((r) => !r.initial);
  const film = sum(rows.filter((r) => /^\/room\/story-film\./.test(r.pathname)));
  const board = sum(rows.filter((r) => !r.initial && r.step === 'board' && /\.(webp|avif|jpe?g|png)$/.test(r.pathname)));
  const biggestSfx = Math.max(0, ...rows.filter((r) => r.pathname.startsWith('/audio/sfx/')).map((r) => r.bytes));
  const music = sum(rows.filter((r) => r.pathname.startsWith('/audio/music/')));
  const textFirst = fcpEpoch < firstModelEnd;
  const textBeforeFirstByte = fcpEpoch < first3dByte.at;

  console.log('bytes      type        when       step        request (made after first contentful paint)');
  for (const r of rows) {
    console.log(`${String(r.bytes).padStart(9)}  ${r.type.padEnd(10)}  ${r.initial ? 'initial  ' : 'on demand'}  ${(r.initial ? '' : r.step).padEnd(10)}  ${r.pathname}`);
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

  const kindOf = (r) => {
    const p = r.pathname;
    if (/^\/room\/story-film\./.test(p)) return 'film';
    if (p.startsWith('/audio/music/')) return 'music';
    if (p.startsWith('/audio/city/')) return 'city sound';
    if (p.startsWith('/audio/sfx/')) return 'sound effects';
    if (p.startsWith('/audio/')) return 'room sound';
    if (/^\/room\/window_.*\.ktx2$/.test(p)) return 'window, other pictures';
    if (p === '/api/films.json') return 'live diary';
    if (r.type === 'font') return 'fonts';
    if (/\.(webp|avif|jpe?g|png)$/.test(p) || /\/photographs\.[^/]*\.js$/.test(p)) {
      return { album: 'album', board: 'Instax board', projector: 'projector' }[r.step] ?? 'photos, other';
    }
    return 'other';
  };
  const caps = { film: FILM_CAP, music: MUSIC_CAP, 'Instax board': BOARD_CAP };
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
  console.log(`initial bytes (until the room is interactive, no input): ${sum(initial)} (budget ${BUDGET})`);
  console.log(`on-demand bytes (this visit): ${sum(onDemand)}; of which film ${film} (cap ${FILM_CAP}), music ${music} (cap ${MUSIC_CAP}), board ${board} (cap ${BOARD_CAP}), largest sound effect ${biggestSfx} (cap ${SFX_CAP})`);
  console.log(`total bytes: ${sum(rows)}`);
  console.log(`first contentful paint: ${fcp.toFixed(0)} ms; room interactive: ${interactiveAt.toFixed(0)} ms`);
  console.log(`first .glb/.ktx2 response end: ${Number.isFinite(firstModelEnd) ? (firstModelEnd - origin).toFixed(0) + ' ms' : 'none'}`);
  console.log(`first 3D byte: ${Number.isFinite(first3dByte.at) ? `${(first3dByte.at - origin).toFixed(0)} ms (${first3dByte.pathname})` : 'none'}`);
  console.log(`text-before-3D: ${textFirst}; text before the first 3D byte: ${textBeforeFirstByte}`);
  ok = sum(initial) <= BUDGET && film <= FILM_CAP && music <= MUSIC_CAP && board <= BOARD_CAP && biggestSfx <= SFX_CAP && textFirst && textBeforeFirstByte;
  console.log(ok ? 'payload: pass' : 'payload: FAIL');
} finally {
  await browser.close();
  await server.close();
}
process.exit(ok ? 0 : 1);
