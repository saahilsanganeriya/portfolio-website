import * as THREE from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { FinishingPass, type FinishFrame, type FinishSettings } from '../post/FinishingPass';
import { TexelDebug, type TexelStat } from '../post/TexelDebug';
import type { QualityTier } from './Quality';

// The look the finishing pass draws; the tiers pick the parts (no tier grades: the bake ships as baked). The T53 and T73
// rows in DECISIONS.md hold the comparisons. No grain: it was the largest share of the idle drift's crawl at every
// amplitude tried (T73 A/B).
const FINISH: FinishSettings = {
  grade: { tone: 'aces', exposure: 0.4, toe: [0.03, 0.3], keepHue: 0.85, strength: 0.6 },
  bloom: 0.85,
  vignette: 0.42,
  // Half an 8-bit level, static: dark gradients no longer band, and the drift's crawl does not rise (T73b A/B).
  dither: 0.5,
};

type Parts = Pick<FinishFrame, 'grade' | 'bloom' | 'film'>;

/** Tuning and screenshot hook: the live look, and which parts to draw whatever the tier says. */
export interface FinishProbe {
  readonly settings: FinishSettings;
  /** Applies partial settings; a new `grade` rebuilds the table. */
  set(settings: Partial<FinishSettings>): void;
  force: Partial<Parts> | null;
}

/** The render's A/B switches (`window.__roomDebug.set`): each overrides what the tier or the shipped look says. */
export interface RenderSwitches {
  /** MSAA samples on the scene target (0 = off). */
  samples: number;
  /** Cap on the device pixel ratio. */
  dprCap: number;
  anisotropy: number;
  grade: boolean;
  bloom: boolean;
  vignette: number;
  /** Output dither amplitude in 8-bit levels. */
  dither: number;
  /** Half-float scene target. */
  halfFloat: boolean;
  halos: boolean;
}

/** Measurement hook for captures and the texel view; the application fills in what only it can do. */
export interface RoomDebug {
  readonly switches: Partial<RenderSwitches>;
  set(patch: Partial<RenderSwitches>): void;
  /** Back to what the tier and the shipped look say. */
  reset(): void;
  /** Draws every baked surface in its texel-density band, with a legend (also `?debug=texels`). */
  texels(on: boolean): void;
  /** Per-surface texel density for the current view (turns the texel view on). */
  texelStats(): TexelStat[];
  /** Sets the ambient clock (seconds), so two captures of the idle drift start from the same moment. */
  setClock(seconds: number): void;
  /** The device pixel ratio the room draws at, and the GPU memory it holds. */
  readonly pixelRatio: number;
}

/** What the GPU holds for the room: textures (per texture) and the render targets, estimated from their sizes. */
export interface GpuMemory {
  textures: { name: string; width: number; height: number; format: string; bytes: number }[];
  textureBytes: number;
  targetBytes: number;
  totalBytes: number;
  /** three.js's own counts (renderer.info.memory). */
  info: { textures: number; geometries: number };
}

declare global {
  interface Window {
    __finish?: FinishProbe;
    __roomDebug?: RoomDebug;
  }
}

// Bytes per texel of what a compressed texture transcodes to (KTX2Loader's targets).
const COMPRESSED_BYTES: Record<number, [string, number]> = {
  [THREE.RGBA_ASTC_4x4_Format]: ['ASTC 4x4', 1],
  [THREE.RGBA_BPTC_Format]: ['BC7', 1],
  [THREE.RGB_S3TC_DXT1_Format]: ['BC1', 0.5],
  [THREE.RGBA_S3TC_DXT1_Format]: ['BC1', 0.5],
  [THREE.RGBA_S3TC_DXT5_Format]: ['BC3', 1],
  [THREE.RGB_ETC1_Format]: ['ETC1', 0.5],
  [THREE.RGB_ETC2_Format]: ['ETC2', 0.5],
  [THREE.RGBA_ETC2_EAC_Format]: ['ETC2 RGBA', 1],
  [THREE.RGB_PVRTC_4BPPV1_Format]: ['PVRTC', 0.5],
};

/** GPU bytes of one texture: compressed levels as stored, anything else as RGBA8 with a third more for mipmaps. */
export function textureBytes(texture: THREE.Texture): { width: number; height: number; format: string; bytes: number } {
  if (texture instanceof THREE.CompressedTexture) {
    const levels = texture.mipmaps as { data: ArrayBufferView; width: number; height: number }[];
    const [format = 'compressed', perTexel = 1] = COMPRESSED_BYTES[texture.format as number] ?? [];
    const bytes = levels.reduce((sum, level) => sum + (level.data?.byteLength || level.width * level.height * perTexel), 0);
    return { width: levels[0]?.width ?? 0, height: levels[0]?.height ?? 0, format, bytes };
  }
  const image = texture.image as { width?: number; height?: number } | null;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  const mips = texture.generateMipmaps && texture.minFilter !== THREE.LinearFilter && texture.minFilter !== THREE.NearestFilter ? 4 / 3 : 1;
  return { width, height, format: 'RGBA8', bytes: Math.round(width * height * 4 * mips) };
}

/**
 * Two layers, as in Henry's scene: a CSS3D layer holding the monitor iframe, and above it a WebGL canvas that punches
 * an alpha hole where the screen is. The room draws into a multisampled target and the finishing pass (grade, bloom,
 * vignette) resolves it onto the canvas; a tier with none of those and no MSAA draws straight onto the canvas.
 */
export class RoomRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly css: CSS3DRenderer;
  private readonly finish: FinishingPass;
  private readonly probe: FinishProbe;
  private readonly texelView = new TexelDebug();
  private tier!: QualityTier;
  private readonly switches: Partial<RenderSwitches> = {};
  private lastScene: THREE.Scene | null = null;
  private lastCamera: THREE.Camera | null = null;
  /** The application's side of the debug hook: set the clock, re-apply the tier (pixel ratio, halos), redraw. */
  hooks: { setClock(seconds: number): void; reapply(): void } = { setClock: () => {}, reapply: () => {} };

  constructor(webglHost: HTMLElement, cssHost: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance', stencil: false });
    this.gl.setClearColor(0x000000, 0);
    this.gl.domElement.setAttribute('aria-hidden', 'true');
    webglHost.appendChild(this.gl.domElement);

    this.css = new CSS3DRenderer();
    cssHost.appendChild(this.css.domElement);

    const finish = new FinishingPass(this.gl, structuredClone(FINISH));
    this.finish = finish;
    this.probe = {
      settings: finish.settings,
      set(settings) {
        Object.assign(finish.settings, settings);
        if (settings.grade) finish.rebuildLut();
      },
      force: null,
    };
    window.__finish = this.probe;
    this.installDebug();
  }

  setTier(tier: QualityTier) {
    const anisotropy = this.tier && this.anisotropy();
    this.tier = tier;
    this.finish.setSamples(this.switches.samples ?? tier.msaa);
    // The dither places the shades between two 8-bit levels. The vignette and the bloom make them in the pass; a tier
    // with neither (the lowest desktop tiers, phones) keeps the scene's own in a half-float target (T73b A/B).
    this.finish.setHalfFloat(this.switches.halfFloat ?? !(tier.bloom || tier.film));
    // A tier with another number of anisotropic taps filters what is already loaded again (one upload per texture).
    if (this.lastScene && anisotropy !== this.anisotropy()) this.prepareTextures(this.lastScene);
  }

  /** The tier with the debug switches over it: what the effects and the world should draw. */
  effective(tier: QualityTier): QualityTier {
    const { halos } = this.switches;
    return { ...tier, ...(halos !== undefined && { halos }) };
  }

  /** The device pixel ratio a tier draws at, under the ladder's cap (or the debug switch's). */
  pixelRatio(dprCap: number, tier: QualityTier) {
    return Math.min(window.devicePixelRatio || 1, this.switches.dprCap ?? dprCap) * tier.resolution;
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.gl.setPixelRatio(pixelRatio);
    this.gl.setSize(width, height);
    this.css.setSize(width, height);
    const buffer = this.gl.getDrawingBufferSize(new THREE.Vector2());
    this.finish.setSize(buffer.x, buffer.y);
  }

  setPixelRatio(pixelRatio: number) {
    const size = this.gl.getSize(new THREE.Vector2());
    this.setSize(size.x, size.y, pixelRatio);
  }

  /** The clear colour behind the set (floorplan.json `voidColor`); without one the canvas stays clear, as before. */
  setVoidColor(color: THREE.ColorRepresentation | null) {
    if (color === null) this.gl.setClearColor(0x000000, 0);
    else this.gl.setClearColor(color, 1);
  }

  /** Anisotropic filtering on every texture under `root` (atlases, the window, art), as many taps as the tier asks. */
  prepareTextures(root: THREE.Object3D) {
    const anisotropy = this.anisotropy();
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) this.filter(value, anisotropy);
        for (const uniform of Object.values((material as THREE.ShaderMaterial).uniforms ?? {})) {
          if (uniform?.value instanceof THREE.Texture) this.filter(uniform.value, anisotropy);
        }
      }
    });
  }

  /** The anisotropy textures get: the debug switch's, or the tier's, within what the GPU allows. */
  anisotropy() {
    return Math.max(1, Math.min(this.switches.anisotropy ?? this.tier.anisotropy, this.gl.capabilities.getMaxAnisotropy()));
  }

  private filter(texture: THREE.Texture, anisotropy: number) {
    if (texture.anisotropy === anisotropy || texture.minFilter === THREE.NearestFilter) return;
    texture.anisotropy = anisotropy;
    // Already on the GPU: the sampler is set on upload.
    if (texture.version > 0) texture.needsUpdate = true;
  }

  render(scene: THREE.Scene, cssScene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.lastScene = scene;
    this.lastCamera = camera;
    if (this.texelView.enabled) {
      this.gl.setRenderTarget(null);
      this.texelView.render(this.gl, scene, camera);
      this.css.render(cssScene, camera);
      return;
    }
    const tier = this.tier;
    const s = this.switches;
    const parts: Parts = { grade: s.grade ?? tier.grade, bloom: s.bloom ?? tier.bloom, film: tier.film, ...this.probe.force };
    const vignette = s.vignette ?? this.finish.settings.vignette;
    const frame: FinishFrame = { ...parts, film: parts.film && vignette > 0, vignette, dither: s.dither ?? this.finish.settings.dither };
    const antialiased = (s.samples ?? tier.msaa) > 0;
    // The dither is on every tier, so every tier finishes through the pass.
    if (antialiased || parts.grade || parts.bloom || frame.film || frame.dither > 0) this.finish.render(scene, camera, frame);
    else {
      this.gl.setRenderTarget(null);
      this.gl.render(scene, camera);
    }
    this.css.render(cssScene, camera);
  }

  /** GPU memory: every texture the scene's materials hold, and the render targets. */
  memory(scene: THREE.Scene): GpuMemory {
    const seen = new Set<unknown>();
    const textures: GpuMemory['textures'] = [];
    const add = (texture: THREE.Texture) => {
      // Render targets' own textures are counted with the targets.
      if (seen.has(texture.source) || texture.version === 0 || texture.isRenderTargetTexture || texture instanceof THREE.DepthTexture) return;
      seen.add(texture.source);
      textures.push({ name: texture.name || '(unnamed)', ...textureBytes(texture) });
    };
    scene.traverse((node) => {
      const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) add(value);
        for (const uniform of Object.values((m as THREE.ShaderMaterial).uniforms ?? {})) if (uniform?.value instanceof THREE.Texture) add(uniform.value);
      }
    });
    textures.sort((a, b) => b.bytes - a.bytes);
    const textureTotal = textures.reduce((sum, t) => sum + t.bytes, 0);
    const buffer = this.gl.getDrawingBufferSize(new THREE.Vector2());
    // The canvas's own colour and depth buffers, then the finishing pass's targets.
    const targetBytes = buffer.x * buffer.y * 8 + this.finish.memoryBytes();
    const { textures: count, geometries } = this.gl.info.memory;
    return { textures, textureBytes: textureTotal, targetBytes, totalBytes: textureTotal + targetBytes, info: { textures: count, geometries } };
  }

  private installDebug() {
    const renderer = this;
    const texels = (on: boolean) => {
      if (on && renderer.lastScene) renderer.texelView.enable(renderer.lastScene);
      else if (!on) renderer.texelView.disable();
      renderer.hooks.reapply();
    };
    window.__roomDebug = {
      switches: this.switches,
      set(patch) {
        Object.assign(renderer.switches, patch);
        renderer.setTier(renderer.tier);
        if ('anisotropy' in patch && renderer.lastScene) renderer.prepareTextures(renderer.lastScene);
        renderer.hooks.reapply();
      },
      reset() {
        for (const key of Object.keys(renderer.switches)) delete renderer.switches[key as keyof RenderSwitches];
        this.set({ anisotropy: undefined });
      },
      texels,
      texelStats() {
        if (!renderer.lastScene || !renderer.lastCamera) return [];
        texels(true);
        return renderer.texelView.measure(renderer.gl, renderer.lastScene, renderer.lastCamera);
      },
      setClock(seconds) {
        renderer.hooks.setClock(seconds);
      },
      get pixelRatio() {
        return renderer.gl.getPixelRatio();
      },
    };
    if (new URLSearchParams(location.search).get('debug') === 'texels') {
      // The scene is known once the first frame has drawn.
      const once = () => (this.lastScene ? texels(true) : requestAnimationFrame(once));
      requestAnimationFrame(once);
    }
  }

  dispose() {
    this.texelView.dispose();
    this.finish.dispose();
    this.gl.dispose();
    this.gl.domElement.remove();
    this.css.domElement.remove();
    delete window.__finish;
    delete window.__roomDebug;
  }
}
