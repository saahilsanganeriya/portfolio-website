import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Diorama } from '../src/scene/World/Diorama';

// Set v4's back wall and the window's view behind it (public/room/room.glb, world units: mm). The Delhi half reaches
// 14 mm past the wall's free end (x 3450); the void-coloured mask round the view reaches 34 mm past it.
const CENTER = new THREE.Vector3(-50, 950, 1150);
const IDLE = new THREE.Vector3(1850, 3000, 8200);
const IDLE_TARGET = new THREE.Vector3(-200, 1000, 1300);

function block(name: string, [x0, y0, z0]: number[], [x1, y1, z1]: number[]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return mesh;
}

function cornerSet(maskMaxX: number) {
  const root = new THREE.Group();
  const group = new THREE.Group();
  group.name = 'wall_back_group';
  group.add(
    block('wall_back', [-3270, 0, -540], [3450, 3400, -420]),
    block('window_view_sf', [-553, 854, -3715], [1850, 1827, -557]),
    block('window_view_delhi', [1850, 865, -3715], [3464, 1609, -557]),
    block('window_view_mask', [-3270, 675, -3765], [maskMaxX, 3400, -540]),
  );
  root.add(group);
  return new Diorama(root, [], CENTER, true);
}

const back = (diorama: Diorama, eye: THREE.Vector3) => {
  diorama.update(eye, 0);
  return diorama.probe().find((w) => w.name === 'back')!;
};
/** cam_idle swung about its target by the wide view's sway (RoomCamera's IDLE_SWAY_RAD, 0.14). */
const swayed = (angle: number) => IDLE.clone().sub(IDLE_TARGET).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(IDLE_TARGET);
const fromSide = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(80)), 0, Math.cos(THREE.MathUtils.degToRad(80))).multiplyScalar(5700).add(CENTER).setY(4000);

describe('the city behind the back wall', () => {
  /**
   * Catches the window drawn as a void-coloured rectangle from the wide view: the mask counted among what it hides
   * (its box reaches past the wall's free end, so the wall never "covered" it from cam_idle), or the angle test left
   * in charge with a mask present (the Delhi half's 14 mm overhang hides the view at the sway's right end).
   */
  it('shows from the wide view, all through its sway, and from the side, while the mask holds it', () => {
    const diorama = cornerSet(3484);
    for (const eye of [IDLE, swayed(0.14), swayed(-0.14), fromSide]) {
      const wall = back(diorama, eye);
      expect(wall.masked).toBe(true);
      expect(wall.outside.map((o) => o.name)).toEqual(['window_view_sf', 'window_view_delhi']);
      expect(wall.outside.every((o) => o.shown), `shown from ${eye.toArray().map(Math.round)}`).toBe(true);
    }
  });

  /** Catches a view grown past its mask (a re-export) showing from the side, where only the mask would hide it. */
  it('without a mask that holds it, hides once the eye sees past the wall’s free end', () => {
    const diorama = cornerSet(3400);
    expect(back(diorama, IDLE).masked).toBe(false);
    expect(back(diorama, IDLE).outside.every((o) => o.shown)).toBe(true);
    expect(back(diorama, fromSide).outside.some((o) => o.shown)).toBe(false);
  });
});

describe('a wall the camera has gone behind', () => {
  /**
   * Catches a wall that keeps or gets back its first-frame atlas: the atlas streamer swaps the full atlas into what the
   * scene draws, which is the fade's copy while the wall is see-through, and the copy then took the source's old atlas
   * back every frame, and the wall showed it again once whole.
   */
  it('keeps an atlas swapped in while it was see-through, and after it is whole again', () => {
    const root = new THREE.Group();
    const group = new THREE.Group();
    group.name = 'wall_back_group';
    const wall = block('wall_back', [-3270, 0, -540], [3450, 3400, -420]);
    const [low, full] = [new THREE.Texture(), new THREE.Texture()];
    (wall.material as THREE.MeshBasicMaterial).map = low;
    group.add(wall);
    root.add(group);
    const diorama = new Diorama(root, [], CENTER, true);
    // 35 cm behind the wall: about half see-through.
    const behind = new THREE.Vector3(0, 1500, -830);
    diorama.update(behind, 0);
    const copy = wall.material as THREE.MeshBasicMaterial;
    expect(copy.opacity).toBeLessThan(1);
    copy.map = full;
    diorama.update(behind, 0);
    expect((wall.material as THREE.MeshBasicMaterial).map, 'while see-through').toBe(full);
    diorama.update(IDLE, 0);
    expect((wall.material as THREE.MeshBasicMaterial).map, 'whole again').toBe(full);
  });
});
