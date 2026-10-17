import * as THREE from 'three';
import steamFrag from '../shaders/coffee_steam.frag.glsl?raw';
import steamVert from '../shaders/coffee_steam.vert.glsl?raw';
import perlinGlsl from '../shaders/perlin.glsl?raw';
import type { CoffeeSteamNode } from './nodes';

// Steam over the coffee on the desk, after Henry Heffernan's CoffeeSteam: one quad of soft noise rising from the mug
// (coffee_steam), fading toward its edges and its top, warm grey, drawn without writing depth. Under reduced motion it
// holds still.

const COLOUR = '#d8d0c4';
const OPACITY = 0.55;
// Under reduced motion the noise stops at this moment, a wisp mid-rise.
const STILL_AT_S = 7.3;

const withPerlin = (glsl: string) => glsl.replace('#include <perlin>', perlinGlsl);

export class CoffeeSteam {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private time = STILL_AT_S;

  constructor(
    node: CoffeeSteamNode,
    private readonly still: boolean,
  ) {
    const geometry = new THREE.PlaneGeometry(node.widthM, node.heightM, 1, 12);
    geometry.translate(0, node.heightM / 2, 0);
    const material = new THREE.ShaderMaterial({
      vertexShader: withPerlin(steamVert),
      fragmentShader: withPerlin(steamFrag),
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: this.time },
        uColour: { value: new THREE.Color(COLOUR) },
        uOpacity: { value: OPACITY },
      },
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'coffee_steam_plume';
    // It turns to the camera in its shader, so its box must hold every turn.
    this.mesh.frustumCulled = false;
    node.anchor.add(this.mesh);
  }

  update(dt: number) {
    if (this.still) return;
    this.time += Math.max(dt, 0);
    this.mesh.material.uniforms.uTime.value = this.time;
  }

  state() {
    return { time: Number(this.time.toFixed(2)), moving: !this.still };
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
