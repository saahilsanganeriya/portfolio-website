import * as THREE from 'three';
import artVert from '../shaders/art.vert.glsl?raw';
import blendGlsl from '../shaders/window_blend.glsl?raw';
import landFrag from '../shaders/window.frag.glsl?raw';
import skyFrag from '../shaders/window_sky.frag.glsl?raw';
import skyVert from '../shaders/window_sky.vert.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import { CITIES, localTime, moonAge, nightAt, nightWeight, solarPosition, type CityId } from './daylight';
import { lookAt, oneMoon, type RGB, type SkyLook } from './sky';
import type { WindowSkyNode, WindowViewNode } from './nodes';
import type { TextureStore } from './textures';

// The window looks out on San Francisco (left) and Delhi (right). One sky spans both: its colour runs from San
// Francisco's sky to Delhi's across a wide band in the middle, each lit by its own sun, with the sun on a side in
// daylight, the moon on a side at night and stars after dark (window_sky). The land of each half shows its day and night
// pictures by the same blend, so the cities meet without a line. One picture per city loads with the room; the others
// load once the room is interactive, because the blend carries each city's light into the other's half.

const ROOM_PATH = '/room/';
const CHECK_EVERY_S = 10;
const LOOKAHEAD_MS = 45 * 60_000;
// A change of light already under way moves at these rates, so a dusk that happens during a visit is seen to fall.
const ELEVATION_DEG_PER_S = 2;
const HOUR_DEG_PER_S = 20;
// Half-width of the blend from San Francisco's sky and light to Delhi's, on the window's plane (the window is 1.5 m
// wide): wide enough that the change runs across most of the window, so neither city's half reads as a block.
const BLEND_HALF_WIDTH_M = 0.62;
// Without the sky's markers (an older room), how far in front of the window the eye stands.
const FALLBACK_EYE_M = 3;

type Phase = 'day' | 'night';
const CITY_ORDER: CityId[] = ['sf', 'delhi'];

interface View {
  node: WindowViewNode;
  material: THREE.ShaderMaterial;
  pictures: Record<Phase, THREE.Texture | null>;
  requested: Set<Phase>;
}

interface Sun {
  elevation: number;
  hourAngle: number;
}

export interface CityState {
  name: string;
  local: string;
  /** 0 day, 1 night, as shown now. */
  night: number;
  /** Which pictures have arrived. */
  loaded: Phase[];
  /** The sun's height there (degrees), and how much of the sun, the moon and the stars show in its half. */
  elevation: number;
  sun: number;
  moon: number;
  stars: number;
}

const vec3 = () => new THREE.Vector3();
const linear = (rgb: RGB, out: THREE.Vector3) => {
  const colour = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  return out.set(colour.r, colour.g, colour.b);
};
const withBlend = (glsl: string) => glsl.replace('#include <window_blend>', blendGlsl);
const towards = (from: number, to: number, step: number) => from + THREE.MathUtils.clamp(to - from, -step, step);

export class WindowView {
  private readonly views: View[];
  private readonly sky: THREE.ShaderMaterial | null;
  private readonly shared = {
    uCentre: { value: vec3() },
    uEye: { value: vec3() },
    uOut: { value: vec3() },
    uRight: { value: vec3() },
    uBand: { value: 1 },
  };
  private readonly land = {
    uNightSide: { value: [0, 0] },
    uDuskSide: { value: [0, 0] },
    uHorizonSide: { value: [vec3(), vec3()] },
    uHaze: { value: new THREE.Vector2(0, 1) },
  };
  private readonly target: Record<CityId, Sun> = { sf: { elevation: 0, hourAngle: 0 }, delhi: { elevation: 0, hourAngle: 0 } };
  private readonly shown: Record<CityId, Sun> = { sf: { elevation: 0, hourAngle: 0 }, delhi: { elevation: 0, hourAngle: 0 } };
  private looks: Record<CityId, SkyLook> | null = null;
  private readonly skyMesh: THREE.Mesh | null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly bodies = new Map<string, { key: string; direction: THREE.Vector3 }>();
  private skyRadius = 1;
  private sinceCheck = 0;
  private onDemand = false;
  private time = 0;

  constructor(
    nodes: WindowViewNode[],
    skyNode: WindowSkyNode | null,
    private readonly textures: TextureStore,
    private readonly options: { reducedMotion?: boolean; now?: () => Date } = {},
  ) {
    this.placeBlend(nodes, skyNode);
    this.views = nodes.map((node) => {
      const old = node.mesh.material as THREE.MeshBasicMaterial;
      const standin = node.mesh.userData.standin as Record<Phase, THREE.Texture> | undefined;
      // The room's own material carries the day picture when the exporter embedded it (not a deferred placeholder).
      const deferred = old.map?.userData.deferredWindowPicture === true;
      if (deferred) old.map!.dispose();
      const embeddedDay = deferred ? null : (old.map ?? null);
      const material = new THREE.ShaderMaterial({
        vertexShader: artVert,
        fragmentShader: withBlend(landFrag),
        uniforms: {
          uDay: { value: null },
          uNight: { value: null },
          uHasDay: { value: 0 },
          uHasNight: { value: 0 },
          ...this.shared,
          ...this.land,
        },
      });
      node.mesh.material = material;
      return { node, material, pictures: { day: standin?.day ?? embeddedDay, night: standin?.night ?? null }, requested: new Set<Phase>() };
    });
    this.sky = skyNode ? this.makeSky(skyNode) : null;
    this.skyMesh = skyNode?.mesh ?? null;
    if (this.skyMesh) {
      // A body whose direction misses the trimmed dome stands at its usual distance from the centre.
      const box = new THREE.Box3().setFromObject(this.skyMesh);
      this.skyRadius = box.getSize(vec3()).length() / 3;
    }
  }

  /**
   * Sets the light for the current time and loads one picture per city before the room is shown: the one its land is
   * nearer now. The other pictures follow once the room is interactive (allowOnDemand), so the first load is the same
   * size at every hour.
   */
  async load() {
    this.check(true);
    this.apply();
    await Promise.all(this.views.map((view) => this.fetch(view, this.nightOf(view.node.city) >= 0.5 ? 'night' : 'day')));
    this.apply();
  }

  /** From now on, fetch the pictures the blend needs, and any a city will need within the hour. */
  allowOnDemand() {
    this.onDemand = true;
    this.sinceCheck = CHECK_EVERY_S;
  }

  update(dt: number) {
    this.sinceCheck += dt;
    if (this.sinceCheck >= CHECK_EVERY_S) this.check(false);
    const step = Math.max(dt, 0);
    for (const city of CITY_ORDER) {
      const shown = this.shown[city];
      const target = this.target[city];
      shown.elevation = towards(shown.elevation, target.elevation, ELEVATION_DEG_PER_S * step);
      const turn = ((target.hourAngle - shown.hourAngle + 540) % 360) - 180;
      shown.hourAngle = ((shown.hourAngle + THREE.MathUtils.clamp(turn, -HOUR_DEG_PER_S * step, HOUR_DEG_PER_S * step) + 540) % 360) - 180;
    }
    if (!this.options.reducedMotion) this.time += step;
    this.apply();
  }

  /** At the window framing, look again at once for pictures the view needs. */
  setCloseUp(closeUp: boolean) {
    if (closeUp) this.sinceCheck = Math.max(this.sinceCheck, CHECK_EVERY_S - 0.5);
  }

  /** "San Francisco 3:12 am · Delhi 3:42 pm" */
  label() {
    const date = this.now();
    return CITY_ORDER.map((id) => `${CITIES[id].name} ${localTime(CITIES[id], date)}`).join(' · ');
  }

  state(): Record<string, CityState> {
    const date = this.now();
    return Object.fromEntries(
      this.views.map((view) => {
        const city = view.node.city;
        const look = this.looks?.[city];
        return [
          city,
          {
            name: CITIES[city].name,
            local: localTime(CITIES[city], date),
            night: Number(this.nightOf(city).toFixed(3)),
            loaded: (['day', 'night'] as const).filter((p) => view.pictures[p]),
            elevation: Number(this.shown[city].elevation.toFixed(2)),
            sun: Number((this.sky ? (look?.sun.shown ?? 0) : 0).toFixed(3)),
            moon: Number((this.sky ? (look?.moon.shown ?? 0) : 0).toFixed(3)),
            stars: Number((this.sky ? (look?.stars ?? 0) : 0).toFixed(3)),
          },
        ];
      }),
    );
  }

  dispose() {
    this.sky?.dispose();
    for (const view of this.views) {
      view.material.dispose();
      for (const picture of Object.values(view.pictures)) picture?.dispose();
    }
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }

  private nightOf(city: CityId) {
    return nightAt(this.shown[city].elevation);
  }

  /** Where the sky's directions start, the eye the blend is seen from, and the window's out and right directions. */
  private placeBlend(nodes: WindowViewNode[], skyNode: WindowSkyNode | null) {
    const bounds = nodes.map((n) => new THREE.Box3().setFromObject(n.mesh));
    const { uCentre, uEye, uOut, uRight, uBand } = this.shared;
    uBand.value = BLEND_HALF_WIDTH_M * WORLD_SCALE;
    if (skyNode) {
      uCentre.value.copy(skyNode.centre);
      uEye.value.copy(skyNode.eye);
    } else {
      // An older room: the window's seam between the halves, facing the room's front (glTF +Z), the eye in front of it.
      const all = bounds.reduce((box, b) => box.union(b), new THREE.Box3());
      const sf = bounds[nodes.findIndex((n) => n.city === 'sf')];
      const delhi = bounds[nodes.findIndex((n) => n.city === 'delhi')];
      uCentre.value.set(sf && delhi ? (sf.max.x + delhi.min.x) / 2 : all.getCenter(vec3()).x, all.min.y, all.max.z);
      uEye.value.copy(uCentre.value).add(new THREE.Vector3(0, 0, FALLBACK_EYE_M * WORLD_SCALE));
    }
    uOut.value.subVectors(uCentre.value, uEye.value).setY(0).normalize();
    uRight.value.crossVectors(uOut.value, new THREE.Vector3(0, 1, 0)).normalize();
    // The far land hazes into the sky's horizon: from about half the land's depth behind the window to its far edge.
    let far = 0;
    for (const box of bounds) {
      for (const x of [box.min.x, box.max.x])
        for (const z of [box.min.z, box.max.z]) far = Math.max(far, new THREE.Vector3(x, uCentre.value.y, z).sub(uCentre.value).dot(uOut.value));
    }
    this.land.uHaze.value.set(far * 0.45, far);
  }

  private makeSky(node: WindowSkyNode) {
    const material = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: withBlend(skyFrag),
      uniforms: {
        ...this.shared,
        uZenith: { value: [vec3(), vec3()] },
        uHorizon: { value: [vec3(), vec3()] },
        uGlow: { value: [vec3(), vec3()] },
        uGlowAmount: { value: [0, 0] },
        uSunDir: { value: [vec3(), vec3()] },
        uSunShown: { value: [0, 0] },
        uSunColour: { value: [vec3(), vec3()] },
        uMoonDir: { value: [vec3(), vec3()] },
        uMoonShown: { value: [0, 0] },
        uMoonAge: { value: 0 },
        uStars: { value: [0, 0] },
        uTime: { value: 0 },
      },
    });
    node.mesh.material = material;
    return material;
  }

  private check(immediately: boolean) {
    this.sinceCheck = 0;
    const date = this.now();
    for (const city of CITY_ORDER) {
      const { elevation, hourAngle } = solarPosition(CITIES[city], date);
      this.target[city] = { elevation, hourAngle };
      if (immediately) this.shown[city] = { elevation, hourAngle };
    }
    if (this.sky) this.sky.uniforms.uMoonAge.value = moonAge(date);
    if (!this.onDemand) return;
    for (const view of this.views) for (const phase of ['day', 'night'] as const) if (this.needs(view, phase)) void this.fetch(view, phase);
  }

  /**
   * Whether `phase`'s picture shows now or within the hour. While the cities' light differs, the blend carries the other
   * city's light into this half, so it needs both.
   */
  private needs(view: View, phase: Phase) {
    const city = view.node.city;
    const now = nightAt(this.target[city].elevation);
    if (CITY_ORDER.some((other) => other !== city && Math.abs(nightAt(this.target[other].elevation) - now) > 0.02)) return true;
    const later = nightWeight(CITIES[city], new Date(this.now().getTime() + LOOKAHEAD_MS));
    return phase === 'night' ? now > 0 || later > 0 : now < 1 || later < 1;
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

  /**
   * The direction from the eye to a body that stands at `azimuth` and `height` as seen from the dome's centre: where that
   * direction meets the sky. Measured from the eye, the body's disc is round from the room.
   */
  private bodyDirection(name: string, azimuth: number, height: number, out: THREE.Vector3) {
    const key = `${azimuth.toFixed(3)} ${height.toFixed(3)}`;
    const known = this.bodies.get(name);
    if (known?.key === key) return out.copy(known.direction);
    const { uCentre, uEye } = this.shared;
    const along = this.direction(azimuth, height, vec3());
    let point = uCentre.value.clone().addScaledVector(along, this.skyRadius);
    if (this.skyMesh) {
      this.raycaster.set(uCentre.value, along);
      const hit = this.raycaster.intersectObject(this.skyMesh, false)[0];
      if (hit) point = hit.point;
    }
    const direction = point.sub(uEye.value).normalize();
    this.bodies.set(name, { key, direction });
    return out.copy(direction);
  }

  /** The direction (world) from the dome's centre at `azimuth` degrees right of straight out and `height` degrees up. */
  private direction(azimuth: number, height: number, out: THREE.Vector3) {
    const a = THREE.MathUtils.degToRad(azimuth);
    const h = THREE.MathUtils.degToRad(height);
    return out
      .copy(this.shared.uOut.value)
      .multiplyScalar(Math.cos(h) * Math.cos(a))
      .addScaledVector(this.shared.uRight.value, Math.cos(h) * Math.sin(a))
      .add(new THREE.Vector3(0, Math.sin(h), 0))
      .normalize();
  }

  private apply() {
    const moon = this.sky ? (this.sky.uniforms.uMoonAge.value as number) : 0;
    const both = oneMoon(lookAt('sf', this.shown.sf.elevation, this.shown.sf.hourAngle), lookAt('delhi', this.shown.delhi.elevation, this.shown.delhi.hourAngle), moon);
    this.looks = { sf: both.sf, delhi: both.delhi };
    CITY_ORDER.forEach((city, side) => {
      const look = both[city];
      this.land.uNightSide.value[side] = look.night;
      this.land.uDuskSide.value[side] = look.dusk;
      linear(look.horizon, this.land.uHorizonSide.value[side]);
      const sky = this.sky?.uniforms;
      if (!sky) return;
      linear(look.zenith, sky.uZenith.value[side]);
      linear(look.horizon, sky.uHorizon.value[side]);
      linear(look.glow, sky.uGlow.value[side]);
      sky.uGlowAmount.value[side] = look.glowAmount;
      this.bodyDirection(`sun-${city}`, look.sun.azimuth, look.sun.height, sky.uSunDir.value[side]);
      sky.uSunShown.value[side] = look.sun.shown;
      linear(look.sun.colour, sky.uSunColour.value[side]);
      this.bodyDirection(`moon-${city}`, look.moon.azimuth, look.moon.height, sky.uMoonDir.value[side]);
      sky.uMoonShown.value[side] = look.moon.shown;
      sky.uStars.value[side] = look.stars;
    });
    if (this.sky) this.sky.uniforms.uTime.value = this.time;
    for (const view of this.views) {
      const { day, night } = view.pictures;
      const u = view.material.uniforms;
      u.uDay.value = day ?? night;
      u.uNight.value = night ?? day;
      u.uHasDay.value = day ? 1 : 0;
      u.uHasNight.value = night ? 1 : 0;
    }
  }
}
