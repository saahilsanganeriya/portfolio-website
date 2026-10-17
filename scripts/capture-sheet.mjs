// The side-by-side sheet (brief §1.4): our room against Henry Heffernan's live site at the same viewports, the wide
// view and the desk view (his landing view and his zoomed-in monitor view), plus 1:1 crops of matching regions: the
// desk edge, the keyboard, the monitor bezel and the wall or background behind.
//
// Ours is driven with page time under the script's control (the quality tier pinned, as a real GPU holds it); his runs
// in real time: Start, then the landing view; a click, then his desk view (crops only); the pointer over his screen,
// then the monitor view. Crops are placed
// from each site's screen element (our CSS3D iframe, his #computer-screen), in units of that screen's height on the
// page, so they follow each framing.
//
// Files in --out: sheet-<WxH device>.png (labelled grid and crops), shots/<site>-<view>-<WxH>.png, crops/…, and
// sheet.json (what was captured, with which WebGL).
//
//   node scripts/capture-sheet.mjs [--url http://… | --no-build] [--out dir] [--viewports 1440x900@1,1280x720@2]
//     [--henry https://henryheffernan.com] [--gl swiftshader|egl|default] [--label "ours (main)"] [--mock dir]
//     [--tier 0] [--no-henry] [--from dir]   --from recomposes the sheets from an earlier run's shots/ and sheet.json
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { driveTo, glRenderer, launch, openPage, parseViewports, stepUntil, tick } from './lib/room-capture.mjs';
import { serveBuild } from './lib/serve-build.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = option('--out', 'sheet');
const viewports = parseViewports(option('--viewports', '1440x900@1,1280x720@2'));
const henryUrl = option('--henry', 'https://henryheffernan.com');
const glMode = option('--gl', 'swiftshader');
const label = option('--label', 'ours');
const tier = Number(option('--tier', '0'));
const CELL_WIDTH = 1280;
const CROP = { width: 420, height: 280 };

// Region → [view the crop comes from, x and y of its centre from the screen's top-left, in screen heights].
const REGIONS = {
  ours: {
    'desk edge': ['desk', -1.06, 2.3],
    keyboard: ['desk', 0.39, 2.42],
    'monitor bezel': ['desk', -0.06, 0.6],
    wall: ['desk', -1.5, -0.35],
  },
  henry: {
    'desk edge': ['close', -1.44, 2.32],
    keyboard: ['close', 0.5, 2.07],
    'monitor bezel': ['desk', -0.04, 0.6],
    wall: ['close', -1.44, 0.8],
  },
};

const shots = {};
const meta = { gl: glMode, label, henry: henryUrl, viewports: [], screens: {} };

async function screenRect(page, selector) {
  return page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  }, selector);
}

async function shoot(page, site, view, viewport, selector) {
  const png = await page.screenshot({ type: 'png', timeout: 180_000 });
  const file = join(out, 'shots', `${site}-${view}-${viewport.label}.png`);
  await writeFile(file, png);
  shots[`${site}/${view}/${viewport.label}`] = { png, screen: await screenRect(page, selector) };
  meta.screens[`${site}/${view}/${viewport.label}`] = shots[`${site}/${view}/${viewport.label}`].screen;
}

async function ours(browser, server, viewport) {
  const page = await openPage(browser, viewport, { tier, mock: option('--mock', null) });
  await driveTo(page, server.url, 'idle');
  const renderer = await glRenderer(page);
  await shoot(page, 'ours', 'wide', viewport, '.room-css iframe');
  await page.evaluate(() => window.__room.goto('desk'));
  await stepUntil(page, () => window.__room.phase === 'desk' && !window.__room.moving, { realMs: 0 });
  for (let t = 0; t < 2000; t += 100) await tick(page, 100);
  await shoot(page, 'ours', 'desk', viewport, '.room-css iframe');
  await page.context().close();
  return renderer;
}

async function henry(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr });
  const page = await context.newPage();
  await page.goto(henryUrl, { waitUntil: 'load', timeout: 180_000 });
  const renderer = await glRenderer(page);
  await page.waitForSelector('.bios-start-button', { timeout: 300_000 });
  await page.click('.bios-start-button');
  // His camera glides to the landing view in about 2.5 s; the pointer rests in a corner, off his parallax.
  await page.mouse.move(4, viewport.height - 4);
  await page.waitForTimeout(7000);
  await shoot(page, 'henry', 'wide', viewport, '#computer-screen');
  // A click on the floor in front of his desk: his camera moves to its desk framing.
  await page.mouse.click(viewport.width / 2, viewport.height - 40);
  await page.mouse.move(4, viewport.height - 4);
  await page.waitForTimeout(4000);
  await shoot(page, 'henry', 'close', viewport, '#computer-screen');
  const screen = await screenRect(page, '#computer-screen');
  await page.mouse.move(screen.left + screen.width / 2, screen.top + screen.height / 2, { steps: 5 });
  await page.waitForTimeout(5000);
  await shoot(page, 'henry', 'desk', viewport, '#computer-screen');
  await context.close();
  return renderer;
}

const text = (s, size, color = '#f2efe8') =>
  `<text font-family="DejaVu Sans, sans-serif" font-size="${size}" fill="${color}">${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
const labelSvg = (width, height, line, size = 22) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111"/><g transform="translate(10 ${Math.round(height * 0.7)})">${text(line, size)}</g></svg>`);

async function crop(site, region, viewport) {
  const [view, fx, fy] = REGIONS[site][region];
  const shot = shots[`${site}/${view}/${viewport.label}`];
  if (!shot?.screen) return null;
  const { left, top, height } = shot.screen;
  const meta = await sharp(shot.png).metadata();
  const cx = (left + fx * height) * viewport.dpr;
  const cy = (top + fy * height) * viewport.dpr;
  const x = Math.round(Math.min(Math.max(0, cx - CROP.width / 2), meta.width - CROP.width));
  const y = Math.round(Math.min(Math.max(0, cy - CROP.height / 2), meta.height - CROP.height));
  const buffer = await sharp(shot.png).extract({ left: x, top: y, width: CROP.width, height: CROP.height }).png().toBuffer();
  await writeFile(join(out, 'crops', `${site}-${region.replace(/ /g, '-')}-${viewport.label}.png`), buffer);
  return buffer;
}

async function compose(viewport, renderers) {
  const cellHeight = Math.round((CELL_WIDTH * viewport.height) / viewport.width);
  const labelHeight = 40;
  const gap = 16;
  const views = [
    ['wide', 'wide view', 'landing view'],
    ['desk', 'desk view', 'monitor view'],
  ];
  const sites = [
    ['ours', label],
    ['henry', 'henryheffernan.com (live)'],
  ];
  const regions = Object.keys(REGIONS.ours);
  const cropsTop = 60 + views.length * (labelHeight + cellHeight + gap);
  const width = sites.length * CELL_WIDTH + gap;
  const height = cropsTop + labelHeight + 2 * (labelHeight + CROP.height + gap);
  const layers = [
    { input: labelSvg(width, 60, `${viewport.width}×${viewport.height} CSS @${viewport.dpr} = ${viewport.label} device px · WebGL: ${renderers.ours.replace(/[()]/g, '')}`, 24), left: 0, top: 0 },
  ];
  for (const [r, [view, ourName, hisName]] of views.entries()) {
    for (const [c, [site, siteName]] of sites.entries()) {
      const shot = shots[`${site}/${view}/${viewport.label}`];
      if (!shot) continue;
      const left = c * (CELL_WIDTH + gap);
      const top = 60 + r * (labelHeight + cellHeight + gap);
      layers.push({ input: labelSvg(CELL_WIDTH, labelHeight, `${siteName} — ${site === 'ours' ? ourName : hisName}`), left, top });
      layers.push({ input: await sharp(shot.png).resize(CELL_WIDTH, cellHeight, { kernel: 'lanczos3' }).toBuffer(), left, top: top + labelHeight });
    }
  }
  layers.push({ input: labelSvg(width, labelHeight, 'crops at 1:1 device pixels (no scaling): ours above, Henry below', 22), left: 0, top: cropsTop });
  for (const [row, site] of ['ours', 'henry'].entries()) {
    for (const [i, region] of regions.entries()) {
      const buffer = await crop(site, region, viewport);
      if (!buffer) continue;
      const left = i * (CROP.width + gap);
      const top = cropsTop + labelHeight + row * (labelHeight + CROP.height + gap);
      layers.push({ input: labelSvg(CROP.width, labelHeight, `${site === 'ours' ? 'ours' : 'Henry'}: ${region}`, 18), left, top });
      layers.push({ input: buffer, left, top: top + labelHeight });
    }
  }
  const file = join(out, `sheet-${viewport.label}.png`);
  await sharp({ create: { width, height, channels: 3, background: '#1b1b1b' } }).composite(layers).png().toFile(file);
  return file;
}

await mkdir(join(out, 'shots'), { recursive: true });
await mkdir(join(out, 'crops'), { recursive: true });
if (option('--from')) {
  const from = option('--from');
  const earlier = JSON.parse(await readFile(join(from, 'sheet.json'), 'utf8'));
  for (const [key, screen] of Object.entries(earlier.screens)) {
    const [site, view, device] = key.split('/');
    shots[key] = { png: await readFile(join(from, 'shots', `${site}-${view}-${device}.png`)), screen };
  }
  for (const viewport of viewports) {
    const renderers = earlier.viewports.find((v) => v.device === viewport.label)?.renderers ?? { ours: 'unknown' };
    console.log(`${viewport.label}: ${await compose(viewport, renderers)} (recomposed from ${from})`);
  }
  process.exit(0);
}
const server = option('--url') ? { url: option('--url'), close: async () => {} } : await serveBuild({ build: !flag('--no-build') });
const browser = await launch(glMode);
try {
  for (const viewport of viewports) {
    const renderers = { ours: await ours(browser, server, viewport) };
    if (!flag('--no-henry')) renderers.henry = await henry(browser, viewport);
    const file = await compose(viewport, renderers);
    meta.viewports.push({ viewport: `${viewport.width}x${viewport.height}@${viewport.dpr}`, device: viewport.label, renderers, sheet: file });
    console.log(`${viewport.label}: ${file} (ours: ${renderers.ours}; Henry: ${renderers.henry ?? 'skipped'})`);
  }
  await writeFile(join(out, 'sheet.json'), JSON.stringify(meta, null, 2) + '\n');
} finally {
  await browser.close();
  await server.close();
}
