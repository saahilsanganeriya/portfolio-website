import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { Hotspot } from '../hotspots';
import { KEYS, LOOPS, RoomMix, SHOTS, type BedName, type ClickKind, type Listener, type LoopName, type Placement, type SoundPositions } from './mix';
import { cityDay, MUSIC_MIX, stateFor, STEMS, volumeGain, type AudioState, type City, type Stem } from './state';

export type { ClickKind } from './mix';

const AUDIO_URL = '/audio/';
const OFFLINE_RATE = 48000;
const UPDATE_MS = 50;
const MASTER_FADE_S = 0.25;
const SUSPEND_AFTER_MUTE_MS = 400;
const DAY_CHECK_MS = 60_000;
// A glide is a move faster than this (m/s) after the camera has rested; a cut (reduced motion) moves further in one
// update than any glide does and makes no sound.
const WHOOSH_SPEED = 0.9;
const REST_SPEED = 0.15;
const REST_S = 0.4;
const CUT_M = 1.2;
// Props and the window keep full level within 2.5 m, so a click from the wide view (6–7 m away) is heard under the music.
const EFFECT_REF_M = 2.5;
const BED_REF_M: Record<BedName, number> = { fan: 0.8, sf: 1.5, 'delhi-day': 1.5, 'delhi-night': 1.5 };

/** A prop's sound: one of its recordings (picked at random), its level under the music, and where it sits. */
interface Effect {
  files: readonly string[];
  dir: 'sfx' | 'city';
  level: number;
  /** Room nodes (first found) it plays from when called without a position. */
  anchors: readonly string[];
  ref?: number;
}

const EFFECTS = {
  shutter: { files: ['shutter-1', 'shutter-2'], dir: 'sfx', level: 0.5, anchors: ['hit_fujifilm_a', 'props_fujifilm_xt'] },
  super8: { files: ['super8'], dir: 'sfx', level: 0.4, anchors: ['hit_super8', 'props_super8_camera'] },
  'projector-clack': { files: ['projector-clack'], dir: 'sfx', level: 0.45, anchors: ['projector_lens', 'hit_projector'] },
  espresso: { files: ['espresso'], dir: 'sfx', level: 0.35, anchors: ['espresso_machine', 'hit_espresso'] },
  'espresso-brew': { files: ['espresso-brew'], dir: 'sfx', level: 0.22, anchors: ['espresso_machine'] },
  'espresso-pour': { files: ['espresso-pour'], dir: 'sfx', level: 0.4, anchors: ['espresso_cup', 'espresso_machine'] },
  oven: { files: ['oven'], dir: 'sfx', level: 0.35, anchors: ['countertop_oven', 'hit_oven'] },
  'oven-open': { files: ['oven-open'], dir: 'sfx', level: 0.5, anchors: ['oven_door', 'countertop_oven'] },
  'oven-close': { files: ['oven-close'], dir: 'sfx', level: 0.6, anchors: ['oven_door', 'countertop_oven'] },
  lava: { files: ['lava'], dir: 'sfx', level: 0.3, anchors: ['lava_lamp', 'hit_lava_lamp'], ref: 1 },
  crt: { files: ['crt'], dir: 'sfx', level: 0.35, anchors: ['monitor_screen'] },
  whoosh: { files: ['whoosh'], dir: 'sfx', level: 0.1, anchors: [] },
  foghorn: { files: ['foghorn'], dir: 'city', level: 0.2, anchors: ['window_view_sf'] },
  gulls: { files: ['gulls'], dir: 'city', level: 0.22, anchors: ['window_view_sf'] },
  'cable-car': { files: ['cable-car'], dir: 'city', level: 0.22, anchors: ['window_view_sf'] },
  'temple-bell': { files: ['temple-bell'], dir: 'city', level: 0.22, anchors: ['window_view_delhi'] },
} as const satisfies Record<string, Effect>;
export type SfxName = keyof typeof EFFECTS;

/** The sound a click on each prop makes (by its proxy in room.glb). */
const HOTSPOT_SFX: Record<string, SfxName> = {
  hit_fujifilm_a: 'shutter',
  hit_fujifilm_b: 'shutter',
  hit_fujifilm_c: 'shutter',
  hit_super8: 'super8',
  hit_projector: 'projector-clack',
  hit_espresso: 'espresso',
  hit_oven: 'oven',
  hit_lava_lamp: 'lava',
};

// What each city does by day and by night, chosen at random every so often while its bed plays.
const CITY_EVENTS: Record<City, { day: readonly SfxName[]; night: readonly SfxName[]; everyS: [number, number] }> = {
  sf: { day: ['gulls', 'gulls', 'cable-car', 'cable-car', 'foghorn'], night: ['foghorn', 'foghorn', 'foghorn', 'gulls'], everyS: [20, 50] },
  delhi: { day: ['temple-bell'], night: [], everyS: [35, 80] },
};
// Room murmurs that happen by themselves now and then, when the room has the prop.
const AMBIENT: { name: SfxName; everyS: [number, number] }[] = [
  { name: 'espresso-brew', everyS: [150, 300] },
  { name: 'lava', everyS: [25, 60] },
];

const BED_ANCHORS: Record<BedName, readonly string[]> = {
  fan: ['ceiling_fan_blades', 'ceiling_fan'],
  sf: ['window_view_sf'],
  'delhi-day': ['window_view_delhi'],
  'delhi-night': ['window_view_delhi'],
};
const BED_DIR: Record<BedName, 'sfx' | 'city'> = { fan: 'sfx', sf: 'city', 'delhi-day': 'city', 'delhi-night': 'city' };

/** What the rest of the page holds of the room's sound. */
export interface AudioHandle {
  /** Starts the sound inside a user gesture (a click, tap or key); does nothing while muted or without a gesture. */
  unlock(): void;
  setMuted(muted: boolean): void;
  /** 0–1, the slider's position; the gain is its square. */
  setVolume(volume: number): void;
  /** Crossfades the music (and beds) to a state; the camera and SaahilOS also set it as the visitor moves. */
  setState(state: AudioState): void;
  /** Plays a prop's recording at `position` (world units), or at the prop it belongs to. */
  sfx(name: SfxName, position?: THREE.Vector3): void;
  readonly unlocked: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly state: AudioState;
  /** Called after any of the above changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface OfflineOptions {
  state?: AudioState;
  filmsOpen?: boolean;
  /** Henry's startup at 0 s, as heard when the sound first starts. */
  startup?: boolean;
  /** The music bus's fade-in from 0 s (the first seconds after the sound starts). */
  fadeIn?: boolean;
  clicks?: { at: number; kind: ClickKind }[];
  effects?: { at: number; name: SfxName }[];
  /** The moment the cities' day and night are read at. */
  date?: Date;
}

/** Opus where the browser decodes it, AAC otherwise; a file that fails to decode falls back to the next format. */
const formats = () =>
  typeof Audio !== 'undefined' && new Audio().canPlayType('audio/webm; codecs="opus"') ? ['webm', 'm4a'] : ['m4a'];
const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

export class RoomAudio implements AudioHandle {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mix: RoomMix | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>();
  private readonly anchors = new Map<string, THREE.Vector3 | null>();
  private readonly listeners = new Set<() => void>();
  private loaded: Promise<void> | null = null;
  private current: AudioState = 'room';
  private derived: AudioState | null = null;
  private isMuted = false;
  private level = 1;
  private lastUpdate = 0;
  private resting = 0;
  private lastDayCheck = 0;
  private readonly nextEvent = new Map<string, number>();
  private suspendTimer = 0;

  constructor(
    private readonly positions: SoundPositions,
    private readonly room: THREE.Object3D | null = null,
  ) {}

  get unlocked() {
    return this.ctx !== null;
  }

  get muted() {
    return this.isMuted;
  }

  get volume() {
    return this.level;
  }

  get state() {
    return this.current;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Nothing is fetched before this: the first gesture creates the context and loads the sound. */
  unlock() {
    if (this.ctx || this.isMuted) return;
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.isActive) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    void ctx.resume();
    this.master = ctx.createGain();
    this.master.gain.value = volumeGain(this.level);
    this.master.connect(ctx.destination);
    const mix = new RoomMix(ctx, this.positions);
    mix.output.connect(this.master);
    this.mix = mix;
    mix.setState(this.current, (bed) => this.bedLevel(bed), true);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loaded = this.load(ctx, mix);
    this.notify();
  }

  setMuted(muted: boolean) {
    if (muted === this.isMuted) return;
    this.isMuted = muted;
    clearTimeout(this.suspendTimer);
    if (this.ctx && this.master) {
      const ctx = this.ctx;
      if (!muted && document.visibilityState !== 'hidden') void ctx.resume();
      this.fadeMaster();
      // A muted room stops processing once its fade is done.
      if (muted) this.suspendTimer = window.setTimeout(() => void ctx.suspend(), SUSPEND_AFTER_MUTE_MS);
    }
    this.notify();
  }

  setVolume(volume: number) {
    const next = THREE.MathUtils.clamp(volume, 0, 1);
    if (next === this.level) return;
    this.level = next;
    this.fadeMaster();
    this.notify();
  }

  setState(state: AudioState) {
    if (state === this.current) return;
    this.current = state;
    this.mix?.setState(state, (bed) => this.bedLevel(bed));
    this.notify();
  }

  sfx(name: SfxName, position?: THREE.Vector3) {
    this.play(name, position, 1);
  }

  /** A prop's or city's recording at `gain` times its own level. */
  private play(name: SfxName, position: THREE.Vector3 | undefined, gain: number) {
    const ctx = this.ctx;
    const mix = this.mix;
    if (!ctx || !mix) return;
    const effect: Effect = EFFECTS[name];
    const file = effect.files[Math.floor(Math.random() * effect.files.length)];
    const at = position ?? this.anchorOf(effect.anchors);
    // A prop's sound needs the prop: a room without an oven makes no oven sound. Only the whoosh is the camera's own.
    if (!at && effect.anchors.length) return;
    const placement: Placement | null = at ? { position: at, ref: effect.ref ?? EFFECT_REF_M } : null;
    const play = (buffer: AudioBuffer | null) =>
      buffer && this.mix === mix && mix.shot(buffer, effect.level * gain, placement, ctx.currentTime, 0.98 + Math.random() * 0.04);
    const buffer = this.buffers.get(`${effect.dir}/${file}`);
    if (buffer) play(buffer);
    else void this.fetch(ctx, effect.dir, file).then(play);
  }

  /** The sound of clicking a prop, from the prop. */
  hotspot(hotspot: Pick<Hotspot, 'proxies'>) {
    for (const proxy of hotspot.proxies) {
      const name = HOTSPOT_SFX[proxy];
      if (name) return this.sfx(name, this.anchorOf([proxy]) ?? undefined);
    }
  }

  click(kind: ClickKind) {
    const buffer = this.clickBuffer(kind);
    if (buffer) this.mix?.click(buffer);
  }

  /**
   * Every frame, at most 20 times a second: re-maps the room from the camera, follows the visitor into a state (the
   * framing the camera rests at or flies to, and SaahilOS's front window), whooshes on glides, keeps the cities on
   * their local day or night, and lets the props murmur now and then.
   */
  update(listener: Listener, now: number, station: string, frontWindow: string) {
    if (!this.mix || !this.ctx || now - this.lastUpdate < UPDATE_MS) return;
    const dt = this.lastUpdate ? (now - this.lastUpdate) / 1000 : 0;
    this.lastUpdate = now;
    const moved = this.mix.update(listener, frontWindow.startsWith('films'));

    const derived = stateFor(station, frontWindow);
    if (derived !== this.derived) {
      this.derived = derived;
      this.setState(derived);
    }

    if (dt > 0) {
      const speed = moved / dt;
      if (moved < CUT_M && speed > WHOOSH_SPEED && this.resting >= REST_S) {
        this.sfx('whoosh');
        this.resting = 0;
      } else if (speed < REST_SPEED) this.resting += dt;
      else if (speed > WHOOSH_SPEED) this.resting = 0;
    }

    if (now - this.lastDayCheck > DAY_CHECK_MS) {
      this.lastDayCheck = now;
      for (const bed of ['sf', 'delhi-day', 'delhi-night'] as const) {
        if (this.mix.hasBed(bed)) this.mix.setBed(bed, this.bedLevel(bed));
        else if (this.bedLevel(bed) > 0 && this.anchorOf(BED_ANCHORS[bed])) void this.startBed(this.ctx, this.mix, bed);
      }
    }

    const t = this.ctx.currentTime;
    for (const city of ['sf', 'delhi'] as const) {
      const playing = city === 'sf' ? this.mix.hasBed('sf') : this.mix.hasBed('delhi-day') || this.mix.hasBed('delhi-night');
      if (!playing) continue;
      const due = this.nextEvent.get(city);
      if (due === undefined) this.nextEvent.set(city, t + between(CITY_EVENTS[city].everyS));
      else if (t >= due) {
        this.nextEvent.set(city, t + between(CITY_EVENTS[city].everyS));
        const choices = cityDay(city, new Date()) >= 0.5 ? CITY_EVENTS[city].day : CITY_EVENTS[city].night;
        // As far forward as the city's bed: faint from the room, full at the window.
        const level = MUSIC_MIX[this.current].city;
        if (choices.length && level > 0.05) this.play(choices[Math.floor(Math.random() * choices.length)], undefined, level);
      }
    }
    for (const { name, everyS } of AMBIENT) {
      if (!this.anchorOf(EFFECTS[name].anchors) || this.current === 'os' || this.current === 'story') continue;
      const due = this.nextEvent.get(name);
      if (due === undefined) this.nextEvent.set(name, t + between(everyS));
      else if (t >= due) {
        this.nextEvent.set(name, t + between(everyS));
        this.sfx(name);
      }
    }
  }

  /** The music's and beds' graph state, plus the master's (tests read the state switch off the nodes). */
  graph() {
    return {
      context: this.ctx?.state ?? 'none',
      state: this.current,
      muted: this.isMuted,
      volume: this.level,
      master: this.master?.gain.value ?? null,
      loaded: [...this.buffers.keys()].sort(),
      /** Room nodes the sounds play from, in metres. */
      anchors: Object.fromEntries([...this.anchors].filter(([, at]) => at).map(([name, at]) => [name, at!.toArray().map((v) => v / WORLD_SCALE)])),
      ...(this.mix?.graph() ?? {}),
    };
  }

  /**
   * Measurement hook: `seconds` of the room as heard from `listener`, rendered offline from the same files and mix,
   * with the music and beds set to `state` from 0 s. Resolves once the sounds have loaded.
   */
  async renderOffline(seconds: number, listener: Listener, options: OfflineOptions = {}): Promise<Float32Array[]> {
    if (!this.loaded) throw new Error('room audio: no gesture has unlocked sound yet');
    await this.loaded;
    const { state = 'room', filmsOpen = false, startup = false, fadeIn = false, clicks = [], effects = [], date = new Date() } = options;
    const ctx = new OfflineAudioContext(2, Math.round(seconds * OFFLINE_RATE), OFFLINE_RATE);
    const mix = new RoomMix(ctx, this.positions);
    mix.output.connect(ctx.destination);
    mix.update(listener, filmsOpen, true);
    const bedLevel = (bed: BedName) => this.bedLevel(bed, state, date);
    for (const name of LOOPS) {
      const buffer = this.buffers.get(`room/${name}`);
      if (buffer) mix.loop(name, buffer, 0);
    }
    const startupBuffer = this.buffers.get('room/startup');
    if (startup && startupBuffer) mix.startup(startupBuffer, 0);
    mix.startMusic(this.stems(), state, 0, fadeIn ? undefined : 0);
    mix.setState(state, bedLevel, true);
    for (const bed of Object.keys(BED_ANCHORS) as BedName[]) {
      const at = this.anchorOf(BED_ANCHORS[bed]);
      if (!at || bedLevel(bed) <= 0) continue;
      const buffer = await this.fetch(ctx, BED_DIR[bed], bed);
      if (buffer) mix.bed(bed, buffer, { position: at, ref: BED_REF_M[bed] }, bedLevel(bed), 0, true);
    }
    for (const { at, kind } of clicks) {
      const buffer = this.clickBuffer(kind);
      if (buffer) mix.click(buffer, at);
    }
    for (const { at, name } of effects) {
      const effect: Effect = EFFECTS[name];
      const where = this.anchorOf(effect.anchors);
      if (!where && effect.anchors.length) continue;
      const buffer = await this.fetch(ctx, effect.dir, effect.files[0]);
      if (buffer) mix.shot(buffer, effect.level, where ? { position: where, ref: effect.ref ?? EFFECT_REF_M } : null, at);
    }
    const rendered = await ctx.startRendering();
    return [rendered.getChannelData(0), rendered.getChannelData(1)];
  }

  dispose() {
    clearTimeout(this.suspendTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ctx?.close();
    this.ctx = null;
    this.mix = null;
    this.listeners.clear();
  }

  private readonly onVisibility = () => {
    if (!this.ctx) return;
    if (document.visibilityState === 'hidden') void this.ctx.suspend();
    else if (!this.isMuted) void this.ctx.resume();
  };

  /** Room first (each loop starts as it arrives), then the music (all stems together), the props, the beds. */
  private async load(ctx: AudioContext, mix: RoomMix) {
    const room = Promise.all(
      [...LOOPS, ...SHOTS].map(async (name) => {
        const buffer = await this.fetch(ctx, 'room', name);
        if (!buffer || this.mix !== mix) return;
        if (name === 'startup') {
          mix.startup(buffer);
          // The monitor's tube comes on with the computer.
          this.sfx('crt');
        } else if ((LOOPS as readonly string[]).includes(name)) mix.loop(name as LoopName, buffer);
      }),
    );
    const music = Promise.all(STEMS.map((stem) => this.fetch(ctx, 'music', stem))).then(() => {
      if (this.mix === mix) mix.startMusic(this.stems(), this.current);
    });
    const effects = Promise.all(
      (Object.entries(EFFECTS) as [SfxName, Effect][])
        .filter(([name, effect]) => effect.dir === 'sfx' && (name === 'whoosh' || name === 'crt' || this.anchorOf(effect.anchors)))
        .flatMap(([, effect]) => effect.files.map((file) => this.fetch(ctx, effect.dir, file))),
    );
    const beds = Promise.all(
      (Object.keys(BED_ANCHORS) as BedName[]).filter((bed) => this.bedLevel(bed) > 0 && this.anchorOf(BED_ANCHORS[bed])).map((bed) => this.startBed(ctx, mix, bed)),
    );
    await Promise.all([room, music, effects, beds]);
  }

  private async startBed(ctx: BaseAudioContext, mix: RoomMix, bed: BedName) {
    const buffer = await this.fetch(ctx, BED_DIR[bed], bed);
    const at = this.anchorOf(BED_ANCHORS[bed]);
    if (buffer && at && this.mix === mix) mix.bed(bed, buffer, { position: at, ref: BED_REF_M[bed] }, this.bedLevel(bed));
  }

  /** How far forward a bed is: the fan always murmurs; each city by the state and its local day or night. */
  private bedLevel(bed: BedName, state = this.current, date = new Date()) {
    if (bed === 'fan') return 1;
    const city = MUSIC_MIX[state].city;
    if (bed === 'sf') return city * (0.75 + 0.25 * cityDay('sf', date));
    const day = cityDay('delhi', date);
    return city * (bed === 'delhi-day' ? day : 1 - day);
  }

  private stems(): Partial<Record<Stem, AudioBuffer>> {
    return Object.fromEntries(STEMS.map((stem) => [stem, this.buffers.get(`music/${stem}`)]).filter(([, b]) => b));
  }

  /** The world position of the first named room node present (its bounds' centre), or null. */
  private anchorOf(names: readonly string[]): THREE.Vector3 | null {
    for (const name of names) {
      if (!this.anchors.has(name)) {
        const node = this.room?.getObjectByName(name);
        let at: THREE.Vector3 | null = null;
        if (node) {
          node.updateWorldMatrix(true, true);
          const box = new THREE.Box3().setFromObject(node);
          at = box.isEmpty() ? node.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
        }
        this.anchors.set(name, at);
      }
      const at = this.anchors.get(name);
      if (at) return at;
    }
    if (names.includes('monitor_screen')) return this.positions.crt;
    return null;
  }

  private fadeMaster() {
    if (!this.ctx || !this.master) return;
    const to = this.isMuted ? 0 : volumeGain(this.level);
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(to, this.ctx.currentTime, MASTER_FADE_S / 3);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  private clickBuffer(kind: ClickKind) {
    return this.buffers.get(`room/${kind === 'key' ? KEYS[Math.floor(Math.random() * KEYS.length)] : kind}`);
  }

  private fetch(ctx: BaseAudioContext, dir: string, name: string): Promise<AudioBuffer | null> {
    const key = `${dir}/${name}`;
    const cached = this.buffers.get(key);
    if (cached) return Promise.resolve(cached);
    let pending = this.pending.get(key);
    if (!pending) {
      pending = (async () => {
        for (const ext of formats()) {
          try {
            const response = await fetch(`${AUDIO_URL}${key}.${ext}`);
            if (!response.ok) continue;
            const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
            this.buffers.set(key, buffer);
            return buffer;
          } catch {
            // try the next format
          }
        }
        console.warn(`room audio: could not load ${key}`);
        return null;
      })();
      this.pending.set(key, pending);
    }
    return pending;
  }
}

