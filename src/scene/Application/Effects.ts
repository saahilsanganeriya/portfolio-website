import * as THREE from 'three';
import type { QualityTier } from './Quality';
import type { RoomNodes } from './RoomModel';
import { WORLD_SCALE } from './RoomModel';

const PROJECTOR = new THREE.Color('#9db4c0');
const TUNGSTEN = new THREE.Color('#ffcf8a');

/** A soft radial glow, warm-fringed like film halation around a bright source. */
export function haloTexture() {
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
 * make the monitor's alpha hole opaque wherever a glow or halo crosses the screen.
 */
export const ADD_LIGHT = {
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

/** The room's moving light: NAS LEDs, lamp and CRT glow, halation around each source. */
export class Effects {
  private readonly halos: THREE.Sprite[] = [];
  private readonly leds: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; halo: THREE.Sprite | null }[] = [];
  private readonly lampMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly haloMap = haloTexture();

  constructor(nodes: RoomNodes, scene: THREE.Scene) {
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
    for (const halo of this.halos) halo.visible = tier.halos;
  }

  /** `clock` is the ambient time in seconds; it stops while motion is paused. */
  update(clock: number) {
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

  dispose() {
    this.haloMap.dispose();
  }
}
