import * as THREE from 'three';
import beamFrag from '../shaders/beam.frag.glsl?raw';
import beamVert from '../shaders/beam.vert.glsl?raw';
import motesFrag from '../shaders/motes.frag.glsl?raw';
import motesVert from '../shaders/motes.vert.glsl?raw';
import type { QualityTier } from './Quality';
import type { ProjectorPose, RoomNodes } from './RoomModel';
import { WORLD_SCALE } from './RoomModel';

const PROJECTOR = new THREE.Color('#9db4c0');
const TUNGSTEN = new THREE.Color('#ffcf8a');
const MAX_MOTES = 600;
// An 8 mm projector throws an image about a third as wide as the distance to the screen; film frames are 4:3.
const THROW_RATIO = 3;
const FRAME_ASPECT = 4 / 3;
const LENS_HALF_WIDTH = 0.018;

/** A soft radial glow, warm-fringed like film halation around a bright source. */
function haloTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,240,220,1)');
  g.addColorStop(0.18, 'rgba(255,200,150,0.45)');
  g.addColorStop(0.5, 'rgba(200,90,50,0.12)');
  g.addColorStop(1, 'rgba(120,40,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Additive light that leaves the canvas alpha alone. three.js's AdditiveBlending also adds alpha, which would
 * make the monitor's alpha hole opaque wherever a glow, halo, beam or mote crosses the screen.
 */
const ADD_LIGHT = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

/** Cheap deterministic hash in [0, 1). */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

/** The room's moving light: projector beam and dust, NAS LEDs, lamp and CRT glow, halation around each source. */
export class Effects {
  private readonly halos: THREE.Sprite[] = [];
  private readonly leds: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; halo: THREE.Sprite | null }[] = [];
  private beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> | null = null;
  private motes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private readonly lampMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly haloMap = haloTexture();
  /** The projector's shutter, felt faintly in the whole frame. */
  flicker = 1;

  constructor(nodes: RoomNodes, scene: THREE.Scene) {
    if (nodes.projector) this.addBeam(nodes.projector, scene);

    nodes.leds.forEach((mesh, i) => {
      const material = new THREE.MeshBasicMaterial({ color: PROJECTOR.clone() });
      mesh.material = material;
      this.leds.push({ mesh, material, halo: this.addHalo(scene, mesh.getWorldPosition(new THREE.Vector3()), 0.03, PROJECTOR, 0.5) });
      if (i === 0) material.color.multiplyScalar(0.9);
    });

    if (nodes.lampBulb) {
      this.lampMaterial = new THREE.MeshBasicMaterial({ color: TUNGSTEN.clone() });
      nodes.lampBulb.material = this.lampMaterial;
      this.addHalo(scene, nodes.lampBulb.getWorldPosition(new THREE.Vector3()), 0.32, TUNGSTEN, 0.55);
    }

    if (nodes.crtGlow) {
      // The curved glass bulges 8 mm in front of the flat OS hole, so a glow drawn on it shows only inside the bulge,
      // as a hard-edged patch over the OS. The monitor's flat glass layer carries the CRT's light instead.
      nodes.crtGlow.visible = false;
      this.addHalo(scene, nodes.monitor.position, 0.7, PROJECTOR, 0.12);
    }
  }

  setTier(tier: QualityTier) {
    if (this.motes) this.motes.geometry.setDrawRange(0, Math.min(MAX_MOTES, tier.motes));
    for (const halo of this.halos) halo.visible = tier.halos;
  }

  /** `clock` is the ambient time in seconds; it stops while motion is paused. */
  update(clock: number, pixelRatio: number) {
    // 18 frames a second through a two-blade shutter: a faint flutter, felt more than seen.
    const shutter = Math.sin(clock * Math.PI * 2 * 18) > 0.6 ? 1 : 0;
    this.flicker = 1 - shutter * 0.012;

    if (this.beam) {
      const u = this.beam.material.uniforms;
      u.uTime.value = clock;
      u.uFlicker.value = 1 - shutter * 0.06;
    }
    if (this.motes) {
      const u = this.motes.material.uniforms;
      u.uTime.value = clock;
      u.uSize.value = 1.6 * WORLD_SCALE * pixelRatio;
    }

    // Disk activity comes in bursts; the power light holds steady.
    this.leds.forEach(({ material, halo }, i) => {
      let level = 0.9;
      if (i > 0) {
        const burst = hash(Math.floor(clock * 0.7) * 3 + i) > 0.45;
        const blink = hash(Math.floor(clock * 14) * 7 + i * 13) > 0.5;
        level = burst && blink ? 1 : 0.12;
      }
      material.color.copy(PROJECTOR).multiplyScalar(level);
      if (halo) halo.material.opacity = 0.5 * level;
    });

    if (this.lampMaterial) this.lampMaterial.color.copy(TUNGSTEN).multiplyScalar(0.985 + 0.015 * Math.sin(clock * 2.3));
  }

  private addHalo(scene: THREE.Scene, position: THREE.Vector3, sizeMetres: number, color: THREE.Color, opacity: number) {
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.haloMap, color, opacity, ...ADD_LIGHT }),
    );
    halo.position.copy(position);
    halo.scale.setScalar(sizeMetres * WORLD_SCALE);
    halo.renderOrder = 4;
    scene.add(halo);
    this.halos.push(halo);
    return halo;
  }

  private addBeam({ lens, screenCenter }: ProjectorPose, scene: THREE.Scene) {
    const axis = screenCenter.clone().sub(lens);
    const length = axis.length();
    const dir = axis.clone().normalize();
    // Keep the frame level: its width runs parallel to the floor.
    const right = dir.clone().cross(THREE.Object3D.DEFAULT_UP).normalize();
    const up = right.clone().cross(dir).normalize();
    const halfEnd = new THREE.Vector2(length / THROW_RATIO / 2, length / THROW_RATIO / 2 / FRAME_ASPECT);
    const halfStart = new THREE.Vector2(LENS_HALF_WIDTH * WORLD_SCALE, (LENS_HALF_WIDTH * WORLD_SCALE) / FRAME_ASPECT);

    // A four-sided open cylinder turned 45 degrees is a square frustum; scaling its sections makes it 4:3.
    const geometry = new THREE.CylinderGeometry(Math.SQRT2, Math.SQRT2, 1, 4, 1, true);
    geometry.rotateY(Math.PI / 4);
    geometry.translate(0, -0.5, 0);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const t = -positions.getY(i);
      const half = halfStart.clone().lerp(halfEnd, t);
      positions.setXYZ(i, positions.getX(i) * half.x, -t * length, positions.getZ(i) * half.y);
    }
    geometry.computeVertexNormals();

    const material = new THREE.ShaderMaterial({
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      uniforms: {
        uColor: { value: PROJECTOR.clone() },
        uStrength: { value: 0.11 },
        uTime: { value: 0 },
        uFlicker: { value: 1 },
        uNoiseScale: { value: 7 / WORLD_SCALE },
      },
      side: THREE.DoubleSide,
      ...ADD_LIGHT,
    });
    this.beam = new THREE.Mesh(geometry, material);
    // Local axes: x = frame width, -y = along the beam, z = frame height.
    const basis = new THREE.Matrix4().makeBasis(right, dir.clone().negate(), right.clone().cross(dir.clone().negate()));
    this.beam.quaternion.setFromRotationMatrix(basis);
    this.beam.position.copy(lens);
    this.beam.renderOrder = 5;
    scene.add(this.beam);

    const seeds = new Float32Array(MAX_MOTES * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const motesGeometry = new THREE.BufferGeometry();
    motesGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_MOTES * 3), 3));
    motesGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.motes = new THREE.Points(
      motesGeometry,
      new THREE.ShaderMaterial({
        vertexShader: motesVert,
        fragmentShader: motesFrag,
        uniforms: {
          uTime: { value: 0 },
          uSize: { value: 1 },
          uColor: { value: PROJECTOR.clone().multiplyScalar(0.55) },
          uLens: { value: lens.clone() },
          uDir: { value: dir },
          uRight: { value: right },
          uUp: { value: up },
          uLength: { value: length },
          uHalfStart: { value: halfStart },
          uHalfEnd: { value: halfEnd },
        },
        ...ADD_LIGHT,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 6;
    scene.add(this.motes);
  }

  dispose() {
    this.haloMap.dispose();
  }
}
