// Builds every sound the room plays into public/audio/, from real recordings only (no synthesis), each listed with
// its source, author and licence in blender/ASSETS.md:
//   room/   Henry Heffernan's room tone, computer, startup, keys and mouse (MIT, used with his permission): the loops
//           and clicks heard since the room got its sound.
//   music/  three stems of one lo-fi piece by holizna (CC0), cut to the same 16 bars so they loop together.
//   sfx/    one-shots for the props (CC0 field and foley recordings).
//   city/   the window's beds and events for San Francisco and Delhi (CC0 field recordings).
// Every file is mono and kept below 11 kHz (no steady top end, no hiss). Loops are loudness-normalised and carry a
// crossfade so they repeat without a seam; each sound ships as Opus in WebM plus an AAC copy (.m4a) for browsers that
// cannot decode Opus.
//
//   node scripts/media/build-audio.mjs [--only sfx/espresso-pour,sfx/oven-open]   (--only rebuilds just those files)
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { download, ffmpeg } from '../lib/media.mjs';

const OUT = new URL('../../public/audio/', import.meta.url).pathname;
const MANIFEST = new URL('../../src/scene/audio/sounds.json', import.meta.url).pathname;
const RATE = 48000;
const HENRY = 'https://raw.githubusercontent.com/henryjeff/portfolio-website/c53c5a50183655eb83d70048403a5084f5d1214c/static/audio/';
const FREESOUND = 'https://cdn.freesound.org/previews/';

// ---- room: unchanged since the room first got real sound ----

// Times in seconds within each source. The loop length moves by up to ±0.25 s to the point where the tail lines up
// best with the head, so a hum's rhythm does not flam through the crossfade.
const ROOM_LOOPS = [
  { name: 'atmosphere', url: `${HENRY}atmosphere/office.ogg`, start: 1, length: 16, crossfade: 1.5 },
  { name: 'computer', url: `${HENRY}computer/idle.wav`, start: 1, length: 14, crossfade: 1.5 },
];
const STARTUP = { name: 'startup', url: `${HENRY}startup/startup.mp3`, length: 9, fadeOut: 1.5 };
const CLICKS = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ name: `key-${n}`, url: `${HENRY}keyboard/key_${n}.mp3` })),
  { name: 'mouse-down', url: `${HENRY}mouse/mouse_down.mp3` },
  { name: 'mouse-up', url: `${HENRY}mouse/mouse_up.mp3` },
];

// ---- music: holizna's "Lofi Piano Loop 80 BPM(2)" and "Lofi Melody Loop 80 BPM" are one session (16 bars each,
// 2,284,516 samples at 48 kHz, the same chords voiced twice); his "76 BPM LOFI DRUM(2) LOOP" (exactly 32 beats at 76)
// is stretched to the same tempo and played twice to fill the 16 bars.
const KEYS = { name: 'keys', url: `${FREESOUND}629/629174_12574855-hq.mp3` };
const MELODY = { name: 'melody', url: `${FREESOUND}629/629160_12574855-hq.mp3` };
const BEAT = { name: 'beat', url: `${FREESOUND}629/629135_12574855-hq.mp3`, bars: 8 };
const MUSIC_BARS = 16;

// ---- sfx: [start, length] excerpts, peak-normalised; the runtime sets each one's level under the music ----
const SFX = [
  { name: 'espresso-brew', url: `${FREESOUND}402/402845_824371-hq.mp3`, start: 22, length: 7, fadeIn: 1, fadeOut: 1.5 },
  // The pour the espresso machine plays as it pulls a shot: the vibratory pump coming on, then the shot running.
  { name: 'espresso-pour', url: `${FREESOUND}628/628845_13885154-hq.mp3`, start: 1.25, length: 9, fadeIn: 0.05, fadeOut: 2 },
  { name: 'oven-open', url: `${FREESOUND}372/372541_3294528-hq.mp3`, start: 0, length: 0.95, fadeOut: 0.2 },
  { name: 'oven-close', url: `${FREESOUND}372/372542_3294528-hq.mp3`, start: 0, length: 0.8, fadeOut: 0.15 },
  { name: 'lava', url: `${FREESOUND}251/251454_4082287-hq.mp3`, start: 27.8, length: 0.8, fadeOut: 0.2 },
  { name: 'crt', url: `${FREESOUND}693/693860_9395330-hq.mp3`, start: 6.9, length: 1.5, fadeOut: 0.6 },
  { name: 'whoosh', url: `${FREESOUND}391/391448_7280678-hq.mp3`, start: 6.65, length: 0.95, fadeIn: 0.05, fadeOut: 0.3 },
];

// ---- beds: loops at the window (one per city, both by day) ----
const BEDS = [
  { name: 'sf', dir: 'city', parts: [{ url: `${FREESOUND}90/90636_1431924-hq.mp3`, start: 40 }], length: 22, crossfade: 2 },
  {
    name: 'delhi-day',
    dir: 'city',
    // A downtown street heard from a distance (its top end gone), under a North Indian morning's birds.
    parts: [
      { url: `${FREESOUND}34/34864_311859-hq.mp3`, start: 20, filter: 'lowpass=f=1800,lowpass=f=1800', gain: 0.5 },
      { url: `${FREESOUND}690/690626_15050538-hq.mp3`, start: 2, filter: 'highpass=f=1200', gain: 0.8 },
    ],
    length: 22,
    crossfade: 2,
  },
];

const EVENTS = [
  { name: 'foghorn', url: `${FREESOUND}140/140898_1810340-hq.mp3`, start: 0.7, length: 3.6, fadeIn: 0.2, fadeOut: 1 },
  { name: 'gulls', url: `${FREESOUND}510/510917_11157357-hq.mp3`, start: 4.5, length: 4.6, fadeIn: 0.3, fadeOut: 1 },
  { name: 'cable-car', url: `${FREESOUND}632/632753_3633951-hq.mp3`, start: 9.1, length: 2.2, fadeIn: 0.1, fadeOut: 0.8 },
  { name: 'temple-bell', url: `${FREESOUND}466/466652_9226170-hq.mp3`, start: 0.4, length: 5.6, fadeIn: 0.02, fadeOut: 2 },
];

const LOWPASS = 'lowpass=f=11000,lowpass=f=11000';
const CLEAN = `aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1,highpass=f=30,${LOWPASS}`;
const LOUDNESS = 'I=-23:TP=-2:LRA=11';
const TARGET_LUFS = -23;
const SFX_PEAK_DB = -3;
const SEARCH_S = 0.25;
const MATCH_WINDOW_S = 0.25;
// Codecs smear a file's first and last milliseconds (Opus's warm-up, AAC's priming and padding), so each loop is
// stored between copies of its own tail and head; the room loops between the exact points in sounds.json.
const LOOP_PAD_S = 0.1;

/** Two-pass loudnorm: measures the excerpt, then returns the linear correction filter for it. */
function loudnorm(path, start, length) {
  const { stderr } = ffmpeg(['-ss', String(start), '-t', String(length), '-i', path, '-af', `${CLEAN},loudnorm=${LOUDNESS}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  return `loudnorm=${LOUDNESS}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

/** Decodes an excerpt (to the end when `length` is null) to mono 48 kHz float samples through `filters`. */
function decode(path, start, length, filters) {
  const span = length === null ? [] : ['-t', String(length)];
  const { stdout } = ffmpeg(['-ss', String(start), ...span, '-i', path, '-af', filters, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1']);
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
}

/** Runs mono float samples through an ffmpeg filter chain. */
function filter(samples, filters) {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const { stdout } = ffmpeg(['-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0', '-af', filters, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], { input });
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
}

/** Integrated loudness (LUFS) of mono float samples. */
function measureLufs(samples) {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const { stderr } = ffmpeg(['-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { input });
  return Number(JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)).input_i);
}

const scale = (samples, gain) => samples.map((v) => v * gain);
/** Fades a loop's first and last few milliseconds, so a note held across the bar line cannot click at the wrap. */
const edgeFade = (samples, seconds = 0.005) => {
  const n = Math.round(seconds * RATE);
  const out = samples.slice();
  for (let i = 0; i < n; i++) {
    const g = Math.sin(((i / n) * Math.PI) / 2);
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
};
const toLufs = (samples, target = TARGET_LUFS) => scale(samples, 10 ** ((target - measureLufs(samples)) / 20));
const peakDb = (samples) => 20 * Math.log10(samples.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-9));

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

/** A loop stored between copies of its own tail and head. */
function padded(loop) {
  const pad = Math.round(LOOP_PAD_S * RATE);
  const samples = new Float32Array(loop.length + 2 * pad);
  samples.set(loop.subarray(loop.length - pad), 0);
  samples.set(loop, pad);
  samples.set(loop.subarray(0, pad), pad + loop.length);
  return samples;
}

/** The largest sample-to-sample step at the loop's wrap, as a percentile of every step inside the loop. */
function wrapPercentile(loop) {
  const steps = new Float32Array(loop.length - 1);
  for (let i = 1; i < loop.length; i++) steps[i - 1] = Math.abs(loop[i] - loop[i - 1]);
  const wrap = Math.abs(loop[0] - loop[loop.length - 1]);
  let below = 0;
  for (const s of steps) if (s < wrap) below++;
  return (100 * below) / steps.length;
}

/** Writes `<dir>/<name>.webm` (Opus) and `.m4a` (AAC) from mono float samples; returns both sizes. */
async function encode(dir, name, samples, { opus, aac }) {
  await mkdir(`${OUT}${dir}`, { recursive: true });
  const base = `${OUT}${dir}/${name}`;
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const raw = ['-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0'];
  ffmpeg([...raw, '-c:a', 'libopus', '-b:a', opus, '-vbr', 'on', '-compression_level', '10', '-application', 'audio', '-cutoff', '12000', '-map_metadata', '-1', `${base}.webm`], { input });
  ffmpeg([...raw, '-c:a', 'aac', '-b:a', aac, '-cutoff', '12000', '-map_metadata', '-1', '-movflags', '+faststart', `${base}.m4a`], { input });
  return { webm: (await stat(`${base}.webm`)).size, m4a: (await stat(`${base}.m4a`)).size };
}

const cached = (url) => download(url, decodeURIComponent(url.split('/').slice(-2).join('-')));
const fades = ({ length, fadeIn = 0.005, fadeOut = 0.02 }) => `afade=t=in:d=${fadeIn},afade=t=out:st=${Math.max(0, length - fadeOut)}:d=${fadeOut}`;

/** An excerpt, or several placed on one timeline (`at` seconds), cleaned and faded. */
async function excerpt(sound) {
  const parts = sound.parts ?? [sound];
  const placed = [];
  for (const part of parts) {
    const path = await cached(part.url);
    const highpass = part.highpass ?? sound.highpass ?? 80;
    const x = decode(path, part.start, part.length, `${CLEAN},highpass=f=${highpass},${fades(part)}`);
    placed.push({ x: scale(x, part.gain ?? 1), at: Math.round((part.at ?? 0) * RATE) });
  }
  const out = new Float32Array(Math.max(...placed.map((p) => p.at + p.x.length)));
  for (const { x, at } of placed) for (let i = 0; i < x.length; i++) out[at + i] += x[i];
  return out;
}

await mkdir(OUT, { recursive: true });
const rows = [];
const manifest = { padSeconds: LOOP_PAD_S, loops: {}, music: {} };
const row = (dir, name, seconds, note, sizes) => rows.push({ name: `${dir}/${name}`, seconds, note, ...sizes });
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const skip = (dir, name) => only !== null && !only.includes(`${dir}/${name}`);

for (const loop of ROOM_LOOPS) {
  if (skip('room', loop.name)) continue;
  const path = await cached(loop.url);
  const span = loop.length + SEARCH_S + loop.crossfade + MATCH_WINDOW_S;
  const x = decode(path, loop.start, span, `${CLEAN},${loudnorm(path, loop.start, span)}`);
  const { length, correlation } = bestLength(x, Math.round(loop.length * RATE));
  const seamless = crossfadeLoop(x, length, Math.round(loop.crossfade * RATE), correlation > 0.5);
  manifest.loops[loop.name] = length / RATE;
  row('room', loop.name, length / RATE, `loop, tail-to-head correlation ${correlation.toFixed(2)}`, await encode('room', loop.name, padded(seamless), { opus: '32k', aac: '48k' }));
}

if (!skip('room', STARTUP.name)) {
  const path = await cached(STARTUP.url);
  const fade = `afade=t=out:st=${STARTUP.length - STARTUP.fadeOut}:d=${STARTUP.fadeOut}`;
  const samples = decode(path, 0, STARTUP.length, `${CLEAN},${loudnorm(path, 0, STARTUP.length)},${fade}`);
  row('room', STARTUP.name, samples.length / RATE, 'one-shot', await encode('room', STARTUP.name, samples, { opus: '32k', aac: '48k' }));
}

// Clicks keep their recorded levels; only the silence around them (and the MP3 encoder's lead-in) is trimmed.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-60dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,afade=t=in:d=0.005,areverse';
for (const click of CLICKS) {
  if (skip('room', click.name)) continue;
  const samples = decode(await cached(click.url), 0, 1, `${CLEAN},${TRIM}`);
  row('room', click.name, samples.length / RATE, 'click', await encode('room', click.name, samples, { opus: '48k', aac: '64k' }));
}

if (!['keys', 'melody', 'beat'].every((stem) => skip('music', stem))) {
  const keys = decode(await cached(KEYS.url), 0, null, CLEAN);
  const length = keys.length;
  const melody = decode(await cached(MELODY.url), 0, null, CLEAN).slice(0, length);
  if (melody.length !== length) throw new Error(`melody is ${melody.length} samples, keys ${length}`);
  const half = length / 2;
  const source = decode(await cached(BEAT.url), 0, null, CLEAN);
  // The beat sits behind the piano as a dusty layer: its top end is rolled off above 7 kHz.
  const stretched = filter(source, `rubberband=tempo=${source.length / half}:transients=crisp:detector=percussive,lowpass=f=7000`);
  if (stretched.length < half) throw new Error(`stretched beat is ${stretched.length} samples, needs ${half}`);
  const bars = new Float32Array(half);
  bars.set(stretched.subarray(0, half));
  const beat = new Float32Array(length);
  beat.set(bars, 0);
  beat.set(bars, half);
  const seconds = length / RATE;
  manifest.music = { seconds, bpm: (MUSIC_BARS * 4 * 60) / seconds };
  for (const [name, samples, opus] of [['keys', keys, '40k'], ['melody', melody, '40k'], ['beat', beat, '36k']]) {
    const loop = edgeFade(toLufs(samples));
    const note = `stem, ${MUSIC_BARS} bars, wrap step at the ${wrapPercentile(loop).toFixed(0)}th percentile, peak ${peakDb(loop).toFixed(1)} dBFS`;
    row('music', name, seconds, note, await encode('music', name, padded(loop), { opus, aac: '64k' }));
  }
}

for (const sound of SFX) {
  if (skip('sfx', sound.name)) continue;
  const x = await excerpt(sound);
  const samples = scale(x, 10 ** ((SFX_PEAK_DB - peakDb(x)) / 20));
  row('sfx', sound.name, samples.length / RATE, 'one-shot', await encode('sfx', sound.name, samples, { opus: '40k', aac: '64k' }));
}

for (const bed of BEDS) {
  if (skip(bed.dir, bed.name)) continue;
  const span = bed.length + SEARCH_S + bed.crossfade + MATCH_WINDOW_S;
  let mixed = null;
  for (const part of bed.parts) {
    const x = decode(await cached(part.url), part.start, span, `${CLEAN},highpass=f=60${part.filter ? `,${part.filter}` : ''}`);
    const scaled = scale(toLufs(x), part.gain ?? 1);
    mixed = mixed ? mixed.map((v, i) => v + (scaled[i] ?? 0)) : scaled;
  }
  const x = toLufs(mixed);
  const { length, correlation } = bestLength(x, Math.round(bed.length * RATE));
  const seamless = crossfadeLoop(x, length, Math.round(bed.crossfade * RATE), correlation > 0.5);
  manifest.loops[bed.name] = length / RATE;
  row(bed.dir, bed.name, length / RATE, `loop, tail-to-head correlation ${correlation.toFixed(2)}`, await encode(bed.dir, bed.name, padded(seamless), { opus: '28k', aac: '48k' }));
}

for (const event of EVENTS) {
  if (skip('city', event.name)) continue;
  const x = await excerpt(event);
  const samples = scale(x, 10 ** ((SFX_PEAK_DB - peakDb(x)) / 20));
  row('city', event.name, samples.length / RATE, 'event', await encode('city', event.name, samples, { opus: '32k', aac: '48k' }));
}

// A partial build leaves the loop lengths as they are.
if (!only) await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('name                 seconds  webm (Opus)  m4a (AAC)  note');
for (const r of rows) {
  console.log(`${r.name.padEnd(19)} ${r.seconds.toFixed(3).padStart(8)}  ${String(r.webm).padStart(11)}  ${String(r.m4a).padStart(9)}  ${r.note}`);
}
const total = (dir, key) => rows.filter((r) => !dir || r.name.startsWith(`${dir}/`)).reduce((sum, r) => sum + r[key], 0);
for (const dir of ['room', 'music', 'sfx', 'city', '']) console.log(`${dir || 'all'} bytes: webm ${total(dir, 'webm')}, m4a ${total(dir, 'm4a')}`);
