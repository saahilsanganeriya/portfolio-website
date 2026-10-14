import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import type { RecordId } from '../src/scene/audio/crate';
import { WORLD_SCALE } from '../src/scene/Application/RoomModel';
import { RecordPlayer } from '../src/scene/World/RecordPlayer';

const mm = (v: number) => (v / 1000) * WORLD_SCALE;
const PLATTER_R = mm(150);
const ARM = mm(230);

/** A turntable as the room file names it: a 150 mm platter, and a 230 mm arm pivoted beside it, resting off the record. */
function turntable() {
  const root = new THREE.Group();
  const player = new THREE.Group();
  player.name = 'record_player';
  root.add(player);
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(PLATTER_R, PLATTER_R, mm(10), 32));
  platter.name = 'platter';
  platter.position.set(0, mm(500), 0);
  player.add(platter);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(mm(8), mm(8), ARM).translate(0, 0, -ARM / 2));
  arm.name = 'tonearm';
  arm.position.set(mm(200), mm(520), mm(120));
  player.add(arm);
  root.updateMatrixWorld(true);
  return { root, platter, arm };
}

function host(reducedMotion: boolean) {
  const calls: [RecordId | null, number | undefined][] = [];
  let listener = () => {};
  const audio = {
    musicSource: null as RecordId | null,
    muted: false,
    setMusicSource(record: RecordId | null, cue?: number) {
      calls.push([record, cue]);
      this.musicSource = record;
      listener();
    },
    subscribe(fn: () => void) {
      listener = fn;
      return () => {};
    },
  };
  return { calls, host: { audio, reducedMotion, station: () => 'record_player', announce: () => {} } };
}

const run = (player: RecordPlayer, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) player.update(1 / 60, true);
};

/** Where the stylus (the arm's far end) is, as its horizontal distance from the spindle. */
function stylusRadius(arm: THREE.Object3D, platter: THREE.Object3D) {
  arm.updateWorldMatrix(true, false);
  const stylus = arm.localToWorld(new THREE.Vector3(0, 0, -ARM));
  const spindle = platter.getWorldPosition(new THREE.Vector3());
  return Math.hypot(stylus.x - spindle.x, stylus.z - spindle.z);
}

describe('the record player', () => {
  /**
   * Catches an arm that never sets the needle on the record (a wrong play angle or turning the wrong way), a needle
   * cued before the arm arrives, a platter that never reaches 33⅓ rpm, and a stop that leaves the arm out.
   */
  test('a chosen record swings the arm onto the lead-in, spins the platter, and Stop puts the arm back', () => {
    const { root, platter, arm } = turntable();
    const rest = arm.quaternion.clone();
    const { calls, host: h } = host(false);
    const player = new RecordPlayer(root, h, null);
    expect(stylusRadius(arm, platter)).toBeGreaterThan(PLATTER_R);

    player.choose('night-in-venice');
    expect(calls).toEqual([['night-in-venice', expect.closeTo(1.5, 5)]]);
    run(player, 3);
    expect(player.probe()).toMatchObject({ playing: 'night-in-venice', swing: 1, lift: 0 });
    expect(player.probe().rpm).toBeCloseTo(100 / 3, 1);
    expect(stylusRadius(arm, platter)).toBeCloseTo(PLATTER_R * 0.93, -1);

    player.stop();
    expect(calls.at(-1)).toEqual([null, undefined]);
    run(player, 8);
    expect(player.probe()).toMatchObject({ playing: null, swing: 0, lift: 0 });
    expect(player.probe().rpm).toBeLessThan(0.5);
    expect(arm.quaternion.angleTo(rest)).toBeLessThan(1e-6);
  });

  /** Catches reduced motion that still swings the arm or spins the platter, or that stops the record from playing. */
  test('under reduced motion the record plays while the arm and platter stay still', () => {
    const { root, platter, arm } = turntable();
    const rest = { arm: arm.quaternion.clone(), platter: platter.quaternion.clone() };
    const { calls, host: h } = host(true);
    const player = new RecordPlayer(root, h, null);
    player.choose('raga-kiravani');
    run(player, 3);
    expect(calls).toEqual([['raga-kiravani', 0.3]]);
    expect(player.probe()).toMatchObject({ playing: 'raga-kiravani', swing: 0, rpm: 0 });
    expect(arm.quaternion.angleTo(rest.arm)).toBe(0);
    expect(platter.quaternion.angleTo(rest.platter)).toBe(0);
  });
});
