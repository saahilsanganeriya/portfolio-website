import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';

// A slow breeze through the room, after Bruno Simon's wind in folio-2025 (MIT): a small Perlin noise texture sampled at
// each vertex's world position, scrolled along one direction at two frequencies, summed and scaled into a sideways
// offset, in the vertex shader only. The room's plants sway by it (`plant_sway_*`, vertex colour R: 0 at the stem, 1 at
// the tips), and other modules can sway by it too: merge `uniforms` into a ShaderMaterial and call
// `windOffset(world.xz)` from WIND_GLSL, or pass a material to `sway()`. Under reduced motion it is still.

const DIRECTION_RAD = Math.PI * 0.6;
// Metres a tip moves at most (the two noise lookups sum to about ±1), the noise's scale per metre, and how fast the
// noise drifts along the wind (noise texture widths per second).
const STRENGTH_M = 0.009;
const FREQUENCY_PER_M = 0.5;
const DRIFT_PER_S = 0.05;
const NOISE_PX = 128;

/** GLSL: `vec2 windOffset(vec2 worldXz)`, the breeze's offset (world units) for a point; needs `uniforms`. */
export const WIND_GLSL = /* glsl */ `
uniform sampler2D uWindNoise;
uniform vec2 uWindDirection;
uniform float uWindTime;
uniform float uWindStrength;
uniform float uWindFrequency;
vec2 windOffset(vec2 worldXz) {
  vec2 at = worldXz * uWindFrequency;
  float near = texture2D(uWindNoise, at * 0.2 + uWindDirection * uWindTime).r - 0.5;
  float far = texture2D(uWindNoise, at * 0.1 + uWindDirection * uWindTime * 0.2).r - 0.5;
  return uWindDirection * (near + far) * uWindStrength;
}
`;

/** A tileable 2D Perlin noise, two octaves, in 0..1 (R8). */
function perlinTexture(size: number) {
  const period = 8;
  const gradients: [number, number][] = [];
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < period * period * 4; i++) {
    const a = random() * Math.PI * 2;
    gradients.push([Math.cos(a), Math.sin(a)]);
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const noise = (x: number, y: number, p: number, offset: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const corner = (cx: number, cy: number) => {
      const g = gradients[offset + (((cy % p) + p) % p) * p + (((cx % p) + p) % p)];
      return g[0] * (x - cx) + g[1] * (y - cy);
    };
    const u = fade(x - x0);
    const v = fade(y - y0);
    const top = corner(x0, y0) + (corner(x0 + 1, y0) - corner(x0, y0)) * u;
    const bottom = corner(x0, y0 + 1) + (corner(x0 + 1, y0 + 1) - corner(x0, y0 + 1)) * u;
    return top + (bottom - top) * v;
  };
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = noise((x / size) * period, (y / size) * period, period, 0) + 0.5 * noise((x / size) * period * 2, (y / size) * period * 2, period * 2, 0);
      data[y * size + x] = Math.round(Math.min(1, Math.max(0, 0.5 + n * 0.7)) * 255);
    }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class Wind {
  readonly uniforms = {
    uWindNoise: { value: perlinTexture(NOISE_PX) },
    uWindDirection: { value: new THREE.Vector2(Math.sin(DIRECTION_RAD), Math.cos(DIRECTION_RAD)) },
    uWindTime: { value: 0 },
    uWindStrength: { value: STRENGTH_M * WORLD_SCALE },
    uWindFrequency: { value: FREQUENCY_PER_M / WORLD_SCALE },
  };
  /**
   * Each swaying mesh's own copy of its material. The copy is what the scene draws, so the atlas streamer swaps the full
   * atlas into it directly; the room's material it was copied from hangs off the scene with the first-frame atlas.
   */
  private readonly swaying: { mesh: THREE.Mesh; own: THREE.MeshBasicMaterial }[] = [];

  constructor(private readonly still: boolean) {
    if (still) this.uniforms.uWindStrength.value = 0;
  }

  /**
   * Sways a mesh of the room by its vertex colour R. Its material is copied (the room's materials are shared with meshes
   * that must not move), and the vertex colour moves to its own attribute so the copy does not tint by it.
   */
  sway(mesh: THREE.Mesh) {
    const room = mesh.material;
    const colour = mesh.geometry.getAttribute('color');
    if (!(room instanceof THREE.MeshBasicMaterial) || !colour) return false;
    mesh.geometry.setAttribute('aSway', colour);
    mesh.geometry.deleteAttribute('color');
    const own = room.clone();
    own.vertexColors = false;
    own.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', `attribute vec3 aSway;\n${WIND_GLSL}\nvoid main() {`)
        .replace(
          '#include <project_vertex>',
          /* glsl */ `vec4 windWorld = modelMatrix * vec4(transformed, 1.0);
          windWorld.xz += windOffset(windWorld.xz) * aSway.r;
          vec4 mvPosition = viewMatrix * windWorld;
          gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    own.customProgramCacheKey = () => 'room-wind';
    mesh.material = own;
    this.swaying.push({ mesh, own });
    return true;
  }

  update(dt: number) {
    if (this.still) return;
    this.uniforms.uWindTime.value += Math.max(dt, 0) * DRIFT_PER_S;
  }

  state() {
    return { swaying: this.swaying.length, time: Number(this.uniforms.uWindTime.value.toFixed(3)), still: this.still };
  }

  dispose() {
    this.uniforms.uWindNoise.value.dispose();
    for (const s of this.swaying) s.own.dispose();
  }
}
