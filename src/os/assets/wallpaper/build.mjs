// Turns a Blender render into the SaahilOS wallpaper: a film look (lifted blacks, warm highlights, halation
// around bright light, a vignette and fine grain), written as wallpaper.jpg beside this file. Astro then makes the
// small AVIF and WebP copies the desktop loads. Run from the repo root:
//   node src/os/assets/wallpaper/build.mjs [render.png]
// With no argument it uses blender/renders/window_view.png, or room_idle.png until the window render exists.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WIDTH = 1600;
const HEIGHT = 1000;
const OUT = fileURLToPath(new URL('./wallpaper.jpg', import.meta.url));
const RENDERS = fileURLToPath(new URL('../../../../blender/renders/', import.meta.url));

const input =
  process.argv[2] ?? [`${RENDERS}window_view.png`, `${RENDERS}room_idle.png`].find((path) => existsSync(path));
if (!input || !existsSync(input)) throw new Error(`no render to read (looked for ${input ?? 'window_view.png, room_idle.png'})`);

const { data: base } = await sharp(input)
  .flatten({ background: '#14110f' })
  .resize(WIDTH, HEIGHT, { fit: 'cover' })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

// Halation: light above the threshold spreads into a red-orange glow, as it does through the back of real film.
const highlights = Buffer.alloc(WIDTH * HEIGHT);
for (let i = 0, p = 0; p < highlights.length; i += 3, p++) {
  const luma = 0.2126 * base[i] + 0.7152 * base[i + 1] + 0.0722 * base[i + 2];
  highlights[p] = Math.max(0, Math.min(255, ((luma - 170) / 85) * 255));
}
const halo = await sharp(highlights, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } })
  .blur(22)
  .extractChannel(0) // sharp widens a blurred one-channel image to sRGB; keep one byte per pixel
  .raw()
  .toBuffer();

// mulberry32 with a fixed seed, so a rebuild from the same render gives the same file. (A plain LCG drew
// visible horizontal bands here: its successive values are correlated.)
let seed = 0x5aa1;
const random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
};
// Grain: roughly Gaussian (sum of three uniforms), strongest in the mid-tones like silver grain.
const grain = () => (random() + random() + random() - 1.5) * 2;

const graded = Buffer.alloc(base.length);
const LIFT = [22, 17, 13]; // the film base: ink-brown, never pure black
const GAIN = [0.9, 0.88, 0.84];
const WARM = [1.04, 1.0, 0.92]; // highlights lean warm
const HALO = [1.0, 0.42, 0.2];
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const p = y * WIDTH + x;
    const i = p * 3;
    const dx = (x / WIDTH - 0.5) * 1.6;
    const dy = (y / HEIGHT - 0.5) * 1.9;
    const vignette = Math.max(0, 1 - 0.42 * (dx * dx + dy * dy));
    const luma = (0.2126 * base[i] + 0.7152 * base[i + 1] + 0.0722 * base[i + 2]) / 255;
    // 0.85 saturation: pull each channel a little towards the pixel's luma.
    const n = grain() * (9 * luma * (1 - luma) + 2.5);
    for (let c = 0; c < 3; c++) {
      const desaturated = base[i + c] * 0.85 + luma * 255 * 0.15;
      const warmed = desaturated * (1 + (WARM[c] - 1) * luma);
      const value = (LIFT[c] + warmed * GAIN[c] + halo[p] * HALO[c] * 0.32) * vignette + n;
      graded[i + c] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
}

await sharp(graded, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
  .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
  .toFile(OUT);
console.log(`wallpaper: ${input} -> ${OUT}`);
