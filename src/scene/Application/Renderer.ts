import * as THREE from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { FinishingPass, type FinishFrame, type FinishSettings } from '../post/FinishingPass';
import filmFrag from '../shaders/film.frag.glsl?raw';
import filmVert from '../shaders/film.vert.glsl?raw';
import type { QualityTier } from './Quality';

// The shipped look; the T53 rows in DECISIONS.md hold the comparison it came from.
const FINISH: FinishSettings = {
  grade: { tone: 'aces', exposure: 0.4, toe: [0.03, 0.3], keepHue: 0.85, strength: 0.6 },
  bloom: 0.85,
  grain: 0.05,
  vignette: 0.42,
};

type Parts = Pick<FinishFrame, 'grade' | 'bloom' | 'film'>;

/** Tuning and screenshot hook: the live look, and which parts to draw whatever the tier says. */
export interface FinishProbe {
  readonly settings: FinishSettings;
  /** Applies partial settings; a new `grade` rebuilds the table. */
  set(settings: Partial<FinishSettings>): void;
  force: Partial<Parts> | null;
}

declare global {
  interface Window {
    __finish?: FinishProbe;
  }
}

/**
 * Two layers, as in Henry's scene: a CSS3D layer holding the monitor iframe, and above it a transparent WebGL canvas
 * that punches an alpha hole where the screen is. The finishing pass (grade, bloom, film) draws the room into a target
 * and then onto that canvas; on the tier with film only, the old film pass blends straight over the canvas instead.
 */
export class RoomRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly css: CSS3DRenderer;
  private readonly finish: FinishingPass;
  private readonly probe: FinishProbe;
  private parts: Parts = { grade: true, bloom: true, film: true };
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly filmScene = new THREE.Scene();
  private readonly filmCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly filmMaterial: THREE.ShaderMaterial;

  constructor(webglHost: HTMLElement, cssHost: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance', stencil: false });
    this.gl.setClearColor(0x000000, 0);
    this.gl.domElement.setAttribute('aria-hidden', 'true');
    webglHost.appendChild(this.gl.domElement);

    this.css = new CSS3DRenderer();
    cssHost.appendChild(this.css.domElement);

    this.filmMaterial = new THREE.ShaderMaterial({
      vertexShader: filmVert,
      fragmentShader: filmFrag,
      uniforms: {
        uTime: { value: 0 },
        uGrain: { value: FINISH.grain },
        uVignette: { value: FINISH.vignette },
        uFlicker: { value: 1 },
        uGrainScale: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    // One triangle that covers the screen.
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const filmMesh = new THREE.Mesh(triangle, this.filmMaterial);
    filmMesh.frustumCulled = false;
    this.filmScene.add(filmMesh);

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
  }

  setTier(tier: QualityTier) {
    this.parts = { grade: tier.grade, bloom: tier.bloom, film: tier.film };
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.gl.setPixelRatio(pixelRatio);
    this.gl.setSize(width, height);
    this.css.setSize(width, height);
    // Grain cells stay about one CSS pixel whatever the render scale.
    const grainScale = Math.max(1, pixelRatio);
    this.filmMaterial.uniforms.uGrainScale.value = grainScale;
    const buffer = this.gl.getDrawingBufferSize(new THREE.Vector2());
    this.finish.setSize(buffer.x, buffer.y, grainScale);
  }

  setPixelRatio(pixelRatio: number) {
    const size = this.gl.getSize(new THREE.Vector2());
    this.setSize(size.x, size.y, pixelRatio);
  }

  render(scene: THREE.Scene, cssScene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number, flicker: number) {
    const parts = { ...this.parts, ...this.probe.force };
    // Reduced motion: the grain holds still and the shutter does not flicker.
    const still = this.reducedMotion.matches;
    const frame: FinishFrame = { ...parts, time: still ? 0 : time, flicker: still ? 1 : flicker };
    if (parts.grade || parts.bloom) this.finish.render(scene, camera, frame);
    else {
      this.gl.render(scene, camera);
      if (parts.film) {
        const u = this.filmMaterial.uniforms;
        u.uTime.value = frame.time;
        u.uFlicker.value = frame.flicker;
        u.uGrain.value = this.finish.settings.grain;
        u.uVignette.value = this.finish.settings.vignette;
        this.gl.autoClear = false;
        this.gl.render(this.filmScene, this.filmCamera);
        this.gl.autoClear = true;
      }
    }
    this.css.render(cssScene, camera);
  }

  dispose() {
    this.finish.dispose();
    this.filmMaterial.dispose();
    this.gl.dispose();
    this.gl.domElement.remove();
    this.css.domElement.remove();
    delete window.__finish;
  }
}
