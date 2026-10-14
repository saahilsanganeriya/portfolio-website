import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';
import sounds from './sounds.json';
import { FILTER_FADE_S, logCurve, MUSIC_MIX, powerCurve, STATE_FADE_S, STEMS, type AudioState, type Stem } from './state';

// The room's sound is recorded, not synthesised (scripts/media/build-audio.mjs; sources in blender/ASSETS.md): Henry
// Heffernan's room tone, computer, keyboard, mouse and startup, one CC0 Super 8 projector, a CC0 lo-fi piece in three
// stems, CC0 prop and city recordings. Henry's mapping from camera distance to a low-pass filter stays: the room tone
// muffles as you lean into the monitor, and each machine is clearer the closer you are. Props and the window are
// placed with PannerNodes, so each is louder near its source and sits under the music.

export const LOOPS = ['atmosphere', 'computer', 'projector'] as const;
export const KEYS = ['key-1', 'key-2', 'key-3', 'key-4', 'key-5', 'key-6'] as const;
export const SHOTS = ['startup', ...KEYS, 'mouse-down', 'mouse-up'] as const;
export type LoopName = (typeof LOOPS)[number];
export type ClickKind = 'key' | 'mouse-down' | 'mouse-up';
export type BedName = 'fan' | 'sf' | 'delhi-day' | 'delhi-night';

// Linear gains on the -23 LUFS files: the ambience sits near -30 dBFS RMS, clicks at their recorded level, and the
// projector runs only while its film does, heard up close (it falls off with the square of distance) or, while it
// runs, with Films as the front window.
const ROOM_TONE = 0.4;
const COMPUTER = 0.35;
const PROJECTOR_NEAR = 0.7;
const PROJECTOR_FILMS = 0.45;
const STARTUP = 0.45;
const CLICK = 0.8;
// The visitor's first click, tap or key starts everything, and it all comes up together in about a second.
const LOOP_FADE_S = 1;
// The music bus on -23 LUFS stems; the room's state (MUSIC_MIX) scales it from here.
const MUSIC = 0.67;
const MUSIC_FADE_IN_S = 1;
// A record on the -18 LUFS files sits at the lo-fi bed's loudness (measured offline, room state); its groove's crackle
// is a quiet layer under it. The bed and the record trade places over these times.
const RECORD = 0.72;
const CRACKLE = 0.06;
const BED_OUT_S = 1.2;
const BED_IN_S = 2.8;
// The stems stop at 11 kHz, so the room state's open filter is 11 kHz; a record keeps its top end there.
const recordCutoff = (cutoff: number) => (cutoff >= 11000 ? 20000 : cutoff);
const STEM_PAN: Record<Stem, number> = { keys: -0.15, melody: 0.2, beat: 0 };
// Beds on -23 LUFS loops: the fan is a murmur from across the room; each city is faint until the window comes forward.
const BED_LEVEL: Record<BedName, number> = { fan: 0.35, sf: 0.3, 'delhi-day': 0.3, 'delhi-night': 0.35 };
const BED_FADE_S = 4;
const CUT_M = 1.2;

const pad = sounds.padSeconds;

/** Where the sound comes from (world units) and where Henry's room tone is measured from. */
export interface SoundPositions {
  crt: THREE.Vector3;
  projector: THREE.Vector3 | null;
  desk: THREE.Vector3;
}

/** What the mix needs of a camera. */
export type Listener = Pick<THREE.Camera, 'position' | 'matrixWorldInverse'> & { matrixWorld: THREE.Matrix4 };

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

/** A spatial voice's falloff: full level within `ref` metres, then inverse distance times `rolloff`. */
export interface Placement {
  position: THREE.Vector3;
  ref?: number;
  rolloff?: number;
}

const map = (v: number, a: number, b: number, c: number, d: number) => c + ((d - c) * (v - a)) / (b - a);
const clamp = THREE.MathUtils.clamp;

/**
 * Moves an AudioParam to `to` along a weighted curve (never a linear ramp). A new glide starts from wherever the last
 * one had got to; `seconds` 0 sets the value now (offline renders, the first frame).
 */
function glide(ctx: BaseAudioContext, param: AudioParam, to: number, seconds: number, shape: 'power' | 'log' = 'power') {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  if (seconds <= 0 || Math.abs(param.value - to) < 1e-4) {
    param.setValueAtTime(to, t);
    return;
  }
  const curve = shape === 'log' ? logCurve(param.value, to) : powerCurve(param.value, to);
  param.setValueCurveAtTime(curve, t, seconds);
}

/** The mix on any audio context, live or offline: positional filters and gains, music, props, beds, one-shots. */
export class RoomMix {
  readonly output: GainNode;
  private readonly room: { filter: BiquadFilterNode; gain: GainNode };
  private readonly computer: Source;
  private readonly projector: Source | null;
  private readonly desk: Source;
  private readonly music: {
    bus: GainNode;
    filter: BiquadFilterNode;
    stems: Record<Stem, GainNode>;
    started: boolean;
    /** The lo-fi stems together: 1 while they are the music, 0 while a record plays. */
    bed: GainNode;
    /** Where a record and its crackle enter: their own filter, then the music bus. */
    record: GainNode;
    recordFilter: BiquadFilterNode;
    /** The bus has been brought up (by the stems or by a record). */
    raised: boolean;
  };
  /** The record's needle and groove, on the record input under the record. */
  readonly crackleInput: GainNode;
  private readonly spatial: GainNode;
  private readonly beds = new Map<BedName, GainNode>();
  private projectorRunning = false;
  private readonly local = new THREE.Vector3();
  private readonly lastListener = new THREE.Vector3(NaN, NaN, NaN);
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  /** Where each glided parameter is heading and when it gets there (context seconds). */
  private readonly heading = new Map<AudioParam, { to: number; at: number }>();

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

    const musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    // About Butterworth (Q in dB for a low-pass): no resonant bump at the cutoff as it sweeps.
    musicFilter.Q.value = -3;
    musicFilter.frequency.value = MUSIC_MIX.room.cutoff;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    musicFilter.connect(bus).connect(this.output);
    const bed = ctx.createGain();
    bed.connect(musicFilter);
    const stems = {} as Record<Stem, GainNode>;
    for (const stem of STEMS) {
      stems[stem] = ctx.createGain();
      stems[stem].gain.value = MUSIC_MIX.room.stems[stem];
      const pan = ctx.createStereoPanner();
      pan.pan.value = STEM_PAN[stem];
      stems[stem].connect(pan).connect(bed);
    }
    const recordFilter = ctx.createBiquadFilter();
    recordFilter.type = 'lowpass';
    recordFilter.Q.value = -3;
    recordFilter.frequency.value = recordCutoff(MUSIC_MIX.room.cutoff);
    const record = ctx.createGain();
    record.gain.value = 0;
    record.connect(recordFilter).connect(bus);
    this.crackleInput = ctx.createGain();
    this.crackleInput.gain.value = CRACKLE;
    this.crackleInput.connect(record);
    this.music = { bus, filter: musicFilter, stems, started: false, bed, record, recordFilter, raised: false };
    this.spatial = ctx.createGain();
    this.spatial.connect(this.output);
  }

  /** The projector's motor and shutter sound plays only while its film runs; the next update() glides it in or out. */
  setProjectorRunning(running: boolean) {
    this.projectorRunning = running;
  }

  loop(name: LoopName, buffer: AudioBuffer, when = this.ctx.currentTime) {
    const input = { atmosphere: this.room.filter, computer: this.computer.filter, projector: this.projector?.filter }[name];
    if (!input) return;
    const fade = this.ctx.createGain();
    fade.gain.setValueAtTime(0, when);
    fade.gain.setValueCurveAtTime(powerCurve(0, 1), when, LOOP_FADE_S);
    this.looped(buffer, sounds.loops[name], when).connect(fade).connect(input);
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

  /** Starts the three stems together on one clock, so they stay locked bar for bar, and fades the music in. */
  startMusic(buffers: Partial<Record<Stem, AudioBuffer>>, state: AudioState, when = this.ctx.currentTime, fadeIn = MUSIC_FADE_IN_S) {
    if (this.music.started) return;
    this.music.started = true;
    for (const stem of STEMS) {
      const buffer = buffers[stem];
      if (buffer) this.looped(buffer, sounds.music.seconds, when).connect(this.music.stems[stem]);
    }
    // A record put on before the stems arrived has already brought the bus up.
    if (!this.music.raised) this.raise(state, when, fadeIn);
  }

  /** Brings the music bus up to `state`'s level, from silence. */
  private raise(state: AudioState, when = this.ctx.currentTime, fadeIn = MUSIC_FADE_IN_S) {
    this.music.raised = true;
    const level = MUSIC * MUSIC_MIX[state].level;
    if (fadeIn > 0) {
      this.music.bus.gain.setValueAtTime(0, when);
      this.music.bus.gain.setValueCurveAtTime(powerCurve(0, level), when, fadeIn);
    } else this.music.bus.gain.setValueAtTime(level, when);
    this.heading.set(this.music.bus.gain, { to: level, at: when + fadeIn });
  }

  /** The node a record plays into (live: its media element; offline: a decoded buffer). */
  get recordInput(): AudioNode {
    return this.music.record;
  }

  /**
   * Hands the music to a record (the lo-fi stems fade out, the record input opens) or back to the bed. The stems keep
   * running underneath on their own clock, so the bed returns in time with itself.
   */
  setMusicSource(source: 'bed' | 'record', state: AudioState, immediate = false) {
    const onRecord = source === 'record';
    if (onRecord && !this.music.raised) this.raise(state, this.ctx.currentTime, immediate ? 0 : MUSIC_FADE_IN_S);
    this.move(this.music.bed.gain, onRecord ? 0 : 1, immediate ? 0 : onRecord ? BED_OUT_S : BED_IN_S);
    this.move(this.music.record.gain, onRecord ? RECORD : 0, immediate ? 0 : onRecord ? 0 : BED_OUT_S);
  }

  /** A decoded record into the record input from `when` (offline renders). */
  recordBuffer(buffer: AudioBuffer, when = this.ctx.currentTime) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.music.record);
    source.start(when);
  }

  get musicStarted() {
    return this.music.started;
  }

  /** Crossfades the stems, the music's filter and level, and the window's beds to `state`. */
  setState(state: AudioState, cityLevel: (bed: BedName) => number, immediate = false) {
    const target = MUSIC_MIX[state];
    for (const stem of STEMS) this.move(this.music.stems[stem].gain, target.stems[stem], immediate ? 0 : STATE_FADE_S);
    this.move(this.music.filter.frequency, target.cutoff, immediate ? 0 : FILTER_FADE_S, 'log');
    this.move(this.music.recordFilter.frequency, recordCutoff(target.cutoff), immediate ? 0 : FILTER_FADE_S, 'log');
    if (this.music.raised) this.move(this.music.bus.gain, MUSIC * target.level, immediate ? 0 : STATE_FADE_S);
    for (const name of this.beds.keys()) this.setBed(name, cityLevel(name), immediate);
  }

  /** A loop placed in the room; it fades in from silence and is then steered by setBed. */
  bed(name: BedName, buffer: AudioBuffer, placement: Placement, level: number, when = this.ctx.currentTime, immediate = false) {
    if (this.beds.has(name)) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    // Live beds start anywhere in their loop, so two visits never line up; offline renders start at the top.
    const offset = immediate ? 0 : Math.random() * sounds.loops[name];
    this.looped(buffer, sounds.loops[name], when, offset).connect(gain).connect(this.panner(placement));
    this.beds.set(name, gain);
    this.setBed(name, level, immediate);
  }

  setBed(name: BedName, level: number, immediate = false) {
    const gain = this.beds.get(name);
    if (gain) this.move(gain.gain, BED_LEVEL[name] * level, immediate ? 0 : BED_FADE_S);
  }

  hasBed(name: BedName) {
    return this.beds.has(name);
  }

  /** A one-shot at a place in the room (or, without one, at the listener), at a linear level. */
  shot(buffer: AudioBuffer, level: number, placement: Placement | null, when = this.ctx.currentTime, rate = 1) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = level;
    source.connect(gain).connect(placement ? this.panner(placement) : this.spatial);
    source.start(when);
  }

  /**
   * Re-maps filters and gains from the listener and moves the context's listener to it (metres); `immediate` jumps
   * instead of gliding (offline renders). Returns how far the listener moved since the last call, in metres.
   */
  update(listener: Listener, filmsOpen: boolean, immediate = false): number {
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
      if (s === this.projector && !this.projectorRunning) gain = 0;
      set(s.filter.frequency, cutoff);
      set(s.gain.gain, gain);
      this.local.copy(s.position).applyMatrix4(listener.matrixWorldInverse);
      set(s.pan.pan, clamp(this.local.x / Math.max(1, this.local.length()), -1, 1) * 0.7);
    }

    // The spatial voices hear from the camera: position in metres, facing down its -Z with +Y up.
    const metres = this.local.copy(listener.position).divideScalar(WORLD_SCALE);
    const moved = Number.isNaN(this.lastListener.x) ? 0 : metres.distanceTo(this.lastListener);
    const cut = immediate || moved > CUT_M;
    this.forward.set(0, 0, -1).transformDirection(listener.matrixWorld);
    this.up.set(0, 1, 0).transformDirection(listener.matrixWorld);
    const l = this.ctx.listener;
    const place = (param: AudioParam | undefined, value: number) => {
      if (!param) return;
      if (cut) param.setValueAtTime(value, t);
      else param.setTargetAtTime(value, t, 0.05);
    };
    if (l.positionX) {
      place(l.positionX, metres.x);
      place(l.positionY, metres.y);
      place(l.positionZ, metres.z);
      place(l.forwardX, this.forward.x);
      place(l.forwardY, this.forward.y);
      place(l.forwardZ, this.forward.z);
      place(l.upX, this.up.x);
      place(l.upY, this.up.y);
      place(l.upZ, this.up.z);
    } else {
      // Engines without the listener's AudioParams (Firefox) still take the older setters.
      l.setPosition(metres.x, metres.y, metres.z);
      l.setOrientation(this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z);
    }
    this.lastListener.copy(metres);
    return moved;
  }

  /**
   * The music's and beds' graph state: each gain's and the filter's current value, where its glide is heading, and
   * the context time it lands (what the state switch changed, read off the nodes themselves).
   */
  graph() {
    const read = (param: AudioParam) => {
      const heading = this.heading.get(param);
      return { now: param.value, to: heading?.to ?? param.value, at: heading?.at ?? 0 };
    };
    return {
      time: this.ctx.currentTime,
      level: read(this.music.bus.gain),
      cutoff: read(this.music.filter.frequency),
      stems: Object.fromEntries(STEMS.map((stem) => [stem, read(this.music.stems[stem].gain)])) as Record<Stem, ReturnType<typeof read>>,
      bed: read(this.music.bed.gain),
      record: read(this.music.record.gain),
      beds: Object.fromEntries([...this.beds].map(([name, gain]) => [name, read(gain.gain)])) as Partial<Record<BedName, ReturnType<typeof read>>>,
    };
  }

  private move(param: AudioParam, to: number, seconds: number, shape: 'power' | 'log' = 'power') {
    glide(this.ctx, param, to, seconds, shape);
    this.heading.set(param, { to, at: this.ctx.currentTime + Math.max(0, seconds) });
  }

  /** A looping source playing `seconds` between the file's padding, from `offset` seconds into the loop. */
  private looped(buffer: AudioBuffer, seconds: number, when: number, offset = 0) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    // Each file holds its loop between copies of the loop's tail and head (scripts/media/build-audio.mjs).
    source.loop = true;
    source.loopStart = pad;
    source.loopEnd = pad + seconds;
    source.start(when, pad + offset);
    return source;
  }

  private panner({ position, ref = 1, rolloff = 1 }: Placement) {
    const panner = new PannerNode(this.ctx, {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: ref,
      rolloffFactor: rolloff,
      positionX: position.x / WORLD_SCALE,
      positionY: position.y / WORLD_SCALE,
      positionZ: position.z / WORLD_SCALE,
    });
    panner.connect(this.spatial);
    return panner;
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
