import * as THREE from 'three';
import { Spring, springFor } from '../Camera/spring';
import glintFrag from '../shaders/glint.frag.glsl?raw';
import glintVert from '../shaders/glint.vert.glsl?raw';
import { WORLD_SCALE } from './RoomModel';

const TUNGSTEN = new THREE.Color('#ffcf8a');
// A small hop that reads from where the camera is: a share of the distance to it, never more than a share of the object.
const LIFT_SHARE_OF_DISTANCE = 0.004;
const LIFT_MAX_SHARE_OF_SIZE = 0.12;
const LIFT_MIN = 0.004 * WORLD_SCALE;
// Larger things (the projector screen) only catch the light; they do not jump.
const LIFT_MAX_SIZE = 0.6 * WORLD_SCALE;
const SWEEP_MS = 650;
const PULSE_MS = 700;
const LIFT_SPRING = springFor(0.55, 0.5);
const GLOW_SPRING = springFor(0.3);
const SWEEP_AXIS = new THREE.Vector3(1, 1, 0.35).normalize();

/** Blends light in without touching the canvas alpha, which the monitor's hole depends on. */
const ADD_LIGHT_KEEP_ALPHA = {
  transparent: true,
  depthWrite: false,
  depthFunc: THREE.LessEqualDepth,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

interface Reactor {
  meshes: THREE.Mesh[];
  basePositions: THREE.Vector3[];
  /** Unit direction the object lifts in, world space: up off a surface, or out from a wall. */
  direction: THREE.Vector3;
  size: number;
  center: THREE.Vector3;
  sweepRange: [number, number];
  lift: Spring;
  glow: Spring;
  height: number;
  material: THREE.ShaderMaterial | null;
  sweepStartedAt: number;
  active: boolean;
}

/**
 * Props answer the pointer: the object under it lifts a little on a spring and a glint runs along its edges.
 * Each clickable proxy box (hit_*) claims the visible meshes that sit inside it.
 */
export class HoverReactions {
  private readonly reactors = new Map<THREE.Object3D, Reactor>();
  private hovered: THREE.Object3D | null = null;
  private pulseUntil = 0;
  private pulsed: THREE.Object3D | null = null;

  constructor(
    root: THREE.Object3D,
    proxies: readonly THREE.Object3D[],
    private readonly camera: THREE.Camera,
    private readonly reducedMotion: boolean,
  ) {
    const meshes: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && node.visible && !node.name.startsWith('hit_')) meshes.push({ mesh: node, box: new THREE.Box3().setFromObject(node) });
    });
    for (const proxy of proxies) {
      const reactor = this.claim(proxy, meshes);
      if (reactor) this.reactors.set(proxy, reactor);
    }
  }

  /** Visible meshes each proxy lifts, by name (tests and debugging). */
  get claims(): Record<string, string[]> {
    return Object.fromEntries([...this.reactors].map(([proxy, r]) => [proxy.name, r.meshes.map((m) => m.name)]));
  }

  /** How far the object behind a proxy is lifted now, in millimetres. */
  liftOf(proxyName: string) {
    for (const [proxy, reactor] of this.reactors) if (proxy.name === proxyName) return reactor.lift.value[0];
    return 0;
  }

  /** The proxy under the pointer, or null. */
  set(proxy: THREE.Object3D | null) {
    if (proxy === this.hovered) return;
    this.hovered = proxy;
    if (proxy) this.wake(proxy);
  }

  /** A tap on a touch screen has no hover: the object reacts briefly instead. */
  pulse(proxy: THREE.Object3D) {
    this.pulsed = proxy;
    this.pulseUntil = performance.now() + PULSE_MS;
    this.wake(proxy);
  }

  /** Advances the springs; returns whether anything moved (so a paused room still draws the change). */
  update(dt: number, now: number) {
    if (this.pulsed && now > this.pulseUntil) this.pulsed = null;
    let changed = false;
    for (const [proxy, r] of this.reactors) {
      if (!r.active) continue;
      const on = proxy === this.hovered || proxy === this.pulsed ? 1 : 0;
      r.lift.step([on * r.height], dt, LIFT_SPRING);
      r.glow.step([on], dt, GLOW_SPRING);
      const offset = r.lift.value[0];
      r.meshes.forEach((mesh, i) => {
        const parent = mesh.parent!;
        const world = parent.localToWorld(r.basePositions[i].clone()).addScaledVector(r.direction, offset);
        mesh.position.copy(parent.worldToLocal(world));
      });
      if (r.material) {
        const u = r.material.uniforms;
        const sweep = this.reducedMotion ? 1 : Math.min(1, (now - r.sweepStartedAt) / SWEEP_MS);
        const [from, to] = r.sweepRange;
        u.uSweep.value = this.reducedMotion ? Infinity : from + (to - from) * sweep;
        u.uHover.value = r.glow.value[0];
      }
      changed = true;
      const resting = on === 0 && Math.abs(offset) < 0.05 && Math.abs(r.lift.velocity[0]) < 0.05 && r.glow.value[0] < 0.01;
      if (resting) this.rest(r);
    }
    return changed;
  }

  dispose() {
    for (const r of this.reactors.values()) {
      this.rest(r);
      r.material?.dispose();
    }
  }

  private claim(proxy: THREE.Object3D, meshes: { mesh: THREE.Mesh; box: THREE.Box3 }[]): Reactor | null {
    const box = new THREE.Box3().setFromObject(proxy, true);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    const reach = box.clone().expandByVector(size.clone().multiplyScalar(0.1).addScalar(0.005 * WORLD_SCALE));
    const limit = size.clone().multiplyScalar(1.6).addScalar(0.01 * WORLD_SCALE);
    const claimed = meshes.filter(({ box: b }) => {
      const s = b.getSize(new THREE.Vector3());
      return reach.containsPoint(b.getCenter(new THREE.Vector3())) && s.x <= limit.x && s.y <= limit.y && s.z <= limit.z;
    });
    if (!claimed.length) return null;

    const bounds = new THREE.Box3();
    for (const { box: b } of claimed) bounds.union(b);
    const extent = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    // A thin, tall box against a wall (a poster, a print) comes off the wall toward the room; anything else hops up.
    const thin = Math.min(extent.x, extent.z);
    const wallHung = thin < 0.08 * WORLD_SCALE && extent.y > 3 * thin && Math.max(extent.x, extent.z) > 3 * thin;
    const direction = new THREE.Vector3(0, 1, 0);
    if (wallHung) {
      const axis = extent.x < extent.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const toCamera = this.camera.getWorldPosition(new THREE.Vector3()).sub(center);
      direction.copy(axis.multiplyScalar(Math.sign(toCamera.dot(axis)) || 1)).add(new THREE.Vector3(0, 0.25, 0)).normalize();
    }
    const corners = [bounds.min, bounds.max].map((p) => p.dot(SWEEP_AXIS));
    const maxExtent = Math.max(extent.x, extent.y, extent.z);
    return {
      meshes: claimed.map(({ mesh }) => mesh),
      basePositions: claimed.map(({ mesh }) => mesh.position.clone()),
      direction,
      size: maxExtent,
      center,
      sweepRange: [Math.min(...corners) - maxExtent * 0.2, Math.max(...corners) + maxExtent * 0.2],
      lift: new Spring(1),
      glow: new Spring(1),
      height: 0,
      material: null,
      sweepStartedAt: 0,
      active: false,
    };
  }

  private wake(proxy: THREE.Object3D) {
    const r = this.reactors.get(proxy);
    if (!r) return;
    const distance = this.camera.getWorldPosition(new THREE.Vector3()).distanceTo(r.center);
    r.height =
      this.reducedMotion || r.size > LIFT_MAX_SIZE
        ? 0
        : THREE.MathUtils.clamp(distance * LIFT_SHARE_OF_DISTANCE, LIFT_MIN, Math.max(LIFT_MIN, r.size * LIFT_MAX_SHARE_OF_SIZE));
    r.sweepStartedAt = performance.now();
    if (!r.material) this.addGlint(r);
    for (const mesh of r.meshes) for (const child of mesh.children) if (child.userData.glint) child.visible = true;
    r.active = true;
  }

  private addGlint(r: Reactor) {
    const extent = r.size;
    r.material = new THREE.ShaderMaterial({
      vertexShader: glintVert,
      fragmentShader: glintFrag,
      uniforms: {
        uColor: { value: TUNGSTEN.clone() },
        uHover: { value: 0 },
        uSweep: { value: -Infinity },
        uWidth: { value: extent * 0.12 },
        uAxis: { value: SWEEP_AXIS },
      },
      side: THREE.DoubleSide,
      ...ADD_LIGHT_KEEP_ALPHA,
    });
    for (const mesh of r.meshes) {
      // The baked room ships without normals (its materials are unlit); the rim needs them.
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      const glint = new THREE.Mesh(mesh.geometry, r.material);
      glint.userData.glint = true;
      glint.renderOrder = 4;
      glint.raycast = () => {};
      mesh.add(glint);
    }
  }

  private rest(r: Reactor) {
    r.active = false;
    r.lift.set([0]);
    r.glow.set([0]);
    r.meshes.forEach((mesh, i) => mesh.position.copy(r.basePositions[i]));
    for (const mesh of r.meshes) for (const child of mesh.children) if (child.userData.glint) child.visible = false;
  }
}
