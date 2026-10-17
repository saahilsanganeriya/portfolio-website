import * as THREE from 'three';

// Texel density: how many texels of a surface's baked atlas land on one screen pixel. Below 1 the GPU magnifies the
// bake (soft); 1–2 is the target band; above 2 the atlas spends texels the screen cannot show.
const BANDS = [
  { below: 1, color: '#e0402a', label: '< 1 texel per pixel (magnified, soft)' },
  { below: 2, color: '#3fb95a', label: '1–2 texels per pixel' },
  { below: Infinity, color: '#3a66e8', label: '> 2 texels per pixel' },
] as const;
// The measure mode writes density / DENSITY_RANGE into red and the mesh's index into green and blue.
const DENSITY_RANGE = 8;

const vertexShader = /* glsl */ `
attribute vec2 aDebugUv;
varying vec2 vUv;
void main() {
  vUv = aDebugUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uTexSize;
uniform float uMeasure;
uniform float uId;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
varying vec2 vUv;
void main() {
  vec2 texel = vUv * uTexSize;
  vec2 dx = dFdx(texel);
  vec2 dy = dFdy(texel);
  // Along the pixel's longer footprint: the axis the GPU would pick a mip level for.
  float density = sqrt(max(dot(dx, dx), dot(dy, dy)));
  if (uMeasure > 0.5) {
    gl_FragColor = vec4(clamp(density / ${DENSITY_RANGE.toFixed(1)}, 0.0, 1.0), mod(uId, 256.0) / 255.0, floor(uId / 256.0) / 255.0, 1.0);
    return;
  }
  vec3 band = density < 1.0 ? uLow : (density <= 2.0 ? uMid : uHigh);
  float luma = dot(texture2D(uMap, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(band * (0.35 + 0.65 * sqrt(luma)), 1.0);
}`;

/** A surface's density over the pixels it covers in one frame. */
export interface TexelStat {
  name: string;
  texture: string;
  /** Screen pixels the surface covers. */
  pixels: number;
  median: number;
  p10: number;
  /** Share of its pixels below 1 texel per pixel. */
  belowOne: number;
}

interface Source {
  map: THREE.Texture;
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
}

/** The baked atlas a mesh shows and the UV set it reads it with, or null for a surface with no bake. */
function bakedSource(mesh: THREE.Mesh): Source | null {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const geometry = mesh.geometry;
  const uniforms = (material as THREE.ShaderMaterial).uniforms;
  const bake = uniforms?.uBake?.value as THREE.Texture | null | undefined;
  if (bake && geometry.getAttribute('aBakeUv')) return { map: bake, uv: geometry.getAttribute('aBakeUv') };
  const map = (material as THREE.MeshBasicMaterial).map;
  if (!map) return null;
  const uv = geometry.getAttribute(map.channel ? `uv${map.channel}` : 'uv');
  return uv ? { map, uv } : null;
}

function textureSize(texture: THREE.Texture) {
  const image = (texture.mipmaps?.[0] ?? texture.image) as { width?: number; height?: number } | null;
  return new THREE.Vector2(image?.width ?? 1, image?.height ?? 1);
}

/**
 * The texel-density view (`?debug=texels`, or `window.__roomDebug.texels(true)`): every baked surface drawn in the band
 * its density falls in, shaded by the bake's brightness so the room stays readable, with a legend. `measure` renders
 * the density and each mesh's index into a target and reads it back for per-surface statistics. The debug materials
 * are swapped in only for the draw, so the room's own code always finds its own materials.
 */
export class TexelDebug {
  enabled = false;
  private readonly swaps = new Map<THREE.Object3D, THREE.Material | null>();
  private readonly meshes: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; texture: THREE.Texture }[] = [];
  private readonly flat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
  private legend: HTMLElement | null = null;

  enable(scene: THREE.Scene) {
    if (this.enabled) return;
    this.enabled = true;
    const colors = BANDS.map((b) => new THREE.Color(b.color));
    scene.traverse((node) => {
      // Halos, dust and lines add light on top of the bake: not drawn while the bands show.
      if (node instanceof THREE.Sprite || node instanceof THREE.Points || node instanceof THREE.Line) {
        this.swaps.set(node, null);
        return;
      }
      if (!(node instanceof THREE.Mesh)) return;
      const source = bakedSource(node);
      if (!source) {
        const own = Array.isArray(node.material) ? node.material[0] : node.material;
        // Glass and shader-drawn surfaces would hide what is behind them; plain unbaked ones show grey.
        this.swaps.set(node, own instanceof THREE.ShaderMaterial || own.transparent ? null : this.flat);
        return;
      }
      node.geometry.setAttribute('aDebugUv', source.uv);
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uMap: { value: source.map },
          uTexSize: { value: textureSize(source.map) },
          uMeasure: { value: 0 },
          uId: { value: this.meshes.length + 1 },
          uLow: { value: colors[0] },
          uMid: { value: colors[1] },
          uHigh: { value: colors[2] },
        },
        side: (Array.isArray(node.material) ? node.material[0] : node.material).side,
      });
      this.swaps.set(node, material);
      this.meshes.push({ mesh: node, material, texture: source.map });
    });
    this.showLegend();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    for (const { mesh, material } of this.meshes) {
      mesh.geometry.deleteAttribute('aDebugUv');
      material.dispose();
    }
    this.swaps.clear();
    this.meshes.length = 0;
    this.legend?.remove();
    this.legend = null;
  }

  /** Draws `scene` with the debug materials into the current target, then puts the room's own back. */
  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const restore: [THREE.Object3D, THREE.Material | THREE.Material[] | null, boolean][] = [];
    for (const [node, swap] of this.swaps) {
      const mesh = node as THREE.Mesh;
      restore.push([node, mesh.material ?? null, node.visible]);
      if (swap) mesh.material = swap;
      else node.visible = false;
    }
    try {
      gl.render(scene, camera);
    } finally {
      for (const [node, material, visible] of restore) {
        if (material) (node as THREE.Mesh).material = material;
        node.visible = visible;
      }
    }
  }

  /** Renders the measure mode at the canvas's size and returns each surface's density, largest surfaces first. */
  measure(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): TexelStat[] {
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    for (const { material } of this.meshes) material.uniforms.uMeasure.value = 1;
    const background = scene.background;
    scene.background = null;
    const clear = gl.getClearColor(new THREE.Color());
    const alpha = gl.getClearAlpha();
    gl.setRenderTarget(target);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    this.render(gl, scene, camera);
    gl.setClearColor(clear, alpha);
    const pixels = new Uint8Array(size.x * size.y * 4);
    gl.readRenderTargetPixels(target, 0, 0, size.x, size.y, pixels);
    gl.setRenderTarget(null);
    scene.background = background;
    target.dispose();
    for (const { material } of this.meshes) material.uniforms.uMeasure.value = 0;

    const samples = new Map<number, number[]>();
    for (let i = 0; i < pixels.length; i += 4) {
      const id = pixels[i + 1] + pixels[i + 2] * 256;
      if (!id) continue;
      let list = samples.get(id);
      if (!list) samples.set(id, (list = []));
      list.push((pixels[i] / 255) * DENSITY_RANGE);
    }
    const stats: TexelStat[] = [];
    for (const [id, values] of samples) {
      const entry = this.meshes[id - 1];
      if (!entry) continue;
      values.sort((a, b) => a - b);
      stats.push({
        name: entry.mesh.name,
        texture: entry.texture.name || entry.texture.uuid,
        pixels: values.length,
        median: Number(values[Math.floor(values.length / 2)].toFixed(2)),
        p10: Number(values[Math.floor(values.length / 10)].toFixed(2)),
        belowOne: Number((values.filter((v) => v < 1).length / values.length).toFixed(3)),
      });
    }
    return stats.sort((a, b) => b.pixels - a.pixels);
  }

  private showLegend() {
    const legend = document.createElement('div');
    legend.setAttribute('data-texel-legend', '');
    legend.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:9999;padding:8px 10px;background:rgba(10,10,10,.85);color:#eee;' +
      'font:12px/1.5 ui-monospace,monospace;border-radius:4px;pointer-events:none';
    legend.innerHTML =
      '<div>texel density, baked surfaces</div>' +
      BANDS.map((b) => `<div><span style="display:inline-block;width:10px;height:10px;margin-right:6px;background:${b.color}"></span>${b.label}</div>`).join('') +
      '<div style="color:#999">grey: no bake</div>';
    document.body.appendChild(legend);
    this.legend = legend;
  }

  dispose() {
    this.disable();
    this.flat.dispose();
  }
}
