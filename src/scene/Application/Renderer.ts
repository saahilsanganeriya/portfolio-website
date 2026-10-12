import * as THREE from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import filmFrag from '../shaders/film.frag.glsl?raw';
import filmVert from '../shaders/film.vert.glsl?raw';

export interface FilmSettings {
  enabled: boolean;
  grain: number;
  vignette: number;
}

/**
 * Two layers, as in Henry's scene: a CSS3D layer holding the monitor iframe, and above it a transparent WebGL canvas
 * that punches an alpha hole where the screen is. The film pass is drawn into the same canvas, so no extra layer.
 */
export class RoomRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly css: CSS3DRenderer;
  readonly film: FilmSettings = { enabled: true, grain: 0.09, vignette: 0.42 };
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
        uGrain: { value: this.film.grain },
        uVignette: { value: this.film.vignette },
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
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.gl.setPixelRatio(pixelRatio);
    this.gl.setSize(width, height);
    this.css.setSize(width, height);
    // Grain cells stay about one CSS pixel whatever the render scale.
    this.filmMaterial.uniforms.uGrainScale.value = Math.max(1, pixelRatio);
  }

  setPixelRatio(pixelRatio: number) {
    const size = this.gl.getSize(new THREE.Vector2());
    this.setSize(size.x, size.y, pixelRatio);
  }

  render(scene: THREE.Scene, cssScene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number, flicker: number) {
    this.gl.render(scene, camera);
    if (this.film.enabled) {
      const u = this.filmMaterial.uniforms;
      u.uTime.value = time;
      u.uFlicker.value = flicker;
      u.uGrain.value = this.film.grain;
      u.uVignette.value = this.film.vignette;
      this.gl.autoClear = false;
      this.gl.render(this.filmScene, this.filmCamera);
      this.gl.autoClear = true;
    }
    this.css.render(cssScene, camera);
  }

  dispose() {
    this.filmMaterial.dispose();
    this.gl.dispose();
    this.gl.domElement.remove();
    this.css.domElement.remove();
  }
}
