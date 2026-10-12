import * as THREE from 'three';
import loops from './loops.json';
import { WORLD_SCALE } from './RoomModel';

// The room's sound is recorded, not synthesised: Henry Heffernan's room tone, computer, keyboard, mouse and startup
// recordings (MIT, used with his permission) and one CC0 Super 8 projector, built by scripts/media/build-audio.mjs
// (mono, below 11 kHz, loudness-normalised to -23 LUFS). Henry's mapping from camera distance to a low-pass filter
// stays: the room tone muffles as you lean into the monitor, and each machine is clearer the closer you are.

const AUDIO_URL = '/room/audio/';
const LOOPS = ['atmosphere', 'computer', 'projector'] as const;
const KEYS = ['key-1', 'key-2', 'key-3', 'key-4', 'key-5', 'key-6'] as const;
const SHOTS = ['startup', ...KEYS, 'mouse-down', 'mouse-up'] as const;
type LoopName = (typeof LOOPS)[number];
type SoundName = LoopName | (typeof SHOTS)[number];
export type ClickKind = 'key' | 'mouse-down' | 'mouse-up';

// Linear gains on the -23 LUFS files: the ambience sits near -30 dBFS RMS, clicks at their recorded level, and the
// projector is heard only up close (it falls off with the square of distance) or while Films is the front window.
const ROOM_TONE = 0.4;
const COMPUTER = 0.35;
const PROJECTOR_NEAR = 0.7;
const PROJECTOR_FILMS = 0.45;
const STARTUP = 0.45;
const CLICK = 0.8;
const LOOP_FADE_S = 1.5;
const OFFLINE_RATE = 48000;

/** Where the sound comes from (world units) and where Henry's room tone is measured from. */
export interface SoundPositions {
  crt: THREE.Vector3;
  projector: THREE.Vector3 | null;
  desk: THREE.Vector3;
}

/** What the mix needs of a camera. */
export type Listener = Pick<THREE.Camera, 'position' | 'matrixWorldInverse'>;

interface Source {
  position: THREE.Vector3;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  /** Full volume at this distance (metres) and nearer. */
  near: number;
  volume: number;
  /** 1: gain falls with distance; 2: with its square. */
  rolloff: number;
}

const map = (v: number, a: number, b: number, c: number, d: number) => c + ((d - c) * (v - a)) / (b - a);
const clamp = THREE.MathUtils.clamp;

/** The mix on any audio context, live or offline: positional filters and gains, loops and one-shots. */
class RoomMix {
  readonly output: GainNode;
  private readonly room: { filter: BiquadFilterNode; gain: GainNode };
  private readonly computer: Source;
  private readonly projector: Source | null;
  private readonly desk: Source;
  private readonly local = new THREE.Vector3();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly positions: SoundPositions,
  ) {
    this.output = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(this.output);
    this.room = { filter, gain };
    this.computer = this.source(positions.crt, 0.5, COMPUTER, 1);
    this.projector = positions.projector ? this.source(positions.projector, 0.6, PROJECTOR_NEAR, 2) : null;
    this.desk = this.source(positions.desk, 0.6, CLICK, 1);
  }

  loop(name: LoopName, buffer: AudioBuffer, when = this.ctx.currentTime) {
    const input = { atmosphere: this.room.filter, computer: this.computer.filter, projector: this.projector?.filter }[name];
    if (!input) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    // Each file holds its loop between copies of the loop's tail and head (scripts/media/build-audio.mjs).
    source.loop = true;
    source.loopStart = loops.padSeconds;
    source.loopEnd = loops.padSeconds + loops.seconds[name];
    const fade = this.ctx.createGain();
    fade.gain.setValueAtTime(0, when);
    fade.gain.linearRampToValueAtTime(1, when + LOOP_FADE_S);
    source.connect(fade).connect(input);
    source.start(when, loops.padSeconds);
  }

  startup(buffer: AudioBuffer, when = this.ctx.currentTime) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = STARTUP;
    source.connect(gain).connect(this.output);
    source.start(when);
  }

  /** A key or mouse-button click at the desk, pitched a hair differently each time. */
  click(buffer: AudioBuffer, when = this.ctx.currentTime) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.97 + Math.random() * 0.06;
    source.connect(this.desk.filter);
    source.start(when);
  }

  /** Re-maps filters and gains from the listener; `immediate` jumps instead of gliding (offline renders). */
  update(listener: Listener, filmsOpen: boolean, immediate = false) {
    const t = this.ctx.currentTime;
    const set = (param: AudioParam, value: number) =>
      immediate ? param.setValueAtTime(value, t) : param.setTargetAtTime(value, t, 0.15);

    // Henry's mapping, in metres: muffled at the monitor, open from across the room.
    const d = listener.position.distanceTo(this.positions.desk) / WORLD_SCALE;
    set(this.room.filter.frequency, clamp(map(d, 0, 2.7, 100, 22000) - 3000, 120, 20000));
    set(this.room.gain.gain, (ROOM_TONE * clamp(map(d, 0.32, 2.7, 0, 0.2), 0.05, 0.1)) / 0.1);

    for (const s of [this.computer, this.projector, this.desk]) {
      if (!s) continue;
      const distance = Math.max(0.05, listener.position.distanceTo(s.position) / WORLD_SCALE);
      let cutoff = clamp(18000 * Math.pow(s.near / distance, 1.6), 180, 18000);
      let gain = s.volume * Math.pow(Math.min(1, s.near / distance), s.rolloff);
      if (s === this.projector && filmsOpen) {
        gain = Math.max(gain, PROJECTOR_FILMS);
        cutoff = Math.max(cutoff, 6000);
      }
      set(s.filter.frequency, cutoff);
      set(s.gain.gain, gain);
      this.local.copy(s.position).applyMatrix4(listener.matrixWorldInverse);
      set(s.pan.pan, clamp(this.local.x / Math.max(1, this.local.length()), -1, 1) * 0.7);
    }
  }

  private source(position: THREE.Vector3, near: number, volume: number, rolloff: number): Source {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    const pan = this.ctx.createStereoPanner();
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    filter.connect(pan).connect(gain).connect(this.output);
    return { position, filter, gain, pan, near, volume, rolloff };
  }
}

/** Opus where the browser decodes it, AAC otherwise; a file that fails to decode falls back to the next format. */
const formats = () =>
  typeof Audio !== 'undefined' && new Audio().canPlayType('audio/webm; codecs="opus"') ? ['webm', 'm4a'] : ['m4a'];

export class RoomAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mix: RoomMix | null = null;
  private readonly buffers: Partial<Record<SoundName, AudioBuffer>> = {};
  private loaded: Promise<void> | null = null;
  private muted = false;
  private lastUpdate = 0;

  constructor(private readonly positions: SoundPositions) {}

  /** Call inside the START click: browsers only let a user gesture start sound. Nothing is fetched before it. */
  unlock() {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    void ctx.resume();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);
    const mix = new RoomMix(ctx, this.positions);
    mix.output.connect(this.master);
    this.mix = mix;
    // Each sound starts as soon as it arrives; the startup is the smallest of the first three.
    this.loaded = Promise.all(
      [...LOOPS, ...SHOTS].map(async (name) => {
        const buffer = await this.fetchSound(ctx, name);
        if (!buffer || this.ctx !== ctx) return;
        this.buffers[name] = buffer;
        if (name === 'startup') mix.startup(buffer);
        else if ((LOOPS as readonly string[]).includes(name)) mix.loop(name as LoopName, buffer);
      }),
    ).then(() => undefined);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  click(kind: ClickKind) {
    const buffer = this.clickBuffer(kind);
    if (buffer) this.mix?.click(buffer);
  }

  /** Re-maps filters and gains from the camera, at most 20 times a second. */
  update(listener: Listener, now: number, filmsOpen: boolean) {
    if (!this.mix || now - this.lastUpdate < 50) return;
    this.lastUpdate = now;
    this.mix.update(listener, filmsOpen);
  }

  /**
   * Measurement hook: `seconds` of the room as heard from `listener`, rendered offline from the same files and mix
   * (START's sound at 0 s, loops fading in, clicks at the given times). Resolves once the sounds have loaded.
   */
  async renderOffline(
    seconds: number,
    listener: Listener,
    { filmsOpen = false, clicks = [] as { at: number; kind: ClickKind }[] } = {},
  ): Promise<Float32Array[]> {
    if (!this.loaded) throw new Error('room audio: START has not unlocked sound yet');
    await this.loaded;
    const ctx = new OfflineAudioContext(2, Math.round(seconds * OFFLINE_RATE), OFFLINE_RATE);
    const mix = new RoomMix(ctx, this.positions);
    mix.output.connect(ctx.destination);
    mix.update(listener, filmsOpen, true);
    for (const name of LOOPS) if (this.buffers[name]) mix.loop(name, this.buffers[name], 0);
    if (this.buffers.startup) mix.startup(this.buffers.startup, 0);
    for (const { at, kind } of clicks) {
      const buffer = this.clickBuffer(kind);
      if (buffer) mix.click(buffer, at);
    }
    const rendered = await ctx.startRendering();
    return [rendered.getChannelData(0), rendered.getChannelData(1)];
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.mix = null;
  }

  private clickBuffer(kind: ClickKind) {
    return this.buffers[kind === 'key' ? KEYS[Math.floor(Math.random() * KEYS.length)] : kind];
  }

  private async fetchSound(ctx: BaseAudioContext, name: SoundName): Promise<AudioBuffer | null> {
    for (const ext of formats()) {
      try {
        const response = await fetch(`${AUDIO_URL}${name}.${ext}`);
        if (response.ok) return await ctx.decodeAudioData(await response.arrayBuffer());
      } catch {
        // try the next format
      }
    }
    console.warn(`room audio: could not load ${name}`);
    return null;
  }
}
