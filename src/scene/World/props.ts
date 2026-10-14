import * as THREE from 'three';
import steamFrag from '../shaders/steam.frag.glsl?raw';
import steamVert from '../shaders/steam.vert.glsl?raw';
import { ADD_LIGHT, haloTexture } from '../Application/Effects';
import { WORLD_SCALE } from '../Application/RoomModel';
import type { OvenNodes } from './nodes';

// The kitchen's small things that move: the steam over the espresso cup, and the countertop oven (its glow, its
// door on the hinge, the croissant inside).

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

  /** A fresh cup: a thick column for a few seconds, thinning back to the odd wisp. */
  brew() {
    this.brewing = BREW_S;
  }

  update(clock: number, dt: number, pixelRatio: number, still: boolean) {
    this.brewing = Math.max(0, this.brewing - dt);
    const u = this.points.material.uniforms;
    u.uTime.value = clock;
    u.uSize.value = 0.075 * WORLD_SCALE * pixelRatio * 600;
    // Between cups the machine breathes now and then; a fresh cup fills the column.
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
// The door swings down on a spring that stops a little hard, as a sprung drop-down door does, then settles.
const DOOR_OPEN = { stiffness: 60, damping: 9 };
const DOOR_CLOSE = { stiffness: 90, damping: 15 };
// With the door open the oven's light reads brighter on the croissant and the counter.
const GLOW_OPEN = 1.45;
// The rack slides the croissant this far out of the door as it opens.
const CROISSANT_OUT_M = 0.035;
const PROXY_REACH_M = 0.015;
const CROISSANT_HEADROOM_M = 0.05;
const STEP_S = 1 / 120;

export class Oven {
  open = false;
  /** How far the door has swung, 0 shut to 1 at its stop. */
  angle = 0;
  private velocity = 0;
  private glowLevel = 1;
  private readonly material: THREE.MeshBasicMaterial | null = null;
  private readonly haloMap = haloTexture();
  private readonly halo: THREE.Sprite | null = null;
  private readonly turn = new THREE.Quaternion();
  /** Which way the door's free edge swings: the sign that carries it away from the oven's body. */
  private readonly sign: number = 1;
  private readonly outward = new THREE.Vector3(1, 0, 0);
  private readonly croissantRest: THREE.Vector3 | null = null;

  constructor(
    private readonly nodes: OvenNodes,
    scene: THREE.Scene,
  ) {
    const { door, glow, croissant, body } = nodes;
    if (glow) {
      // The bake's own glow (its warm gradient over the elements), brightened and shimmering at runtime.
      const baked = glow.material instanceof THREE.MeshBasicMaterial ? glow.material : new THREE.MeshBasicMaterial({ color: OVEN.clone() });
      this.material = baked.clone();
      glow.material = this.material;
      this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloMap, color: OVEN.clone(), opacity: 0.3, ...ADD_LIGHT }));
      this.halo.position.copy(new THREE.Box3().setFromObject(glow).getCenter(new THREE.Vector3()));
      this.halo.scale.setScalar(0.32 * WORLD_SCALE);
      this.halo.renderOrder = 4;
      scene.add(this.halo);
    }
    if (door) {
      const hinge = door.pivot.getWorldPosition(new THREE.Vector3());
      const flat = hinge.clone().sub(body).setY(0);
      this.outward.set(Math.abs(flat.x) >= Math.abs(flat.z) ? Math.sign(flat.x) || 1 : 0, 0, Math.abs(flat.x) < Math.abs(flat.z) ? Math.sign(flat.z) || 1 : 0);
      this.sign = this.swingSign(door.pivot, door.axis, door.rest, door.angleDeg);
    }
    if (croissant) this.croissantRest = croissant.position.clone();
    this.placeCroissantProxy();
  }

  /** Opens a shut door, shuts an open one; returns whether it is now open. */
  toggle(instantly: boolean) {
    this.open = !this.open;
    if (instantly) {
      this.angle = this.open ? 1 : 0;
      this.velocity = 0;
    }
    this.placeCroissantProxy();
    return this.open;
  }

  /** The croissant answers a click only while the door is open. */
  get croissantActive() {
    return this.open && (this.nodes.croissantProxy?.layers.isEnabled(0) ?? false);
  }

  /** `clock` drives the glow's thermostat (frozen under reduced motion); `realDt` the door the visitor moved. */
  update(clock: number, realDt: number, still: boolean) {
    const target = this.open ? 1 : 0;
    if (still) {
      this.angle = target;
      this.velocity = 0;
    } else if (this.angle !== target || this.velocity !== 0) {
      const { stiffness, damping } = this.open ? DOOR_OPEN : DOOR_CLOSE;
      for (let t = 0; t < realDt; t += STEP_S) {
        const h = Math.min(STEP_S, realDt - t);
        this.velocity += (stiffness * (target - this.angle) - damping * this.velocity) * h;
        this.angle += this.velocity * h;
        // The hinge has hard stops at shut and fully open: the door bounces off them, it never passes them.
        if (this.angle > 1) [this.angle, this.velocity] = [1, -Math.abs(this.velocity) * 0.25];
        if (this.angle < 0) [this.angle, this.velocity] = [0, Math.abs(this.velocity) * 0.2];
      }
      if (Math.abs(this.angle - target) < 1e-4 && Math.abs(this.velocity) < 1e-3) [this.angle, this.velocity] = [target, 0];
    }
    const door = this.nodes.door;
    if (door) {
      const radians = THREE.MathUtils.degToRad(door.angleDeg) * this.angle * this.sign;
      door.pivot.quaternion.copy(door.rest).multiply(this.turn.setFromAxisAngle(door.axis, radians));
    }
    const croissant = this.nodes.croissant;
    if (croissant && this.croissantRest) {
      const parent = croissant.parent!;
      const rest = parent.localToWorld(this.croissantRest.clone());
      croissant.position.copy(parent.worldToLocal(rest.addScaledVector(this.outward, CROISSANT_OUT_M * WORLD_SCALE * this.angle)));
    }

    const thermostat = 0.9 + 0.1 * Math.sin(clock * 0.31) * Math.sin(clock * 0.07 + 2);
    const shimmer = 1 + 0.04 * Math.sin(clock * 9.1) * Math.sin(clock * 3.7);
    this.glowLevel = THREE.MathUtils.lerp(1, GLOW_OPEN, this.angle);
    const level = thermostat * shimmer * this.glowLevel;
    this.material?.color.setScalar(level);
    if (this.halo) this.halo.material.opacity = 0.32 * level;
  }

  /** The door is still swinging. */
  get moving() {
    return this.angle !== (this.open ? 1 : 0) || this.velocity !== 0;
  }

  setHalos(visible: boolean) {
    if (this.halo) this.halo.visible = visible;
  }

  probe() {
    const door = this.nodes.door;
    return {
      open: this.open,
      doorDeg: Number((door ? door.angleDeg * this.angle : 0).toFixed(1)),
      glow: Number(this.glowLevel.toFixed(2)),
      croissantActive: this.croissantActive,
    };
  }

  dispose() {
    this.material?.dispose();
    this.haloMap.dispose();
    this.halo?.material.dispose();
  }

  /** The door opens away from the oven: whichever turn moves the door's centre further from the body. */
  private swingSign(pivot: THREE.Object3D, axis: THREE.Vector3, rest: THREE.Quaternion, angleDeg: number) {
    const probe = (sign: number) => {
      pivot.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(angleDeg) * sign));
      pivot.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(pivot).getCenter(new THREE.Vector3()).distanceTo(this.nodes.body);
    };
    const sign = probe(1) >= probe(-1) ? 1 : -1;
    pivot.quaternion.copy(rest);
    pivot.updateMatrixWorld(true);
    return sign;
  }

  /**
   * The croissant's proxy: while the door is open, a box round the croissant reaching just out of the oven's own proxy
   * on the door side, so a click there finds the croissant first; while it is shut, off the raycaster's layer.
   */
  private placeCroissantProxy() {
    const proxy = this.nodes.croissantProxy;
    const croissant = this.nodes.croissant;
    if (!proxy || !croissant) return;
    if (!this.open) {
      proxy.layers.set(1);
      return;
    }
    const root = proxy.parent!;
    const box = new THREE.Box3().setFromObject(croissant).expandByScalar(0.006 * WORLD_SCALE);
    // Its place once the rack is out, reaching out of the door past the oven's own proxy so a click finds it first.
    box.translate(this.outward.clone().multiplyScalar(CROISSANT_OUT_M * WORLD_SCALE * (1 - this.angle)));
    const oven = this.nodes.ovenProxy ? new THREE.Box3().setFromObject(this.nodes.ovenProxy) : box.clone();
    const reach = PROXY_REACH_M * WORLD_SCALE;
    // Taller than the croissant: the camera looks down into the oven, so the ray to it crosses the door's mouth above it.
    box.max.y += CROISSANT_HEADROOM_M * WORLD_SCALE;
    if (this.outward.x > 0) box.max.x = Math.max(box.max.x, oven.max.x) + reach;
    else if (this.outward.x < 0) box.min.x = Math.min(box.min.x, oven.min.x) - reach;
    else if (this.outward.z > 0) box.max.z = Math.max(box.max.z, oven.max.z) + reach;
    else box.min.z = Math.min(box.min.z, oven.min.z) - reach;
    const size = box.getSize(new THREE.Vector3()).divideScalar(WORLD_SCALE);
    proxy.geometry.dispose();
    proxy.geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    proxy.quaternion.identity();
    proxy.scale.setScalar(1);
    proxy.position.copy(root.worldToLocal(box.getCenter(new THREE.Vector3())));
    proxy.updateMatrixWorld();
    proxy.layers.set(0);
  }
}
