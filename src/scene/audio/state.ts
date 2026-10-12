// The adaptive part of the room's sound, as plain data and pure functions: which state the visitor is in, what the
// music does in each, the two cities' local day and night, the remembered volume, and the shape of every fade.

/** What the visitor is doing, as far as the sound cares. */
export type AudioState = 'room' | 'projector' | 'os' | 'story' | 'window';
export const AUDIO_STATES: readonly AudioState[] = ['room', 'projector', 'os', 'story', 'window'];

/**
 * The state for the framing the camera rests at or flies to, and SaahilOS's front window (the monitor's hash).
 * Films is the projector's music wherever it is watched; The Thread is the calm one; any other window is the OS.
 */
export function stateFor(station: string, frontWindow: string): AudioState {
  if (station === 'projector') return 'projector';
  if (station === 'window') return 'window';
  if (station !== 'monitor') return 'room';
  const app = frontWindow.split('/')[0];
  if (app === 'films') return 'projector';
  if (app === 'story') return 'story';
  return 'os';
}

/** The three stems of one lo-fi piece, cut to the same 16 bars so they loop together. */
export type Stem = 'keys' | 'melody' | 'beat';
export const STEMS: readonly Stem[] = ['keys', 'melody', 'beat'];

export interface MusicMix {
  /** Linear gain of each stem. */
  stems: Record<Stem, number>;
  /** Linear gain of the whole music bus. */
  level: number;
  /** Low-pass cutoff on the music bus, Hz (the files stop at 11 kHz, so 11000 is open). */
  cutoff: number;
  /** How far the window's city beds come forward (1 = the window framing). */
  city: number;
}

// The room plays piano and beat; the projector trades the beat for the melody stem, like an accompanist under a film;
// the monitor muffles the room's mix; The Thread drops the beat and settles; the window lets the cities in.
export const MUSIC_MIX: Record<AudioState, MusicMix> = {
  room: { stems: { keys: 1, melody: 0, beat: 0.8 }, level: 1, cutoff: 11000, city: 0.25 },
  projector: { stems: { keys: 0.75, melody: 0.95, beat: 0 }, level: 0.8, cutoff: 11000, city: 0.15 },
  os: { stems: { keys: 1, melody: 0, beat: 0.7 }, level: 0.85, cutoff: 1400, city: 0.1 },
  story: { stems: { keys: 0.85, melody: 0, beat: 0 }, level: 0.7, cutoff: 2600, city: 0.1 },
  window: { stems: { keys: 0.8, melody: 0, beat: 0.5 }, level: 0.7, cutoff: 7000, city: 1 },
};

/** Seconds a state change takes; filters move a little faster than levels. */
export const STATE_FADE_S = 2.8;
export const FILTER_FADE_S = 1.6;

// ---- the two cities outside the window ----

export type City = 'sf' | 'delhi';
export const CITY_ZONES: Record<City, string> = { sf: 'America/Los_Angeles', delhi: 'Asia/Kolkata' };
const DAWN_H = 6;
const DUSK_H = 19;
const TWILIGHT_H = 0.75;

/** The hour of day (0–24, fractional) in a time zone. */
export function localHour(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value('hour') + value('minute') / 60;
}

/** 1 by day, 0 by night, eased across 45 minutes either side of 06:00 and 19:00 local time. */
export function dayWeight(hour: number): number {
  const ramp = (centre: number) => {
    const t = Math.min(1, Math.max(0, (hour - (centre - TWILIGHT_H)) / (2 * TWILIGHT_H)));
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  };
  return ramp(DAWN_H) * (1 - ramp(DUSK_H));
}

export const cityDay = (city: City, date: Date) => dayWeight(localHour(CITY_ZONES[city], date));

// ---- the visitor's remembered volume ----

export interface SoundSettings {
  /** 0–1, the slider's position. */
  volume: number;
  muted: boolean;
}
export const DEFAULT_SETTINGS: SoundSettings = { volume: 1, muted: false };
export const SETTINGS_KEY = 'room-sound';

/** The remembered settings; anything missing or malformed falls back to the defaults. */
export function readSettings(storage: Pick<Storage, 'getItem'> | null): SoundSettings {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    const { volume, muted } = raw as Partial<Record<keyof SoundSettings, unknown>>;
    return {
      volume: typeof volume === 'number' && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_SETTINGS.volume,
      muted: typeof muted === 'boolean' ? muted : DEFAULT_SETTINGS.muted,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(storage: Pick<Storage, 'setItem'> | null, settings: SoundSettings) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // private browsing or a full quota: the setting lasts for this visit only
  }
}

/** The slider is a loudness control: its square is the gain, so half way is about −12 dB. */
export const volumeGain = (volume: number) => volume * volume;

// ---- fades with weight ----

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * A gain fade that moves power, not amplitude, along a smootherstep: it leaves and lands at rest, and two stems
 * crossfading this way (one to 0, one from 0) keep their summed power constant.
 */
export function powerCurve(from: number, to: number, steps = 64): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const s = smootherstep(i / (steps - 1));
    curve[i] = Math.sqrt(from * from + (to * to - from * from) * s);
  }
  return curve;
}

/** A filter sweep along a smootherstep in log frequency, so each octave takes the same time. */
export function logCurve(from: number, to: number, steps = 64): Float32Array {
  const curve = new Float32Array(steps);
  const a = Math.log(Math.max(1, from));
  const b = Math.log(Math.max(1, to));
  for (let i = 0; i < steps; i++) curve[i] = Math.exp(a + (b - a) * smootherstep(i / (steps - 1)));
  return curve;
}
