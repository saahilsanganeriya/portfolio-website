import * as THREE from 'three';
import { WORLD_SCALE } from './RoomModel';

// Every sound in the room is synthesised here: no recordings ship. The mapping from camera distance to a
// low-pass filter is Henry's: the room tone muffles as you lean into the monitor, and each machine is clearer
// the closer you are to it.

interface Source {
  position: THREE.Vector3;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  /** Full volume at this distance (metres) and nearer. */
  near: number;
  volume: number;
}

const map = (v: number, a: number, b: number, c: number, d: number) => c + ((d - c) * (v - a)) / (b - a);
const clamp = THREE.MathUtils.clamp;

function noiseBuffer(ctx: BaseAudioContext, seconds: number, colour: 'pink' | 'brown') {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    if (colour === 'pink') {
      // Paul Kellet's economy pink filter.
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    } else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

/** An 8 mm projector's shutter: 18 soft ticks a second, each a few milliseconds of filtered noise. */
function shutterBuffer(ctx: BaseAudioContext) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const tickLength = Math.floor(ctx.sampleRate * 0.004);
  for (let tick = 0; tick < 18; tick++) {
    const start = Math.floor((tick / 18) * ctx.sampleRate);
    for (let i = 0; i < tickLength; i++) data[start + i] += (Math.random() * 2 - 1) * Math.exp(-i / (tickLength / 4)) * 0.6;
  }
  return buffer;
}

export class RoomAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private room: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  private readonly sources: Source[] = [];
  private clickBuffer: AudioBuffer | null = null;
  private muted = false;
  private lastUpdate = 0;
  private readonly local = new THREE.Vector3();

  constructor(
    private readonly crtPosition: THREE.Vector3,
    private readonly projectorPosition: THREE.Vector3 | null,
    private readonly deskPosition: THREE.Vector3,
  ) {}

  /** Call inside the START click: browsers only let a user gesture start sound. */
  unlock() {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    void ctx.resume();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    this.buildRoomTone(ctx);
    this.buildCrt(ctx);
    if (this.projectorPosition) this.buildProjector(ctx, this.projectorPosition);
    this.clickBuffer = noiseBuffer(ctx, 0.05, 'pink');
    this.powerOn(ctx);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** A key or mouse-button click at the desk, a little different each time. */
  click(kind: 'key' | 'mouse') {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.clickBuffer) return;
    const source = ctx.createBufferSource();
    source.buffer = this.clickBuffer;
    source.playbackRate.value = 0.85 + Math.random() * 0.3;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = kind === 'key' ? 2200 + Math.random() * 900 : 3800;
    band.Q.value = 1.4;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(kind === 'key' ? 0.5 : 0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    source.connect(band).connect(gain).connect(this.master);
    source.start(t);
    source.stop(t + 0.06);
  }

  /** Re-maps filters and gains from the camera, at most 20 times a second. */
  update(camera: THREE.Camera, now: number) {
    const ctx = this.ctx;
    if (!ctx || now - this.lastUpdate < 50) return;
    this.lastUpdate = now;
    const t = ctx.currentTime;

    if (this.room) {
      // Henry's mapping, in metres: muffled at the monitor, open from across the room.
      const d = camera.position.distanceTo(this.deskPosition) / WORLD_SCALE;
      this.room.filter.frequency.setTargetAtTime(clamp(map(d, 0, 2.7, 100, 22000) - 3000, 120, 20000), t, 0.15);
      this.room.gain.gain.setTargetAtTime(clamp(map(d, 0.32, 2.7, 0, 0.2), 0.05, 0.1), t, 0.15);
    }

    for (const s of this.sources) {
      const d = Math.max(0.05, camera.position.distanceTo(s.position) / WORLD_SCALE);
      const cutoff = clamp(18000 * Math.pow(s.near / d, 1.6), 180, 18000);
      s.filter.frequency.setTargetAtTime(cutoff, t, 0.15);
      s.gain.gain.setTargetAtTime(s.volume * Math.min(1, s.near / d), t, 0.15);
      this.local.copy(s.position).applyMatrix4(camera.matrixWorldInverse);
      s.pan.pan.setTargetAtTime(clamp(this.local.x / Math.max(1, this.local.length()), -1, 1) * 0.7, t, 0.15);
    }
  }

  private source(ctx: AudioContext, position: THREE.Vector3, near: number, volume: number): Source {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    const pan = ctx.createStereoPanner();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(pan).connect(gain).connect(this.master!);
    const s = { position, filter, gain, pan, near, volume };
    this.sources.push(s);
    return s;
  }

  private buildRoomTone(ctx: AudioContext) {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 6, 'pink');
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    noise.connect(filter).connect(gain).connect(this.master!);
    noise.start();
    this.room = { filter, gain };
  }

  /** Mains hum at 60 Hz with its harmonics, and the faint 15.7 kHz line-scan whine of the tube. */
  private buildCrt(ctx: AudioContext) {
    const out = this.source(ctx, this.crtPosition, 0.45, 0.06);
    [
      [60, 1],
      [120, 0.55],
      [180, 0.3],
      [240, 0.14],
      [15734, 0.05],
    ].forEach(([frequency, level]) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(out.filter);
      osc.start();
    });
  }

  /** The motor's whir with the shutter's tick over it. */
  private buildProjector(ctx: AudioContext, position: THREE.Vector3) {
    const out = this.source(ctx, position, 0.6, 0.18);
    const motor = ctx.createBufferSource();
    motor.buffer = noiseBuffer(ctx, 4, 'brown');
    motor.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 210;
    band.Q.value = 1.1;
    motor.connect(band).connect(out.filter);
    motor.start();

    const shutter = ctx.createBufferSource();
    shutter.buffer = shutterBuffer(ctx);
    shutter.loop = true;
    const tickBand = ctx.createBiquadFilter();
    tickBand.type = 'highpass';
    tickBand.frequency.value = 900;
    const tickGain = ctx.createGain();
    tickGain.gain.value = 0.35;
    shutter.connect(tickBand).connect(tickGain).connect(out.filter);
    shutter.start();
  }

  /** The tube warming up: a low thump, then a degauss swell that settles. */
  private powerOn(ctx: AudioContext) {
    const t = ctx.currentTime + 0.05;
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(70, t);
    thump.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    thump.connect(thumpGain).connect(this.master!);
    thump.start(t);
    thump.stop(t + 0.4);

    const swell = ctx.createOscillator();
    swell.type = 'triangle';
    swell.frequency.setValueAtTime(110, t + 0.08);
    swell.frequency.exponentialRampToValueAtTime(58, t + 1.1);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 9;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 6;
    wobble.connect(wobbleDepth).connect(swell.frequency);
    const swellGain = ctx.createGain();
    swellGain.gain.setValueAtTime(0.0001, t + 0.08);
    swellGain.gain.exponentialRampToValueAtTime(0.08, t + 0.2);
    swellGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    swell.connect(swellGain).connect(this.master!);
    swell.start(t + 0.08);
    wobble.start(t + 0.08);
    swell.stop(t + 1.25);
    wobble.stop(t + 1.25);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
