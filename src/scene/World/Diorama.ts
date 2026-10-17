import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';

// The set as a diorama (owner, round 8: a full 360° orbit, "the walls see-through from behind"): each wall, with what
// hangs on it, fades out while the camera stands behind it and comes back as the camera comes round to the front.
// The corner set names its walls' groups (`wall_back_group`, `wall_left_group`, PLAN-ROUND-8 §4); the first room has
// bare wall meshes (`env_wall_back`, `env_wall_left`, `env_wall_right`), so there a wall takes the thin things hung on
// it. Either way, anything outside a wall (the window's view, a hallway) goes with it. A faded wall's hotspots stop
// catching the pointer.

const WALL_MESH = /^(?:env_)?wall_(back|left|right)$/;
// Where the eye stands from the wall's plane (metres, positive behind it): still solid in front of this, gone past it.
const FADE_FROM_M = -0.2;
const FADE_TO_M = 0.9;
const FADE_TAU_S = 0.18;
// Below this opacity a wall's hotspots stop taking the pointer; below the second, its meshes are not drawn at all.
const CLICKABLE_ABOVE = 0.5;
const DRAWN_ABOVE = 0.004;
// Without a group, a mesh hangs on a wall when it is this thin across the wall and its back is this close to the wall's
// face (curtains, frames, a radiator; not a shelf with books on it, which would leave the books in the air).
const MOUNT_DEPTH_M = 0.16;
const TOUCH_M = 0.03;
// A hotspot belongs to a wall on the same test, a little thicker (a window's box has a sill).
const PROXY_DEPTH_M = 0.22;
// Along the wall, past its ends, what still counts as on it or behind it.
const SPAN_MARGIN_M = 0.3;
/** Where a faded wall's hotspots go: a layer no raycaster in the room tests. */
export const FADED_LAYER = 31;

interface Wall {
  name: string;
  /** A point on the wall's plane and its outward normal (away from the room, horizontal), world units. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
  meshes: THREE.Mesh[];
  proxies: THREE.Object3D[];
  opacity: number;
  clickable: boolean;
}

/** How a mesh is faded: its own material when that is a per-object shader, else a copy made for the fade. */
interface Faded {
  source: THREE.Material;
  copy: THREE.Material | null;
  hidden: boolean;
}

const OPACITY_UNIFORM = 'uDioramaOpacity';

/** Lets a shader material fade: its fragments' alpha is scaled by a uniform, and it is drawn as transparent. */
function patchShader(material: THREE.ShaderMaterial) {
  if (material.uniforms[OPACITY_UNIFORM]) return;
  material.uniforms[OPACITY_UNIFORM] = { value: 1 };
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.fragmentShader = `uniform float ${OPACITY_UNIFORM};\n${shader.fragmentShader.replace(/\}\s*$/, `  gl_FragColor.a *= ${OPACITY_UNIFORM};\n}\n`)}`;
  };
  // Transparent from the start (opacity 1 draws as before): flipping it later would compile another program mid-orbit.
  material.transparent = true;
  material.needsUpdate = true;
}

export class Diorama {
  readonly walls: Wall[] = [];
  private readonly faded = new Map<THREE.Mesh, Faded>();
  private readonly eye = new THREE.Vector3();

  constructor(
    root: THREE.Object3D,
    proxies: readonly THREE.Object3D[],
    center: THREE.Vector3,
    private readonly still: boolean,
  ) {
    root.updateMatrixWorld(true);
    const meshes: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && !node.name.startsWith('hit_')) meshes.push({ mesh: node, box: new THREE.Box3().setFromObject(node) });
    });
    for (const { mesh, box } of meshes) {
      const side = WALL_MESH.exec(mesh.name)?.[1];
      if (!side || this.walls.some((w) => w.name === side)) continue;
      const size = box.getSize(new THREE.Vector3());
      const across: 'x' | 'z' = size.x < size.z ? 'x' : 'z';
      const along: 'x' | 'z' = across === 'x' ? 'z' : 'x';
      const normal = new THREE.Vector3();
      normal[across] = Math.sign(box.getCenter(new THREE.Vector3())[across] - center[across]) || 1;
      // The plane is the wall's face toward the room.
      const point = box.getCenter(new THREE.Vector3());
      point[across] = normal[across] > 0 ? box.min[across] : box.max[across];
      const depth = (b: THREE.Box3) => (b.max[across] - b.min[across]) / WORLD_SCALE;
      const offset = (b: THREE.Box3) => ((b.getCenter(new THREE.Vector3())[across] - point[across]) * normal[across]) / WORLD_SCALE;
      const back = (b: THREE.Box3) => offset(b) + depth(b) / 2;
      const margin = SPAN_MARGIN_M * WORLD_SCALE;
      const inSpan = (b: THREE.Box3) => b.max[along] >= box.min[along] - margin && b.min[along] <= box.max[along] + margin;
      const mounted = (b: THREE.Box3, thin: number) => inSpan(b) && depth(b) <= thin && back(b) >= -TOUCH_M;
      const behind = (b: THREE.Box3) => inSpan(b) && offset(b) > 0;
      const group = root.getObjectByName(`wall_${side}_group`);
      const members = new Set<THREE.Mesh>([mesh]);
      if (group) group.traverse((node) => node instanceof THREE.Mesh && !node.name.startsWith('hit_') && members.add(node));
      for (const { mesh: other, box: b } of meshes) {
        if (behind(b) || (!group && mounted(b, MOUNT_DEPTH_M))) members.add(other);
      }
      const wallProxies = proxies.filter((p) => {
        let inGroup = false;
        group?.traverse((node) => (inGroup ||= node === p));
        return inGroup || mounted(new THREE.Box3().setFromObject(p), PROXY_DEPTH_M) || behind(new THREE.Box3().setFromObject(p));
      });
      this.walls.push({ name: side, point, normal, meshes: [...members], proxies: wallProxies, opacity: 1, clickable: true });
    }
    // A mesh claimed by two walls (a corner's trim) fades with the first only.
    const claimed = new Set<THREE.Mesh>();
    for (const wall of this.walls) {
      wall.meshes = wall.meshes.filter((m) => !claimed.has(m) && claimed.add(m));
      for (const mesh of wall.meshes) if (mesh.material instanceof THREE.ShaderMaterial) patchShader(mesh.material);
    }
  }

  /** Fades each wall for the camera at `camera` (world units); true when anything drawn changed. */
  update(camera: THREE.Vector3, dt: number): boolean {
    let changed = false;
    for (const wall of this.walls) {
      const behindM = this.eye.copy(camera).sub(wall.point).dot(wall.normal) / WORLD_SCALE;
      const goal = 1 - THREE.MathUtils.smoothstep(behindM, FADE_FROM_M, FADE_TO_M);
      const opacity = this.still || dt <= 0 ? goal : goal + (wall.opacity - goal) * Math.exp(-dt / FADE_TAU_S);
      const settled = Math.abs(opacity - goal) < 0.002 ? goal : opacity;
      // While faded at all, every frame: the room may swap a mesh's material meanwhile (a print loads, an atlas streams).
      if (settled === wall.opacity && settled === 1) continue;
      changed ||= settled !== wall.opacity;
      wall.opacity = settled;
      for (const mesh of wall.meshes) this.fade(mesh, settled);
      const clickable = settled > CLICKABLE_ABOVE;
      if (clickable !== wall.clickable) {
        wall.clickable = clickable;
        for (const proxy of wall.proxies) proxy.layers.set(clickable ? 0 : FADED_LAYER);
      }
    }
    return changed;
  }

  private fade(mesh: THREE.Mesh, opacity: number) {
    let state = this.faded.get(mesh);
    if (!state) {
      if (Array.isArray(mesh.material)) return;
      state = { source: mesh.material, copy: null, hidden: false };
      this.faded.set(mesh, state);
    }
    // The room may have given the mesh a new material since (a poster loaded, an atlas streamed in at full size).
    if (mesh.material !== state.source && mesh.material !== state.copy && !Array.isArray(mesh.material)) {
      state.source = mesh.material;
      state.copy?.dispose();
      state.copy = null;
      if (state.source instanceof THREE.ShaderMaterial) patchShader(state.source);
    }
    // Gone, it is not drawn at all; only a mesh this hid is shown again (the room hides some of its own).
    const drawn = opacity > DRAWN_ABOVE;
    if (!drawn && !state.hidden && mesh.visible) {
      mesh.visible = false;
      state.hidden = true;
    } else if (drawn && state.hidden) {
      mesh.visible = true;
      state.hidden = false;
    }
    const source = state.source;
    if (source instanceof THREE.ShaderMaterial) {
      source.uniforms[OPACITY_UNIFORM].value = opacity;
      source.depthWrite = opacity >= 1;
      return;
    }
    if (opacity >= 1) {
      mesh.material = source;
      return;
    }
    // A shared material (the room's atlases) fades only on this mesh: through a copy that follows its texture.
    const copy = (state.copy ??= Object.assign(source.clone(), { transparent: true, depthWrite: false }));
    const map = (source as THREE.MeshBasicMaterial).map;
    if ('map' in copy && copy.map !== map) {
      (copy as THREE.MeshBasicMaterial).map = map ?? null;
      copy.needsUpdate = true;
    }
    copy.opacity = opacity * source.opacity;
    mesh.material = copy;
  }

  /** Each wall's opacity, what fades with it and whether its hotspots take the pointer (tests). */
  probe() {
    return this.walls.map(({ name, opacity, meshes, proxies, clickable }) => ({
      name,
      opacity,
      meshes: meshes.map((m) => m.name),
      proxies: proxies.map((p) => p.name),
      clickable,
    }));
  }

  dispose() {
    for (const [mesh, state] of this.faded) {
      if (state.copy && mesh.material === state.copy) mesh.material = state.source;
      state.copy?.dispose();
    }
  }
}
