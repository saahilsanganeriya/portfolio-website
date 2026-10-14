import * as THREE from 'three';
import lavaFrag from '../shaders/lava.frag.glsl?raw';
import lavaVert from '../shaders/lava.vert.glsl?raw';
import { ADD_LIGHT, haloTexture } from '../Application/Effects';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { LampUniforms } from './art';

// The lava lamp: slow wax on the glass, and its light on the room. A click moves it to the next colour set; wax,
// liquid and light blend over a second and a half while the blobs keep rising and sinking. The room's bake lit the
// lamp red-orange (blender/scripts/build_room.py), so its light on the room is re-tinted rather than added: near the
// lamp the baked colour turns to the new one's hue at the same brightness, and the whole room takes a faint trace of it.

export const COLOUR_SETS = [
  // The first set is the colour the room was baked with.
  { name: 'ember', wax: '#f2733a', liquid: '#6e1712', light: '#ff9959' },
  { name: 'amber', wax: '#f0b347', liquid: '#7a3510', light: '#ffbf5c' },
  { name: 'sea glass', wax: '#7fd8bf', liquid: '#123650', light: '#7fd6c8' },
  { name: 'violet', wax: '#c98df5', liquid: '#2a1450', light: '#b98cff' },
] as const;
export type ColourSetName = (typeof COLOUR_SETS)[number]['name'];

const BAKED_LIGHT = new THREE.Color(COLOUR_SETS[0].light);
// Re-tinting near the lamp stays within these bounds per channel, so a channel the bake barely lit is not blown up.
const TINT_MIN = 0.35;
const TINT_MAX = 2.6;
// How much of the lamp's hue the whole room takes, and how far the lamp's own light reaches (metres).
const ROOM_SHARE = 0.05;
const REACH_M = 1.3;
const BLEND_S = 1.6;

// Each blob rises and sinks on its own slow period (seconds), like wax heating and cooling.
// Radii are in the glass's half-widths: room v3's glass is squatter than the first room's, so the blobs are smaller.
const BLOBS = [
  { period: 38, phase: 0.1, x: -0.2, sway: 0.18, r: 0.36 },
  { period: 47, phase: 2.2, x: 0.25, sway: 0.15, r: 0.3 },
  { period: 29, phase: 4.1, x: 0.05, sway: 0.22, r: 0.26 },
  { period: 55, phase: 1.3, x: -0.1, sway: 0.12, r: 0.4 },
  { period: 33, phase: 5.0, x: 0.3, sway: 0.1, r: 0.22 },
  { period: 61, phase: 3.3, x: -0.3, sway: 0.16, r: 0.29 },
];

interface Colours {
  wax: THREE.Color;
  liquid: THREE.Color;
  light: THREE.Color;
}

const coloursOf = (index: number): Colours => {
  const set = COLOUR_SETS[index];
  return { wax: new THREE.Color(set.wax), liquid: new THREE.Color(set.liquid), light: new THREE.Color(set.light) };
};

const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export class LavaLamp {
  index = 0;
  private from = coloursOf(0);
  private to = coloursOf(0);
  private blend = 1;
  private readonly material: THREE.ShaderMaterial;
  private readonly blobs = BLOBS.map(() => new THREE.Vector4());
  private readonly halo: THREE.Sprite;
  private readonly haloMap = haloTexture();
  private readonly colours: Colours = coloursOf(0);
  private readonly patched: THREE.Material[] = [];

  constructor(
    glass: THREE.Mesh,
    light: THREE.Vector3,
    private readonly lamp: LampUniforms,
    scene: THREE.Scene,
    room: THREE.Object3D,
  ) {
    const box = new THREE.Box3().setFromObject(glass);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) / 2;
    this.material = new THREE.ShaderMaterial({
      vertexShader: lavaVert,
      fragmentShader: lavaFrag,
      uniforms: {
        uBlobs: { value: this.blobs },
        uWax: { value: this.colours.wax },
        uLiquid: { value: this.colours.liquid },
        uPower: { value: 1 },
        uCentre: { value: box.getCenter(new THREE.Vector3()) },
        uAcross: { value: new THREE.Vector2(1, 0) },
        uRadius: { value: radius },
        uBottom: { value: box.min.y },
        uHeight: { value: size.y },
        uStretch: { value: size.y / radius },
      },
    });
    glass.material = this.material;
    lamp.uLampPos.value.copy(light);
    lamp.uLampRange.value = REACH_M * WORLD_SCALE;

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloMap, color: this.colours.light, opacity: 0.3, ...ADD_LIGHT }));
    this.halo.position.copy(box.getCenter(new THREE.Vector3()));
    this.halo.scale.setScalar(0.3 * WORLD_SCALE);
    this.halo.renderOrder = 4;
    scene.add(this.halo);

    this.patchRoom(room);
  }

  get name(): ColourSetName {
    return COLOUR_SETS[this.index].name;
  }

  /** The next colour set; under reduced motion it changes at once. */
  next(instantly: boolean) {
    this.from = { wax: this.colours.wax.clone(), liquid: this.colours.liquid.clone(), light: this.colours.light.clone() };
    this.index = (this.index + 1) % COLOUR_SETS.length;
    this.to = coloursOf(this.index);
    this.blend = instantly ? 1 : 0;
  }

  /** The colours are still blending. */
  get changing() {
    return this.blend < 1;
  }

  /** `clock` drives the wax (frozen while paused or under reduced motion); `realDt` the blend the visitor started. */
  update(clock: number, realDt: number, camera: THREE.Camera) {
    this.blend = Math.min(1, this.blend + realDt / BLEND_S);
    const k = smoother(this.blend);
    for (const key of ['wax', 'liquid', 'light'] as const) this.colours[key].lerpColors(this.from[key], this.to[key], k);

    BLOBS.forEach((b, i) => {
      const rise = 0.5 - 0.5 * Math.cos((clock / b.period) * Math.PI * 2 + b.phase);
      // Wax lingers at the bottom and the top and moves fastest in between.
      const height = 0.1 + 0.8 * rise * rise * (3 - 2 * rise);
      this.blobs[i].set(b.x + b.sway * Math.sin(clock * 0.11 + b.phase * 2), height, b.r, 0);
    });

    // Across the glass as the camera sees it.
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    (this.material.uniforms.uAcross.value as THREE.Vector2).set(right.x, right.z).normalize();

    // The light breathes a little as wax passes the bulb.
    const flicker = 1 + 0.05 * Math.sin(clock * 0.7) * Math.sin(clock * 0.23 + 1);
    this.halo.material.color.copy(this.colours.light);
    this.halo.material.opacity = 0.3 * flicker;

    // The lamp's hue against the baked one, at equal brightness.
    const hue = this.colours.light.clone().multiplyScalar(luminance(BAKED_LIGHT) / Math.max(1e-4, luminance(this.colours.light)));
    const clamp = (v: number) => THREE.MathUtils.clamp(v, TINT_MIN, TINT_MAX);
    const ratio = new THREE.Color(clamp(hue.r / BAKED_LIGHT.r), clamp(hue.g / BAKED_LIGHT.g), clamp(hue.b / BAKED_LIGHT.b));
    this.lamp.uLampTint.value.copy(ratio).multiplyScalar(flicker);
    const share = ratio.clone().multiplyScalar(1 / Math.max(1e-4, luminance(ratio)));
    this.lamp.uRoomTint.value.setRGB(1, 1, 1).lerp(share, ROOM_SHARE);
  }

  setHalos(visible: boolean) {
    this.halo.visible = visible;
  }

  /** The room's light as the probe reports it: the set, how far its blend has got, and the tint near the lamp. */
  probe() {
    const t = this.lamp.uLampTint.value;
    return { index: this.index, name: this.name, blend: Number(this.blend.toFixed(2)), tint: [t.r, t.g, t.b].map((v) => Number(v.toFixed(2))) };
  }

  dispose() {
    this.material.dispose();
    this.haloMap.dispose();
    this.halo.material.dispose();
    for (const material of this.patched) {
      material.onBeforeCompile = () => {};
      material.needsUpdate = true;
    }
  }

  /**
   * The room's baked materials (`room_*` atlases) take the lamp's light: each fragment's baked colour is multiplied by
   * the tint, full near the lamp and falling off with distance, times the faint whole-room tint.
   */
  private patchRoom(room: THREE.Object3D) {
    const seen = new Set<THREE.Material>();
    room.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (seen.has(material) || !(material instanceof THREE.MeshBasicMaterial) || !material.map || !material.name.startsWith('room_')) continue;
        seen.add(material);
        this.patched.push(material);
        material.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, this.lamp);
          shader.vertexShader = shader.vertexShader
            .replace('void main() {', 'varying vec3 vLampWorld;\nvoid main() {')
            .replace('#include <project_vertex>', '#include <project_vertex>\n  vLampWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          shader.fragmentShader = shader.fragmentShader
            .replace('void main() {', 'uniform vec3 uLampTint;\nuniform vec3 uRoomTint;\nuniform vec3 uLampPos;\nuniform float uLampRange;\nvarying vec3 vLampWorld;\nvoid main() {')
            .replace(
              '#include <map_fragment>',
              '#include <map_fragment>\n  float lampD = distance(vLampWorld, uLampPos) / uLampRange;\n  diffuseColor.rgb *= mix(vec3(1.0), uLampTint, 1.0 / (1.0 + 6.0 * lampD * lampD)) * uRoomTint;',
            );
        };
        material.customProgramCacheKey = () => 'room-lamp';
        material.needsUpdate = true;
      }
    });
  }
}
