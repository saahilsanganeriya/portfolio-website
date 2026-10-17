import * as THREE from 'three';
import compositeFrag from './shaders/composite.frag.glsl?raw';
import downFrag from './shaders/down.frag.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import practicalFrag from './shaders/practical.frag.glsl?raw';
import practicalVert from './shaders/practical.vert.glsl?raw';
import upFrag from './shaders/up.frag.glsl?raw';
import { buildGradeLut, LUT_SIZE, type GradeSettings } from './grade';

/**
 * The look: the grade's table, how strongly the practicals' blurred light is screened over the frame, the vignette, and
 * the output dither's amplitude in 8-bit levels (0.5 = ±0.5/255; 0 = none).
 */
export interface FinishSettings {
  grade: GradeSettings;
  bloom: number;
  vignette: number;
  dither: number;
}

/**
 * Which parts this frame draws (the quality tier decides); `film` is the vignette, at `vignette`, and `dither` the
 * output dither's amplitude (the settings' or an A/B's).
 */
export interface FinishFrame {
  grade: boolean;
  bloom: boolean;
  film: boolean;
  vignette: number;
  dither: number;
}

interface Practical {
  /** room.glb nodes; every mesh under one is part of the light. */
  names: string[];
  gain: number;
  /** Display brightness where its bloom starts and where it is full: only a light's bright core glows. */
  knee: [number, number];
}

// Only the room's own light sources bloom; everything else in the bake stays crisp however bright it is.
const PRACTICALS: Practical[] = [
  { names: ['lamp_bulb'], gain: 1.3, knee: [0.35, 0.8] },
  { names: ['desk_lamp_shade'], gain: 0.9, knee: [0.6, 0.95] },
  { names: ['lava_lamp_glass'], gain: 0.85, knee: [0.25, 0.7] },
  { names: ['oven_glow'], gain: 0.9, knee: [0.3, 0.8] },
  { names: ['props_lantern', 'props_kitchen_pendant', 'env_hall_sconce'], gain: 0.8, knee: [0.6, 0.95] },
  { names: ['env_photo_light', 'env_picture_light', 'env_shelf_light'], gain: 0.7, knee: [0.7, 0.98] },
  { names: ['projection_surface'], gain: 0.45, knee: [0.45, 0.9] },
  { names: ['projector_beam'], gain: 0.5, knee: [0, 0.2] },
  { names: ['nas_led_0', 'nas_led_1', 'nas_led_2', 'nas_led_3'], gain: 1, knee: [0.2, 0.6] },
];
// The CRT's screen is the OS hole, so its glow is a constant light behind the glass, masked off the OS itself.
const CRT_GLOW = new THREE.Color('#9db4c0').multiplyScalar(0.5);
// Practicals draw only on this layer in the bloom pass; the main camera never sees it.
const BLOOM_LAYER = 11;
// Millimetres (the world's unit) a surface may sit behind the visible one and still count as seen.
const DEPTH_BIAS_MM = 6;
const BLUR_LEVELS = 3;

/** Full-screen triangle in its own scene; each pass swaps the material. */
class FullScreen {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mesh: THREE.Mesh;

  constructor() {
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(triangle);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  draw(gl: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.mesh.material = material;
    gl.setRenderTarget(target);
    gl.render(this.scene, this.camera);
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

const passMaterial = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

/**
 * The room drawn into a target, then finished onto the canvas in one pass: grade (tone curve + warm table), bloom from
 * the practical lights only, and the vignette. The target is drawn exactly as the canvas would be (display
 * values, blending in display space), so the room's custom shaders and additive glows look as they were tuned.
 */
export class FinishingPass {
  readonly settings: FinishSettings;
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly bloomTargets: THREE.WebGLRenderTarget[] = [];
  private readonly lut: THREE.Data3DTexture;
  private lutBuilt = false;
  private readonly screen = new FullScreen();
  private readonly composite: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private readonly shared = {
    tScene: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2() },
    uNear: { value: 1 },
    uFar: { value: 1000 },
    uBias: { value: DEPTH_BIAS_MM },
  };
  private practicals: { mesh: THREE.Mesh; material: THREE.ShaderMaterial }[] = [];
  private crt: THREE.Mesh | null = null;
  private litScene: THREE.Scene | null = null;

  constructor(
    private readonly gl: THREE.WebGLRenderer,
    settings: FinishSettings,
  ) {
    this.settings = settings;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      stencilBuffer: false,
      depthTexture: new THREE.DepthTexture(1, 1),
      // The bloom's depth test reads the resolved depth; the multisampled one is not needed after the resolve.
      storeMultisampledDepthBuffer: false,
    });
    // three.js encodes sRGB in the shaders (as for the canvas) only for an XR target, and for one stores the bytes
    // as they are; a plain sRGB target would decode the room's display-space glows as linear light. RGBA8 keeps the
    // hardware from encoding a second time.
    (this.sceneTarget as THREE.WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    this.sceneTarget.texture.internalFormat = 'RGBA8';

    // Half-float where the GPU can render to it: the blur's faint tails band in 8 bits.
    const bloomType = gl.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    for (let i = 0; i < BLUR_LEVELS * 2; i++) {
      this.bloomTargets.push(
        new THREE.WebGLRenderTarget(1, 1, { type: bloomType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false }),
      );
    }

    // Built on first use: no tier grades the room by default, the table is for tuning and a veto (DECISIONS, T73).
    this.lut = new THREE.Data3DTexture(new Uint8Array(LUT_SIZE ** 3 * 4), LUT_SIZE, LUT_SIZE, LUT_SIZE);
    this.lut.format = THREE.RGBAFormat;
    this.lut.type = THREE.UnsignedByteType;
    this.lut.minFilter = this.lut.magFilter = THREE.LinearFilter;
    this.lut.wrapR = this.lut.wrapS = this.lut.wrapT = THREE.ClampToEdgeWrapping;
    this.lut.unpackAlignment = 1;

    this.composite = passMaterial(compositeFrag, {
      tScene: { value: this.sceneTarget.texture },
      tBloom: { value: this.bloomTargets[BLUR_LEVELS * 2 - 1].texture },
      tLut: { value: this.lut },
      uLutSize: { value: LUT_SIZE },
      uGrade: { value: 1 },
      uBloom: { value: 0 },
      uVignette: { value: 0 },
      uDither: { value: 0 },
    });
    this.down = passMaterial(downFrag, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = passMaterial(upFrag, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
  }

  /** Rebuilds the grade's table from `settings.grade` (at its first use, and after tuning changed it). */
  rebuildLut() {
    this.lut.image.data = buildGradeLut(this.settings.grade);
    this.lut.needsUpdate = true;
    this.lutBuilt = true;
  }

  /** MSAA samples on the scene target (0 = none); a new count rebuilds the target on the next frame. */
  setSamples(samples: number) {
    if (this.sceneTarget.samples === samples) return;
    this.sceneTarget.samples = samples;
    this.sceneTarget.dispose();
  }

  /**
   * The scene target's colour: 8 bits per channel, or half-float where the GPU can render to it. Half-float keeps the
   * shades between two 8-bit levels (a dark atlas magnified across many pixels) for the dither to place.
   */
  setHalfFloat(on: boolean) {
    const half = on && this.gl.extensions.has('EXT_color_buffer_float');
    const type = half ? THREE.HalfFloatType : THREE.UnsignedByteType;
    if (this.sceneTarget.texture.type === type) return;
    this.sceneTarget.texture.type = type;
    this.sceneTarget.texture.internalFormat = half ? 'RGBA16F' : 'RGBA8';
    this.sceneTarget.dispose();
  }

  /** Bytes the pass's targets hold on the GPU (colour, depth, MSAA renderbuffers, the bloom chain). */
  memoryBytes() {
    const { width, height, samples } = this.sceneTarget;
    const pixels = width * height;
    // Colour RGBA8 or RGBA16F + depth 32-bit; with MSAA, a renderbuffer of each per sample on top of the resolved pair.
    const colour = this.sceneTarget.texture.type === THREE.HalfFloatType ? 8 : 4;
    let bytes = pixels * (colour + 4) * (1 + samples);
    const bloomTexel = this.bloomTargets[0].texture.type === THREE.HalfFloatType ? 8 : 4;
    for (const target of this.bloomTargets) bytes += target.width * target.height * bloomTexel;
    return bytes;
  }

  setSize(width: number, height: number) {
    this.sceneTarget.setSize(width, height);
    // The bloom starts at half size; each blur level halves it again, then climbs back to a quarter.
    const size = (level: number) => [Math.max(1, Math.round(width / 2 ** level)), Math.max(1, Math.round(height / 2 ** level))];
    for (let i = 0; i < BLUR_LEVELS * 2; i++) {
      const level = i <= BLUR_LEVELS ? i + 1 : BLUR_LEVELS * 2 + 1 - i;
      const [w, h] = size(level);
      this.bloomTargets[i].setSize(w, h);
    }
  }

  /** Draws the room into the target and finishes it onto the canvas. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, frame: FinishFrame) {
    const { gl, settings } = this;
    gl.setRenderTarget(this.sceneTarget);
    gl.render(scene, camera);

    const bloom = frame.bloom && settings.bloom > 0 && this.renderBloom(scene, camera);
    const u = this.composite.uniforms;
    if (frame.grade && !this.lutBuilt) this.rebuildLut();
    u.uGrade.value = frame.grade ? 1 : 0;
    u.uBloom.value = bloom ? settings.bloom : 0;
    u.uVignette.value = frame.film ? frame.vignette : 0;
    u.uDither.value = frame.dither;
    this.screen.draw(gl, this.composite, null);
  }

  /** The practicals' light at half size, blurred down three levels and back up to a quarter; false if there is none. */
  private renderBloom(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (this.litScene !== scene) this.findPracticals(scene);
    if (!this.practicals.length) return false;

    const { gl } = this;
    const source = this.bloomTargets[0];
    this.shared.tScene.value = this.sceneTarget.texture;
    this.shared.tDepth.value = this.sceneTarget.depthTexture;
    this.shared.uResolution.value.set(source.width, source.height);
    this.shared.uNear.value = camera.near;
    this.shared.uFar.value = camera.far;

    const saved = this.practicals.map(({ mesh, material }) => {
      const own = mesh.material;
      mesh.material = material;
      return own;
    });
    const mask = camera.layers.mask;
    const autoUpdate = scene.matrixWorldAutoUpdate;
    camera.layers.set(BLOOM_LAYER);
    // The main pass has just updated every matrix.
    scene.matrixWorldAutoUpdate = false;
    gl.setRenderTarget(source);
    gl.render(scene, camera);
    scene.matrixWorldAutoUpdate = autoUpdate;
    camera.layers.mask = mask;
    this.practicals.forEach(({ mesh }, i) => (mesh.material = saved[i]));

    for (let i = 1; i < BLUR_LEVELS * 2; i++) {
      const input = this.bloomTargets[i - 1];
      const pass = i <= BLUR_LEVELS ? this.down : this.up;
      pass.uniforms.tInput.value = input.texture;
      pass.uniforms.uTexel.value.set(1 / input.width, 1 / input.height);
      this.screen.draw(gl, pass, this.bloomTargets[i]);
    }
    return true;
  }

  private findPracticals(scene: THREE.Scene) {
    this.litScene = scene;
    this.practicals = [];
    const material = (gain: number, knee: [number, number], emit?: THREE.Color) =>
      new THREE.ShaderMaterial({
        vertexShader: practicalVert,
        fragmentShader: practicalFrag,
        uniforms: {
          ...this.shared,
          uEmit: { value: emit ? emit.clone() : new THREE.Color(0, 0, 0) },
          uGain: { value: gain },
          uKnee: { value: new THREE.Vector2(...knee) },
        },
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

    for (const { names, gain, knee } of PRACTICALS) {
      for (const name of names) {
        scene.getObjectByName(name)?.traverse((node) => {
          if (!(node instanceof THREE.Mesh) || node.name.startsWith('hit_')) return;
          node.layers.enable(BLOOM_LAYER);
          this.practicals.push({ mesh: node, material: material(gain, knee) });
        });
      }
    }

    const screen = scene.getObjectByName('monitor_screen');
    const width = Number(screen?.userData.width_m);
    const height = Number(screen?.userData.height_m);
    if (screen && width > 0 && height > 0) {
      const glow = material(1, [0, 0.01], CRT_GLOW);
      this.crt = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glow);
      const scale = new THREE.Vector3();
      screen.matrixWorld.decompose(this.crt.position, this.crt.quaternion, scale);
      // width_m is in metres; the node's world scale carries the room's metres-to-millimetres factor.
      this.crt.scale.set(width * scale.x, height * scale.y, 1);
      this.crt.layers.set(BLOOM_LAYER);
      this.crt.name = 'finish_crt_glow';
      scene.add(this.crt);
      this.crt.updateMatrixWorld();
      this.practicals.push({ mesh: this.crt, material: glow });
    }
  }

  dispose() {
    this.sceneTarget.depthTexture?.dispose();
    this.sceneTarget.dispose();
    for (const target of this.bloomTargets) target.dispose();
    this.lut.dispose();
    this.composite.dispose();
    this.down.dispose();
    this.up.dispose();
    this.screen.dispose();
    for (const { material } of this.practicals) material.dispose();
    this.crt?.geometry.dispose();
    this.crt?.removeFromParent();
  }
}
