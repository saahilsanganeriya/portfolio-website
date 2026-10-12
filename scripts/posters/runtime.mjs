// Writes the small copies the room loads at runtime for each favourite (src/content/favorites.json) that has a
// hand-drawn sheet in blender/posters/: public/room/posters/<slug>.avif (683x1024) and <slug>.ktx2 (512x768,
// ETC1S with mipmaps, for three.js's KTX2Loader). Each must fit MAX_BYTES; quality steps down until it does.
// Needs `ktx` (KTX-Software 4.x) on PATH. Usage: npm run posters:runtime [-- <slug> ...] (default: every favourite)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const root = new URL('../../', import.meta.url);
const SHEETS = new URL('blender/posters/', root);
const OUT = new URL('public/room/posters/', root);
const MAX_BYTES = 120_000;
const AVIF_QUALITY = [50, 44, 38, 32];
const KTX_QLEVEL = [192, 160, 128, 96];

const slugs =
  process.argv.length > 2
    ? process.argv.slice(2)
    : JSON.parse(await readFile(new URL('src/content/favorites.json', root), 'utf8')).films.map((film) => film.slug);
await mkdir(OUT, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), 'posters-'));

async function firstUnderCap(qualities, write) {
  for (const quality of qualities) {
    const path = await write(quality);
    const { size } = await stat(path);
    if (size <= MAX_BYTES) return { size, quality };
  }
  throw new Error(`still over ${MAX_BYTES} B at the lowest quality`);
}

try {
  for (const slug of slugs) {
    const sheet = new URL(`${slug}.png`, SHEETS).pathname;
    if (!existsSync(sheet)) {
      console.log(`posters: ${slug} has no hand-drawn sheet; the room draws it with renderPoster()`);
      continue;
    }
    const avifPath = new URL(`${slug}.avif`, OUT).pathname;
    const avif = await firstUnderCap(AVIF_QUALITY, async (quality) => {
      await sharp(sheet).resize(683, 1024, { fit: 'fill' }).avif({ quality, effort: 7 }).toFile(avifPath);
      return avifPath;
    });

    const flat = join(scratch, `${slug}.png`);
    await sharp(sheet).resize(512, 768, { fit: 'fill' }).removeAlpha().png().toFile(flat);
    const ktxPath = new URL(`${slug}.ktx2`, OUT).pathname;
    const ktx = await firstUnderCap(KTX_QLEVEL, async (qlevel) => {
      execFileSync('ktx', [
        'create', '--format', 'R8G8B8_SRGB', '--assign-tf', 'srgb', '--encode', 'basis-lz',
        '--clevel', '5', '--qlevel', String(qlevel), '--generate-mipmap', flat, ktxPath,
      ]);
      return ktxPath;
    });
    console.log(
      `posters: ${slug}.avif ${avif.size} B (q${avif.quality}), ${slug}.ktx2 ${ktx.size} B (qlevel ${ktx.quality})`,
    );
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
