// The crawl check (brief §1.4, CRAFT-R8 §6): a capture of the wide view's idle drift with page time under the
// script's control, so two builds (or two settings of one) are drawn at the same moments, and a number for how much
// the room's edges shimmer while the camera drifts.
//
// For each viewport: the room is driven to the wide view (the quality tier pinned, Math.random seeded, the clock at a
// fixed date), then for each variant `--seconds` of drift are captured at `--fps`, one rendered frame per captured
// frame. Out of each capture come four fixed crops (the desk's front edge and keyboard, the monitor and its bezel, the
// window frame, the wall art), placed from the room's own anchors so every build crops the same places:
//
//   motion  mean |Y(t) − Y(t−1)| on edge pixels: how far edges move (the drift itself)
//   crawl   mean |Y(t+1) − 2·Y(t) + Y(t−1)| / 2 on edge pixels: what does not move smoothly. A clean edge drifting
//           at an even speed changes by the same amount every frame and scores ~0; an aliased edge stepping from pixel
//           to pixel, grain, flicker or a light that pulses all score. Y is luma 0–255, edges are pixels whose
//           gradient in the capture's mean image is ≥ 10 levels per pixel.
//   flat    the crawl formula on the other pixels (grain and flicker show here; the drift barely does)
//
// Files per viewport and variant in <out>/<variant>/<WxH device>/: crawl.json, first.png (the first frame),
// crops/<crop>.png (1:1), strips/<crop>.png (eight consecutive frames of a crop, ×3 nearest), crops.png (where the
// crops sit), and drift.mp4 with --video.
//
//   node scripts/capture-crawl.mjs [--url http://…] [--no-build] [--out dir] [--viewports 1440x900@1,1280x720@2]
//     [--seconds 5] [--fps 30] [--tier 0] [--gl swiftshader|egl|default] [--mock dir] [--video]
//     [--variants file.json]   {"name": { …window.__roomDebug switches…, finish?: { …window.__finish settings… } }, …};
//                              default one variant, "as-built"
//     [--clock 0]              start each variant at this ambient clock (s) when the build has window.__roomDebug;
//                              --no-set-clock keeps the clock the drive reached (for builds without the hook)
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { driveTo, glRenderer, launch, openPage, parseViewports, stepUntil, tick } from './lib/room-capture.mjs';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = option('--out', 'crawl-capture');
const viewports = parseViewports(option('--viewports', '1440x900@1,1280x720@2'));
const seconds = Number(option('--seconds', '5'));
const fps = Number(option('--fps', '30'));
const tier = Number(option('--tier', '0'));
const glMode = option('--gl', 'swiftshader');
const variants = option('--variants') ? JSON.parse(await readFile(option('--variants'), 'utf8')) : { 'as-built': {} };
const startClock = flag('--no-set-clock') ? null : Number(option('--clock', '0'));
const EDGE = 10;
const STRIP_FRAMES = 8;

// Crops in CSS pixels as shares of the viewport's height, centred on an anchor the room's probe can place.
const CROPS = [
  { name: 'desk', anchor: 'monitor', dx: -0.07, dy: 0.075, w: 0.36, h: 0.1 },
  { name: 'monitor', anchor: 'monitor', dx: 0, dy: 0, w: 0.17, h: 0.15 },
  { name: 'window', anchor: 'hit_window', dx: 0, dy: -0.04, w: 0.3, h: 0.3 },
  { name: 'wall-art', anchor: 'hit_plaque', dx: 0, dy: -0.065, w: 0.36, h: 0.13 },
];

/** Crop rectangles in device pixels for this viewport, from the anchors' screen positions now. */
async function placeCrops(page, viewport) {
  const rects = [];
  for (const crop of CROPS) {
    const at = await page.evaluate((name) => window.__room.point(name), crop.anchor);
    if (!at) throw new Error(`crawl: anchor ${crop.anchor} is off screen`);
    const H = viewport.height;
    const width = Math.round(crop.w * H * viewport.dpr);
    const height = Math.round(crop.h * H * viewport.dpr);
    const left = Math.round((at.x + crop.dx * H) * viewport.dpr - width / 2);
    const top = Math.round((at.y + crop.dy * H) * viewport.dpr - height / 2);
    rects.push({ name: crop.name, left, top, width, height });
  }
  return rects;
}

const luma = (rgb, width, rect) => {
  const y = new Float32Array(rect.width * rect.height);
  for (let r = 0; r < rect.height; r++) {
    for (let c = 0; c < rect.width; c++) {
      const i = ((rect.top + r) * width + rect.left + c) * 3;
      y[r * rect.width + c] = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
    }
  }
  return y;
};

/** motion, crawl and flat for one crop's frames (see the header). */
function metrics(frames, w, h) {
  const n = frames.length;
  const mean = new Float32Array(w * h);
  for (const f of frames) for (let i = 0; i < mean.length; i++) mean[i] += f[i] / n;
  const edge = new Uint8Array(w * h);
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const at = (dr, dc) => mean[(r + dr) * w + c + dc];
      const gx = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
      const gy = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
      edge[r * w + c] = Math.hypot(gx, gy) / 8 >= EDGE ? 1 : 0;
    }
  }
  let edges = 0;
  for (const e of edge) edges += e;
  let motion = 0;
  let crawl = 0;
  let flat = 0;
  for (let t = 1; t < n; t++) for (let i = 0; i < edge.length; i++) if (edge[i]) motion += Math.abs(frames[t][i] - frames[t - 1][i]);
  for (let t = 1; t < n - 1; t++) {
    for (let i = 0; i < edge.length; i++) {
      const second = Math.abs(frames[t + 1][i] - 2 * frames[t][i] + frames[t - 1][i]) / 2;
      if (edge[i]) crawl += second;
      else flat += second;
    }
  }
  const round = (v) => Number(v.toFixed(3));
  return {
    edgeShare: round(edges / edge.length),
    motion: round(motion / Math.max(1, edges * (n - 1))),
    crawl: round(crawl / Math.max(1, edges * (n - 2))),
    flat: round(flat / Math.max(1, (edge.length - edges) * (n - 2))),
  };
}

function encoder(file, viewport) {
  const ffmpeg = spawn('nice', ['-n', '10', 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-vf', `scale=${viewport.width * viewport.dpr}:-2`, file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  return { write: (png) => new Promise((resolve) => (ffmpeg.stdin.write(png) ? resolve() : ffmpeg.stdin.once('drain', resolve))), end: () => (ffmpeg.stdin.end(), done) };
}

async function writeCropsOverlay(dir, firstPng, rects) {
  const meta = await sharp(firstPng).metadata();
  const boxes = rects
    .map((r) => `<rect x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}" fill="none" stroke="#ff3b30" stroke-width="${Math.max(2, meta.width / 640)}"/>` +
      `<text x="${r.left + 6}" y="${r.top - 8}" font-family="monospace" font-size="${Math.max(14, meta.width / 90)}" fill="#ff3b30">${r.name}</text>`)
    .join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${boxes}</svg>`);
  await sharp(firstPng).composite([{ input: svg }]).toFile(join(dir, 'crops.png'));
}

async function capture(page, viewport, name, switches, rects, dir) {
  await mkdir(join(dir, 'crops'), { recursive: true });
  await mkdir(join(dir, 'strips'), { recursive: true });
  const hasDebug = await page.evaluate(() => Boolean(window.__roomDebug));
  // `finish` in a variant is a look for window.__finish.set (the grade's tone curve, its strength); the rest are switches.
  const { finish = null, ...rest } = switches;
  if (hasDebug) {
    await page.evaluate(
      ([s, look]) => {
        window.__roomDebug.reset();
        window.__roomDebug.set(s);
        window.__finishShipped ??= structuredClone(window.__finish.settings);
        window.__finish.set({ ...structuredClone(window.__finishShipped), ...look });
      },
      [rest, finish ?? {}],
    );
  } else if (Object.keys(switches).length) throw new Error(`variant ${name} needs window.__roomDebug, which this build lacks`);
  if (hasDebug && startClock !== null) await page.evaluate((t) => window.__roomDebug.setClock(t), startClock);
  // Two frames for the switches to take effect (a rebuilt target, a re-uploaded texture).
  await tick(page, 1000 / fps);
  await tick(page, 1000 / fps);
  const pixelRatio = hasDebug ? await page.evaluate(() => window.__roomDebug.pixelRatio) : null;

  const video = flag('--video') ? encoder(join(dir, 'drift.mp4'), viewport) : null;
  const frames = Object.fromEntries(rects.map((r) => [r.name, []]));
  const strips = Object.fromEntries(rects.map((r) => [r.name, []]));
  const count = Math.round(seconds * fps);
  for (let f = 0; f < count; f++) {
    await tick(page, 1000 / fps);
    const png = await page.screenshot({ type: 'png', timeout: 180_000 });
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const r of rects) {
      frames[r.name].push(luma(data, info.width, r));
      if (f < STRIP_FRAMES) strips[r.name].push(await sharp(png).extract(r).png().toBuffer());
    }
    if (f === 0) {
      await writeFile(join(dir, 'first.png'), png);
      await writeCropsOverlay(dir, png, rects);
      for (const r of rects) await sharp(png).extract(r).toFile(join(dir, 'crops', `${r.name}.png`));
    }
    if (video) await video.write(png);
  }
  await video?.end();

  const result = { variant: name, switches, viewport: `${viewport.width}x${viewport.height}@${viewport.dpr}`, device: viewport.label, pixelRatio, frames: count, fps, crops: {} };
  for (const r of rects) {
    result.crops[r.name] = { rect: r, ...metrics(frames[r.name], r.width, r.height) };
    const tiles = strips[r.name];
    const scale = 3;
    const gap = 4;
    const strip = sharp({ create: { width: tiles.length * (r.width * scale + gap), height: r.height * scale, channels: 3, background: '#000' } });
    const inputs = await Promise.all(tiles.map(async (t, i) => ({ input: await sharp(t).resize(r.width * scale, r.height * scale, { kernel: 'nearest' }).toBuffer(), left: i * (r.width * scale + gap), top: 0 })));
    await strip.composite(inputs).png().toFile(join(dir, 'strips', `${r.name}.png`));
  }
  const values = Object.values(result.crops);
  const avg = (key) => Number((values.reduce((s, v) => s + v[key], 0) / values.length).toFixed(3));
  result.mean = { motion: avg('motion'), crawl: avg('crawl'), flat: avg('flat') };
  await writeFile(join(dir, 'crawl.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !flag('--no-build') });
const browser = await launch(glMode);
const rows = [];
try {
  for (const viewport of viewports) {
    const page = await openPage(browser, viewport, { tier, mock: option('--mock', null) });
    await driveTo(page, server.url, 'idle');
    // The full atlases swap in after the room is interactive; a swap inside a capture would read as crawl.
    await stepUntil(page, () => !window.__roomStats || window.__roomStats.done || window.__roomStats.skipped, { ms: 100, realMs: 100, timeoutMs: 600_000 });
    const renderer = await glRenderer(page);
    const rects = await placeCrops(page, viewport);
    for (const [name, switches] of Object.entries(variants)) {
      const started = Date.now();
      const result = await capture(page, viewport, name, switches, rects, join(out, name, viewport.label));
      rows.push(result);
      console.log(
        `${viewport.label.padEnd(10)} ${name.padEnd(18)} crawl ${result.mean.crawl.toFixed(3)}  motion ${result.mean.motion.toFixed(3)}  flat ${result.mean.flat.toFixed(3)}  ` +
          Object.entries(result.crops).map(([c, m]) => `${c} ${m.crawl.toFixed(2)}`).join('  ') +
          `  (${((Date.now() - started) / 1000).toFixed(0)} s)`,
      );
    }
    console.log(`renderer (${glMode}): ${renderer}`);
    await page.context().close();
  }
  await writeFile(join(out, 'summary.json'), JSON.stringify({ gl: glMode, tier, seconds, fps, rows }, null, 2) + '\n');
} finally {
  await browser.close();
  await server.close();
}
