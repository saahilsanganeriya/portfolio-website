// The record crate beside the armchair: four records the visitor can put on, each a whole piece (or, for the rāga, the
// opening of one) under CC0 or CC BY 4.0, streamed only when chosen, and a fifth that plays on the monitor through
// Spotify's player (NOW_PLAYING, below). The sleeves are drawn here, typographic and graphic in the room's palette; no
// cover art is copied. Sources and licences are also in blender/ASSETS.md (Credits).
import built from './records.json';

export type RecordId = 'washed-up' | 'night-in-venice' | 'cylinder-five' | 'raga-kiravani';

export interface CrateRecord {
  id: RecordId;
  title: string;
  artist: string;
  /** What the crate's label says it is. */
  genre: string;
  /** One line on the sleeve's back: the album, the recording, the year. */
  detail: string;
  licence: 'CC0 1.0' | 'CC BY 4.0';
  licenceUrl: string;
  sourceUrl: string;
  /** The credit a CC BY licence asks for, in the artist's own format; CC0 records are credited too, by choice. */
  credit: string;
  /** Seconds as built (the rāga is an excerpt). */
  seconds: number;
}

const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';

export const CRATE: readonly CrateRecord[] = [
  {
    id: 'washed-up',
    title: 'Washed Up',
    artist: 'HoliznaCC0',
    genre: 'Lo-fi',
    detail: 'from Ocean Memory (Lo-fi Chill)',
    licence: 'CC0 1.0',
    licenceUrl: CC0,
    sourceUrl: 'https://freemusicarchive.org/music/holiznacc0/ocean-memory-lo-fi-chill/washed-up/',
    credit: '“Washed Up” by HoliznaCC0, from Ocean Memory (Lo-fi Chill), CC0 1.0',
    seconds: built.records['washed-up'].seconds,
  },
  {
    id: 'night-in-venice',
    title: 'Night in Venice',
    artist: 'Kevin MacLeod',
    genre: 'Jazz',
    detail: 'alto sax, electric piano, bass and drums; 2020',
    licence: 'CC BY 4.0',
    licenceUrl: CC_BY,
    sourceUrl: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900056',
    credit: '“Night in Venice” Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0',
    seconds: built.records['night-in-venice'].seconds,
  },
  {
    id: 'cylinder-five',
    title: 'Cylinder Five',
    artist: 'Chris Zabriskie',
    genre: 'Film score',
    detail: 'from Cylinders; 2014',
    licence: 'CC BY 4.0',
    licenceUrl: CC_BY,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Chris_Zabriskie_-_05_-_Cylinder_Five.ogg',
    credit: '“Cylinder Five” by Chris Zabriskie, from Cylinders, licensed under Creative Commons Attribution 4.0 (chriszabriskie.com)',
    seconds: built.records['cylinder-five'].seconds,
  },
  {
    id: 'raga-kiravani',
    title: 'Rāga Kīravāṇi',
    artist: 'L. Ramakrishnan',
    genre: 'Carnatic veena',
    detail: 'the opening of an ālāpana; recorded in Portland, Oregon, 2004',
    licence: 'CC0 1.0',
    licenceUrl: CC0,
    sourceUrl: 'https://archive.org/details/LR_kIravANI',
    credit: '“Rāga Kīravāṇi” by L. Ramakrishnan (veena), the first 4 min 38 s, CC0 1.0',
    seconds: built.records['raga-kiravani'].seconds,
  },
];

export const recordById = (id: string) => CRATE.find((record) => record.id === id) ?? null;

// ---- the one record the site does not host ----
// Max Richter's recording is copyrighted, so nothing of it is hosted or downloaded here: its sleeve opens SaahilOS's
// Now Playing window, which loads Spotify's own player. Nothing loads from Spotify before the sleeve is chosen.

export interface NowPlayingRecord {
  id: 'nature-of-daylight';
  title: string;
  artist: string;
  /** Seconds, as Spotify lists the track. */
  seconds: number;
  /** The SaahilOS window the sleeve opens. */
  window: 'now-playing';
  /**
   * Spotify's player for the track. The id was checked on 2026-10-18 through Spotify's oEmbed endpoint and its embed
   * data: artist spotify:artist:2VZNmg4vCnew4Pavo8zDdW (the profile maxrichtermusic.com links), the 2004 recording by
   * Louisa Fuller, Natalia Bonner, John Metcalfe, Philip Sheppard and Chris Worsey, 6:11, Deutsche Grammophon's edition.
   */
  embedUrl: string;
  /** The track's own page on Spotify. */
  sourceUrl: string;
  /** The window's one line: what it is. */
  line: string;
  /** The crate's credit line. */
  credit: string;
}

export const NOW_PLAYING: NowPlayingRecord = {
  id: 'nature-of-daylight',
  title: 'On the Nature of Daylight',
  artist: 'Max Richter',
  seconds: 372,
  window: 'now-playing',
  embedUrl: 'https://open.spotify.com/embed/track/5DFUsGW4Cmltv8Spd0u1aV',
  sourceUrl: 'https://open.spotify.com/track/5DFUsGW4Cmltv8Spd0u1aV',
  line: 'Max Richter, “On the Nature of Daylight”, from The Blue Notebooks (2004). Arrival (2016) opens and closes with it.',
  credit: '“On the Nature of Daylight” by Max Richter, from The Blue Notebooks (2004), streamed by Spotify’s player',
};

export type SleeveId = RecordId | NowPlayingRecord['id'];

// ---- the sleeves: 100 × 100 SVG, drawn from the room's palette ----
// Roman 400 faces only: an italic or a heavier weight would be one more font file (25-105 KB) loaded with the crate.

const INK = '#14110f';
const WALNUT = '#3b2a1e';
const PAPER = '#ede4d3';
const DUST = '#a89f91';
const THREAD = '#b4442c';
const PROJECTOR = '#9db4c0';
const MANGO = '#c98a2b';
const SERIF = "font-family=\"'Newsreader Variable', Georgia, serif\"";
const SANS = "font-family=\"'IBM Plex Sans', Arial, sans-serif\"";
const MONO = "font-family=\"'IBM Plex Mono', Menlo, monospace\"";

const wave = (y: number, amplitude: number, phase: number) => {
  let d = `M0 ${y.toFixed(1)}`;
  for (let x = 2; x <= 100; x += 2) d += ` L${x} ${(y + amplitude * Math.sin(x / 7 + phase)).toFixed(2)}`;
  return d;
};

// Each sleeve answers to its record: tide lines for the lo-fi ocean, a moon over stacked caps for the late-night jazz,
// a cylinder's rings for the film score, the veena's resonator and seven strings for the rāga.
const SLEEVES: Record<RecordId, () => string> = {
  'washed-up': () => `
    <rect width="100" height="100" fill="${PAPER}"/>
    <circle cx="76" cy="24" r="9" fill="${THREAD}"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="${wave(44 + i * 6, 2.4 - i * 0.28, i * 0.9)}" fill="none" stroke="${WALNUT}" stroke-width="${(1.3 - i * 0.12).toFixed(2)}"/>`).join('')}
    <text x="8" y="14" ${MONO} font-size="4.6" letter-spacing="0.6" fill="${WALNUT}">HOLIZNA · LO-FI</text>
    <text x="8" y="92" ${SERIF} font-size="13" fill="${INK}">washed up</text>`,
  'night-in-venice': () => `
    <rect width="100" height="100" fill="${INK}"/>
    <circle cx="96" cy="30" r="22" fill="${THREAD}"/>
    <line x1="8" y1="58" x2="92" y2="58" stroke="${PAPER}" stroke-width="0.5"/>
    <text ${SANS} fill="${PAPER}" font-size="17" letter-spacing="-0.4">
      <tspan x="7" y="76">NIGHT IN</tspan><tspan x="7" y="92">VENICE</tspan></text>
    <text x="8" y="14" ${MONO} font-size="4.6" letter-spacing="0.6" fill="${DUST}">KEVIN MACLEOD</text>
    <text x="8" y="52" ${MONO} font-size="4.2" letter-spacing="0.6" fill="${DUST}">JAZZ · 114 BPM</text>`,
  'cylinder-five': () => `
    <rect width="100" height="100" fill="${WALNUT}"/>
    ${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="50" cy="${30 + i * 7}" rx="30" ry="${(8 - i * 0.6).toFixed(1)}" fill="none" stroke="${PROJECTOR}" stroke-width="${i === 4 ? 1.4 : 0.6}"/>`).join('')}
    <line x1="20" y1="30" x2="20" y2="58" stroke="${PROJECTOR}" stroke-width="0.6"/>
    <line x1="80" y1="30" x2="80" y2="58" stroke="${PROJECTOR}" stroke-width="0.6"/>
    <text x="8" y="14" ${MONO} font-size="4.6" letter-spacing="0.6" fill="${DUST}">CHRIS ZABRISKIE</text>
    <text x="8" y="86" ${SERIF} font-size="12.5" fill="${PAPER}">Cylinder Five</text>
    <text x="8" y="93" ${MONO} font-size="3.8" letter-spacing="0.6" fill="${DUST}">FROM CYLINDERS · 2014</text>`,
  'raga-kiravani': () => `
    <rect width="100" height="100" fill="${MANGO}"/>
    <path d="M42 100 A30 30 0 0 1 102 100 Z" fill="${PAPER}"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<line x1="${60 + i * 4}" y1="8" x2="${60 + i * 4}" y2="100" stroke="${INK}" stroke-width="${i < 4 ? 0.7 : 0.4}"/>`).join('')}
    <text x="8" y="14" ${MONO} font-size="4.6" letter-spacing="0.6" fill="${INK}">VEENA</text>
    <text x="8" y="40" ${SERIF} font-size="11" fill="${INK}"><tspan x="8">Rāga</tspan><tspan x="8" dy="11">Kīravāṇi</tspan></text>
    <text x="8" y="62" ${MONO} font-size="3.8" letter-spacing="0.5" fill="${WALNUT}">L. RAMAKRISHNAN</text>`,
};

// The streamed record: a blue notebook's ruled page with its red margin, and daylight coming up over the horizon.
const NOW_PLAYING_SLEEVE = () => `
    <rect width="100" height="100" fill="${PROJECTOR}"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<line x1="0" y1="${23 + i * 11}" x2="100" y2="${23 + i * 11}" stroke="${INK}" stroke-width="${i === 3 ? 0.8 : 0.25}"/>`).join('')}
    <path d="M54 56 A16 16 0 0 1 86 56 Z" fill="${PAPER}"/>
    <line x1="15" y1="0" x2="15" y2="100" stroke="${THREAD}" stroke-width="0.7"/>
    <text x="19" y="14" ${MONO} font-size="4.6" letter-spacing="0.6" fill="${INK}">MAX RICHTER</text>
    <text ${SERIF} font-size="11" fill="${INK}"><tspan x="19" y="78">On the Nature</tspan><tspan x="19" y="89">of Daylight</tspan></text>
    <text x="19" y="97" ${MONO} font-size="3.6" letter-spacing="0.5" fill="${WALNUT}">THE BLUE NOTEBOOKS · 2004</text>`;

/** The record's sleeve as an inline SVG (decorative: the button around it carries the name). */
export const sleeveSvg = (id: SleeveId) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${id === NOW_PLAYING.id ? NOW_PLAYING_SLEEVE() : SLEEVES[id]()}</svg>`;

/** "3:38" */
export const duration = (seconds: number) => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
