// The banding check: how posterised the room's darkest smooth gradients look (the dark floor and wall fades of the
// wide view, the dark walls behind the desk), measured on one frame per view with page time under the script's
// control, so every variant draws the same moment of the idle drift. The metric (run, ripple) is in lib/banding.mjs.
//
// For each viewport and view (idle = the wide view, desk), the first variant's frame picks the crops: the `--count`
// darkest windows with a gradient across them and no edge or texture in them, away from the monitor's OS. Every
// variant is then measured on those same crops. `--crops file.json` (a banding.json from an earlier run) reuses its
// crops instead, so two builds or two rooms can be measured on the same pixels.
//
// Files in <out>/<WxH device>/<view>/: <variant>.png (the frame), crops.png (where the crops sit), and per crop
// <crop>-<variant>.png at 1:1 plus <crop>-<variant>-x8.png (its levels stretched, the same stretch for every variant,
// so the steps can be seen); <out>/banding.json and sheet-<WxH>.png (each crop, variants side by side).
//
//   node scripts/measure-banding.mjs [--url http://… | --no-build] [--out dir] [--viewports 1440x900@1,1280x720@2]
//     [--views idle,desk] [--variants file.json] [--crops banding.json] [--count 4] [--tier 0] [--mock dir]
//     [--gl swiftshader|egl|default] [--clock 0]
//   --variants: {"name": { …window.__roomDebug switches…, finish?: { …window.__finish settings… } }, …}; the first is
//   the reference that places the crops; default {"as-built": {}}. Streamed atlases are waited for before measuring.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { bandingOf, findDarkGradients } from './lib/banding.mjs';
import { driveTo, glRenderer, launch, openPage, parseViewports, stepUntil, tick } from './lib/room-capture.mjs';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = option('--out', 'banding');
const viewports = parseViewports(option('--viewports', '1440x900@1,1280x720@2'));
const views = option('--views', 'idle,desk').split(',');
const tier = Number(option('--tier', '0'));
const glMode = option('--gl', 'swiftshader');
const count = Number(option('--count', '4'));
const startClock = Number(option('--clock', '0'));
const variants = option('--variants') ? JSON.parse(await readFile(option('--variants'), 'utf8')) : { 'as-built': {} };
const reuse = option('--crops') ? JSON.parse(await readFile(option('--crops'), 'utf8')) : null;
const STRETCH_MAX = 8;

async function apply(page, switches) {
  const { finish = {}, ...rest } = switches;
  await page.evaluate(
    ([s, look]) => {
      window.__roomDebug.reset();
      window.__roomDebug.set(s);
      window.__finishShipped ??= structuredClone(window.__finish.settings);
      window.__finish.set({ ...structuredClone(window.__finishShipped), ...look });
    },
    [rest, finish],
  );
  await page.evaluate((t) => window.__roomDebug.setClock(t), startClock);
  // Two frames for the switches to take effect (a rebuilt target), the same two for every variant.
  await tick(page, 33);
  await tick(page, 33);
}

/** The monitor's OS (the CSS3D iframe behind the canvas's alpha hole) in device pixels, grown by 24 CSS px. */
async function osRect(page, dpr) {
  const r = await page.evaluate(() => document.querySelector('.room-css iframe')?.getBoundingClientRect().toJSON() ?? null);
  if (!r) return [];
  const m = 24;
  return [{ left: Math.round((r.left - m) * dpr), top: Math.round((r.top - m) * dpr), width: Math.round((r.width + 2 * m) * dpr), height: Math.round((r.height + 2 * m) * dpr) }];
}

/** Levels of a crop stretched about its reference's range (×8 at most), so 1-level steps show; 1:1, no scaling. */
async function stretched(png, rect, lo, gain) {
  const { data, info } = await sharp(png).extract(rect).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const outBuf = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) outBuf[i] = Math.max(0, Math.min(255, Math.round((data[i] - lo) * gain + 16)));
  return sharp(outBuf, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
}

const text = (s, size) => `<text font-family="DejaVu Sans, sans-serif" font-size="${size}" fill="#f2efe8">${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
const label = (width, height, line, size = 18) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111"/><g transform="translate(8 ${Math.round(height * 0.72)})">${text(line, size)}</g></svg>`)).png().toBuffer();

/** One row per crop: each variant at 1:1, then each variant stretched ×8, with its numbers above. */
async function sheet(viewport, rows) {
  const gap = 12;
  const labelHeight = 30;
  const names = Object.keys(variants);
  const parts = [];
  let y = 0;
  let width = 0;
  for (const row of rows) {
    const { rect } = row;
    parts.push({ input: await label(1600, labelHeight, `${row.view} · ${row.crop} (${rect.width}×${rect.height} device px, luma ${row.luma}) — 1:1, then levels ×${row.gain.toFixed(1)}`, 18), left: 0, top: y });
    y += labelHeight;
    let x = 0;
    for (const kind of ['1:1', 'x8']) {
      for (const name of names) {
        const m = row.metrics[name];
        parts.push({ input: await label(rect.width, 24, `${name}: run ${m.run} · ripple ${m.ripple}`, 13), left: x, top: y });
        parts.push({ input: row.images[name][kind], left: x, top: y + 24 });
        x += rect.width + gap;
      }
    }
    width = Math.max(width, x);
    y += 24 + rect.height + gap * 2;
  }
  return sharp({ create: { width: Math.max(width, 1600), height: y, channels: 3, background: '#1b1b1b' } }).composite(parts).png().toFile(join(out, `sheet-${viewport.label}.png`));
}

const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !flag('--no-build') });
const browser = await launch(glMode);
const result = { gl: glMode, tier, clock: startClock, variants, viewports: {} };
try {
  for (const viewport of viewports) {
    const page = await openPage(browser, viewport, { tier, mock: option('--mock', null) });
    await driveTo(page, server.url, 'idle', { frameMs: viewport.width < 768 ? 16 : 50 });
    await stepUntil(page, () => !window.__roomStats || window.__roomStats.done || window.__roomStats.skipped, { ms: 100, realMs: 100, timeoutMs: 600_000 });
    const renderer = await glRenderer(page);
    const perView = {};
    const rows = [];
    for (const view of views) {
      if (view !== 'idle') {
        await page.evaluate((s) => window.__room.goto(s), view);
        await stepUntil(page, (s) => window.__room.phase === s && !window.__room.moving, { arg: view, realMs: 0 });
        for (let t = 0; t < 2000; t += 100) await tick(page, 100);
      }
      const dir = join(out, viewport.label, view);
      await mkdir(dir, { recursive: true });
      const frames = {};
      for (const [name, switches] of Object.entries(variants)) {
        await apply(page, switches);
        frames[name] = await page.screenshot({ type: 'png', timeout: 180_000 });
        await writeFile(join(dir, `${name}.png`), frames[name]);
      }
      const [reference] = Object.keys(variants);
      const decoded = {};
      for (const [name, png] of Object.entries(frames)) decoded[name] = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const { info } = decoded[reference];
      const crops =
        reuse?.viewports?.[viewport.label]?.views?.[view]?.crops.map((c) => c.rect) ??
        findDarkGradients(decoded[reference].data, info.width, info.height, viewport.dpr, { count, avoid: await osRect(page, viewport.dpr) });
      const boxes = crops
        .map((r, i) => `<rect x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}" fill="none" stroke="#ff3b30" stroke-width="${2 * viewport.dpr}"/><text x="${r.left + 6}" y="${r.top - 8}" font-family="monospace" font-size="${14 * viewport.dpr}" fill="#ff3b30">${view}-${i}</text>`)
        .join('');
      await sharp(frames[reference]).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">${boxes}</svg>`) }]).toFile(join(dir, 'crops.png'));

      perView[view] = { crops: [] };
      for (const [i, c] of crops.entries()) {
        const rect = { left: c.left, top: c.top, width: c.width, height: c.height };
        const ref = await sharp(frames[reference]).extract(rect).removeAlpha().raw().toBuffer();
        let lo = 255;
        let hi = 0;
        for (const v of ref) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
        const gain = Math.min(STRETCH_MAX, 223 / Math.max(1, hi - lo));
        const metrics = {};
        const images = {};
        for (const name of Object.keys(variants)) {
          const { data } = decoded[name];
          metrics[name] = bandingOf(data, info.width, info.height, rect, viewport.dpr);
          const plain = await sharp(frames[name]).extract(rect).png().toBuffer();
          const x8 = await stretched(frames[name], rect, lo, gain);
          await writeFile(join(dir, `${view}-${i}-${name}.png`), plain);
          await writeFile(join(dir, `${view}-${i}-${name}-x8.png`), x8);
          images[name] = { '1:1': plain, x8 };
        }
        perView[view].crops.push({ crop: `${view}-${i}`, rect, luma: c.luma ?? null, span: c.span ?? null, metrics });
        rows.push({ view, crop: `${view}-${i}`, rect, luma: c.luma ?? '?', gain, metrics, images });
        console.log(`${viewport.label.padEnd(10)} ${view}-${i} ` + Object.entries(metrics).map(([n, m]) => `${n}: run ${m.run} ripple ${m.ripple}`).join('  |  '));
      }
      const mean = {};
      for (const name of Object.keys(variants)) {
        const ms = perView[view].crops.map((c) => c.metrics[name]);
        mean[name] = { run: Number((ms.reduce((s, m) => s + m.run, 0) / ms.length).toFixed(2)), ripple: Number((ms.reduce((s, m) => s + m.ripple, 0) / ms.length).toFixed(3)) };
      }
      perView[view].mean = mean;
    }
    result.viewports[viewport.label] = { viewport: `${viewport.width}x${viewport.height}@${viewport.dpr}`, renderer, pixelRatio: await page.evaluate(() => window.__roomDebug.pixelRatio), views: perView };
    await sheet(viewport, rows);
    console.log(`renderer (${glMode}): ${renderer}`);
    await page.context().close();
  }
  await writeFile(join(out, 'banding.json'), JSON.stringify(result, null, 2) + '\n');
} finally {
  await browser.close();
  await server.close();
}
