import * as THREE from 'three';
import coffeeFrag from '../shaders/coffee.frag.glsl?raw';
import coffeeVert from '../shaders/coffee.vert.glsl?raw';
import streamFrag from '../shaders/stream.frag.glsl?raw';
import streamVert from '../shaders/stream.vert.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { EspressoNodes } from './nodes';

// A shot of espresso: after a moment of pre-infusion a thin stream runs from the spout into the cup, dark at first
// and blonding at the end, the coffee rises in the cup under a crema that lightens and spreads, then the stream
// thins to drips and stops. The times follow the recorded pour (public/audio/sfx/espresso-pour), which starts with
// the click. A second click on a full cup tips it out first, then pulls a fresh shot.

const PRE_INFUSION_S = 1.2;
const STREAM_END_S = 6.9;
const FILL_START_S = 1.45;
const FILL_END_S = 7.1;
const SHOT_S = 7.8;
const EMPTY_S = 0.6;
// The stream's head and tail fall at about this speed (m/s): it takes a few frames to reach the cup.
const FALL_M_S = 0.55;
const STREAM_RADIUS_M = 0.0024;
// The cup narrows toward its foot: the coffee's surface is this much narrower when the cup is nearly empty.
const FOOT_SCALE = 0.72;

export type ShotPhase = 'empty' | 'pouring' | 'full' | 'emptying';

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export class Espresso {
  phase: ShotPhase = 'empty';
  /** How full the cup is, 0–1. */
  level = 0;
  private time = 0;
  private emptyFrom = 0;
  private started = false;
  private readonly coffee: THREE.Mesh;
  private readonly restPosition: THREE.Vector3;
  private readonly restScale: THREE.Vector3;
  private readonly coffeeMaterial: THREE.ShaderMaterial;
  private readonly stream: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly fullY: number;
  private readonly radius: number;
  private readonly fillDepth: number;
  /** From the spout down to the bottom of the empty cup (world units). */
  private readonly length: number;

  constructor(nodes: EspressoNodes, scene: THREE.Scene) {
    this.coffee = nodes.coffee;
    this.restPosition = this.coffee.position.clone();
    this.restScale = this.coffee.scale.clone();
    const bounds = new THREE.Box3().setFromObject(this.coffee);
    this.fullY = bounds.max.y;
    this.radius = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2;
    this.fillDepth = nodes.fillDepth;

    this.coffeeMaterial = new THREE.ShaderMaterial({
      vertexShader: coffeeVert,
      fragmentShader: coffeeFrag,
      uniforms: {
        uCentre: { value: bounds.getCenter(new THREE.Vector3()) },
        uRadius: { value: this.radius },
        uCrema: { value: 0 },
        uSwirl: { value: 0 },
        uLight: { value: 1 },
      },
    });
    this.coffee.material = this.coffeeMaterial;
    this.coffee.visible = false;

    // A thin tapering column from the spout down to the coffee's full surface; the shader shows only the part between
    // the falling head and the falling tail.
    this.length = Math.max(0.005 * WORLD_SCALE, nodes.spout.y - this.fullY + nodes.fillDepth);
    const geometry = new THREE.CylinderGeometry(STREAM_RADIUS_M * WORLD_SCALE * 0.8, STREAM_RADIUS_M * WORLD_SCALE, this.length, 10, 24, true);
    geometry.translate(0, -this.length / 2, 0);
    this.stream = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: streamVert,
        fragmentShader: streamFrag,
        uniforms: {
          uTime: { value: 0 },
          uHead: { value: 0 },
          uTail: { value: 0 },
          uSurface: { value: 1 },
          uBlond: { value: 0 },
          uThin: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.stream.position.copy(nodes.spout);
    this.stream.visible = false;
    this.stream.renderOrder = 6;
    scene.add(this.stream);
  }

  /** Pulls a shot (or, on a full cup, tips it out and pulls a fresh one). Returns false while one is already running. */
  pull(instantly: boolean) {
    if (this.phase === 'pouring' || this.phase === 'emptying') return false;
    if (instantly) {
      this.phase = 'full';
      this.level = 1;
      this.time = SHOT_S;
      this.started = true;
      this.place();
      return true;
    }
    if (this.phase === 'full') {
      this.phase = 'emptying';
      this.emptyFrom = this.level;
      this.time = 0;
    } else this.start();
    return true;
  }

  /** The seconds since the shot started, for the sound's timing and the tests. */
  get elapsed() {
    return this.time;
  }

  /** A shot is running, or the cup is being tipped out. */
  get busy() {
    return this.phase === 'pouring' || this.phase === 'emptying';
  }

  /** Whether a shot has started since the last call (the pump comes on, and its recording with it); clears itself. */
  takeStart() {
    const started = this.started;
    this.started = false;
    return started;
  }

  update(realDt: number, clock: number) {
    if (this.phase === 'emptying') {
      this.time += realDt;
      this.level = this.emptyFrom * (1 - smooth(clamp01(this.time / EMPTY_S)));
      if (this.time >= EMPTY_S) this.start();
    } else if (this.phase === 'pouring') {
      this.time += realDt;
      this.level = 1 - (1 - clamp01((this.time - FILL_START_S) / (FILL_END_S - FILL_START_S))) ** 1.6;
      if (this.time >= SHOT_S) [this.phase, this.level] = ['full', 1];
    }
    this.place();

    const u = this.stream.material.uniforms;
    const fall = (FALL_M_S * WORLD_SCALE) / this.length;
    const head = clamp01((this.time - PRE_INFUSION_S) * fall);
    const tail = clamp01((this.time - STREAM_END_S) * fall);
    // Along the stream (0 at the spout, 1 at the empty cup's bottom), the coffee's surface hides the rest of it.
    const surface = 1 - (this.fillDepth * this.level) / this.length;
    this.stream.visible = this.phase === 'pouring' && head > 0 && tail < surface;
    u.uTime.value = clock;
    u.uHead.value = head;
    u.uTail.value = tail;
    u.uSurface.value = surface;
    // The shot blonds as it ends, and the stream necks down to a thread before it breaks into drips.
    u.uBlond.value = clamp01((this.time - (STREAM_END_S - 2.2)) / 2.2);
    u.uThin.value = 1 - 0.55 * clamp01((this.time - (STREAM_END_S - 1.4)) / 1.4);
    this.coffeeMaterial.uniforms.uSwirl.value = clock;
  }

  probe() {
    return { phase: this.phase, level: Number(this.level.toFixed(3)), streaming: this.stream.visible };
  }

  dispose() {
    this.coffeeMaterial.dispose();
    this.stream.geometry.dispose();
    this.stream.material.dispose();
    this.stream.removeFromParent();
  }

  private start() {
    this.phase = 'pouring';
    this.level = 0;
    this.time = 0;
    this.started = true;
  }

  /** The coffee's surface at this level: lower and narrower in the cup's foot, its crema forming as it rises. */
  private place() {
    const coffee = this.coffee;
    coffee.visible = this.level > 0.004;
    const parent = coffee.parent!;
    const world = parent.localToWorld(this.restPosition.clone());
    world.y -= this.fillDepth * (1 - this.level);
    coffee.position.copy(parent.worldToLocal(world));
    const across = THREE.MathUtils.lerp(FOOT_SCALE, 1, Math.sqrt(this.level));
    coffee.scale.set(this.restScale.x * across, this.restScale.y, this.restScale.z * across);
    this.coffeeMaterial.uniforms.uRadius.value = this.radius * across;
    this.coffeeMaterial.uniforms.uCrema.value = smooth(clamp01(this.level * 1.15));
  }
}
