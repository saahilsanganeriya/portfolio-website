import * as THREE from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { AudioHandle, SfxName } from '../audio/RoomAudio';
import { HOTSPOTS, type Hotspot } from '../hotspots';
import type { Effects } from '../Application/Effects';
import type { QualityTier } from '../Application/Quality';
import type { RoomNodes, StationName } from '../Application/RoomModel';
import { WORLD_SCALE } from '../Application/RoomModel';
import { Album } from './Album';
import { ArtSurface, lampUniforms, Posters } from './art';
import { Espresso } from './Espresso';
import { FILM } from './film';
import { Instax } from './Instax';
import { LavaLamp } from './LavaLamp';
import { readWorld, type WorldNodes } from './nodes';
import type { Photograph } from './photographs';
import { Projector } from './Projector';
import { Oven, Steam } from './props';
import type { RecordPlayer } from './RecordPlayer';
import { StickyNotes } from './StickyNotes';
import { TextureStore } from './textures';
import { WindowView } from './WindowView';

// Everything in the room that lives and reacts (PLAN 11.1, 12.1, PLAN-ROUND-7 §3–§4 and §7): the window's two cities
// by day with the flight between them, the lava lamp and its light, the espresso machine's pour and the cup's steam,
// the oven's door
// and glow, the projector on the wall, the favourite posters, the Instax board, the sticky notes and the photo album.
// It carries out every hotspot's room action, with the recordings its actions make. A click that comes from across
// the room takes the camera to the prop first, and the prop acts once the camera has landed. What the visitor first
// sees loads with the room; everything else waits until the room is interactive, then loads when it comes into view
// or is asked for.

export interface WorldHost {
  /** Glides to a framing (the camera's seam); false if the room has no such framing. */
  fly(station: StationName): boolean;
  /** The framing the camera is at or heading to. */
  station(): string;
  openWindow(target: string): void;
  /** The audio layer's recorded one-shot (`audio.sfx`). */
  sfx(name: SfxName, at?: THREE.Vector3): void;
  /** The projector's running sound (`audio.setProjectorRunning`). */
  setProjectorRunning?(running: boolean): void;
  /** The room's sound, for the record player: which music plays (the lo-fi bed or a record) and whether sound is off. */
  readonly audio?: Pick<AudioHandle, 'setMusicSource' | 'musicSource' | 'subscribe' | 'muted'>;
  /** While the album is open the monitor's frame must not take the pointer (it lies behind the book). */
  setMonitorBlocked(blocked: boolean): void;
  readonly reducedMotion: boolean;
  /** The phone tier keeps the projector wall's baked light (no film to download and decode). */
  readonly light: boolean;
}

export interface WorldFrame {
  camera: THREE.PerspectiveCamera;
  /** Ambient seconds (frozen while motion is paused) and this frame's share of them. */
  clock: number;
  dt: number;
  /** Real seconds since the last frame, for motion the visitor started (a pour, a door, the album). */
  realDt: number;
  /** The room has started and motion is not paused. */
  running: boolean;
  pixelRatio: number;
}

const LABELS_EVERY_S = 1;
// Once the room is interactive, on-demand loading starts after this pause, so it never overlaps the first moment.
const ON_DEMAND_DELAY_MS = 400;
// A prop acts once the camera it called has landed: slower than this (world units a second) for a moment, or after
// this long whatever the camera is doing.
const LANDED_SPEED = 0.03 * WORLD_SCALE;
const LANDED_FRAMES = 3;
const LANDING_TIMEOUT_S = 2.4;
// The espresso cup's fresh steam rises once the shot is in the cup.
const STEAM_AFTER_S = 2;

/** A prop's action waiting for the camera to land at its framing. */
interface Landing {
  station: StationName;
  run: () => void;
  waited: number;
  still: number;
}

export class World {
  private readonly nodes: WorldNodes;
  private readonly textures: TextureStore;
  private readonly lamp = lampUniforms();
  private readonly posters: Posters;
  private readonly paleBlueDot: ArtSurface | null;
  readonly instax: Instax | null;
  private readonly stickies: StickyNotes | null;
  private readonly windowView: WindowView | null;
  private readonly lava: LavaLamp | null;
  private readonly espresso: Espresso | null;
  private readonly steam: Steam | null;
  private readonly oven: Oven | null;
  readonly projector: Projector | null;
  private readonly album: Album | null;
  private readonly status: HTMLElement;
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly lastCamera = new THREE.Vector3();
  private collectionPromise: Promise<Photograph[]> | null = null;
  private landing: Landing | null = null;
  private records: RecordPlayer | null = null;
  private recordsLoading: Promise<RecordPlayer | null> | null = null;
  private everything = false;
  private interactive = false;
  private printsWanted = false;
  private sinceLabels = LABELS_EVERY_S;
  private steamAt = -1;
  /** The camera of the last frame, to project the window's motif for tests. */
  private camera: THREE.Camera | null = null;
  private timer = 0;

  constructor(
    private readonly room: RoomNodes,
    scene: THREE.Scene,
    container: HTMLElement,
    ktx2: KTX2Loader,
    private readonly effects: Effects,
    private readonly host: WorldHost,
  ) {
    this.nodes = readWorld(room);
    const n = this.nodes;
    const still = host.reducedMotion;
    this.textures = new TextureStore(ktx2);
    this.posters = new Posters(n.posters, this.lamp);
    this.paleBlueDot = n.paleBlueDot
      ? new ArtSurface(n.paleBlueDot.node, this.lamp, { ambient: 0.55, top: 0.6, lightAbove: 0.3, fall: 0.45 })
      : null;
    this.instax = n.prints.length ? new Instax(n.prints, this.lamp, HOTSPOTS, n.printsAreInstax) : null;
    this.stickies = n.stickies.length ? new StickyNotes(n.stickies, this.lamp) : null;
    this.windowView = n.windowViews.length
      ? new WindowView(n.windowViews, n.windowSky, n.windowMotif, this.textures, { reducedMotion: still })
      : null;
    this.lava = n.lava ? new LavaLamp(n.lava.glass, n.lava.light, this.lamp, scene, room.root) : null;
    this.espresso = n.espresso ? new Espresso(n.espresso, scene) : null;
    this.steam = n.steam ? new Steam(n.steam, scene) : null;
    this.oven = n.oven ? new Oven(n.oven, scene) : null;
    this.projector =
      n.projector && !host.light
        ? new Projector(n.projector, FILM, this.textures, () => this.collection(), n.dial, this.lamp, still, {
            setRunning: (running) => host.setProjectorRunning?.(running),
          })
        : null;
    if (n.projector && room.projector) {
      // The beam fans out to the picture on the wall; its far end is square to the beam, so the picture's height
      // shortens by the beam's tilt.
      const dir = room.projector.screenCenter.clone().sub(room.projector.lens).normalize();
      effects.fitBeam(n.projector.width / 2, (n.projector.height / 2) * Math.sqrt(1 - dir.y * dir.y));
    }

    this.status = document.createElement('p');
    this.status.className = 'visually-hidden';
    this.status.setAttribute('role', 'status');
    container.appendChild(this.status);

    this.album = n.album
      ? new Album(n.album, room.framings.desk.position, room.framings.desk.fov, scene, container, {
          collection: () => this.collection().then((photos) => import('./photographs').then((m) => m.sections(photos))),
          textures: this.textures,
          reducedMotion: still,
          announce: (text) => this.announce(text),
          setCapturing: (capturing) => host.setMonitorBlocked(capturing),
        })
      : null;
    this.refreshLabels();
  }

  /** What the first view needs, before the room is shown: the posters, the window's pictures and motif, the sticky notes. */
  async load() {
    await Promise.all([this.posters.load(this.textures), this.windowView?.load(), this.stickies?.load()]);
  }

  /** The intro is over and the visitor can act: on-demand loading may start. */
  becomeInteractive() {
    if (this.interactive) return;
    this.timer = window.setTimeout(() => {
      this.interactive = true;
      this.projector?.allowOnDemand();
      this.loadPaleBlueDot();
      if (this.instax) {
        this.printsWanted = true;
        void this.collection().then((photos) => this.instax?.hang(photos));
      }
    }, ON_DEMAND_DELAY_MS);
  }

  get isInteractive() {
    return this.interactive;
  }

  /** Whether the album holds the stage's input (no hover labels, no glides from a click). */
  get capturing() {
    return this.album?.isOpen ?? false;
  }

  /** Something the visitor started is still moving: frames must be drawn even while motion is paused. */
  get animating() {
    return Boolean(
      this.album?.animating ||
        this.espresso?.busy ||
        this.oven?.moving ||
        this.lava?.changing ||
        this.projector?.animating ||
        this.records?.animating ||
        this.landing,
    );
  }

  /**
   * Carries out a hotspot's room action (with any recording it adds); returns false when the room should do the default:
   * fly to the hotspot's framing, then open its SaahilOS window.
   */
  activate(hotspot: Hotspot): boolean {
    const here = this.host.station();
    const still = this.host.reducedMotion;
    switch (hotspot.action) {
      case 'album':
        this.host.fly('desk');
        void this.album?.open();
        return true;
      case 'dial': {
        const projector = this.projector;
        if (!projector) return false;
        this.host.sfx('projector-clack', this.positionOf(hotspot));
        projector.next();
        this.refreshLabels();
        if (here !== 'projector') this.host.fly('projector');
        this.announce(`The projector now shows ${projector.label}.`);
        return true;
      }
      case 'lava': {
        const lava = this.lava;
        if (!lava) return false;
        lava.next(still);
        this.announce(`The lava lamp turns ${lava.name}.`);
        return true;
      }
      case 'espresso': {
        const espresso = this.espresso;
        if (!espresso) return false;
        this.whenLanded('espresso', () => {
          if (!espresso.pull(still)) return;
          this.steamAt = still ? -1 : STEAM_AFTER_S;
          this.announce(still ? 'A cup of espresso, poured.' : 'The espresso machine pulls a shot into the cup.');
        });
        return true;
      }
      case 'oven': {
        const oven = this.oven;
        if (!oven) return false;
        this.whenLanded('oven', () => {
          const open = oven.toggle(still);
          this.host.sfx(open ? 'oven-open' : 'oven-close');
          this.announce(open ? 'The oven door opens on a croissant. Click it for the recipes.' : 'The oven door closes.');
        });
        return true;
      }
      case 'projector': {
        const projector = this.projector;
        if (!projector) return false;
        const arriving = here !== 'projector';
        this.whenLanded('projector', () => {
          const was = projector.wanted;
          if (arriving) projector.play();
          else projector.toggle();
          if (projector.wanted !== was) this.host.sfx('projector-clack');
          this.announce(projector.wanted ? `The projector plays ${projector.label.toLowerCase()}.` : 'The projector stops.');
        });
        return true;
      }
      case 'window':
        if (here !== 'window' && this.host.fly('window')) return true;
        this.announce(`Out of the window: ${this.windowView?.label() ?? 'San Francisco and New Delhi'}.`);
        return true;
      case 'records': {
        const audio = this.host.audio;
        if (!audio) return false;
        this.whenLanded('record_player', () => void this.recordPlayer(audio).then((records) => records?.activate()));
        return true;
      }
      case 'print':
        // From across the room a print (a few pixels wide there) takes the camera to the board first; at the board it
        // opens its photograph in SaahilOS, the camera gliding to the desk and into the monitor.
        if (here !== 'photos' && this.host.fly('photos')) return true;
        if (hotspot.target) this.host.openWindow(hotspot.target);
        return true;
      default:
        return false;
    }
  }

  update(frame: WorldFrame) {
    const { camera, clock, dt, realDt, running, pixelRatio } = frame;
    const still = this.host.reducedMotion;
    this.camera = camera;
    this.land(camera, realDt);
    if (this.everything) this.keepEverythingRunning();

    this.posters.update(realDt);
    this.paleBlueDot?.update(realDt);
    this.instax?.update(realDt);
    this.windowView?.update(realDt);
    // Under reduced motion the lamp's wax and the oven's flicker hold still.
    const ambient = still ? 0 : clock;
    this.lava?.update(ambient, realDt, camera);

    const espresso = this.espresso;
    if (espresso) {
      espresso.update(realDt, clock);
      // The pour's recording starts with the pump, also after a full cup has been tipped out first.
      if (espresso.takeStart()) this.host.sfx('espresso-pour');
    }
    if (this.steamAt >= 0 && espresso && espresso.elapsed >= this.steamAt) {
      this.steamAt = -1;
      this.steam?.brew();
    }
    this.steam?.update(clock, Math.max(dt, espresso?.busy ? realDt : 0), pixelRatio, still);
    this.oven?.update(ambient, realDt, still);
    this.records?.update(realDt, running);

    const projector = this.projector;
    if (projector) {
      projector.update(camera, running, realDt);
      this.effects.setProjector(projector.beam, projector.running && running && !still);
    }
    this.album?.update(realDt, camera);
    if (this.album?.isOpen && this.host.station() !== 'desk') this.album.close();

    // The board's prints draw once it is in view.
    if (this.printsWanted && this.instax?.isHung) {
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection);
      if (this.frustum.intersectsBox(this.instax.box)) {
        this.printsWanted = false;
        void this.instax.load(this.textures, still);
      }
    }

    this.sinceLabels += realDt;
    if (this.sinceLabels >= LABELS_EVERY_S) this.refreshLabels();
  }

  /** Measurement hook: the lava lamp cycling, the steam up, a shot pouring again and again and the projector running. */
  forceEverything(on: boolean) {
    this.everything = on;
    this.projector?.force(on);
  }

  setTier(tier: QualityTier) {
    this.lava?.setHalos(tier.halos);
    this.oven?.setHalos(tier.halos);
  }

  /** Screen point of a world feature by name (album pages), for tests. */
  point(name: string, rect: DOMRect) {
    if (name === 'album_left' || name === 'album_right') return this.album?.point(name, rect) ?? null;
    if (name === 'window_motif') {
      const node = this.nodes.windowMotif?.anchor;
      if (!node || !this.camera) return null;
      const p = node.getWorldPosition(new THREE.Vector3()).project(this.camera);
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) return null;
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    }
    return undefined;
  }

  probe() {
    return {
      interactive: this.interactive,
      window: this.windowView?.state() ?? null,
      posters: this.posters.loaded,
      paleBlueDot: this.paleBlueDot?.shown ?? null,
      instax: this.instax?.probe() ?? null,
      stickies: this.stickies?.written ?? null,
      lava: this.lava?.probe() ?? null,
      espresso: this.espresso?.probe() ?? null,
      steam: this.steam ? { brewing: this.steam.brewing > 0 } : null,
      oven: this.oven?.probe() ?? null,
      projector: this.projector?.state ?? null,
      landing: this.landing?.station ?? null,
      records: this.records?.probe() ?? null,
      album: this.album?.probe() ?? null,
      labels: Object.fromEntries(HOTSPOTS.map((h) => [h.proxies[0], h.label])),
    };
  }

  dispose() {
    clearTimeout(this.timer);
    this.posters.dispose();
    this.paleBlueDot?.dispose();
    this.instax?.dispose();
    this.stickies?.dispose();
    this.windowView?.dispose();
    this.lava?.dispose();
    this.espresso?.dispose();
    this.steam?.dispose();
    this.oven?.dispose();
    this.projector?.dispose();
    this.album?.dispose();
    this.records?.dispose();
    this.textures.dispose();
    this.status.remove();
  }

  /** Opens the record crate where the camera is (keyboard and test access when the room has no player to click). */
  openRecords() {
    const audio = this.host.audio;
    if (audio) void this.recordPlayer(audio).then((records) => records?.open());
  }

  /** The Pale Blue Dot's picture (NASA/JPL, public/room/pale-blue-dot.ktx2) loads on demand, after the first view. */
  private loadPaleBlueDot() {
    const dot = this.paleBlueDot;
    const file = this.nodes.paleBlueDot?.file;
    if (!dot || !file) return;
    this.textures
      .ktx2(`/room/${file}`)
      .then((texture) => dot.show(texture, false))
      .catch((error) => console.warn('room: the Pale Blue Dot print did not load', error));
  }

  /** The record player and its crate load the first time the visitor reaches them. */
  private recordPlayer(audio: NonNullable<WorldHost['audio']>) {
    this.recordsLoading ??= import('./RecordPlayer').then(({ RecordPlayer }) => {
      this.records = new RecordPlayer(this.room.root, {
        audio,
        reducedMotion: this.host.reducedMotion,
        station: () => this.host.station(),
        announce: (text) => this.announce(text),
      });
      return this.records;
    });
    return this.recordsLoading;
  }

  /** Runs `run` once the camera has landed at `station`, flying there first if it is elsewhere. */
  private whenLanded(station: StationName, run: () => void) {
    if (this.host.station() !== station && !this.host.fly(station)) {
      run();
      return;
    }
    this.landing = { station, run, waited: 0, still: 0 };
  }

  /** The waiting action runs once the camera rests at its framing; a flight elsewhere cancels it. */
  private land(camera: THREE.Camera, realDt: number) {
    const position = camera.getWorldPosition(new THREE.Vector3());
    const speed = realDt > 0 ? position.distanceTo(this.lastCamera) / realDt : Infinity;
    this.lastCamera.copy(position);
    const landing = this.landing;
    if (!landing) return;
    if (this.host.station() !== landing.station) {
      this.landing = null;
      return;
    }
    landing.waited += realDt;
    landing.still = speed < LANDED_SPEED ? landing.still + 1 : 0;
    if (landing.still >= LANDED_FRAMES || landing.waited >= LANDING_TIMEOUT_S) {
      this.landing = null;
      landing.run();
    }
  }

  private keepEverythingRunning() {
    if (this.espresso && !this.espresso.busy) {
      this.espresso.pull(false);
      this.steamAt = STEAM_AFTER_S;
    }
    if (this.lava && !this.lava.changing) this.lava.next(false);
    // The film plays once; the worst case keeps it running.
    if (this.projector && !this.projector.running) this.projector.play();
  }

  /** The owner's photography: a chunk of its own, imported once and only when something needs it. */
  private collection() {
    this.collectionPromise ??= import('./photographs').then((m) => m.PHOTOGRAPHS);
    return this.collectionPromise;
  }

  private announce(text: string) {
    this.status.textContent = text;
  }

  private positionOf(hotspot: Hotspot) {
    const proxy = this.room.proxies.find((p) => hotspot.proxies.includes(p.name));
    return proxy ? new THREE.Box3().setFromObject(proxy).getCenter(new THREE.Vector3()) : undefined;
  }

  /** Labels that change with the room: the window's two cities, and the projector's next program on its dial. */
  private refreshLabels() {
    this.sinceLabels = 0;
    for (const hotspot of HOTSPOTS) {
      if (hotspot.action === 'window' && this.windowView) hotspot.label = this.windowView.label();
      if (hotspot.action === 'dial' && this.projector) hotspot.label = `Next: ${this.projector.nextLabel}`;
      if (hotspot.proxies.includes('hit_projection') && this.projector) hotspot.label = this.projector.label;
    }
  }
}
