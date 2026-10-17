import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brakedTime, fromGlidePose, glidePose, glideTime, planGlide, toGlidePose } from '../src/scene/Camera/glide';

// The played tour's glide over the real room: the framings come from public/room/room.glb (its cam_* empties sit at
// the scene's top level, in metres) and the stops from public/room/floorplan.json (those src/scene/tour.json has a
// caption for), as the room plays them at 1440 × 900.
const glb = readFileSync(new URL('../public/room/room.glb', import.meta.url));
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as { nodes: { name: string; translation?: number[]; extras?: { fov_deg?: number } }[] };
const floorplan = JSON.parse(readFileSync(new URL('../public/room/floorplan.json', import.meta.url), 'utf8')) as {
  outline: [number, number][];
  walls: [number, number][][];
  stops: { id: string; camera: string }[];
};
const tour = JSON.parse(readFileSync(new URL('../src/scene/tour.json', import.meta.url), 'utf8')) as { stops: { id: string }[] };
const captioned = new Set(tour.stops.map((s) => s.id));
const stops = floorplan.stops.filter((s) => captioned.has(s.id));
const WALL_HEIGHT_M = 2.85;
const SECONDS = 60;

const node = (name: string) => gltf.nodes.find((n) => n.name === name)!;
const point = (name: string) => {
  const [x, y, z] = node(name).translation!;
  return { x, y, z };
};
function framing(camera: string, distance = 1) {
  const eye = point(camera);
  const target = point(`${camera}_target`);
  const away = { x: target.x + (eye.x - target.x) * distance, y: target.y + (eye.y - target.y) * distance, z: target.z + (eye.z - target.z) * distance };
  return toGlidePose(away, target, node(camera).extras!.fov_deg!);
}
const poses = [framing('cam_monitor'), ...stops.map((s) => framing(s.camera)), framing('cam_desk')];
const glide = planGlide(poses, SECONDS, floorplan);

/** Whether the line of sight from `eye` along `dir` meets a wall of the plan or the floor (not the dark outside the set). */
function landsInRoom(eye: number[], dir: number[]) {
  for (const [[x1, z1], [x2, z2]] of floorplan.walls) {
    const [ex, ez] = [x2 - x1, z2 - z1];
    const den = dir[0] * ez - dir[2] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((x1 - eye[0]) * ez - (z1 - eye[2]) * ex) / den;
    const s = ((x1 - eye[0]) * dir[2] - (z1 - eye[2]) * dir[0]) / den;
    const y = eye[1] + t * dir[1];
    if (t > 0 && s >= 0 && s <= 1 && y >= 0 && y <= WALL_HEIGHT_M) return true;
  }
  if (dir[1] >= 0) return false;
  const t = -eye[1] / dir[1];
  const [x, z] = [eye[0] + t * dir[0], eye[2] + t * dir[2]];
  const xs = floorplan.outline.map(([px]) => px);
  const zs = floorplan.outline.map(([, pz]) => pz);
  return x >= Math.min(...xs) && x <= Math.max(...xs) && z >= Math.min(...zs) && z <= Math.max(...zs);
}

describe('the played tour glides through the room', () => {
  // Catches a glide that pauses (the old tour held 4.5 s at each stop), skips a stop's framing, or stalls between.
  it('passes every stop’s framing at its mark and never stands still between its start and its end', () => {
    glide.marks.forEach((mark, i) => {
      const at = glidePose(glide, mark);
      poses[i].forEach((value, c) => expect(at[c]).toBeCloseTo(value, 6));
    });
    let last = glidePose(glide, 0);
    for (let real = 0.05; real < SECONDS; real += 0.05) {
      const pose = glidePose(glide, glideTime(glide, real));
      expect(Math.hypot(...pose.map((v, c) => v - last[c])), `still at ${real.toFixed(2)} s`).toBeGreaterThan(0);
      last = pose;
    }
    expect(glideTime(glide, SECONDS)).toBe(glide.duration);
  });

  // Catches the view swinging past the end of the right wall into the dark outside the set (2.7 s of it when the head
  // turned on a plain spline, 3.8 s when it did not lead), or dropping to the floor under the eye (its look-at point
  // sliding across). A glance along the wall's end beside the armchair stop, whose own framing grazes it, is shorter.
  it('keeps the middle of the view on the room’s walls or floor all the way round, never steeper than a stop', () => {
    const steepest = Math.min(...poses.map((p) => p[4]));
    const runs: string[] = [];
    const steep: string[] = [];
    let run: number[] = [];
    for (let time = 0; time <= glide.duration + 1e-9; time += 0.1) {
      const pose = glidePose(glide, time);
      const { eye, target } = fromGlidePose(pose);
      const dir = target.map((v, c) => v - eye[c]);
      const length = Math.hypot(...dir);
      if (!landsInRoom(eye, dir.map((v) => v / length))) run.push(time);
      else if (run.length) {
        if (run.length > 10) runs.push(`${run[0].toFixed(1)}–${run.at(-1)!.toFixed(1)} s`);
        run = [];
      }
      if (pose[4] < steepest - 0.05) steep.push(time.toFixed(1));
    }
    expect(runs, 'stretches longer than a second looking out of the set').toEqual([]);
    expect(steep, 'path seconds looking down more steeply than any stop').toEqual([]);
  });

  // Catches a brake that jerks to a halt, runs backward, or never settles.
  it('brakes smoothly to rest within about a second', () => {
    const from = 20;
    const rate = 1;
    const early = brakedTime(glide, from, rate, 0.01);
    expect((early.time - from) / 0.01).toBeCloseTo(rate, 1);
    let previous = from;
    for (let since = 0.05; since <= 1.3; since += 0.05) {
      const { time } = brakedTime(glide, from, rate, since);
      expect(time).toBeGreaterThanOrEqual(previous);
      previous = time;
    }
    expect(brakedTime(glide, from, rate, 1.3)).toEqual({ time: previous, done: true });
  });
});
