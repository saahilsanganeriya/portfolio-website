import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { AudioHandle } from '../audio/RoomAudio';
import { CRATE, duration, recordById, sleeveSvg, type CrateRecord, type RecordId } from '../audio/crate';

// The record player by the armchair and its crate (PLAN-ROUND-7 §7). A click on the player opens the crate overlay;
// picking a record swings the tonearm out, lowers the needle and spins the platter, and the record becomes the room's
// music until it ends, Stop is pressed or the player is clicked again. Reduced motion keeps the arm and platter still,
// and the record still plays. Loaded the first time the visitor reaches the player.

export interface RecordPlayerHost {
  readonly audio: Pick<AudioHandle, 'setMusicSource' | 'musicSource' | 'subscribe' | 'muted'>;
  readonly reducedMotion: boolean;
  /** The framing the camera is at or heading to. */
  station(): string;
  announce(text: string): void;
}

const RPM = 100 / 3;
const SPIN_UP_S = 0.35;
const SPIN_DOWN_S = 1.2;
// The arm's moves, in seconds; the needle meets the groove when the lowering ends.
const LIFT_S = 0.25;
const SWING_S = 0.9;
const LOWER_S = 0.35;
const LIFT_M = 0.008;
// Without a play angle in the room file, the needle sets down this far out from the spindle (fraction of the platter).
const LEAD_IN = 0.93;
const MAX_SWING_DEG = 60;
// With the arm held still, the needle "meets the groove" this soon after the choice.
const STILL_CUE_S = 0.3;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

interface ArmMove {
  /** 'lift' / 'lower' move the needle up and down; 'swing' turns the arm between rest (0) and play (1). */
  kind: 'lift' | 'lower' | 'swing';
  from: number;
  to: number;
  seconds: number;
  t: number;
}

interface Arm {
  node: THREE.Object3D;
  /** The arm's pivot axis (world up) in its parent's space. */
  axis: THREE.Vector3;
  rest: THREE.Quaternion;
  restPosition: THREE.Vector3;
  /** Parent-space lift for LIFT_M metres up. */
  up: THREE.Vector3;
  playRad: number;
}

const readDeg = (data: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) if (typeof data[key] === 'number') return data[key] as number;
  return null;
};

/** World up in `node`'s parent space. */
function upInParent(node: THREE.Object3D) {
  const parent = node.parent;
  const up = new THREE.Vector3(0, 1, 0);
  if (!parent) return up;
  parent.updateWorldMatrix(true, false);
  return up.transformDirection(parent.matrixWorld.clone().invert()).normalize();
}

/**
 * The arm's play angle: from the room file if T43 recorded one, else the smallest turn about the pivot that sets the
 * stylus (the arm's point farthest from its pivot) down on the lead-in groove.
 */
function playAngle(tonearm: THREE.Object3D, platter: THREE.Object3D): number {
  const given = readDeg(tonearm.userData, ['play_angle_deg', 'play_deg', 'angle_play_deg']);
  const rest = readDeg(tonearm.userData, ['rest_angle_deg', 'rest_deg', 'angle_rest_deg']) ?? 0;
  if (given !== null) return THREE.MathUtils.degToRad(given - rest);
  tonearm.updateWorldMatrix(true, true);
  const pivot = tonearm.getWorldPosition(new THREE.Vector3());
  let stylus = pivot.clone();
  tonearm.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const position = mesh.isMesh ? mesh.geometry.getAttribute('position') : null;
    if (!position) return;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (v.distanceToSquared(pivot) > stylus.distanceToSquared(pivot)) stylus = v.clone();
    }
  });
  const bounds = new THREE.Box3().setFromObject(platter);
  const spindle = bounds.getCenter(new THREE.Vector3());
  const radius = (Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2) * LEAD_IN;
  const worldAxis = new THREE.Vector3(0, 1, 0);
  const flat = (p: THREE.Vector3) => Math.hypot(p.x - spindle.x, p.z - spindle.z);
  let best = 0;
  let bestError = Infinity;
  for (let deg = -MAX_SWING_DEG; deg <= MAX_SWING_DEG; deg += 0.25) {
    const turned = stylus.clone().sub(pivot).applyAxisAngle(worldAxis, THREE.MathUtils.degToRad(deg)).add(pivot);
    const error = Math.abs(flat(turned) - radius) + Math.abs(deg) * 1e-4 * WORLD_SCALE;
    if (error < bestError) [best, bestError] = [deg, error];
  }
  // A turn about world up equals the same turn about the arm's axis in its parent's space.
  return THREE.MathUtils.degToRad(best);
}

export class RecordPlayer {
  private readonly arm: Arm | null;
  private readonly platter: { node: THREE.Object3D; axis: THREE.Vector3; rest: THREE.Quaternion } | null;
  private readonly panel: HTMLElement | null;
  private readonly unsubscribe: () => void;
  private moves: ArmMove[] = [];
  private swing = 0;
  private lift = 0;
  private spin = 0;
  private speed = 0;
  private playing: RecordId | null = null;
  private openedAt: string | null = null;
  private built = false;
  private readonly abort = new AbortController();

  constructor(
    root: THREE.Object3D,
    private readonly host: RecordPlayerHost,
    panel: HTMLElement | null = document.querySelector<HTMLElement>('[data-records]'),
  ) {
    const tonearm = root.getObjectByName('tonearm');
    const platter = root.getObjectByName('platter');
    if (tonearm && platter) {
      const axis = upInParent(tonearm);
      this.arm = {
        node: tonearm,
        axis,
        rest: tonearm.quaternion.clone(),
        restPosition: tonearm.position.clone(),
        up: upInParent(tonearm).multiplyScalar(LIFT_M * WORLD_SCALE),
        playRad: playAngle(tonearm, platter),
      };
    } else this.arm = null;
    this.platter = platter ? { node: platter, axis: upInParent(platter), rest: platter.quaternion.clone() } : null;
    this.panel = panel;
    this.playing = host.audio.musicSource;
    // A record that ends by itself (or cannot load) hands the music back: the arm returns.
    this.unsubscribe = host.audio.subscribe(() => {
      const now = host.audio.musicSource;
      if (now === this.playing) return this.refresh();
      if (now === null && this.playing) this.returnArm();
      this.playing = now;
      this.refresh();
    });
  }

  get isOpen() {
    return Boolean(this.panel && !this.panel.hidden);
  }

  /** The arm or the platter is changing: frames must be drawn (also while ambient motion is paused). */
  get animating() {
    return this.moves.length > 0 || Math.abs(this.speed - this.targetSpeed) > 0.01;
  }

  /** A click on the player: stops the record that is playing, otherwise opens the crate. */
  activate() {
    if (this.playing) this.stop();
    else this.open();
  }

  open() {
    if (!this.panel) return;
    this.build();
    this.panel.hidden = false;
    this.openedAt = this.host.station();
    this.refresh();
    const first = this.panel.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? this.panel.querySelector<HTMLButtonElement>('[data-record]');
    first?.focus({ preventScroll: true });
  }

  close() {
    if (!this.panel || this.panel.hidden) return;
    const hadFocus = this.panel.contains(document.activeElement) || document.activeElement === document.body;
    this.panel.hidden = true;
    this.openedAt = null;
    if (hadFocus) document.querySelector<HTMLElement>('[data-room]')?.focus({ preventScroll: true });
  }

  choose(id: RecordId) {
    const record = recordById(id);
    if (!record || id === this.playing) return;
    const wasPlaying = this.playing !== null;
    this.playing = id;
    // The needle meets the groove when the arm's moves end; a record swapped mid-play lifts and sets down again.
    let cue = STILL_CUE_S;
    if (!this.host.reducedMotion && this.arm) {
      cue = this.queue(wasPlaying ? [['lift', 1, LIFT_S], ['lower', 0, LOWER_S]] : [['lift', 1, LIFT_S], ['swing', 1, SWING_S], ['lower', 0, LOWER_S]]);
    }
    this.host.audio.setMusicSource(id, cue);
    this.host.announce(`Now playing ${record.title} by ${record.artist}.`);
    this.refresh();
  }

  stop() {
    if (!this.playing) return;
    // Cleared first: the audio's subscribers hear the change at once and must find the player already stopped.
    this.playing = null;
    this.returnArm();
    this.host.audio.setMusicSource(null);
    this.host.announce('The record is off; the room’s own music is back.');
    this.refresh();
  }

  update(realDt: number, running: boolean) {
    // The camera left the player while the crate was open: the crate goes with it.
    if (this.openedAt !== null && this.host.station() !== this.openedAt) this.close();
    if (this.host.reducedMotion) return;
    const move = this.moves[0];
    if (move) {
      move.t = Math.min(move.seconds, move.t + realDt);
      const value = THREE.MathUtils.lerp(move.from, move.to, smoothstep(move.seconds > 0 ? move.t / move.seconds : 1));
      if (move.kind === 'swing') this.swing = value;
      else this.lift = value;
      if (move.t >= move.seconds) this.moves.shift();
    }
    // The platter is ambient motion once it is up to speed, so a paused room holds it where it is.
    if (running) {
      const tau = this.targetSpeed > this.speed ? SPIN_UP_S : SPIN_DOWN_S;
      this.speed += (this.targetSpeed - this.speed) * (1 - Math.exp(-realDt / tau));
      this.spin = (this.spin + this.speed * realDt) % (Math.PI * 2);
    }
    this.pose();
  }

  probe() {
    return {
      open: this.isOpen,
      playing: this.playing,
      hasPlayer: this.arm !== null,
      swing: this.swing,
      lift: this.lift,
      rpm: (this.speed * 60) / (Math.PI * 2),
      playAngleDeg: this.arm ? THREE.MathUtils.radToDeg(this.arm.playRad) : null,
    };
  }

  dispose() {
    this.unsubscribe();
    this.abort.abort();
  }

  private get targetSpeed() {
    return this.playing && !this.host.reducedMotion ? (RPM * Math.PI * 2) / 60 : 0;
  }

  /** Queues arm moves (each from wherever the previous one ends); returns their total seconds. */
  private queue(steps: [ArmMove['kind'], number, number][]) {
    let swing = this.moves.reduce((s, m) => (m.kind === 'swing' ? m.to : s), this.swing);
    let lift = this.moves.reduce((l, m) => (m.kind === 'swing' ? l : m.to), this.lift);
    let total = this.moves.reduce((sum, m) => sum + m.seconds - m.t, 0);
    for (const [kind, to, seconds] of steps) {
      const from = kind === 'swing' ? swing : lift;
      this.moves.push({ kind, from, to, seconds, t: 0 });
      if (kind === 'swing') swing = to;
      else lift = to;
      total += seconds;
    }
    return total;
  }

  private returnArm() {
    if (this.host.reducedMotion || !this.arm) return;
    this.queue([['lift', 1, LIFT_S], ['swing', 0, SWING_S], ['lower', 0, LOWER_S * 0.8]]);
  }

  private pose() {
    if (this.arm) {
      const { node, axis, rest, restPosition, up, playRad } = this.arm;
      node.quaternion.setFromAxisAngle(axis, playRad * this.swing).multiply(rest);
      node.position.copy(restPosition).addScaledVector(up, this.lift);
    }
    if (this.platter) this.platter.node.quaternion.setFromAxisAngle(this.platter.axis, -this.spin).multiply(this.platter.rest);
  }

  // ---- the crate overlay (src/components/RecordCrate.astro) ----

  private build() {
    const panel = this.panel;
    if (!panel || this.built) return;
    this.built = true;
    const q = <T extends Element>(selector: string) => panel.querySelector<T>(selector)!;
    const list = q<HTMLUListElement>('[data-records-list]');
    for (const record of CRATE) list.append(this.item(record));
    const credits = q<HTMLUListElement>('[data-records-credits]');
    for (const record of CRATE) credits.append(this.creditItem(record));
    const { signal } = this.abort;

    list.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-record]');
      if (button) this.choose(button.dataset.record as RecordId);
    }, { signal });
    // Arrow keys move between the sleeves (Tab does too); the room must not also take them as a step.
    list.addEventListener('keydown', (event) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const buttons = [...list.querySelectorAll<HTMLButtonElement>('[data-record]')];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    }, { signal });
    // Stop disables itself, so focus moves to the sleeve of the record that was playing rather than falling to the page.
    q<HTMLButtonElement>('[data-records-stop]').addEventListener('click', () => {
      const was = this.playing;
      this.stop();
      if (was) list.querySelector<HTMLButtonElement>(`[data-record="${was}"]`)?.focus();
    }, { signal });
    q<HTMLButtonElement>('[data-records-close]').addEventListener('click', () => this.close(), { signal });
    // The crate's own way to turn the sound on is the room's Sound button, so the choice is remembered in one place.
    q<HTMLButtonElement>('[data-records-sound-on]').addEventListener(
      'click',
      () => document.querySelector<HTMLButtonElement>('[data-room-sound]')?.click(),
      { signal },
    );
    // Escape closes the crate wherever focus is, before the room would take it as "back out".
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.preventDefault();
      this.close();
    }, { capture: true, signal });
  }

  private item(record: CrateRecord) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'room-records-record';
    button.dataset.record = record.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${record.title}, ${record.artist}. ${record.genre}, ${duration(record.seconds)}.`);
    button.innerHTML = `<span class="room-records-sleeve">${sleeveSvg(record.id)}</span>`;
    const caption = document.createElement('span');
    caption.className = 'room-records-caption';
    caption.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = 'room-records-title';
    title.textContent = record.title;
    const meta = document.createElement('span');
    meta.className = 'room-records-meta';
    meta.textContent = `${record.artist} · ${record.genre} · ${duration(record.seconds)}`;
    caption.append(title, meta);
    button.append(caption);
    li.append(button);
    return li;
  }

  private creditItem(record: CrateRecord) {
    const li = document.createElement('li');
    const link = (href: string, text: string) => {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = text;
      return a;
    };
    li.append(`${record.credit}. `, link(record.sourceUrl, 'Source'), ' · ', link(record.licenceUrl, 'Licence'));
    return li;
  }

  private refresh() {
    const panel = this.panel;
    if (!panel || !this.built) return;
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-record]')) {
      button.setAttribute('aria-pressed', String(button.dataset.record === this.playing));
    }
    const now = this.playing ? recordById(this.playing) : null;
    panel.querySelector('[data-records-now]')!.textContent = now ? `Now playing: ${now.title}, ${now.artist}` : 'Nothing on the turntable.';
    panel.querySelector<HTMLButtonElement>('[data-records-stop]')!.disabled = !now;
    panel.querySelector<HTMLElement>('[data-records-sound]')!.hidden = !this.host.audio.muted;
  }
}
