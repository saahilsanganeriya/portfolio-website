// Writes blender/posters/<id>.svg and a 2048-px-tall 2:3 sRGB PNG of each for the room bake.
// Usage: npm run posters [-- <id> ...]
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { H, POSTERS, W } from './designs.mjs';

const OUT = new URL('../../blender/posters/', import.meta.url);
const PNG_HEIGHT = 2048;
// 2048 * 2/3 is 1365.33 px; 1365 keeps whole pixels and stretches the sheet by 0.02 %.
const PNG_WIDTH = 1365;

const only = new Set(process.argv.slice(2));
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: PNG_WIDTH, height: PNG_HEIGHT }, deviceScaleFactor: 1 });
  for (const draw of POSTERS) {
    const svg = draw();
    const id = svg.match(/data-poster="([^"]+)"/)[1];
    if (only.size > 0 && !only.has(id)) continue;
    await writeFile(new URL(`${id}.svg`, OUT), svg);
    const sized = svg.replace(
      `width="${W}" height="${H}"`,
      `width="${PNG_WIDTH}" height="${PNG_HEIGHT}" preserveAspectRatio="none"`,
    );
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">${sized}</body></html>`);
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: PNG_WIDTH, height: PNG_HEIGHT } });
    // A 256-colour palette is indistinguishable here (a few inks plus grain) and about 40 % of the full-colour size.
    await sharp(shot).png({ palette: true, colours: 256, dither: 0, effort: 10 }).toFile(new URL(`${id}.png`, OUT).pathname);
    console.log(`posters: ${id}.svg + ${id}.png (${PNG_WIDTH}x${PNG_HEIGHT})`);
  }
} finally {
  await browser.close();
}
