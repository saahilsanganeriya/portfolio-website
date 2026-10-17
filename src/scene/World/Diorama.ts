import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';

// The set as a diorama (owner, round 8: a full 360° orbit, "the walls see-through from behind"): each wall, with what
// hangs on it, fades out while the camera stands behind it and comes back as the camera comes round to the front.
// The corner set names its walls' groups (`wall_back_group`, `wall_left_group`, PLAN-ROUND-8 §4); the first room has
// bare wall meshes (`env_wall_back`, `env_wall_left`, `env_wall_right`), so there a wall takes the thin things hung on
// it. What lies outside a wall (the window's city view and sky, a hallway) shows only while the wall itself stands
// whole between it and the eye: hidden outright when the wall is faded at all, or when the camera is far enough round
// to see past the wall's free end. Set v4 boxes the window's view in (`window_view_mask`, void-coloured panels on every
// side but the wall's): while that box holds all of it, the box hides it from the side and above, and it shows whenever
// the wall is whole. A faded wall's hotspots stop catching the pointer.

const WALL_MESH = /^(?:env_)?wall_(back|left|right)$/;
// The window's own parts behind the wall: its view, sky and motif (and anything the room hangs under them), and the pane.
const OUTSIDE_NODE = /^window_(?:view_(?!mask)|sky|motif|glass)/;
// The box round them fades with the wall, like anything else hung on it.
const MASK_NODE = /^window_view_mask$/;
const MASK_SLACK_M = 0.01;
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

interface Outside {
  node: THREE.Object3D;
  /** Whether this hid it (the room may hide some of its own). */
  hidden: boolean;
}

interface Wall {
  name: string;
  /** A point on the wall's plane and its outward normal (away from the room, horizontal), world units. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
  group: THREE.Object3D | null;
  meshes: THREE.Mesh[];
  proxies: THREE.Object3D[];
  outside: Outside[];
  /** The plan corners (world x, z) of the box round everything outside, and the wall's extent along itself. */
  outsideCorners: THREE.Vector2[];
  /** Whether a mask box holds everything outside (from the wall's face back), so no angle needs it hidden. */
  masked: boolean;
  span: [number, number];
  along: 'x' | 'z';
  across: 'x' | 'z';
  /** Whether a mesh or hotspot (by box) is hung on this wall, by the first room's test. */
  mounted(box: THREE.Box3, thin: number): boolean;
  behind(box: THREE.Box3): boolean;
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

const isUnder = (node: THREE.Object3D, roots: readonly THREE.Object3D[]) => {
  for (let n: THREE.Object3D | null = node; n; n = n.parent) if (roots.includes(n)) return true;
  return false;
};

export class Diorama {
  readonly walls: Wall[] = [];
  private readonly faded = new Map<THREE.Mesh, Faded>();
  private readonly eye = new THREE.Vector3();

  constructor(
    private readonly root: THREE.Object3D,
    private readonly proxies: readonly THREE.Object3D[],
    center: THREE.Vector3,
    private readonly still: boolean,
  ) {
    root.updateMatrixWorld(true);
    root.traverse((node) => {
      const side = node instanceof THREE.Mesh ? WALL_MESH.exec(node.name)?.[1] : undefined;
      if (!side || this.walls.some((w) => w.name === side)) return;
      const box = new THREE.Box3().setFromObject(node);
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
      const margin = SPAN_MARGIN_M * WORLD_SCALE;
      const inSpan = (b: THREE.Box3) => b.max[along] >= box.min[along] - margin && b.min[along] <= box.max[along] + margin;
      const group = root.getObjectByName(`wall_${side}_group`) ?? null;
      const wall: Wall = {
        name: side,
        point,
        normal,
        group,
        meshes: [node as THREE.Mesh],
        proxies: [],
        outside: [],
        outsideCorners: [],
        masked: false,
        span: [box.min[along], box.max[along]],
        along,
        across,
        mounted: (b, thin) => inSpan(b) && depth(b) <= thin && offset(b) + depth(b) / 2 >= -TOUCH_M,
        behind: (b) => inSpan(b) && offset(b) > 0,
        opacity: 1,
        clickable: true,
      };
      this.walls.push(wall);
    });
    for (const wall of this.walls) this.collect(wall);
  }

  /**
   * What fades with a wall, read again each time it starts to fade: the room hangs things on its walls after loading
   * (prints on the darkroom lines, the window's motif), and those go with it too.
   */
  private collect(wall: Wall) {
    const outsideRoots: THREE.Object3D[] = [];
    let mask = null as THREE.Object3D | null;
    wall.group?.traverse((node) => {
      if (MASK_NODE.test(node.name)) mask = node;
      else if (OUTSIDE_NODE.test(node.name) && !isUnder(node.parent!, outsideRoots)) outsideRoots.push(node);
    });
    const meshes = new Set<THREE.Mesh>(wall.meshes.slice(0, 1));
    this.root.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || node.name.startsWith('hit_') || isUnder(node, outsideRoots)) return;
      const inGroup = wall.group !== null && isUnder(node, [wall.group]);
      const box = new THREE.Box3().setFromObject(node);
      if (wall.behind(box) && !inGroup && !this.walls.some((w) => w !== wall && w.group && isUnder(node, [w.group]))) outsideRoots.push(node);
      else if (inGroup || (!wall.group && wall.mounted(box, MOUNT_DEPTH_M))) meshes.add(node);
    });
    // A mesh another wall already fades (a corner's trim) stays with that one.
    const others = new Set(this.walls.filter((w) => w !== wall).flatMap((w) => w.meshes));
    wall.meshes = [...meshes].filter((m) => !others.has(m));
    for (const mesh of wall.meshes) if (mesh.material instanceof THREE.ShaderMaterial) patchShader(mesh.material);
    const known = new Map(wall.outside.map((o) => [o.node, o]));
    wall.outside = outsideRoots.map((node) => known.get(node) ?? { node, hidden: false });
    const box = new THREE.Box3();
    for (const o of wall.outside) {
      const was = o.node.visible;
      o.node.visible = true;
      box.union(new THREE.Box3().setFromObject(o.node));
      o.node.visible = was;
    }
    wall.outsideCorners = box.isEmpty()
      ? []
      : [box.min, box.max].flatMap((a) => [box.min, box.max].map((b) => new THREE.Vector2(a.x, b.z)));
    // The pane sits in the wall's opening, in front of the box: the box counts from the wall's room face back.
    const held = mask && new THREE.Box3().setFromObject(mask).expandByPoint(wall.point).expandByScalar(MASK_SLACK_M * WORLD_SCALE);
    wall.masked = !box.isEmpty() && !!held && held.containsBox(box);
    wall.proxies = this.proxies.filter((p) => {
      const box = new THREE.Box3().setFromObject(p);
      return (wall.group !== null && isUnder(p, [wall.group])) || wall.mounted(box, PROXY_DEPTH_M) || wall.behind(box);
    });
  }

  /** Fades each wall for the camera at `camera` (world units); true when anything drawn changed. */
  update(camera: THREE.Vector3, dt: number): boolean {
    let changed = false;
    for (const wall of this.walls) {
      const behindM = this.eye.copy(camera).sub(wall.point).dot(wall.normal) / WORLD_SCALE;
      const goal = 1 - THREE.MathUtils.smoothstep(behindM, FADE_FROM_M, FADE_TO_M);
      const opacity = this.still || dt <= 0 ? goal : goal + (wall.opacity - goal) * Math.exp(-dt / FADE_TAU_S);
      const settled = Math.abs(opacity - goal) < 0.002 ? goal : opacity;
      if (wall.opacity === 1 && settled < 1) this.collect(wall);
      changed = this.showOutside(wall, camera, settled) || changed;
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

  /**
   * Whether the wall stands between the eye and everything outside it: the eye is in front of the wall, and the line
   * from the eye to each corner of the box round the outside crosses the wall's plane within the wall's length (in plan).
   */
  private covers(wall: Wall, camera: THREE.Vector3) {
    const { across, along, normal, point, span } = wall;
    const side = (x: number, z: number) => ((across === 'x' ? x : z) - point[across]) * normal[across];
    const eyeSide = side(camera.x, camera.z);
    if (eyeSide >= 0) return false;
    const eyeAlong = camera[along];
    return wall.outsideCorners.every(({ x, y: z }) => {
      const cornerSide = side(x, z);
      if (cornerSide <= 0) return true;
      const t = eyeSide / (eyeSide - cornerSide);
      const crossing = eyeAlong + t * ((along === 'x' ? x : z) - eyeAlong);
      return crossing >= span[0] && crossing <= span[1];
    });
  }

  /** What lies outside the wall shows only while the wall is whole and covers it (or its mask does); true if any changed. */
  private showOutside(wall: Wall, camera: THREE.Vector3, opacity: number) {
    let changed = false;
    const show = opacity >= 1 && (wall.masked || this.covers(wall, camera));
    for (const o of wall.outside) {
      // Re-hidden if the room showed it again meanwhile; only what this hid is shown again.
      if (!show && o.node.visible) {
        o.node.visible = false;
        o.hidden = true;
        changed = true;
      } else if (show && o.hidden) {
        o.node.visible = true;
        o.hidden = false;
        changed = true;
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

  /** Each wall's opacity, what fades with it, what is hidden outside it and whether a mask holds that, whether its hotspots take the pointer (tests). */
  probe() {
    return this.walls.map(({ name, opacity, meshes, proxies, outside, masked, clickable }) => ({
      name,
      opacity,
      masked,
      meshes: meshes.map((m) => m.name),
      proxies: proxies.map((p) => p.name),
      outside: outside.map((o) => ({ name: o.node.name, shown: o.node.visible })),
      clickable,
    }));
  }

  dispose() {
    for (const o of this.walls.flatMap((w) => w.outside)) if (o.hidden) o.node.visible = true;
    for (const [mesh, state] of this.faded) {
      if (state.copy && mesh.material === state.copy) mesh.material = state.source;
      state.copy?.dispose();
    }
  }
}
