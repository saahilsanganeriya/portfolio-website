import * as THREE from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { ReelFilm } from '../../lib/films/latest';
import type { SfxName } from '../audio/RoomAudio';
import { HOTSPOTS, type Hotspot } from '../hotspots';
import type { Effects } from '../Application/Effects';
import type { QualityTier } from '../Application/Quality';
import type { RoomNodes, StationName } from '../Application/RoomModel';
import { Album } from './Album';
import { lampUniforms, Posters, Prints } from './art';
import { LavaLamp } from './LavaLamp';
import { readWorld, type WorldNodes } from './nodes';
import type { Photograph } from './photographs';
import { Projector } from './Projector';
import { Fan, FAN_SPEEDS, OvenGlow, Steam } from './props';
import { TextureStore } from './textures';
import { WindowView } from './WindowView';

// Everything in the room that lives and reacts (PLAN 11.1, 12.1): the window's two cities by their own clocks, the
// lava lamp and its light, the fan and the dust it stirs, the espresso machine's steam, the oven's glow, the
// favourite posters, the print wall, the photo album and the projector's programs. It carries out every hotspot's
// room action (the click's own sound is the audio layer's, by proxy) and asks for the recordings its actions add.
// What the visitor first sees loads with the room; everything else waits until the room is interactive, then loads
// when it comes into view or is asked for.

export interface WorldHost {
  /** Glides to a framing (the camera's seam); false if the room has no such framing. */
  fly(station: StationName): boolean;
  /** The framing the camera is at or heading to. */
  station(): string;
  openWindow(target: string): void;
  /** The audio layer's recorded one-shot (`audio.sfx`). */
  sfx(name: SfxName, at?: THREE.Vector3): void;
  /** While the album is open the monitor's frame must not take the pointer (it lies behind the book). */
  setMonitorBlocked(blocked: boolean): void;
  readonly reducedMotion: boolean;
  /** The phone tier keeps the projector screen's baked still (no programs to download and decode). */
  readonly light: boolean;
}

export interface WorldFrame {
  camera: THREE.PerspectiveCamera;
  /** Ambient seconds (frozen while motion is paused) and this frame's share of them. */
  clock: number;
  dt: number;
  /** Real seconds since the last frame, for motion the visitor started (the album). */
  realDt: number;
  /** The room has started and motion is not paused. */
  running: boolean;
  pixelRatio: number;
}

const LABELS_EVERY_S = 1;
// Once the room is interactive, on-demand loading starts after this pause, so it never overlaps the first moment.
const ON_DEMAND_DELAY_MS = 400;

export class World {
  private readonly nodes: WorldNodes;
  private readonly textures: TextureStore;
  private readonly lamp = lampUniforms();
  private readonly posters: Posters;
  private readonly prints: Prints;
  private readonly windowView: WindowView | null;
  private readonly lava: LavaLamp | null;
  private readonly fan: Fan | null;
  private readonly steam: Steam | null;
  private readonly oven: OvenGlow | null;
  readonly projector: Projector | null;
  private readonly album: Album | null;
  private readonly status: HTMLElement;
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly printBounds = new THREE.Box3();
  private collectionPromise: Promise<Photograph[]> | null = null;
  private everything = false;
  private interactive = false;
  private printsWanted = false;
  private sinceLabels = LABELS_EVERY_S;
  private timer = 0;

  constructor(
    private readonly room: RoomNodes,
    scene: THREE.Scene,
    container: HTMLElement,
    ktx2: KTX2Loader,
    private readonly effects: Effects,
    films: ReelFilm[],
    private readonly host: WorldHost,
  ) {
    this.nodes = readWorld(room);
    const n = this.nodes;
    this.textures = new TextureStore(ktx2);
    this.posters = new Posters(n.posters, this.lamp);
    this.prints = new Prints(n.prints, this.lamp, HOTSPOTS);
    for (const print of n.prints) this.printBounds.expandByObject(print.mesh);
    this.windowView = n.windowViews.length ? new WindowView(n.windowViews, this.textures) : null;
    this.lava = n.lava ? new LavaLamp(n.lava.glass, n.lava.light, this.lamp, scene, n.posterWallX) : null;
    this.fan = n.fan ? new Fan(n.fan.blades, n.fan.axis) : null;
    this.steam = n.steam ? new Steam(n.steam, scene) : null;
    this.oven = n.ovenGlow ? new OvenGlow(n.ovenGlow, scene) : null;
    this.projector =
      room.projection && !host.light
        ? new Projector(room.projection, room.screenSurface, scene, films, this.textures, () => this.collection(), n.dial)
      : null;

    this.status = document.createElement('p');
    this.status.className = 'visually-hidden';
    this.status.setAttribute('role', 'status');
    container.appendChild(this.status);

    this.album = n.album
      ? new Album(n.album, room.framings.desk.position, room.framings.desk.fov, scene, container, {
          collection: () => this.collection().then((photos) => import('./photographs').then((m) => m.sections(photos))),
          textures: this.textures,
          reducedMotion: host.reducedMotion,
          announce: (text) => this.announce(text),
          setCapturing: (capturing) => host.setMonitorBlocked(capturing),
        })
      : null;
    this.refreshLabels();
  }

  /** What the first view needs, before the room is shown: the posters and the window's pictures for now. */
  async load() {
    await Promise.all([this.posters.load(this.textures), this.windowView?.load()]);
  }

  /** The intro is over and the visitor can act: on-demand loading may start. */
  becomeInteractive() {
    if (this.interactive) return;
    this.timer = window.setTimeout(() => {
      this.interactive = true;
      this.windowView?.allowOnDemand();
      this.projector?.allowOnDemand();
      this.printsWanted = this.prints.photos.length === 0 && this.nodes.prints.length > 0;
      if (this.printsWanted) void this.collection().then((photos) => this.prints.hang(photos));
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
    return this.album?.animating ?? false;
  }

  /**
   * Carries out a hotspot's room action (with any recording it adds); returns false when the room should do the default:
   * fly to the hotspot's framing, then open its SaahilOS window.
   */
  activate(hotspot: Hotspot): boolean {
    const here = this.host.station();
    switch (hotspot.action) {
      case 'album':
        this.host.fly('desk');
        void this.album?.open();
        return true;
      case 'dial':
        this.host.sfx('projector-clack', this.positionOf(hotspot));
        this.projector?.next();
        this.refreshLabels();
        if (here !== 'projector') this.host.fly('projector');
        this.announce(`The projector now shows ${this.projector?.label ?? 'nothing'}.`);
        return true;
      case 'lava':
        this.lava?.nextMood();
        this.announce(`The lava lamp is ${this.lava?.mood === 'off' ? 'off' : this.lava?.mood}.`);
        return true;
      case 'fan':
        this.fan?.pullChain();
        this.announce(`The fan is on speed ${(this.fan?.speedIndex ?? 0) + 1} of ${FAN_SPEEDS.length}.`);
        return true;
      case 'espresso':
        this.host.sfx('espresso-brew', this.positionOf(hotspot));
        this.steam?.brew();
        this.announce('The espresso machine pulls a shot.');
        return true;
      case 'window':
        if (here !== 'window' && this.host.fly('window')) return true;
        this.announce(`Out of the window: ${this.windowView?.label() ?? 'San Francisco and Delhi'}.`);
        return true;
      case 'print':
        if (here !== 'photos' && this.host.fly('photos')) return true;
        if (hotspot.target) this.host.openWindow(hotspot.target);
        return true;
      default:
        if (hotspot.proxies.includes('hit_projector_screen')) hotspot.target = this.projector?.target() ?? hotspot.target;
        return false;
    }
  }

  update(frame: WorldFrame) {
    const { camera, clock, dt, realDt, running, pixelRatio } = frame;
    const still = this.host.reducedMotion;
    if (this.everything) this.steam?.brew();
    this.posters.update(realDt);
    this.prints.update(realDt);
    this.windowView?.setCloseUp(this.host.station() === 'window');
    this.windowView?.update(realDt);
    // Under reduced motion the lamp's wax and the oven's flicker hold still.
    const ambient = still ? 0 : clock;
    this.lava?.update(ambient, realDt, camera);
    this.fan?.update(dt, still);
    if (this.fan) this.effects.setWind(this.fan.speed / FAN_SPEEDS[FAN_SPEEDS.length - 1], this.fan.angle);
    this.steam?.update(clock, dt, pixelRatio, still);
    this.oven?.update(ambient);
    this.projector?.update(camera, running, dt);
    this.album?.update(realDt, camera);
    if (this.album?.isOpen && this.host.station() !== 'desk') this.album.close();

    // The prints' pictures load once the wall is in view.
    if (this.printsWanted && this.prints.photos.length > 0) {
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection);
      if (this.frustum.intersectsBox(this.printBounds)) {
        this.printsWanted = false;
        void this.prints.load(this.textures, this.host.reducedMotion);
      }
    }

    this.sinceLabels += realDt;
    if (this.sinceLabels >= LABELS_EVERY_S) this.refreshLabels();
  }

  /** Measurement hook: the fan at its top speed, the steam brewing and the projector playing, in view or not. */
  forceEverything(on: boolean) {
    this.everything = on;
    if (this.fan && on) this.fan.speedIndex = FAN_SPEEDS.length - 1;
    this.projector?.force(on);
  }

  setTier(tier: QualityTier) {
    this.lava?.setHalos(tier.halos);
    this.oven?.setHalos(tier.halos);
  }

  /** Screen point of a world feature by name (album pages), for tests. */
  point(name: string, rect: DOMRect) {
    if (name === 'album_left' || name === 'album_right') return this.album?.point(name, rect) ?? null;
    return undefined;
  }

  probe() {
    return {
      interactive: this.interactive,
      window: this.windowView?.state() ?? null,
      posters: this.posters.loaded,
      prints: this.prints.photos,
      lava: this.lava?.mood ?? null,
      fan: this.fan ? { speed: this.fan.speedIndex, turnsPerSecond: Number(this.fan.speed.toFixed(3)) } : null,
      steam: this.steam ? { brewing: this.steam.brewing > 0 } : null,
      projector: this.projector?.state ?? null,
      album: this.album?.probe() ?? null,
      labels: Object.fromEntries(HOTSPOTS.map((h) => [h.proxies[0], h.label])),
    };
  }

  dispose() {
    clearTimeout(this.timer);
    this.posters.dispose();
    this.prints.dispose();
    this.windowView?.dispose();
    this.lava?.dispose();
    this.steam?.dispose();
    this.oven?.dispose();
    this.projector?.dispose();
    this.album?.dispose();
    this.textures.dispose();
    this.status.remove();
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

  /** Labels that change with the room: the time in both cities, and what the projector shows and shows next. */
  private refreshLabels() {
    this.sinceLabels = 0;
    for (const hotspot of HOTSPOTS) {
      if (hotspot.action === 'window' && this.windowView) hotspot.label = this.windowView.label();
      if (hotspot.action === 'dial' && this.projector) {
        hotspot.label = `Next program: ${this.projector.nextLabel}`;
        hotspot.target = this.projector.target();
      }
      if (hotspot.proxies.includes('hit_projector_screen') && this.projector) {
        hotspot.label = this.projector.label;
        hotspot.target = this.projector.target();
      }
    }
  }
}
