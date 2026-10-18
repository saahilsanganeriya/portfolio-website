import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { Hotspot } from '../hotspots';
import type { RecordId } from './crate';
import { KEYS, LOOPS, RoomMix, SHOTS, type BedName, type ClickKind, type Listener, type LoopName, type Placement, type SoundPositions } from './mix';
import type { RecordDeck } from './RecordDeck';
import { MUSIC_MIX, powerCurve, stateFor, STEMS, volumeGain, type AudioState, type Stem } from './state';

export type { ClickKind } from './mix';
export type { RecordId } from './crate';

const AUDIO_URL = '/audio/';
const OFFLINE_RATE = 48000;
const UPDATE_MS = 50;
const MASTER_FADE_S = 0.25;
// The first time the sound runs (at once where the browser allows it, else at the first press or key), the whole room
// comes up from silence over this long.
const FIRST_FADE_S = 1.5;
// The browser answers an autoplay attempt at once; one that has not answered by now waits for a gesture.
const AUTOPLAY_ANSWER_MS = 300;
// Without a tonearm to watch (reduced motion, or a room without the player), the needle meets the groove this soon.
const QUICK_CUE_S = 0.3;
const SUSPEND_AFTER_MUTE_MS = 400;
// A glide is a move faster than this (m/s) after the camera has rested; a cut (reduced motion) moves further in one
// update than any glide does and makes no sound.
const WHOOSH_SPEED = 0.9;
const REST_SPEED = 0.15;
const REST_S = 0.4;
const CUT_M = 1.2;
// Props and the window keep full level within 2.5 m, so a click from the wide view (6–7 m away) is heard under the music.
const EFFECT_REF_M = 2.5;
const BED_REF_M: Record<BedName, number> = { sf: 1.5, 'delhi-day': 1.5 };

/** A prop's sound: one of its recordings (picked at random), its level under the music, and where it sits. */
interface Effect {
  files: readonly string[];
  dir: 'sfx' | 'city' | 'records';
  level: number;
  /** Room nodes (first found) it plays from when called without a position. */
  anchors: readonly string[];
  ref?: number;
}

const EFFECTS = {
  'espresso-brew': { files: ['espresso-brew'], dir: 'sfx', level: 0.22, anchors: ['espresso_machine'] },
  'espresso-pour': { files: ['espresso-pour'], dir: 'sfx', level: 0.4, anchors: ['espresso_cup', 'espresso_machine'] },
  'oven-open': { files: ['oven-open'], dir: 'sfx', level: 0.5, anchors: ['oven_door', 'countertop_oven'] },
  'oven-close': { files: ['oven-close'], dir: 'sfx', level: 0.6, anchors: ['oven_door', 'countertop_oven'] },
  lava: { files: ['lava'], dir: 'sfx', level: 0.3, anchors: ['lava_lamp', 'hit_lava_lamp'], ref: 1 },
  crt: { files: ['crt'], dir: 'sfx', level: 0.35, anchors: ['monitor_screen'] },
  whoosh: { files: ['whoosh'], dir: 'sfx', level: 0.1, anchors: [] },
  // The turntable's own: loaded with the first record chosen, never before.
  'needle-drop': { files: ['needle-drop'], dir: 'records', level: 0.3, anchors: ['tonearm', 'platter', 'record_player'], ref: 1.5 },
  'needle-lift': { files: ['needle-lift'], dir: 'records', level: 0.3, anchors: ['tonearm', 'platter', 'record_player'], ref: 1.5 },
  foghorn: { files: ['foghorn'], dir: 'city', level: 0.2, anchors: ['window_view_sf'] },
  gulls: { files: ['gulls'], dir: 'city', level: 0.22, anchors: ['window_view_sf'] },
  'cable-car': { files: ['cable-car'], dir: 'city', level: 0.22, anchors: ['window_view_sf'] },
  'temple-bell': { files: ['temple-bell'], dir: 'city', level: 0.22, anchors: ['window_view_delhi'] },
} as const satisfies Record<string, Effect>;
export type SfxName = keyof typeof EFFECTS;

/**
 * The sound a click on each prop makes (by its proxy in room.glb). The espresso machine and the oven are
 * not here: the room plays their recordings when they act, once the camera has flown to them (src/scene/World/).
 */
const HOTSPOT_SFX: Record<string, SfxName> = {
  hit_lava_lamp: 'lava',
};

// What each city does now and then while its bed plays, chosen at random. Both cities are always in daylight.
const BED_EVENTS: Record<BedName, { events: readonly SfxName[]; everyS: [number, number] }> = {
  sf: { events: ['gulls', 'gulls', 'cable-car', 'cable-car', 'foghorn'], everyS: [20, 50] },
  'delhi-day': { events: ['temple-bell'], everyS: [35, 80] },
};
// Room murmurs that happen by themselves now and then, when the room has the prop.
const AMBIENT: { name: SfxName; everyS: [number, number] }[] = [
  { name: 'espresso-brew', everyS: [150, 300] },
  { name: 'lava', everyS: [25, 60] },
];

const BED_ANCHORS: Record<BedName, readonly string[]> = {
  sf: ['window_view_sf'],
  'delhi-day': ['window_view_delhi'],
};

/** What the rest of the page holds of the room's sound. */
export interface AudioHandle {
  /**
   * Starts the sound without a gesture, where the browser's autoplay policy allows it (Chrome does for a site the
   * visitor often plays media on); elsewhere the sound waits, made but suspended, for `unlock()`. Nothing while muted.
   * Resolves with whether it runs.
   */
  autoplay(): Promise<boolean>;
  /** Starts (or resumes) the sound from inside a press, tap or key, which every browser allows; nothing while muted. */
  unlock(): void;
  setMuted(muted: boolean): void;
  /** 0–1, the slider's position; the gain is its square. */
  setVolume(volume: number): void;
  /** Crossfades the music (and beds) to a state; the camera and SaahilOS also set it as the visitor moves. */
  setState(state: AudioState): void;
  /** Plays a prop's recording at `position` (world units), or at the prop it belongs to. */
  sfx(name: SfxName, position?: THREE.Vector3): void;
  /**
   * The room's music: a record from the crate (streamed when chosen; the needle meets the groove `cue` seconds from
   * now) or null for the adaptive lo-fi bed. A record that ends by itself hands back to the bed (subscribers hear it).
   */
  setMusicSource(record: RecordId | null, cue?: number): void;
  readonly musicSource: RecordId | null;
  /** Holds the music (the bed or the record, where it is) while another player is open, then lets it go on. */
  setMusicHeld(held: boolean): void;
  readonly musicHeld: boolean;
  /** The sound runs: the browser let it start, and it is not suspended (muted a moment, or the tab hidden). */
  readonly unlocked: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly state: AudioState;
  /** Called after any of the above changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface OfflineOptions {
  state?: AudioState;
  /** Henry's startup at 0 s, as heard when the sound first starts. */
  startup?: boolean;
  /** The music bus's fade-in from 0 s (the first seconds after the sound starts). */
  fadeIn?: boolean;
  clicks?: { at: number; kind: ClickKind }[];
  effects?: { at: number; name: SfxName }[];
  /** A record playing from 0 s instead of the lo-fi bed (decoded from its shipped file). */
  record?: RecordId;
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
  private source: RecordId | null = null;
  private held = false;
  private deck: Promise<RecordDeck | null> | null = null;
  private deckReady: RecordDeck | null = null;
  private level = 1;
  private lastUpdate = 0;
  /** The master has made its first fade up from silence. */
  private faded = false;
  private resting = 0;
  private readonly nextEvent = new Map<string, number>();
  private suspendTimer = 0;

  constructor(
    private readonly positions: SoundPositions,
    private readonly room: THREE.Object3D | null = null,
  ) {}

  get unlocked() {
    return this.ctx?.state === 'running';
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

  get musicSource() {
    return this.source;
  }

  get musicHeld() {
    return this.held;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async autoplay() {
    if (this.isMuted || !this.create()) return false;
    const ctx = this.ctx!;
    if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, AUTOPLAY_ANSWER_MS))]).catch(() => {});
    return this.unlocked;
  }

  unlock() {
    if (this.isMuted || !this.create()) return;
    const ctx = this.ctx!;
    // Suspended, or WebKit's `interrupted`, which is where Safari holds a context made before any gesture.
    if (ctx.state !== 'running' && ctx.state !== 'closed' && document.visibilityState !== 'hidden') void ctx.resume().catch(() => {});
  }

  /** Makes the sound once: its graph, at silence, and its files loading. False where the browser has no Web Audio. */
  private create() {
    if (this.ctx) return true;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    // Made inside a gesture it runs at once; made outside one it starts suspended until a gesture resumes it.
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    const mix = new RoomMix(ctx, this.positions);
    mix.output.connect(this.master);
    this.mix = mix;
    mix.setState(this.current, true);
    if (this.held) mix.holdMusic(true, true);
    ctx.addEventListener('statechange', this.onState);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loaded = this.load(ctx, mix);
    // A record chosen while the sound was off starts now.
    if (this.source) this.applySource(QUICK_CUE_S);
    this.onState();
    return true;
  }

  /** The context began to run (or stopped): the first time, the room fades up from silence. */
  private readonly onState = () => {
    const ctx = this.ctx;
    if (ctx?.state === 'running' && this.master && !this.faded) {
      this.faded = true;
      const t = ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(0, t);
      this.master.gain.setValueCurveAtTime(powerCurve(0, this.isMuted ? 0 : volumeGain(this.level)), t, FIRST_FADE_S);
    }
    this.notify();
  };

  setMuted(muted: boolean) {
    if (muted === this.isMuted) return;
    this.isMuted = muted;
    clearTimeout(this.suspendTimer);
    if (this.ctx && this.master) {
      const ctx = this.ctx;
      if (!muted && document.visibilityState !== 'hidden') void ctx.resume();
      this.deckReady?.hold(this.deckHeld());
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
    this.mix?.setState(state);
    this.notify();
  }

  sfx(name: SfxName, position?: THREE.Vector3) {
    this.play(name, position, 1);
  }

  setMusicHeld(held: boolean) {
    if (held === this.held) return;
    this.held = held;
    this.mix?.holdMusic(held);
    this.deckReady?.hold(this.deckHeld());
    this.notify();
  }

  /** The record waits where it is while the sound is off, the tab is hidden or the music holds. */
  private deckHeld() {
    return this.isMuted || this.held || document.visibilityState === 'hidden';
  }

  setMusicSource(record: RecordId | null, cue = QUICK_CUE_S) {
    if (record === this.source) return;
    this.source = record;
    this.applySource(cue);
    this.notify();
  }

  /** Hands the music to the chosen record (loading the deck the first time) or back to the bed. */
  private applySource(cue: number) {
    const ctx = this.ctx;
    const mix = this.mix;
    if (!(ctx instanceof AudioContext) || !mix) return;
    mix.setMusicSource(this.source ? 'record' : 'bed', this.current);
    void this.recordDeck(ctx, mix).then((deck) => {
      if (!deck || this.mix !== mix) return;
      if (this.source) deck.play(this.source, cue);
      else deck.stop();
    });
  }

  private recordDeck(ctx: AudioContext, mix: RoomMix) {
    this.deck ??= import('./RecordDeck').then(({ RecordDeck }) => {
      if (this.mix !== mix) return null;
      const deck = new RecordDeck(ctx, mix.recordInput, mix.crackleInput, {
        sound: (name) => this.fetch(ctx, 'records', name),
        shot: (buffer, when) => {
          const effect: Effect = EFFECTS['needle-drop'];
          const at = this.anchorOf(effect.anchors);
          if (this.mix === mix) mix.shot(buffer, effect.level, at ? { position: at, ref: effect.ref } : null, when);
        },
        formats,
        ended: (record) => {
          if (this.source !== record) return;
          this.source = null;
          mix.setMusicSource('bed', this.current);
          deck.stop();
          this.notify();
        },
      });
      deck.hold(this.deckHeld());
      this.deckReady = deck;
      return deck;
    });
    return this.deck;
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
   * framing the camera rests at or flies to, and SaahilOS's front window), whooshes on glides, and lets the cities and
   * the props murmur now and then.
   */
  update(listener: Listener, now: number, station: string, frontWindow: string) {
    if (!this.mix || !this.ctx || now - this.lastUpdate < UPDATE_MS) return;
    const dt = this.lastUpdate ? (now - this.lastUpdate) / 1000 : 0;
    this.lastUpdate = now;
    const moved = this.mix.update(listener);

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

    const t = this.ctx.currentTime;
    for (const bed of Object.keys(BED_EVENTS) as BedName[]) {
      if (!this.mix.hasBed(bed)) continue;
      const { events, everyS } = BED_EVENTS[bed];
      const due = this.nextEvent.get(bed);
      if (due === undefined) this.nextEvent.set(bed, t + between(everyS));
      else if (t >= due) {
        this.nextEvent.set(bed, t + between(everyS));
        // As far forward as the city's bed: faint from the room, full at the window.
        const level = MUSIC_MIX[this.current].city;
        if (level > 0.05) this.play(events[Math.floor(Math.random() * events.length)], undefined, level);
      }
    }
    for (const { name, everyS } of AMBIENT) {
      if (!this.anchorOf(EFFECTS[name].anchors) || this.current === 'os') continue;
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
      musicSource: this.source,
      musicHeld: this.held,
      /** The turntable's stream: which record, the needle, whether the music itself plays, its position. */
      deck: this.deckReady?.state ?? null,
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
    if (!this.loaded) throw new Error('room audio: the sound has not been made yet (muted, or before the room started)');
    await this.loaded;
    const { state = 'room', startup = false, fadeIn = false, clicks = [], effects = [] } = options;
    const ctx = new OfflineAudioContext(2, Math.round(seconds * OFFLINE_RATE), OFFLINE_RATE);
    const mix = new RoomMix(ctx, this.positions);
    mix.output.connect(ctx.destination);
    mix.update(listener, true);
    for (const name of LOOPS) {
      const buffer = this.buffers.get(`room/${name}`);
      if (buffer) mix.loop(name, buffer, 0);
    }
    const startupBuffer = this.buffers.get('room/startup');
    if (startup && startupBuffer) mix.startup(startupBuffer, 0);
    mix.startMusic(this.stems(), state, 0, fadeIn ? undefined : 0);
    mix.setState(state, true);
    if (options.record) {
      const buffer = await this.fetch(ctx, 'records', options.record);
      if (!buffer) throw new Error(`room audio: could not load the record ${options.record}`);
      mix.setMusicSource('record', state, true);
      mix.recordBuffer(buffer, 0);
    }
    for (const bed of Object.keys(BED_ANCHORS) as BedName[]) {
      const at = this.anchorOf(BED_ANCHORS[bed]);
      if (!at) continue;
      const buffer = await this.fetch(ctx, 'city', bed);
      if (buffer) mix.bed(bed, buffer, { position: at, ref: BED_REF_M[bed] }, MUSIC_MIX[state].city, 0, true);
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
    this.deckReady?.dispose();
    this.ctx?.removeEventListener('statechange', this.onState);
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ctx?.close();
    this.ctx = null;
    this.mix = null;
    this.listeners.clear();
  }

  private readonly onVisibility = () => {
    if (!this.ctx) return;
    const hidden = document.visibilityState === 'hidden';
    this.deckReady?.hold(this.deckHeld());
    if (hidden) void this.ctx.suspend();
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
    const beds = Promise.all((Object.keys(BED_ANCHORS) as BedName[]).filter((bed) => this.anchorOf(BED_ANCHORS[bed])).map((bed) => this.startBed(ctx, mix, bed)));
    await Promise.all([room, music, effects, beds]);
  }

  private async startBed(ctx: BaseAudioContext, mix: RoomMix, bed: BedName) {
    const buffer = await this.fetch(ctx, 'city', bed);
    const at = this.anchorOf(BED_ANCHORS[bed]);
    if (buffer && at && this.mix === mix) mix.bed(bed, buffer, { position: at, ref: BED_REF_M[bed] }, MUSIC_MIX[this.current].city);
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
    // Before the first fade the master stays silent; that fade goes to the level set by then.
    if (!this.ctx || !this.master || !this.faded) return;
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

