// Builds public/room/reel.mp4, the silent reel the room's projector plays: public-domain early cinema from
// Wikimedia Commons, cut to the timeline in src/scene/reel.json. Card segments are black in the video; the room
// draws its intertitle cards over them at runtime (one is the newest Letterboxd diary entry). The clips are
// denoised and grey, because the room adds its own grain, flicker and gate weave. Sources are in blender/ASSETS.md.
//
//   node scripts/media/build-reel.mjs [--crf 30]
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { CACHE, download, ffmpeg } from '../lib/media.mjs';

const OUT = new URL('../../public/room/reel.mp4', import.meta.url).pathname;
const timeline = JSON.parse(await readFile(new URL('../../src/scene/reel.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const crf = args.includes('--crf') ? args[args.indexOf('--crf') + 1] : '30';

const WIDTH = 320;
const HEIGHT = 240;
const FPS = 18;
const FADE_S = 0.25;
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';

// `from` is the in-point in the source (s); `crop` keeps the 4:3 picture inside the source frame.
const CLIPS = {
  train: {
    url: `${COMMONS}1/1a/Arrival_of_a_Train_at_La_Ciotat_%28The_Lumi%C3%A8re_Brothers%2C_1895%29.webm`,
    from: 4,
    crop: 'crop=448:336:43:12',
  },
  factory: {
    url: `${COMMONS}transcoded/0/09/La_Sortie_de_l%27Usine_Lumi%C3%A8re_%C3%A0_Lyon_I_1895.webm/La_Sortie_de_l%27Usine_Lumi%C3%A8re_%C3%A0_Lyon_I_1895.webm.480p.vp9.webm`,
    from: 1,
    crop: 'crop=iw:ih',
  },
  moon: {
    url: `${COMMONS}transcoded/6/6d/Le_Voyage_dans_la_Lune_%281902%29.webm/Le_Voyage_dans_la_Lune_%281902%29.webm.480p.vp9.webm`,
    from: 364,
    crop: 'crop=iw:ih',
  },
};

let previousEnd = 0;
const parts = [];
for (const [i, segment] of timeline.segments.entries()) {
  if (segment.start !== previousEnd) throw new Error(`reel.json: segment ${i} starts at ${segment.start}, not ${previousEnd}`);
  previousEnd = segment.end;
  const seconds = segment.end - segment.start;
  const part = `${CACHE}reel-part-${i}.mkv`;
  if (segment.clip) {
    const clip = CLIPS[segment.clip];
    const source = await download(clip.url, `reel-${segment.clip}.webm`);
    const video = [
      clip.crop,
      `scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
      `fps=${FPS}`,
      'format=gray',
      'hqdn3d=3:2:4:3',
      'normalize=blackpt=black:whitept=white:smoothing=36:strength=0.8',
      `fade=t=in:st=0:d=${FADE_S}`,
      `fade=t=out:st=${seconds - FADE_S}:d=${FADE_S}`,
      'format=yuv420p',
    ].join(',');
    ffmpeg(['-ss', String(clip.from), '-t', String(seconds), '-i', source, '-vf', video, '-an', '-c:v', 'ffv1', part]);
  } else {
    ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${seconds}`, '-vf', 'format=yuv420p', '-c:v', 'ffv1', part]);
  }
  parts.push(part);
}
if (previousEnd !== timeline.duration) throw new Error(`reel.json: segments end at ${previousEnd}, duration says ${timeline.duration}`);

const list = `${CACHE}reel-parts.txt`;
await writeFile(list, parts.map((p) => `file '${p}'`).join('\n'));
ffmpeg([
  '-f', 'concat', '-safe', '0', '-i', list,
  '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'film', '-crf', crf, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-g', String(FPS * 2), '-r', String(FPS), '-an', '-map_metadata', '-1', '-movflags', '+faststart', OUT,
]);
await Promise.all([list, ...parts].map((p) => rm(p)));

const { stderr } = ffmpeg(['-i', OUT, '-f', 'null', '-']);
const duration = stderr.match(/time=(\d+:\d+:[\d.]+)/g)?.at(-1);
console.log(`reel: ${OUT}`);
console.log(`bytes: ${(await stat(OUT)).size} (crf ${crf}, ${WIDTH}x${HEIGHT}, ${FPS} fps, decoded ${duration})`);
