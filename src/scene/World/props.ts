import * as THREE from 'three';
import steamFrag from '../shaders/steam.frag.glsl?raw';
import steamVert from '../shaders/steam.vert.glsl?raw';
import { ADD_LIGHT, haloTexture } from '../Application/Effects';
import { WORLD_SCALE } from '../Application/RoomModel';

// Small things that move by themselves: the ceiling fan, the espresso machine's steam, the oven's glow.

// A pull chain's three speeds, in turns a second; a real ceiling fan takes a few seconds to change speed.
export const FAN_SPEEDS = [0.28, 0.6, 1.05];
const FAN_SPIN_UP_S = 2.5;

export class Fan {
  speedIndex = 0;
  /** Turns a second now, and the angle turned since the room opened (radians): the dust in the beam swirls with it. */
  speed = 0;
  angle = 0;
  private readonly rest: THREE.Quaternion;
  private readonly turn = new THREE.Quaternion();

  constructor(
    private readonly blades: THREE.Object3D,
    private readonly axis: THREE.Vector3,
  ) {
    this.rest = blades.quaternion.clone();
  }

  pullChain() {
    this.speedIndex = (this.speedIndex + 1) % FAN_SPEEDS.length;
  }

  /** `dt` is 0 while motion is paused; under reduced motion the fan stands still. */
  update(dt: number, still: boolean) {
    const target = still ? 0 : FAN_SPEEDS[this.speedIndex];
    this.speed += (target - this.speed) * Math.min(1, dt / FAN_SPIN_UP_S);
    this.angle += this.speed * Math.PI * 2 * dt;
    this.blades.quaternion.copy(this.rest).multiply(this.turn.setFromAxisAngle(this.axis, this.angle));
  }
}

const PUFFS = 56;
const IDLE_RATE = 0.22;
const BREW_S = 9;

export class Steam {
  brewing = 0;
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(origin: THREE.Vector3, scene: THREE.Scene) {
    const seeds = new Float32Array(PUFFS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PUFFS * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: steamVert,
        fragmentShader: steamFrag,
        uniforms: {
          uTime: { value: 0 },
          uRate: { value: IDLE_RATE },
          uSize: { value: 1 },
          uRise: { value: 0.22 * WORLD_SCALE },
          uOrigin: { value: origin.clone() },
          uColor: { value: new THREE.Color('#b9b2a8') },
          uOpacity: { value: 0.16 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    // Puffs are placed in the shader; this sphere holds the whole column, so it is culled when out of view.
    geometry.boundingSphere = new THREE.Sphere(origin.clone().add(new THREE.Vector3(0, 0.12 * WORLD_SCALE, 0)), 0.25 * WORLD_SCALE);
    this.points.renderOrder = 7;
    scene.add(this.points);
  }

  /** Pulls a shot: a thick column for a few seconds, thinning back to the odd wisp. */
  brew() {
    this.brewing = BREW_S;
  }

  update(clock: number, dt: number, pixelRatio: number, still: boolean) {
    this.brewing = Math.max(0, this.brewing - dt);
    const u = this.points.material.uniforms;
    u.uTime.value = clock;
    u.uSize.value = 0.075 * WORLD_SCALE * pixelRatio * 600;
    // Between shots the machine breathes now and then; a brew fills the column.
    const breath = Math.max(0, Math.sin(clock * 0.21)) ** 3;
    u.uRate.value = Math.min(1, IDLE_RATE * breath + Math.min(1, this.brewing / 3));
    this.points.visible = !still;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

const OVEN = new THREE.Color('#ff9446');

export class OvenGlow {
  private readonly material = new THREE.MeshBasicMaterial({ color: OVEN.clone() });
  private readonly haloMap = haloTexture();
  private readonly halo: THREE.Sprite;

  constructor(glow: THREE.Mesh, scene: THREE.Scene) {
    glow.material = this.material;
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloMap, color: OVEN.clone(), opacity: 0.3, ...ADD_LIGHT }));
    this.halo.position.copy(new THREE.Box3().setFromObject(glow).getCenter(new THREE.Vector3()));
    this.halo.scale.setScalar(0.32 * WORLD_SCALE);
    this.halo.renderOrder = 4;
    scene.add(this.halo);
  }

  /** The elements cycle on a thermostat and shimmer while they are on. */
  update(clock: number) {
    const thermostat = 0.75 + 0.25 * Math.sin(clock * 0.31) * Math.sin(clock * 0.07 + 2);
    const shimmer = 1 + 0.04 * Math.sin(clock * 9.1) * Math.sin(clock * 3.7);
    const level = thermostat * shimmer;
    this.material.color.copy(OVEN).multiplyScalar(level);
    this.halo.material.opacity = 0.32 * level;
  }

  setHalos(visible: boolean) {
    this.halo.visible = visible;
  }

  dispose() {
    this.material.dispose();
    this.haloMap.dispose();
    this.halo.material.dispose();
  }
}
