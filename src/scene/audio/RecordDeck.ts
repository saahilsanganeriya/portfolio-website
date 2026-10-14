import type { RecordId } from './crate';
import records from './records.json';
import { powerCurve } from './state';

// A record on the turntable, in sound: the chosen file streams through one <audio> element into the room's music
// (nothing of it is fetched before the visitor picks it); the needle's drop and lift are recordings, and the groove's
// crackle loops under the music while the needle is down. Loaded with the first record a visitor chooses.

/** Seconds of bare groove between the needle touching down and the music, as on a real lead-in. */
const LEAD_IN_S = 0.9;
const RECORD_FADE_IN_S = 0.4;
const RECORD_FADE_OUT_S = 0.6;
const CRACKLE_FADE_S = 0.5;

export interface DeckHost {
  /** A decoded recording from public/audio/records/, or null if it cannot load. */
  sound(name: 'crackle' | 'needle-drop' | 'needle-lift'): Promise<AudioBuffer | null>;
  /** Plays a one-shot at the turntable at context time `when`. */
  shot(buffer: AudioBuffer, when: number): void;
  /** The extension the browser decodes ('webm' first, then 'm4a'). */
  formats(): readonly string[];
  /** The record finished by itself, or could not be played. */
  ended(record: RecordId, failed: boolean): void;
}

export interface DeckState {
  record: RecordId | null;
  /** The needle is in the groove (the crackle is playing). */
  needleDown: boolean;
  /** The music itself is playing (not waiting for the lead-in or the stream). */
  playing: boolean;
  time: number;
  /** The file streaming now (its URL path). */
  src: string | null;
}

export class RecordDeck {
  private readonly element: HTMLAudioElement;
  private readonly fade: GainNode;
  private crackle: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private current: RecordId | null = null;
  private needleDown = false;
  /** Bumped by every play and stop, so a late callback from an earlier one does nothing. */
  private turn = 0;
  private held = false;
  private startTimer = 0;
  private formatIndex = 0;

  constructor(
    private readonly ctx: AudioContext,
    input: AudioNode,
    private readonly crackleInput: AudioNode,
    private readonly host: DeckHost,
  ) {
    this.element = new Audio();
    this.element.preload = 'none';
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    ctx.createMediaElementSource(this.element).connect(this.fade).connect(input);
    this.element.addEventListener('ended', () => {
      if (this.current) this.host.ended(this.current, false);
    });
    this.element.addEventListener('error', () => this.onError());
  }

  /** Puts `record` on: the needle meets the groove `cue` seconds from now, the music follows the lead-in. */
  play(record: RecordId, cue: number) {
    const turn = ++this.turn;
    const switching = this.current !== null && this.current !== record;
    this.current = record;
    this.formatIndex = 0;
    clearTimeout(this.startTimer);
    if (switching) this.lift();
    this.element.pause();
    this.element.src = this.url(record);
    this.element.load();
    const touch = this.ctx.currentTime + Math.max(0, cue);
    void this.host.sound('needle-drop').then((buffer) => buffer && turn === this.turn && this.host.shot(buffer, touch));
    void this.startCrackle(turn, touch);
    this.needleDown = true;
    // The element streams while the arm swings; the music starts once the lead-in has run and enough has arrived.
    this.startTimer = window.setTimeout(() => this.whenReady(turn), (Math.max(0, cue) + LEAD_IN_S) * 1000);
  }

  /** Lifts the needle: the music and the groove fade out and the stream stops. */
  stop() {
    this.turn++;
    clearTimeout(this.startTimer);
    if (this.current === null) return;
    this.current = null;
    this.lift();
  }

  /** Mute and hidden tabs: the record waits where it is (the room's context is suspended too). */
  hold(held: boolean) {
    if (held === this.held) return;
    this.held = held;
    if (held) this.element.pause();
    else if (this.current && this.needleDown && this.fade.gain.value > 0) void this.element.play().catch(() => {});
  }

  get state(): DeckState {
    return {
      record: this.current,
      needleDown: this.needleDown,
      playing: !this.element.paused && !this.element.ended && this.current !== null,
      time: this.element.currentTime,
      src: this.current ? new URL(this.element.currentSrc || this.element.src, location.href).pathname : null,
    };
  }

  dispose() {
    this.stop();
    this.element.removeAttribute('src');
    this.element.load();
  }

  private url(record: RecordId) {
    return `/audio/records/${record}.${this.host.formats()[this.formatIndex] ?? 'webm'}`;
  }

  private whenReady(turn: number) {
    if (turn !== this.turn || !this.current) return;
    if (this.element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      this.element.addEventListener('canplay', () => this.whenReady(turn), { once: true });
      return;
    }
    this.glide(1, RECORD_FADE_IN_S);
    if (!this.held) void this.element.play().catch(() => this.onError());
  }

  private onError() {
    if (!this.current) return;
    // Opus first, then the AAC copy; when both fail the record goes back in the crate.
    if (++this.formatIndex < this.host.formats().length) {
      this.element.src = this.url(this.current);
      this.element.load();
      return;
    }
    console.warn(`room audio: could not play the record ${this.current}`);
    const failed = this.current;
    this.stop();
    this.host.ended(failed, true);
  }

  private lift() {
    const element = this.element;
    this.glide(0, RECORD_FADE_OUT_S);
    window.setTimeout(() => {
      if (this.fade.gain.value < 0.01 && !this.current) element.pause();
    }, RECORD_FADE_OUT_S * 1000 + 50);
    if (this.needleDown) void this.host.sound('needle-lift').then((buffer) => buffer && this.host.shot(buffer, this.ctx.currentTime));
    this.needleDown = false;
    const crackle = this.crackle;
    this.crackle = null;
    if (crackle) {
      const t = this.ctx.currentTime;
      crackle.gain.gain.cancelScheduledValues(t);
      crackle.gain.gain.setTargetAtTime(0, t, CRACKLE_FADE_S / 3);
      crackle.source.stop(t + CRACKLE_FADE_S * 2);
    }
  }

  private async startCrackle(turn: number, when: number) {
    const buffer = await this.host.sound('crackle');
    if (!buffer || turn !== this.turn || this.crackle) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = records.padSeconds;
    source.loopEnd = records.padSeconds + records.crackle.seconds;
    const gain = this.ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain).connect(this.crackleInput);
    source.start(Math.max(when, this.ctx.currentTime), records.padSeconds);
    this.crackle = { source, gain };
  }

  private glide(to: number, seconds: number) {
    const t = this.ctx.currentTime;
    const from = this.fade.gain.value;
    this.fade.gain.cancelScheduledValues(t);
    this.fade.gain.setValueCurveAtTime(powerCurve(from, to), t, seconds);
  }
}
