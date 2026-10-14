// Builds the record crate's audio into public/audio/records/, from real recordings only, each listed with its source,
// author and licence in blender/ASSETS.md:
//   <record>.webm / .m4a   four records (CC0 or CC BY 4.0), streamed only when a visitor chooses one: stereo, 48 kHz,
//                          -18 LUFS, at the highest bitrate that keeps each file under 2,500,000 bytes (96 kbit/s at most)
//   needle-drop, needle-lift   the tonearm's stylus meeting and leaving the groove (CC0 foley)
//   crackle                    the surface noise of a real blank groove, looped over ten turns at 33 1/3 rpm (CC0)
// It writes the measured lengths, bitrates and sizes to src/scene/audio/records.json.
//
//   node scripts/media/build-records.mjs
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { download, ffmpeg } from '../lib/media.mjs';

const OUT = new URL('../../public/audio/records/', import.meta.url).pathname;
const MANIFEST = new URL('../../src/scene/audio/records.json', import.meta.url).pathname;
const RATE = 48000;
const MAX_BYTES = 2_500_000;
// Opus and AAC overshoot their nominal rate a little; aim below the cap and step down until the file fits.
const AIM_BYTES = 2_380_000;
const MAX_KBPS = 96;
const LOUDNESS = 'I=-18:TP=-1.5:LRA=14';
const FREESOUND = 'https://cdn.freesound.org/previews/';
const PAD_S = 0.1;

// start/length in seconds within the source; length null keeps the whole piece. The rāga is a 13.5-minute
// improvisation, so its record is the opening of the ālāpana, faded out at a quiet turn of phrase.
const RECORDS = [
  { id: 'washed-up', url: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/nOI7iSZu1JomcCiZGL8R8hwVQEQjcDv49AUyCLnz.mp3', start: 0, length: null },
  { id: 'night-in-venice', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Night%20in%20Venice.mp3', start: 0, length: null },
  { id: 'cylinder-five', url: 'https://upload.wikimedia.org/wikipedia/commons/4/44/Chris_Zabriskie_-_05_-_Cylinder_Five.ogg', start: 0, length: null },
  { id: 'raga-kiravani', url: 'https://archive.org/download/LR_kIravANI/kiravani.mp3', start: 0, length: 278, fadeOut: 6 },
];

const NEEDLE_DROP = { name: 'needle-drop', url: `${FREESOUND}556/556722_9159316-hq.mp3`, start: 0, length: 1.6, fadeOut: 0.8 };
const NEEDLE_LIFT = { name: 'needle-lift', url: `${FREESOUND}456/456280_572329-hq.mp3`, start: 0, length: 0.8, fadeOut: 0.15 };
// 33 1/3 rpm turns once every 1.8 s, so ten turns loop without breaking the groove's rhythm.
const CRACKLE = { name: 'crackle', url: `${FREESOUND}586/586430_6110723-hq.mp3`, start: 300, length: 18, crossfade: 1.5 };

/** Two-pass loudness normalisation filter for an excerpt. */
function loudnorm(path, start, length, pre = 'anull') {
  const span = length === null ? [] : ['-t', String(length)];
  const { stderr } = ffmpeg(['-ss', String(start), ...span, '-i', path, '-af', `${pre},loudnorm=${LOUDNESS}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  return `loudnorm=${LOUDNESS}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

function decode(path, start, length, filters, channels) {
  const span = length === null ? [] : ['-t', String(length)];
  const { stdout } = ffmpeg(['-ss', String(start), ...span, '-i', path, '-map', '0:a', '-af', filters, '-ac', String(channels), '-ar', String(RATE), '-f', 'f32le', 'pipe:1']);
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
}

function lufs(samples, channels) {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const { stderr } = ffmpeg(['-f', 'f32le', '-ar', String(RATE), '-ac', String(channels), '-i', 'pipe:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { input });
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  return { integrated: Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)[1]), truePeak: Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)[1]) };
}

async function encodeAt(name, samples, channels, codec, kbps) {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const raw = ['-f', 'f32le', '-ar', String(RATE), '-ac', String(channels), '-i', 'pipe:0'];
  const path = `${OUT}${name}.${codec === 'opus' ? 'webm' : 'm4a'}`;
  const args =
    codec === 'opus'
      ? ['-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'constrained', '-compression_level', '10', '-application', 'audio']
      : ['-c:a', 'aac', '-b:a', `${kbps}k`, '-movflags', '+faststart'];
  ffmpeg([...raw, ...args, '-map_metadata', '-1', path], { input });
  return (await stat(path)).size;
}

/** The highest bitrate (steps of 4 kbit/s, at most MAX_KBPS) whose file stays under MAX_BYTES. */
async function encodeCapped(name, samples, channels, codec, seconds) {
  let kbps = Math.min(MAX_KBPS, Math.floor((AIM_BYTES * 8) / seconds / 1000 / 4) * 4);
  for (;;) {
    const bytes = await encodeAt(name, samples, channels, codec, kbps);
    if (bytes <= MAX_BYTES) return { kbps, bytes };
    kbps -= 4;
  }
}

/** The loop with its tail before and its head after, so a player loops between pad and pad + length (as in sounds.json). */
function padded(loop, channels) {
  const pad = Math.round(PAD_S * RATE) * channels;
  const samples = new Float32Array(loop.length + 2 * pad);
  samples.set(loop.subarray(loop.length - pad), 0);
  samples.set(loop, pad);
  samples.set(loop.subarray(0, pad), pad + loop.length);
  return samples;
}

/**
 * `length` seconds of `x` (which runs `fade` seconds longer) that loop without a seam: the first `fade` seconds blend
 * (equal power) from what followed the cut into the head, so the last frame runs on into the first.
 */
function crossfadeLoop(x, length, fade, channels) {
  const frames = Math.round(length * RATE);
  const fadeFrames = Math.round(fade * RATE);
  const loop = x.slice(0, frames * channels);
  for (let i = 0; i < fadeFrames; i++) {
    const t = i / fadeFrames;
    for (let c = 0; c < channels; c++) {
      loop[i * channels + c] = x[i * channels + c] * Math.sin((t * Math.PI) / 2) + x[(frames + i) * channels + c] * Math.cos((t * Math.PI) / 2);
    }
  }
  return loop;
}

await mkdir(OUT, { recursive: true });
const manifest = { padSeconds: PAD_S, records: {}, crackle: {}, sounds: {} };
const rows = [];

for (const record of RECORDS) {
  const path = await download(record.url);
  const fade = record.fadeOut ? `,afade=t=out:st=${record.length - record.fadeOut}:d=${record.fadeOut}` : '';
  const filters = `aresample=${RATE},${loudnorm(path, record.start, record.length)},afade=t=in:d=0.03${fade}`;
  const samples = decode(path, record.start, record.length, filters, 2);
  const seconds = samples.length / 2 / RATE;
  const level = lufs(samples, 2);
  const opus = await encodeCapped(record.id, samples, 2, 'opus', seconds);
  const aac = await encodeCapped(record.id, samples, 2, 'aac', seconds);
  manifest.records[record.id] = { seconds: Number(seconds.toFixed(3)), webm: opus, m4a: aac, lufs: level.integrated, truePeak: level.truePeak };
  rows.push({ name: record.id, seconds, opus, aac, note: `${level.integrated} LUFS, true peak ${level.truePeak} dBFS` });
}

for (const sound of [NEEDLE_DROP, NEEDLE_LIFT]) {
  const path = await download(sound.url);
  const filters = `aresample=${RATE},highpass=f=40,afade=t=in:d=0.003,afade=t=out:st=${sound.length - sound.fadeOut}:d=${sound.fadeOut}`;
  const x = decode(path, sound.start, sound.length, filters, 1);
  const max = x.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-9);
  const samples = x.map((v) => (v / max) * 10 ** (-3 / 20));
  const opus = { kbps: 48, bytes: await encodeAt(sound.name, samples, 1, 'opus', 48) };
  const aac = { kbps: 64, bytes: await encodeAt(sound.name, samples, 1, 'aac', 64) };
  manifest.sounds[sound.name] = { seconds: Number((samples.length / RATE).toFixed(3)), webm: opus, m4a: aac };
  rows.push({ name: sound.name, seconds: samples.length / RATE, opus, aac, note: 'one-shot, peak -3 dBFS' });
}

{
  const sound = CRACKLE;
  const path = await download(sound.url);
  const span = sound.length + sound.crossfade;
  const filters = `aresample=${RATE},highpass=f=30,${loudnorm(path, sound.start, span, 'highpass=f=30')}`;
  const x = decode(path, sound.start, span, filters, 2);
  const loop = crossfadeLoop(x, sound.length, sound.crossfade, 2);
  const samples = padded(loop, 2);
  const opus = { kbps: 40, bytes: await encodeAt(sound.name, samples, 2, 'opus', 40) };
  const aac = { kbps: 64, bytes: await encodeAt(sound.name, samples, 2, 'aac', 64) };
  manifest.crackle = { seconds: sound.length, webm: opus, m4a: aac };
  rows.push({ name: sound.name, seconds: sound.length, opus, aac, note: `loop of ten turns, ${sound.crossfade} s crossfade` });
}

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('name              seconds  webm bytes (kbit/s)  m4a bytes (kbit/s)  note');
for (const r of rows) {
  console.log(
    `${r.name.padEnd(16)} ${r.seconds.toFixed(2).padStart(8)}  ${String(r.opus.bytes).padStart(10)} (${r.opus.kbps})  ${String(r.aac.bytes).padStart(10)} (${r.aac.kbps})  ${r.note}`,
  );
}
