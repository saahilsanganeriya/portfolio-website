// Builds the room's sound in public/room/audio/ from real recordings: Henry Heffernan's (MIT, used with his
// permission) and one CC0 Super 8 projector recording. Every file is mono and kept below 11 kHz (no steady top end,
// no hiss); loops and the startup are loudness-normalised with ffmpeg's loudnorm, and each loop carries a baked
// crossfade so it repeats without a seam. Each sound ships as Opus in WebM, plus an AAC copy (.m4a) for browsers
// that cannot decode Opus. Sources and changes are listed in blender/ASSETS.md.
//
//   node scripts/media/build-audio.mjs
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { download, ffmpeg } from '../lib/media.mjs';

const OUT = new URL('../../public/room/audio/', import.meta.url).pathname;
const MANIFEST = new URL('../../src/scene/Application/loops.json', import.meta.url).pathname;
const RATE = 48000;
const HENRY = 'https://raw.githubusercontent.com/henryjeff/portfolio-website/c53c5a50183655eb83d70048403a5084f5d1214c/static/audio/';

// Times in seconds within each source. The loop length moves by up to ±0.25 s to the point where the tail lines up
// best with the head, so a hum or a shutter's rhythm does not flam through the crossfade.
const LOOPS = [
  { name: 'atmosphere', url: `${HENRY}atmosphere/office.ogg`, start: 1, length: 16, crossfade: 1.5 },
  { name: 'computer', url: `${HENRY}computer/idle.wav`, start: 1, length: 14, crossfade: 1.5 },
  { name: 'projector', url: 'https://cdn.freesound.org/previews/241/241886_1130120-hq.ogg', start: 40, length: 12, crossfade: 1 },
];
const STARTUP = { name: 'startup', url: `${HENRY}startup/startup.mp3`, length: 9, fadeOut: 1.5 };
const CLICKS = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ name: `key-${n}`, url: `${HENRY}keyboard/key_${n}.mp3` })),
  { name: 'mouse-down', url: `${HENRY}mouse/mouse_down.mp3` },
  { name: 'mouse-up', url: `${HENRY}mouse/mouse_up.mp3` },
];

const CLEAN = 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1,highpass=f=30,lowpass=f=11000,lowpass=f=11000';
const LOUDNESS = 'I=-23:TP=-2:LRA=11';
const SEARCH_S = 0.25;
const MATCH_WINDOW_S = 0.25;
// Codecs smear a file's first and last milliseconds (Opus's warm-up, AAC's priming and padding), so each loop is
// stored between copies of its own tail and head; the room loops between the exact points in loops.json.
const LOOP_PAD_S = 0.1;

/** Two-pass loudnorm: measures the excerpt, then returns the linear correction filter for it. */
function loudnorm(path, start, length) {
  const { stderr } = ffmpeg(['-ss', String(start), '-t', String(length), '-i', path, '-af', `${CLEAN},loudnorm=${LOUDNESS}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  return `loudnorm=${LOUDNESS}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

/** Decodes an excerpt to mono 48 kHz float samples through `filters`. */
function decode(path, start, length, filters) {
  const { stdout } = ffmpeg(['-ss', String(start), '-t', String(length), '-i', path, '-af', filters, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1']);
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
}

/** The loop length near `nominal` samples whose following samples correlate best with the loop's head. */
function bestLength(x, nominal) {
  const window = Math.round(MATCH_WINDOW_S * RATE);
  const span = Math.round(SEARCH_S * RATE);
  let headEnergy = 0;
  for (let i = 0; i < window; i++) headEnergy += x[i] * x[i];
  let best = { length: nominal, correlation: -Infinity };
  for (let length = nominal - span; length <= nominal + span; length++) {
    let dot = 0;
    let tailEnergy = 0;
    for (let i = 0; i < window; i++) {
      const tail = x[length + i];
      dot += x[i] * tail;
      tailEnergy += tail * tail;
    }
    const correlation = dot / Math.sqrt(headEnergy * tailEnergy + 1e-20);
    if (correlation > best.correlation) best = { length, correlation };
  }
  return best;
}

/** `length` samples that repeat seamlessly: the head fades in over the samples that follow the loop's end. */
function crossfadeLoop(x, length, fade, linear) {
  const out = x.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    // Correlated tails sum in amplitude (equal gain); uncorrelated ones in power (equal power).
    const fadeIn = linear ? t : Math.sin((t * Math.PI) / 2);
    const fadeOut = linear ? 1 - t : Math.cos((t * Math.PI) / 2);
    out[i] = x[i] * fadeIn + x[length + i] * fadeOut;
  }
  return out;
}

/** Writes `<name>.webm` (Opus) and `<name>.m4a` (AAC) from mono float samples; returns both sizes. */
async function encode(name, samples, { opus, aac }) {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const raw = ['-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0'];
  ffmpeg([...raw, '-c:a', 'libopus', '-b:a', opus, '-vbr', 'on', '-compression_level', '10', '-application', 'audio', '-cutoff', '12000', '-map_metadata', '-1', `${OUT}${name}.webm`], { input });
  ffmpeg([...raw, '-c:a', 'aac', '-b:a', aac, '-cutoff', '12000', '-map_metadata', '-1', '-movflags', '+faststart', `${OUT}${name}.m4a`], { input });
  return { webm: (await stat(`${OUT}${name}.webm`)).size, m4a: (await stat(`${OUT}${name}.m4a`)).size };
}

await mkdir(OUT, { recursive: true });
const rows = [];
const manifest = { padSeconds: LOOP_PAD_S, seconds: {} };

for (const loop of LOOPS) {
  const path = await download(loop.url, `${loop.name}-${decodeURIComponent(loop.url.split('/').pop())}`);
  const excerpt = loop.length + SEARCH_S + loop.crossfade + MATCH_WINDOW_S;
  const x = decode(path, loop.start, excerpt, `${CLEAN},${loudnorm(path, loop.start, excerpt)}`);
  const { length, correlation } = bestLength(x, Math.round(loop.length * RATE));
  const seamless = crossfadeLoop(x, length, Math.round(loop.crossfade * RATE), correlation > 0.5);
  const pad = Math.round(LOOP_PAD_S * RATE);
  const samples = new Float32Array(length + 2 * pad);
  samples.set(seamless.subarray(length - pad), 0);
  samples.set(seamless, pad);
  samples.set(seamless.subarray(0, pad), pad + length);
  manifest.seconds[loop.name] = length / RATE;
  const sizes = await encode(loop.name, samples, { opus: '32k', aac: '48k' });
  rows.push({ name: loop.name, seconds: length / RATE, note: `loop, tail-to-head correlation ${correlation.toFixed(2)}`, ...sizes });
}

{
  const path = await download(STARTUP.url, `startup-${STARTUP.url.split('/').pop()}`);
  const fade = `afade=t=out:st=${STARTUP.length - STARTUP.fadeOut}:d=${STARTUP.fadeOut}`;
  const samples = decode(path, 0, STARTUP.length, `${CLEAN},${loudnorm(path, 0, STARTUP.length)},${fade}`);
  rows.push({ name: STARTUP.name, seconds: samples.length / RATE, note: 'one-shot', ...(await encode(STARTUP.name, samples, { opus: '32k', aac: '48k' })) });
}

// Clicks keep their recorded levels; only the silence around them (and the MP3 encoder's lead-in) is trimmed.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-60dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,afade=t=in:d=0.005,areverse';
for (const click of CLICKS) {
  const path = await download(click.url, `click-${click.url.split('/').pop()}`);
  const samples = decode(path, 0, 1, `${CLEAN},${TRIM}`);
  rows.push({ name: click.name, seconds: samples.length / RATE, note: 'click', ...(await encode(click.name, samples, { opus: '48k', aac: '64k' })) });
}

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('name          seconds  webm (Opus)  m4a (AAC)  note');
for (const r of rows) {
  console.log(`${r.name.padEnd(12)} ${r.seconds.toFixed(3).padStart(8)}  ${String(r.webm).padStart(11)}  ${String(r.m4a).padStart(9)}  ${r.note}`);
}
const total = (key) => rows.reduce((sum, r) => sum + r[key], 0);
console.log(`total bytes: webm ${total('webm')}, m4a ${total('m4a')}`);
