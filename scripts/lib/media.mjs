// Shared helpers for the media builds in scripts/media/: a download cache and ffmpeg calls.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

export const CACHE = new URL('../../blender/.cache/media/', import.meta.url).pathname;
const USER_AGENT = 'saahilsanganeriya.com media build (saahilsanganeria666@gmail.com)';

/** Downloads `url` once into the cache (as `name`) and returns the local path. */
export async function download(url, name = decodeURIComponent(basename(new URL(url).pathname))) {
  await mkdir(CACHE, { recursive: true });
  const path = CACHE + name;
  if (existsSync(path)) return path;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`download ${url}: HTTP ${response.status}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

/** Runs ffmpeg (quiet) and returns stderr, where its filters print their measurements. Throws on failure. */
export function ffmpeg(args, { input } = {}) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { input, maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${result.stderr.toString()}`);
  return { stdout: result.stdout, stderr: result.stderr.toString() };
}
