import * as THREE from 'three';
import type { Framing, RoomNodes } from './RoomModel';
import { WORLD_SCALE } from './RoomModel';
import { damp, easeInOutQuint, type Easing } from './tween';

export type CameraPhase = 'loading' | 'idle' | 'desk' | 'monitor';

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

interface Transition {
  from: Pose;
  to: CameraPhase;
  startedAt: number;
  duration: number;
  easing: Easing;
  onDone?: () => void;
}

const IDLE_SWAY_RAD = 0.22;
const IDLE_PERIOD_S = 80;
const MONITOR_MARGIN = 1.3;
// Henry's framings were tuned for a 16:10 window; taller windows step back so the desk stays in frame.
const REFERENCE_ASPECT = 900 / 1440;

/** Glides between the framings authored as empties in the room (cam_loading, cam_idle, cam_desk, cam_monitor). */
export class RoomCamera {
  readonly instance: THREE.PerspectiveCamera;
  phase: CameraPhase = 'loading';
  private readonly framings: RoomNodes['framings'];
  private readonly monitorCenter: THREE.Vector3;
  private readonly monitorNormal: THREE.Vector3;
  private readonly monitorSize: { width: number; height: number };
  private readonly current: Pose;
  private readonly deskPointer = new THREE.Vector2();
  private transition: Transition | null = null;
  private aspect = 1;

  constructor(nodes: RoomNodes, aspect: number) {
    this.framings = nodes.framings;
    this.monitorCenter = nodes.monitor.position.clone();
    this.monitorNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(nodes.monitor.quaternion);
    this.monitorSize = { width: nodes.monitor.width, height: nodes.monitor.height };
    const loading = this.framings.loading;
    this.instance = new THREE.PerspectiveCamera(loading.fov, aspect, 0.01 * WORLD_SCALE, 80 * WORLD_SCALE);
    this.current = { position: loading.position.clone(), target: loading.target.clone(), fov: loading.fov };
    this.resize(aspect);
    this.apply();
  }

  get moving() {
    return this.transition !== null;
  }

  /** The phase the camera is in or heading to. */
  get destination(): CameraPhase {
    return this.transition?.to ?? this.phase;
  }

  resize(aspect: number) {
    this.aspect = aspect;
    this.instance.aspect = aspect;
    this.instance.updateProjectionMatrix();
  }

  goTo(phase: CameraPhase, duration = 1000, easing: Easing = easeInOutQuint, onDone?: () => void, now = performance.now()) {
    if (this.destination === phase && !this.transition) return;
    if (this.transition?.to === phase) return;
    this.transition = {
      from: { position: this.current.position.clone(), target: this.current.target.clone(), fov: this.current.fov },
      to: phase,
      startedAt: now,
      duration,
      easing,
      onDone,
    };
  }

  /** `pointer` is in [-1, 1] on both axes, +y up; `clock` is the ambient time in seconds (frozen while paused). */
  update(now: number, dt: number, clock: number, pointer: THREE.Vector2) {
    this.deskPointer.lerp(pointer, damp(2.5, dt));
    if (this.transition) {
      const t = this.transition;
      const progress = Math.min(1, (now - t.startedAt) / t.duration);
      const eased = t.easing(progress);
      const live = this.pose(t.to, clock);
      this.current.position.lerpVectors(t.from.position, live.position, eased);
      this.current.target.lerpVectors(t.from.target, live.target, eased);
      this.current.fov = THREE.MathUtils.lerp(t.from.fov, live.fov, eased);
      if (progress >= 1) {
        this.phase = t.to;
        this.transition = null;
        t.onDone?.();
      }
    } else {
      const live = this.pose(this.phase, clock);
      this.current.position.copy(live.position);
      this.current.target.copy(live.target);
      this.current.fov = live.fov;
    }
    this.apply();
  }

  private apply() {
    this.instance.position.copy(this.current.position);
    this.instance.lookAt(this.current.target);
    if (this.instance.fov !== this.current.fov) {
      this.instance.fov = this.current.fov;
      this.instance.updateProjectionMatrix();
    }
  }

  private pose(phase: CameraPhase, clock: number): Pose {
    switch (phase) {
      case 'loading':
        return this.fromFraming(this.framings.loading);
      case 'idle':
        return this.idlePose(clock);
      case 'desk':
        return this.deskPose();
      case 'monitor':
        return this.monitorPose();
    }
  }

  private fromFraming(f: Framing, distanceScale = 1): Pose {
    const position = f.target.clone().add(f.position.clone().sub(f.target).multiplyScalar(distanceScale));
    return { position, target: f.target.clone(), fov: f.fov };
  }

  private aspectFit() {
    return THREE.MathUtils.clamp(1 + (1 / this.aspect - REFERENCE_ASPECT) * 0.55, 0.9, 1.6);
  }

  private idlePose(clock: number): Pose {
    const pose = this.fromFraming(this.framings.idle, this.aspectFit());
    const angle = Math.sin((clock * Math.PI * 2) / IDLE_PERIOD_S) * IDLE_SWAY_RAD;
    pose.position.sub(pose.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle).add(pose.target);
    pose.position.y += Math.sin((clock * Math.PI * 2) / 47) * 0.05 * WORLD_SCALE;
    return pose;
  }

  private deskPose(): Pose {
    const pose = this.fromFraming(this.framings.desk, this.aspectFit());
    const forward = pose.target.clone().sub(pose.position).normalize();
    const right = forward.clone().cross(THREE.Object3D.DEFAULT_UP).normalize();
    const up = right.clone().cross(forward).normalize();
    const { x, y } = this.deskPointer;
    // Henry's parallax: the look-at point follows the pointer further than the eye does.
    pose.target.addScaledVector(right, x * 0.12 * WORLD_SCALE).addScaledVector(up, y * 0.06 * WORLD_SCALE);
    pose.position.addScaledVector(right, x * 0.06 * WORLD_SCALE).addScaledVector(up, y * 0.04 * WORLD_SCALE);
    return pose;
  }

  /** Close enough that the glass fills the view with a thin bezel, whatever the window's shape. */
  private monitorPose(): Pose {
    const fov = this.framings.monitor.fov;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    const fitHeight = this.monitorSize.height / 2 / halfTan;
    const fitWidth = this.monitorSize.width / 2 / (halfTan * this.aspect);
    const distance = Math.max(fitHeight, fitWidth) * MONITOR_MARGIN;
    const authored = this.framings.monitor.position.clone().sub(this.framings.monitor.target).normalize();
    const direction = authored.lengthSq() > 0 ? authored : this.monitorNormal;
    return {
      position: this.monitorCenter.clone().addScaledVector(direction, distance),
      target: this.monitorCenter.clone(),
      fov,
    };
  }
}
