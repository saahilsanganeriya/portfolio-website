import * as THREE from 'three';
import { WORLD_SCALE } from '../Application/RoomModel';

// A framing fitted to one object (round 9 §10.2: a click flies to THAT object), for the props without a cam_ node of
// their own. The camera faces a thin object (a poster, a print, the record on the wall) square on; anything else it sees
// from the side the wide view sees it from. The object fills about half the view, so the card fits beside it, the
// eye looks down on it as a standing person would, and it stays in front of both walls.

/** The object's share of the view's height (or width), so the card beside it has room. */
const SHARE = 0.5;
// A box this much thinner across one horizontal axis than the other hangs flat: the camera faces it square on.
const THIN = 0.35;
// The eye looks down on an object as a standing person does: steeply at desk height, barely at a pennant up the wall.
const LOOK_DOWN_DEG = { atDesk: 25, perMetre: 12, deskM: 0.8, min: 6 };
const DISTANCE_M = { min: 0.5, max: 2.6 };
/** The eye keeps this far in front of a wall, and inside this height band (metres). */
const WALL_MARGIN_M = 0.25;
const HEIGHT_M = { min: 0.35, max: 2.6 };

export interface FramingSpace {
  /** Vertical field of view (degrees) and the stage's width over height. */
  fov: number;
  aspect: number;
  /** Where the visit sees the set from (the wide view's eye): the side an object is seen from, if it is not flat. */
  toward: THREE.Vector3;
  /** The walls' inner faces (world units): the eye stays at larger x than the left wall, larger z than the back wall. */
  leftWallX?: number;
  backWallZ?: number;
}

/** A framing (eye, look-at point, field of view) that shows the object in `box` (world units) well. */
export function frameObject(box: THREE.Box3, space: FramingSpace) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const normal = new THREE.Vector3();
  const [thin, wide] = [Math.min(size.x, size.z), Math.max(size.x, size.z)];
  if (thin < wide * THIN) {
    const axis = size.x < size.z ? 'x' : 'z';
    normal[axis] = Math.sign(space.toward[axis] - center[axis]) || 1;
  } else normal.set(space.toward.x - center.x, 0, space.toward.z - center.z).normalize();
  // What the camera sees of the box: its width across the view, its height, and its depth along the view.
  const across = size.x * Math.abs(normal.z) + size.z * Math.abs(normal.x);
  const depth = size.x * Math.abs(normal.x) + size.z * Math.abs(normal.z);
  const halfTan = Math.tan(THREE.MathUtils.degToRad(space.fov) / 2);
  const fit = Math.max(size.y / (2 * halfTan * SHARE), across / (2 * halfTan * space.aspect * SHARE)) + depth / 2;
  const distance = THREE.MathUtils.clamp(fit, DISTANCE_M.min * WORLD_SCALE, DISTANCE_M.max * WORLD_SCALE);
  const position = center.clone().addScaledVector(normal, distance);
  const { atDesk, perMetre, deskM, min } = LOOK_DOWN_DEG;
  const lookDown = THREE.MathUtils.clamp(atDesk - perMetre * (center.y / WORLD_SCALE - deskM), min, atDesk);
  position.y += distance * Math.tan(THREE.MathUtils.degToRad(lookDown));
  const margin = WALL_MARGIN_M * WORLD_SCALE;
  if (space.leftWallX !== undefined) position.x = Math.max(position.x, space.leftWallX + margin);
  if (space.backWallZ !== undefined) position.z = Math.max(position.z, space.backWallZ + margin);
  position.y = THREE.MathUtils.clamp(position.y, HEIGHT_M.min * WORLD_SCALE, HEIGHT_M.max * WORLD_SCALE);
  return { position, target: center, fov: space.fov };
}
