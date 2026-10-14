import * as THREE from 'three';
import artVert from '../shaders/art.vert.glsl?raw';
import windowFrag from '../shaders/window.frag.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import { CITIES, localTime, nightWeight, type CityId } from './daylight';
import type { WindowViewNode } from './nodes';
import type { TextureStore } from './textures';

// The window looks out on San Francisco (left) and Delhi (right); each half shows day or night by that city's own
// sun. One picture per city loads with the room; the other loads once it will be needed within the hour,
// or when the camera comes to the window, where the two skies blend across the seam (from further away the seam
// sits behind the window's central bar).

const ROOM_PATH = '/room/';
// Half the width of the blend across the seam between the two cities' skies.
const SEAM_BAND_M = 0.12;
const CHECK_EVERY_S = 10;
const LOOKAHEAD_MS = 45 * 60_000;
// A blend already under way moves at this rate (per second), so a dusk that happens during a visit is seen to fall.
const EASE_PER_S = 0.05;

type Phase = 'day' | 'night';

interface View {
  node: WindowViewNode;
  material: THREE.ShaderMaterial;
  pictures: Record<Phase, THREE.Texture | null>;
  requested: Set<Phase>;
  night: number;
  target: number;
}

export interface CityState {
  name: string;
  local: string;
  /** 0 day, 1 night, as shown now. */
  night: number;
  /** Which pictures have arrived. */
  loaded: Phase[];
}

export class WindowView {
  private readonly views: View[];
  private sinceCheck = 0;
  private onDemand = false;
  private readonly seamX: number;
  private closeUp = false;

  constructor(
    nodes: WindowViewNode[],
    private readonly textures: TextureStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.views = nodes.map((node) => {
      const old = node.mesh.material as THREE.MeshBasicMaterial;
      const standin = node.mesh.userData.standin as Record<Phase, THREE.Texture> | undefined;
      // The room's own material carries the day picture when the exporter embedded it (not a deferred placeholder).
      const deferred = old.map?.userData.deferredWindowPicture === true;
      if (deferred) old.map!.dispose();
      const embeddedDay = deferred ? null : (old.map ?? null);
      const material = new THREE.ShaderMaterial({
        vertexShader: artVert,
        fragmentShader: windowFrag,
        uniforms: {
          uDay: { value: null },
          uNight: { value: null },
          uNightLeft: { value: 0 },
          uNightRight: { value: 0 },
          uSeamX: { value: 0 },
          uSeamBand: { value: SEAM_BAND_M * WORLD_SCALE },
          uHasDay: { value: 0 },
          uHasNight: { value: 0 },
        },
      });
      node.mesh.material = material;
      const view: View = {
        node,
        material,
        pictures: { day: standin?.day ?? embeddedDay, night: standin?.night ?? null },
        requested: new Set(),
        night: 0,
        target: 0,
      };
      return view;
    });
    // San Francisco is the left half and Delhi the right; the seam is where they meet.
    const sf = this.views.find((v) => v.node.city === 'sf');
    const delhi = this.views.find((v) => v.node.city === 'delhi');
    this.seamX =
      sf && delhi
        ? (new THREE.Box3().setFromObject(sf.node.mesh).max.x + new THREE.Box3().setFromObject(delhi.node.mesh).min.x) / 2
        : 0;
  }

  /**
   * Sets each half for the current time and loads one picture per city before the room is shown: the one its sky is
   * nearer now. A city at dusk or dawn gets its other picture once the room is interactive (allowOnDemand) and then
   * blends, so the first load is the same size at every hour (both cities can be mid-twilight at once).
   */
  async load() {
    this.check(true);
    await Promise.all(this.views.map((view) => this.fetch(view, view.target >= 0.5 ? 'night' : 'day')));
    this.apply();
  }

  /** From now on, fetch a picture shortly before its city will need it. */
  allowOnDemand() {
    this.onDemand = true;
    this.sinceCheck = CHECK_EVERY_S;
  }

  update(dt: number) {
    this.sinceCheck += dt;
    if (this.sinceCheck >= CHECK_EVERY_S) this.check(false);
    for (const view of this.views) {
      const step = EASE_PER_S * Math.max(dt, 0);
      view.night += THREE.MathUtils.clamp(view.target - view.night, -step, step);
    }
    this.apply();
  }

  /** At the window framing both halves blend across the seam, so each needs both pictures while the cities differ. */
  setCloseUp(closeUp: boolean) {
    if (closeUp === this.closeUp) return;
    this.closeUp = closeUp;
    if (closeUp) this.sinceCheck = CHECK_EVERY_S;
  }

  /** "San Francisco 3:12 am · Delhi 3:42 pm" */
  label() {
    const date = this.now();
    return (Object.keys(CITIES) as CityId[]).map((id) => `${CITIES[id].name} ${localTime(CITIES[id], date)}`).join(' · ');
  }

  state(): Record<string, CityState> {
    const date = this.now();
    return Object.fromEntries(
      this.views.map((view) => [
        view.node.city,
        {
          name: CITIES[view.node.city].name,
          local: localTime(CITIES[view.node.city], date),
          night: Number(view.night.toFixed(3)),
          loaded: (['day', 'night'] as const).filter((p) => view.pictures[p]),
        },
      ]),
    );
  }

  dispose() {
    for (const view of this.views) {
      view.material.dispose();
      for (const picture of Object.values(view.pictures)) picture?.dispose();
    }
  }

  private check(immediately: boolean) {
    this.sinceCheck = 0;
    const date = this.now();
    for (const view of this.views) {
      view.target = nightWeight(CITIES[view.node.city], date);
      if (immediately) view.night = view.target;
      if (!this.onDemand) continue;
      for (const phase of ['day', 'night'] as const) if (this.needs(view, phase, LOOKAHEAD_MS)) void this.fetch(view, phase);
    }
  }

  /** Whether `phase`'s picture shows now, or will within `ahead` ms (close up, also near the seam). */
  private needs(view: View, phase: Phase, ahead: number) {
    const later = nightWeight(CITIES[view.node.city], new Date(this.now().getTime() + ahead));
    const weights = [view.target, later];
    if (this.closeUp) weights.push(...this.views.map((v) => v.target));
    return phase === 'night' ? weights.some((w) => w > 0) : weights.some((w) => w < 1);
  }

  private async fetch(view: View, phase: Phase) {
    const file = phase === 'day' ? view.node.dayFile : view.node.nightFile;
    if (view.pictures[phase] || view.requested.has(phase) || !file) return;
    view.requested.add(phase);
    try {
      view.pictures[phase] = await this.textures.ktx2(ROOM_PATH + file);
    } catch (error) {
      console.warn(`room: the window's ${view.node.city} ${phase} view did not load`, error);
    }
  }

  private apply() {
    const night = (city: CityId) => this.views.find((v) => v.node.city === city)?.night;
    const left = night('sf') ?? night('delhi') ?? 0;
    const right = night('delhi') ?? left;
    for (const view of this.views) {
      const { day, night: dark } = view.pictures;
      const u = view.material.uniforms;
      u.uDay.value = day ?? dark;
      u.uNight.value = dark ?? day;
      u.uHasDay.value = day ? 1 : 0;
      u.uHasNight.value = dark ? 1 : 0;
      u.uNightLeft.value = left;
      u.uNightRight.value = right;
      u.uSeamX.value = this.seamX;
    }
  }
}
