import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkEncoded, encodeAtlases, parseCodec, readKtx2 } from '../scripts/encode-atlases.mjs';

const has = (command: string, flag: string) => spawnSync(command, [flag], { stdio: 'ignore' }).status === 0;
const tools = has('ktx', '--version') && has('ffmpeg', '-version');

// A 128 px bake (a gradient with a grid, like a baked surface with edges), encoded at 64 px as export.py's would be.
describe.skipIf(!tools)('encode-atlases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'encode-atlases-test-'));
  const bake = join(dir, 'bake');
  beforeAll(async () => {
    const size = 128;
    const pixels = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 3;
        const line = x % 16 === 0 || y % 16 === 0 ? 120 : 0;
        pixels[i] = Math.min(255, x * 2 + line);
        pixels[i + 1] = Math.min(255, y * 2);
        pixels[i + 2] = line;
      }
    }
    mkdirSync(bake, { recursive: true });
    await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toFile(join(bake, 'tiny.png'));
  }, 30_000);

  const encode = (codec: string) =>
    encodeAtlases({ bake, out: join(dir, 'out'), table: { tiny: { px: 64, codec } }, work: join(dir, 'work'), threads: 2 })[0];

  // Catches a KTX2 that is not what the site's streamer and atlases.json say it is: wrong size, no mip chain (blurry or
  // shimmering when minified), the wrong Basis mode (ETC1S where UASTC was asked) or no supercompression (bytes).
  it.each([
    ['uastc:q1:l1:d4096:z9', 'ktx2-uastc', 166, 2],
    ['etc1s:q128:c1', 'ktx2-etc1s', 163, 1],
  ])('writes %s as a mipmapped KTX2 of the asked size and mode', (codec, format, model, supercompression) => {
    const row = encode(codec);
    expect(row).toMatchObject({ name: 'tiny', uri: 'atlas/tiny.ktx2', px: 64, format, levels: 7 });
    expect(row.bytes).toBe(statSync(join(dir, 'out', 'tiny.ktx2')).size);
    const header = readKtx2(readFileSync(join(dir, 'out', 'tiny.ktx2')));
    expect(header).toMatchObject({ width: 64, height: 64, levels: 7, colorModel: model, supercompression, transfer: 2 });
  }, 60_000);

  it('writes an AVIF of the asked size and removes the atlas in its old codec', () => {
    encode('uastc:q0:z3');
    const row = encode('avif:30');
    expect(row).toMatchObject({ uri: 'atlas/tiny.avif', px: 64, format: 'avif', levels: 1 });
    expect(() => statSync(join(dir, 'out', 'tiny.ktx2'))).toThrow();
  }, 60_000);

  // Catches an encode that silently comes out at another size than the table says (atlases.json would lie about px).
  it('refuses an atlas whose size is not the one asked for', () => {
    encode('uastc:q0:z3');
    expect(() => checkEncoded(join(dir, 'out', 'tiny.ktx2'), parseCodec('uastc'), 128)).toThrow(/64x64, want 128x128; 7 levels, want 8/);
  }, 60_000);
});
