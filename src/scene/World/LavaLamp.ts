import * as THREE from 'three';
import lavaFrag from '../shaders/lava.frag.glsl?raw';
import lavaVert from '../shaders/lava.vert.glsl?raw';
import { ADD_LIGHT, haloTexture } from '../Application/Effects';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { LampUniforms } from './art';

// The lava lamp: slow wax on the glass, and the warm light it throws on the posters above it (their own shader
// reads LampUniforms) and on the wall behind them (an additive glow that keeps the canvas alpha). A click changes
// its mood: rose, amber, or switched off.

export const MOODS = ['rose', 'amber', 'off'] as const;
export type Mood = (typeof MOODS)[number];

const PALETTES: Record<Mood, { wax: string; liquid: string; light: string; power: number; strength: number }> = {
  rose: { wax: '#ffa58c', liquid: '#c23a52', light: '#ff8a5c', power: 1, strength: 0.32 },
  amber: { wax: '#ffd27a', liquid: '#c2611c', light: '#ffa24a', power: 1, strength: 0.3 },
  off: { wax: '#5a3a30', liquid: '#2a1a1c', light: '#000000', power: 0.4, strength: 0 },
};
// Each blob rises and sinks on its own slow period (seconds), like wax heating and cooling.
const BLOBS = [
  { period: 38, phase: 0.1, x: -0.2, sway: 0.18, r: 0.5 },
  { period: 47, phase: 2.2, x: 0.25, sway: 0.15, r: 0.42 },
  { period: 29, phase: 4.1, x: 0.05, sway: 0.22, r: 0.36 },
  { period: 55, phase: 1.3, x: -0.1, sway: 0.12, r: 0.55 },
  { period: 33, phase: 5.0, x: 0.3, sway: 0.1, r: 0.3 },
  { period: 61, phase: 3.3, x: -0.3, sway: 0.16, r: 0.4 },
];
const MOOD_FADE_S = 0.8;
const COLOURS = Object.fromEntries(
  MOODS.map((mood) => [mood, { wax: new THREE.Color(PALETTES[mood].wax), liquid: new THREE.Color(PALETTES[mood].liquid), light: new THREE.Color(PALETTES[mood].light) }]),
) as Record<Mood, { wax: THREE.Color; liquid: THREE.Color; light: THREE.Color }>;

export class LavaLamp {
  mood: Mood = 'rose';
  private readonly material: THREE.ShaderMaterial;
  private readonly blobs = BLOBS.map(() => new THREE.Vector4());
  private readonly wall: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  private readonly halo: THREE.Sprite;
  private readonly haloMap = haloTexture();
  private readonly colours = { wax: new THREE.Color(), liquid: new THREE.Color(), light: new THREE.Color() };
  private power = 1;
  private strength = 0;

  constructor(
    glass: THREE.Mesh,
    light: THREE.Vector3,
    private readonly lamp: LampUniforms,
    scene: THREE.Scene,
    wallX: number | null,
  ) {
    const box = new THREE.Box3().setFromObject(glass);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) / 2;
    this.setColours(this.mood, 1);
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

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloMap, color: this.colours.light, opacity: 0.35, ...ADD_LIGHT }));
    this.halo.position.copy(box.getCenter(new THREE.Vector3()));
    this.halo.scale.setScalar(0.3 * WORLD_SCALE);
    this.halo.renderOrder = 4;
    scene.add(this.halo);

    if (wallX !== null) {
      // The glow on the wall rises from the lamp: centred above it, wider than tall.
      const geometry = new THREE.PlaneGeometry(1.6 * WORLD_SCALE, 1.3 * WORLD_SCALE);
      geometry.rotateY(Math.PI / 2);
      this.wall = new THREE.Mesh(
        geometry,
        new THREE.ShaderMaterial({
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: `uniform vec3 uColor; varying vec2 vUv;
            void main() { vec2 d = (vUv - vec2(0.5, 0.3)) * vec2(1.0, 1.25); float g = exp(-dot(d, d) * 9.0);
              gl_FragColor = vec4(uColor * g, 1.0); }`,
          uniforms: { uColor: { value: new THREE.Color() } },
          ...ADD_LIGHT,
        }),
      );
      this.wall.position.set(wallX + 0.003 * WORLD_SCALE, light.y + 0.35 * WORLD_SCALE, light.z);
      this.wall.renderOrder = 3;
      scene.add(this.wall);
    }
  }

  nextMood() {
    this.mood = MOODS[(MOODS.indexOf(this.mood) + 1) % MOODS.length];
  }

  /** `clock` drives the wax (frozen while paused); `dt` eases a mood change. */
  update(clock: number, dt: number, camera: THREE.Camera) {
    const palette = PALETTES[this.mood];
    const k = Math.min(1, dt / MOOD_FADE_S);
    this.setColours(this.mood, k);
    this.power += (palette.power - this.power) * k;
    this.strength += (palette.strength - this.strength) * k;

    BLOBS.forEach((b, i) => {
      const rise = 0.5 - 0.5 * Math.cos((clock / b.period) * Math.PI * 2 + b.phase);
      // Wax lingers at the bottom and the top and moves fastest in between.
      const height = 0.1 + 0.8 * rise * rise * (3 - 2 * rise);
      this.blobs[i].set(b.x + b.sway * Math.sin(clock * 0.11 + b.phase * 2), height, b.r, 0);
    });

    // Across the glass as the camera sees it.
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    (this.material.uniforms.uAcross.value as THREE.Vector2).set(right.x, right.z).normalize();
    this.material.uniforms.uPower.value = this.power;

    // The light breathes a little as wax passes the bulb.
    const flicker = 0.92 + 0.08 * Math.sin(clock * 0.7) * Math.sin(clock * 0.23 + 1);
    const light = this.lamp.uLampColor.value.copy(this.colours.light).multiplyScalar(this.strength * flicker);
    this.halo.material.color.copy(this.colours.light);
    this.halo.material.opacity = 0.9 * this.strength * flicker;
    if (this.wall) this.wall.material.uniforms.uColor.value.copy(light).multiplyScalar(0.55);
  }

  setHalos(visible: boolean) {
    this.halo.visible = visible;
  }

  dispose() {
    this.material.dispose();
    this.haloMap.dispose();
    this.halo.material.dispose();
    this.wall?.geometry.dispose();
    this.wall?.material.dispose();
  }

  private setColours(mood: Mood, k: number) {
    this.colours.wax.lerp(COLOURS[mood].wax, k);
    this.colours.liquid.lerp(COLOURS[mood].liquid, k);
    this.colours.light.lerp(COLOURS[mood].light, k);
  }
}
