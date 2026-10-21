import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import shineGlsl from '../shaders/shine.glsl?raw';
import type { QualityTier } from '../Application/Quality';
import { FLOORPLAN_URL } from '../Application/Resources';
import { WORLD_SCALE, type MonitorPose } from '../Application/RoomModel';

// Live shine (the hybrid render: baked view-independent light, live view-dependent light). The bake cannot hold a
// reflection, which is right from one viewpoint only, so the surfaces the set tags `gloss` (roughness 0–1) get it here:
// the room probe's light, prefiltered by roughness, weighted by Fresnel, projected onto the set's box (the two walls, the
// floor, the void beyond) so a reflection stays on the wall it shows as the camera orbits, and tone-mapped as the bake
// was (AgX). Each tagged mesh gets an overlay, so its own material (and what patches it, like the lava lamp's light) is
// left alone: on glaze and varnish the reflection is screened over the bake, `baked + shine * (1 - baked)`, so the bake
// stays as baked and only what is brighter than it, a window or a lamp, shows; on glass it also takes its share of what
// shows through, `shine + behind * (1 - F)`. The probe loads after the room is interactive and only on a tier with
// `shine`; Save-Data visitors get no 3D room at all (src/layouts/Room.astro).

// The surfaces that shine, and how strongly (1 = the physical Fresnel), as the off/on crops from three orbit angles each
// decided: at full strength the window's glare washed the desk's varnish white and covered the OS on the CRT, at a
// quarter both read as varnish and glass. The window pane, the mug's glaze, the espresso machine, the lamp shade, the
// lava lamp, the platter and the Voyager record showed no gain or a smudge (the probe is 512 × 256 and taken at the
// desk, so a near lamp or the far wall reflects as a blur), so their `gloss` tags draw nothing.
const SHINES: Readonly<Record<string, number>> = {
  desk_desk_top: 0.25,
  crt_glow: 0.25,
  // The chairs' semi-matte leather, and the soft-pad desk chair's polished aluminium (its frames and its base). The
  // desk chair's seat is seen at a grazing angle and mirrors the window: above 0.05 that lays a grey film over it.
  desk_chair_leather: 0.05,
  props_lounge_chair_leather: 0.2,
  desk_chair: 0.35,
  desk_chair_base: 0.35,
};
// The bake's exposure (blender/scripts/build_room.py EXPOSURE), for a floor plan whose probe does not state it.
const BAKE_EXPOSURE_STOPS = 2.8;
// The set's walls rise to 3.4 m and fade into the void: the top of the box reflections are projected on.
const WALL_HEIGHT_M = 3.4;
// Smooth across edges up to this angle when the room file has no normals; sharper edges stay creased.
const CREASE_DEG = 40;
// The CRT's curved glass sits up to 8 mm behind the OS hole's plane at its edges: its shine is drawn as if this far in
// front of the plane, so the hole (which writes depth) does not cut it to a hard-edged patch.
const SCREEN_MARGIN_M = 0.001;
// Its shine fades out as the camera closes in to read the OS (the monitor framing is 0.5 m from the glass, the desk
// framing 1.5 m).
const SCREEN_FADE_M: readonly [number, number] = [0.65, 1.0];
// After the OS hole (1) and the CRT's glass layer (3), MonitorScreen.ts.
const SCREEN_RENDER_ORDER = 4;

export type ShineState = 'waiting' | 'loading' | 'ready' | 'failed';

/** Measurement hook (`window.__shine`; `?shine=off` starts it forced off, for A/B captures of one build). */
export interface ShineDebug {
  readonly state: ShineState;
  /** Whether the overlays draw now. */
  readonly on: boolean;
  /** The meshes that shine, with their roughness. */
  readonly surfaces: { name: string; roughness: number }[];
  /** true or false overrides the tier; null follows it again. */
  set(on: boolean | null): void;
  /** Tuning and A/B: one surface's roughness and strength (1 = physical). */
  tune(name: string, values: { roughness?: number; strength?: number }): void;
}

declare global {
  interface Window {
    __shine?: ShineDebug;
  }
}

/** The OS hole's plane and rectangle, for the CRT glass that is drawn over it. */
export interface ShineScreen {
  /** The curved glass in front of the hole (crt_glow); Effects hides its baked glow, its shine stands in for it. */
  glass: THREE.Mesh;
  pose: MonitorPose;
}

// ---- The probe: scene-linear radiance, in three's equirect layout ----

/**
 * The probe as the overlays sample it (RGBA half floats, `width × height`): the light each texel saw, scaled by the
 * bake's exposure, after the zenith's radiance is taken off (straight up from the desk is the void above the set: its
 * world colour would otherwise reflect as a grey veil; taken off, the void reflects as black). The shader tone-maps
 * what a surface reflects as the bake was (AgX). The rows go bottom-up and the columns are turned a quarter: the
 * probe's centre looks at −z, three's equirect centre at +x. `src` is the Radiance file's RGBA floats, top row first.
 */
export function prepareProbe(src: Float32Array, width: number, height: number, exposureStops: number): Uint16Array {
  const zenith = [0, 0, 0];
  for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) zenith[c] += src[x * 4 + c] / width;
  const gain = 2 ** exposureStops;
  const quarter = width / 4;
  const out = new Uint16Array(width * height * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let y = 0; y < height; y++) {
    const row = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) {
      const s = (row + ((x + quarter) % width)) * 4;
      const d = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) out[d + c] = THREE.DataUtils.toHalfFloat(Math.max(0, src[s + c] - zenith[c]) * gain);
      out[d + 3] = one;
    }
  }
  return out;
}

// ---- The overlays ----

/**
 * An overlay's geometry: the mesh's triangles, unindexed, with normals smooth up to CREASE_DEG and creased beyond.
 * The room's positions are quantized (KHR_mesh_quantization: a small integer box, stretched by the node's scale), so the
 * angles are measured in the mesh's real proportions. A mesh that has normals lends a copy of its own.
 */
export function shineGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const source = mesh.geometry;
  if (source.hasAttribute('normal')) return source.clone();
  const scale = mesh.getWorldScale(new THREE.Vector3());
  const local = source.getAttribute('position');
  const positions = new Float32Array(local.count * 3);
  const proportional = new Float32Array(local.count * 3);
  for (let i = 0; i < local.count; i++) {
    positions.set([local.getX(i), local.getY(i), local.getZ(i)], i * 3);
    proportional.set([local.getX(i) * scale.x, local.getY(i) * scale.y, local.getZ(i) * scale.z], i * 3);
  }
  const shaped = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(proportional, 3));
  const own = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (source.index) {
    shaped.setIndex(source.index);
    own.setIndex(source.index);
  }
  const normals = toCreasedNormals(shaped, THREE.MathUtils.degToRad(CREASE_DEG)).getAttribute('normal');
  // Back to the mesh's own axes: a normal scales by the inverse of what stretched the positions.
  const n = new THREE.Vector3();
  for (let i = 0; i < normals.count; i++) {
    n.fromBufferAttribute(normals, i).multiply(scale).normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  const geometry = own.index ? own.toNonIndexed() : own;
  geometry.setAttribute('normal', normals);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Where the probe was taken and the box it is projected on (world units). */
export interface ShineBox {
  probeAt: THREE.Vector3;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

interface ShineUniforms {
  shineRoughness: { value: number };
  shineStrength: { value: number };
  shineProbeAt: { value: THREE.Vector3 };
  shineBoxMin: { value: THREE.Vector3 };
  shineBoxMax: { value: THREE.Vector3 };
  shineScreenPoint?: { value: THREE.Vector3 };
  shineScreenNormal?: { value: THREE.Vector3 };
  shineScreenToLocal?: { value: THREE.Matrix4 };
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vShineNormal;
varying vec3 vShinePosition;
#ifdef SHINE_SCREEN
  uniform vec3 shineScreenPoint;
  uniform vec3 shineScreenNormal;
#endif
void main() {`;

// Moving a vertex along its view ray keeps it on the same pixel and changes only its depth.
const SCREEN_PULL = /* glsl */ `
#include <project_vertex>
#ifdef SHINE_SCREEN
  vec3 shineAt = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float shineAhead = dot(shineAt - shineScreenPoint, shineScreenNormal);
  float shineFacing = max(dot(normalize(cameraPosition - shineAt), shineScreenNormal), 0.25);
  float shinePull = max(0.0, SHINE_SCREEN_MARGIN - shineAhead) / shineFacing;
  mvPosition.xyz *= 1.0 - shinePull / length(mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
#endif`;

const VERTEX_OUT = /* glsl */ `
#include <envmap_vertex>
vShineNormal = inverseTransformDirection(transformedNormal, viewMatrix);
vShinePosition = worldPosition.xyz;`;

const FRAGMENT_PARS = /* glsl */ `
#include <cube_uv_reflection_fragment>
${shineGlsl}
#ifdef SHINE_SCREEN
  uniform mat4 shineScreenToLocal;
#endif
void main() {`;

// rgb is the reflection as the bake would show it; alpha (glass) is the share of what shows through that it replaces.
const FRAGMENT_SHINE = /* glsl */ `
#ifdef SHINE_SCREEN
  vec3 shineOnScreen = (shineScreenToLocal * vec4(vShinePosition, 1.0)).xyz;
  if (abs(shineOnScreen.x) > 0.5 || abs(shineOnScreen.y) > 0.5) discard;
#endif
vec3 shineN = normalize(vShineNormal) * (gl_FrontFacing ? 1.0 : -1.0);
vec3 shineV = normalize(cameraPosition - vShinePosition);
float shineR = shineFilteredRoughness(shineN, shineRoughness);
float shineF = shineWeight(saturate(dot(shineN, shineV)), shineR) * shineStrength;
#ifdef SHINE_SCREEN
  shineF *= smoothstep(SHINE_FADE_NEAR, SHINE_FADE_FAR, distance(cameraPosition, vShinePosition));
#endif
outgoingLight = shineAgX(textureCubeUV(envMap, shineOnBox(vShinePosition, reflect(-shineV, shineN)), shineR).rgb * shineF);
diffuseColor.a = shineF;`;

interface ShineLook {
  roughness: number;
  strength: number;
  side: THREE.Side;
  /** Glass shows what is behind it; glaze and varnish are opaque. */
  glass: boolean;
  /** The OS hole the CRT glass is drawn over. */
  screen: MonitorPose | null;
}

function shineMaterial(env: THREE.Texture, box: ShineBox, { roughness, strength, side, glass, screen }: ShineLook) {
  const material = new THREE.MeshBasicMaterial({
    name: 'shine',
    envMap: env,
    side,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    // Glass: shine + behind × (1 − F). Glaze and varnish: a screen, which never brightens past white and leaves the
    // canvas's alpha alone.
    blendSrc: glass ? THREE.OneFactor : THREE.OneMinusDstColorFactor,
    blendDst: glass ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
    blendSrcAlpha: glass ? THREE.OneFactor : THREE.ZeroFactor,
    blendDstAlpha: glass ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
    // Drawn on the baked mesh's own triangles: wins the depth tie.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const uniforms: ShineUniforms = {
    shineRoughness: { value: roughness },
    shineStrength: { value: strength },
    shineProbeAt: { value: box.probeAt },
    shineBoxMin: { value: box.min },
    shineBoxMax: { value: box.max },
  };
  if (screen) {
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(screen.quaternion);
    const toLocal = new THREE.Matrix4()
      .compose(screen.position, screen.quaternion, new THREE.Vector3(screen.width, screen.height, 1))
      .invert();
    Object.assign(uniforms, {
      shineScreenPoint: { value: screen.position.clone() },
      shineScreenNormal: { value: normal },
      shineScreenToLocal: { value: toLocal },
    });
    material.defines = {
      SHINE_SCREEN: '',
      SHINE_SCREEN_MARGIN: (SCREEN_MARGIN_M * WORLD_SCALE).toFixed(3),
      SHINE_FADE_NEAR: (SCREEN_FADE_M[0] * WORLD_SCALE).toFixed(1),
      SHINE_FADE_FAR: (SCREEN_FADE_M[1] * WORLD_SCALE).toFixed(1),
    };
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VERTEX_PARS)
      .replace('#include <project_vertex>', SCREEN_PULL)
      .replace('#include <envmap_vertex>', VERTEX_OUT);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', FRAGMENT_PARS)
      .replace('#include <envmap_fragment>', FRAGMENT_SHINE);
  };
  material.customProgramCacheKey = () => (screen ? 'shine-screen' : 'shine');
  material.userData.shine = uniforms;
  return material;
}

/**
 * Adds a shine overlay for every mesh under `root` tagged `gloss` that `strengths` lists: a child of the mesh (it
 * moves, lifts and hides with it), except the CRT glass, whose baked glow Effects hides: its overlay stands beside it
 * and draws over the OS hole. Returns the overlays, hidden.
 */
export function addShine(
  root: THREE.Object3D,
  env: THREE.Texture,
  box: ShineBox,
  screen: ShineScreen | null,
  strengths: Readonly<Record<string, number>> = SHINES,
): THREE.Mesh[] {
  const tagged: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && typeof node.userData.gloss === 'number' && node.name in strengths) tagged.push(node);
  });
  return tagged.map((mesh) => {
    const onScreen = mesh === screen?.glass;
    const own = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const glass = onScreen || own.transparent;
    const look = { roughness: mesh.userData.gloss, strength: strengths[mesh.name], side: own.side, glass, screen: onScreen ? screen.pose : null };
    const overlay = new THREE.Mesh(shineGeometry(mesh), shineMaterial(env, box, look));
    overlay.name = `${mesh.name}_shine`;
    overlay.visible = false;
    if (onScreen && mesh.parent) {
      overlay.position.copy(mesh.position);
      overlay.quaternion.copy(mesh.quaternion);
      overlay.scale.copy(mesh.scale);
      overlay.renderOrder = SCREEN_RENDER_ORDER;
      mesh.parent.add(overlay);
    } else {
      overlay.renderOrder = mesh.renderOrder;
      mesh.add(overlay);
    }
    overlay.updateMatrixWorld();
    return overlay;
  });
}

// ---- Loading and the tier ----

type Plan = [number, number][];
interface Floorplan {
  /** The two walls' foot, glTF x and z (metres). */
  corner: Plan;
  /** Where the floor has faded into the void. */
  fadeOutline: Plan;
  probe?: { uri: string; position: [number, number, number]; exposureStops?: number };
}

/**
 * The box the probe is projected on (world units): the left and back walls bound it where they stand, the faded floor's
 * rim on the open sides (all void there, so its exact place does not show), the floor below, the walls' top above.
 */
export function shineBox({ corner, fadeOutline }: Floorplan, probeAt: THREE.Vector3): ShineBox {
  const xs = (plan: Plan) => plan.map(([x]) => x);
  const zs = (plan: Plan) => plan.map(([, z]) => z);
  const min = new THREE.Vector3(Math.min(...xs(corner)), 0, Math.min(...zs(corner))).multiplyScalar(WORLD_SCALE);
  const max = new THREE.Vector3(Math.max(...xs(fadeOutline)), WALL_HEIGHT_M, Math.max(...zs(fadeOutline))).multiplyScalar(WORLD_SCALE);
  return { probeAt, min, max };
}

/** The probe's file, the exposure its bake was shown at, and the box, from floorplan.json. */
async function probeEntry(): Promise<{ url: string; exposureStops: number; box: ShineBox }> {
  const response = await fetch(FLOORPLAN_URL);
  if (!response.ok) throw new Error(`floorplan.json: HTTP ${response.status}`);
  const plan = (await response.json()) as Floorplan;
  if (!plan.probe) throw new Error('floorplan.json names no probe');
  const { uri, position, exposureStops } = plan.probe;
  return {
    url: new URL(uri, new URL(FLOORPLAN_URL, location.href)).href,
    exposureStops: exposureStops ?? BAKE_EXPOSURE_STOPS,
    box: shineBox(plan, new THREE.Vector3(...position).multiplyScalar(WORLD_SCALE)),
  };
}

/** Loads the probe, prefilters it by roughness (PMREM: a cube of mips, one per roughness step) and returns it. */
async function loadProbe(gl: THREE.WebGLRenderer): Promise<{ target: THREE.WebGLRenderTarget; box: ShineBox }> {
  const { url, exposureStops, box } = await probeEntry();
  const hdr = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(url);
  const { data, width, height } = hdr.image as { data: Float32Array; width: number; height: number };
  hdr.dispose();
  const equirect = new THREE.DataTexture(prepareProbe(data, width, height, exposureStops), width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.LinearSRGBColorSpace;
  equirect.magFilter = THREE.LinearFilter;
  equirect.minFilter = THREE.LinearFilter;
  equirect.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(gl);
  try {
    return { target: pmrem.fromEquirectangular(equirect), box };
  } finally {
    pmrem.dispose();
    equirect.dispose();
  }
}

/**
 * Turns the shine on and off with the quality tier (`QualityTier.shine`), loading the probe the first time a tier asks
 * for it once the room's tier is measured (behind the dark screen). Reduced motion leaves it on: nothing in it moves.
 */
export class Shine {
  private state: ShineState = 'waiting';
  private wanted = false;
  private started = false;
  private forced: boolean | null = new URLSearchParams(location.search).get('shine') === 'off' ? false : null;
  private overlays: THREE.Mesh[] = [];
  private probe: THREE.WebGLRenderTarget | null = null;
  private loading: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly gl: THREE.WebGLRenderer,
    private readonly screen: ShineScreen | null,
    private readonly onChange: () => void,
  ) {
    this.installDebug();
  }

  setTier(tier: QualityTier) {
    this.wanted = tier.shine;
    this.apply();
  }

  /** The probe may load now; resolves once it has (or at once when no tier asks for the shine). */
  start() {
    this.started = true;
    this.apply();
    return this.loading;
  }

  private get on() {
    return this.forced ?? this.wanted;
  }

  private apply() {
    if (this.on && this.started && this.state === 'waiting') this.loading = this.load();
    for (const overlay of this.overlays) overlay.visible = this.on;
    this.onChange();
  }

  private async load() {
    this.state = 'loading';
    try {
      const { target, box } = await loadProbe(this.gl);
      if (this.disposed) {
        target.dispose();
        return;
      }
      this.probe = target;
      this.overlays = addShine(this.root, target.texture, box, this.screen);
      this.state = 'ready';
    } catch (error) {
      this.state = 'failed';
      console.error('room: live shine is off, the probe did not load', error);
    }
    this.apply();
  }

  private installDebug() {
    const shine = this;
    window.__shine = {
      get state() {
        return shine.state;
      },
      get on() {
        return shine.state === 'ready' && shine.on;
      },
      get surfaces() {
        return shine.overlays.map((o) => ({ name: o.name.replace(/_shine$/, ''), roughness: (o.material as THREE.MeshBasicMaterial).userData.shine.shineRoughness.value }));
      },
      set(on) {
        shine.forced = on;
        shine.apply();
      },
      tune(name, { roughness, strength }) {
        const overlay = shine.overlays.find((o) => o.name === `${name}_shine`);
        if (!overlay) throw new Error(`shine: no surface ${name}`);
        const uniforms = (overlay.material as THREE.MeshBasicMaterial).userData.shine as ShineUniforms;
        if (roughness !== undefined) uniforms.shineRoughness.value = roughness;
        if (strength !== undefined) uniforms.shineStrength.value = strength;
        shine.onChange();
      },
    };
  }

  dispose() {
    this.disposed = true;
    for (const overlay of this.overlays) {
      overlay.removeFromParent();
      (overlay.material as THREE.Material).dispose();
      overlay.geometry.dispose();
    }
    this.overlays = [];
    this.probe?.dispose();
    delete window.__shine;
  }
}
