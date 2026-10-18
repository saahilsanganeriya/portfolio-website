// The baked atlases (blender/.cache/bake/<atlas>.png) → the full-quality files the site streams (public/room/atlas/),
// each at its size in the codec its A/B picked, with a manifest export.py turns into atlases.json. The one encoder:
// blender/scripts/export.py calls it; the codec A/B runs it with --codec overrides.
//
//   node scripts/encode-atlases.mjs --bake blender/.cache/bake --out public/room/atlas [--manifest file.json]
//     [--only desk,art] [--codec props=etc1s] [--codec desk=uastc:l2:d32768:z22] [--px env=2048] [--work dir] [--threads 8]
//
// Codecs (KTX-Software 4.4 `ktx create`, ffmpeg with libaom):
//   uastc[:q<level>][:l<lambda>][:d<dict bytes>][:z<zstd level>]  KTX2 UASTC (+ RDO when l is given) + zstd, mipmapped;
//                                                                  the GPU holds ASTC 4x4 or BC7: 1 byte per texel
//   etc1s[:q<qlevel>][:c<clevel>]                                  KTX2 ETC1S (BasisLZ), mipmapped; ETC2 or BC1 on the
//                                                                  GPU: 0.5 byte per texel (BC7 where a GPU has no ETC2/BC1 path)
//   avif[:<crf>]                                                   AVIF, decoded to RGBA8 by the browser: 4 bytes per texel
// The A/B behind each choice: BOX/evidence/T93/codec-ab.md (SSIM at the desk and wide views, bytes, GPU bytes).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Each atlas's shipped size and codec (T93's A/B, BOX/evidence/T93/codec-ab.md). desk and art: UASTC with a larger RDO
 * dictionary and zstd 22, smaller than round 8's at the same or a higher SSIM. props: AVIF; ETC1S showed blocks at the
 * desk view, and UASTC would put the full room over its 25 MB budget. env: AVIF while the full set has no room; UASTC
 * (`--codec env=uastc:q2:l2:d32768:z22`, optionally `--px env=2048`) holds a quarter of its GPU memory for +2.9 MB.
 * With the bezel's own atlas the full room measured 26.0 MB: desk, art and the bezel take RDO level 2 (-0.85 MB, about
 * 2 dB PSNR against the resampled bake), the bezel ships at 1792 px (-0.47 MB) and props at crf 16 (-0.10 MB), which
 * keeps the full room under 25 MB once the darkroom's small prints load before the reveal. The bezel's 4,096-sample
 * re-bake has far less noise to encode: at 2048 px it is smaller than the 1,024-sample bake was at 1792.
 */
export const ATLASES = {
  desk: { px: 4096, codec: 'uastc:q2:l2:d32768:z22' },
  bezel: { px: 2048, codec: 'uastc:q2:l2:d32768:z22' }, // the CRT bezel the landing view shows
  art: { px: 4096, codec: 'uastc:q2:l2:d32768:z22' },
  props: { px: 4096, codec: 'avif:16' },
  env: { px: 3072, codec: 'avif:14' },
};

/** `uastc:q2:l1:d32768:z22` → { kind, quality, lambda, dict, zstd }; `etc1s:q255` → { kind, qlevel, clevel }; `avif:14`. */
export function parseCodec(spec) {
  const [kind, ...parts] = spec.split(':');
  const field = (prefix, fallback) => {
    const part = parts.find((p) => p.startsWith(prefix));
    return part === undefined ? fallback : Number(part.slice(prefix.length));
  };
  if (kind === 'uastc') return { kind, quality: field('q', 2), lambda: field('l', null), dict: field('d', 4096), zstd: field('z', 18) };
  if (kind === 'etc1s') return { kind, qlevel: field('q', 255), clevel: field('c', 5) };
  if (kind === 'avif') return { kind, crf: parts.length ? Number(parts[0]) : 14 };
  throw new Error(`unknown codec ${spec} (uastc, etc1s or avif)`);
}

/** The manifest's format name, which the site's streamer reads (Resources.ts): ktx2-uastc, ktx2-etc1s or avif. */
export const formatOf = (codec) => (codec.kind === 'avif' ? 'avif' : `ktx2-${codec.kind}`);

/** Arguments for one encode of `src` (already at its size) to `dst`. */
export function encodeArgs(codec, src, dst, threads = 8) {
  if (codec.kind === 'avif') {
    return ['ffmpeg', ['-v', 'error', '-y', '-i', src, '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(codec.crf), '-cpu-used', '4', '-threads', String(threads), dst]];
  }
  const common = ['create', '--format', 'R8G8B8_SRGB', '--assign-tf', 'srgb', '--generate-mipmap', '--threads', String(threads)];
  if (codec.kind === 'uastc') {
    const rdo = codec.lambda === null ? [] : ['--uastc-rdo', '--uastc-rdo-l', String(codec.lambda), '--uastc-rdo-d', String(codec.dict)];
    return ['ktx', [...common, '--encode', 'uastc', '--uastc-quality', String(codec.quality), ...rdo, '--zstd', String(codec.zstd), src, dst]];
  }
  return ['ktx', [...common, '--encode', 'basis-lz', '--qlevel', String(codec.qlevel), '--clevel', String(codec.clevel), src, dst]];
}

/**
 * The KTX2 header and the first descriptor block of its data format descriptor: size, levels, supercompression
 * (1 BasisLZ, 2 zstd) and the colour model (166 UASTC, 163 ETC1S) with its transfer function (2 sRGB).
 */
export function readKtx2(bytes) {
  const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!IDENTIFIER.every((b, i) => bytes[i] === b)) throw new Error('not a KTX2 file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  const dfd = u32(48);
  return {
    vkFormat: u32(12),
    width: u32(20),
    height: u32(24),
    levels: u32(40),
    supercompression: u32(44),
    colorModel: view.getUint8(dfd + 12),
    transfer: view.getUint8(dfd + 14),
  };
}

const MODELS = { uastc: 166, etc1s: 163 };
const SUPERCOMPRESSION = { uastc: 2, etc1s: 1 };

/** Checks an encoded atlas against what was asked for; returns { bytes, levels }. Throws on a mismatch. */
export function checkEncoded(path, codec, px) {
  const bytes = statSync(path).size;
  if (codec.kind === 'avif') {
    const probe = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], { capture: true });
    const [width, height] = probe.trim().split(',').map(Number);
    if (width !== px || height !== px) throw new Error(`${path}: ${width}x${height}, want ${px}x${px}`);
    return { bytes, levels: 1 };
  }
  const header = readKtx2(readFileSync(path));
  const levels = Math.floor(Math.log2(px)) + 1;
  const problems = [
    header.width !== px || header.height !== px ? `${header.width}x${header.height}, want ${px}x${px}` : '',
    header.levels !== levels ? `${header.levels} levels, want ${levels}` : '',
    header.colorModel !== MODELS[codec.kind] ? `colour model ${header.colorModel}, want ${MODELS[codec.kind]}` : '',
    header.supercompression !== SUPERCOMPRESSION[codec.kind] ? `supercompression ${header.supercompression}` : '',
    header.transfer !== 2 ? `transfer ${header.transfer}, want sRGB` : '',
  ].filter(Boolean);
  if (problems.length) throw new Error(`${path}: ${problems.join('; ')}`);
  return { bytes, levels };
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync('nice', ['-n', '10', command, ...args], { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
  return result.stdout ?? '';
}

/** The bake at `px` square, resampled as export.py always did (ffmpeg Lanczos, 8-bit RGB): byte-identical output. */
function resample(src, px, work) {
  const dst = join(work, `sized_${px}`, src.split('/').pop());
  mkdirSync(join(work, `sized_${px}`), { recursive: true });
  run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale=${px}:${px}:flags=lanczos,format=rgb24`, dst]);
  return dst;
}

/**
 * Encodes `names` from `bake` into `out`; returns the manifest rows. Old files of an atlas in another codec go.
 * `table` is ATLASES unless a caller (a test) brings its own.
 * @param {{ bake: string, out: string, table?: Record<string, { px: number, codec: string }>, names?: string[],
 *   codecs?: Record<string, string>, sizes?: Record<string, number>, work?: string, threads?: number }} options
 */
export function encodeAtlases({ bake, out, table = ATLASES, names = Object.keys(table), codecs = {}, sizes = {}, work = join(tmpdir(), 'encode-atlases'), threads = 8 }) {
  mkdirSync(out, { recursive: true });
  const rows = [];
  for (const name of names) {
    const atlas = table[name];
    if (!atlas) throw new Error(`unknown atlas ${name} (${Object.keys(table).join(', ')})`);
    const spec = codecs[name] ?? atlas.codec;
    const codec = parseCodec(spec);
    const px = sizes[name] ?? atlas.px;
    const src = resample(join(bake, `${name}.png`), px, work);
    for (const file of readdirSync(out)) if (file.startsWith(`${name}.`)) rmSync(join(out, file));
    const dst = join(out, `${name}.${codec.kind === 'avif' ? 'avif' : 'ktx2'}`);
    const started = Date.now();
    const [command, args] = encodeArgs(codec, src, dst, threads);
    run(command, args);
    const { bytes, levels } = checkEncoded(dst, codec, px);
    rows.push({ name, uri: `atlas/${dst.split('/').pop()}`, px, bytes, format: formatOf(codec), levels, codec: spec, seconds: Math.round((Date.now() - started) / 1000) });
    console.log(`encode-atlases: ${name} ${spec} ${px}px -> ${dst} ${bytes.toLocaleString('en-US')} B, ${levels} levels`);
  }
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const pairs = (flag) => Object.fromEntries(argv.flatMap((a, i) => (a === flag ? [argv[i + 1].split('=')] : [])));
  const codecs = pairs('--codec');
  const sizes = Object.fromEntries(Object.entries(pairs('--px')).map(([name, px]) => [name, Number(px)]));
  const bake = option('--bake', null);
  const out = option('--out', null);
  if (!bake || !out) {
    console.error('usage: encode-atlases.mjs --bake <dir> --out <dir> [--manifest f] [--only a,b] [--codec name=spec] [--px name=n] [--work dir] [--threads n]');
    process.exit(2);
  }
  const only = option('--only', null);
  const rows = encodeAtlases({ bake, out, names: only ? only.split(',') : undefined, codecs, sizes, work: option('--work', undefined), threads: Number(option('--threads', '8')) });
  const manifest = option('--manifest', null);
  if (manifest) writeFileSync(manifest, JSON.stringify(rows, null, 2) + '\n');
}
