import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { clockText } from '../src/components/RoomHud';
import { tourStops } from '../src/components/RoomTourMap';
import { wheelPixels } from '../src/scene/Camera/Navigation';
import { Orbit, readOrbit, toSpherical } from '../src/scene/Camera/orbit';
import { homeSeconds } from '../src/scene/Camera/RoomCamera';

// The corner set's orbit_center (public/room/room.glb, world units): 2.4-9 m, 38-80° from straight up.
const settings = {
  center: new THREE.Vector3(0, 950, 1150),
  limits: { minDist: 2400, maxDist: 9000, minPolar: THREE.MathUtils.degToRad(38), maxPolar: THREE.MathUtils.degToRad(80) },
};
const eyeAt = (azimuthDeg: number, polarDeg: number, radius: number) => {
  const [a, p] = [azimuthDeg, polarDeg].map(THREE.MathUtils.degToRad);
  return new THREE.Vector3(Math.sin(a) * Math.sin(p), Math.cos(p), Math.cos(a) * Math.sin(p)).multiplyScalar(radius).add(settings.center);
};
const run = (orbit: Orbit, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) orbit.step(1 / 60);
};

describe('the orbit about the set', () => {
  // Catches a wheel that zooms the wrong way for the platform (deltaY < 0 is toward the screen: in), a zoom limit that
  // stops dead (no give past it) or gives without end, and one that never springs back inside.
  it('moves in for a negative deltaY, out for a positive one, gives a little past the limits and springs back', () => {
    const orbit = new Orbit(eyeAt(0, 70, 6000), settings.center, settings, false);
    orbit.zoom(-300);
    run(orbit, 1);
    expect(orbit.radius).toBeLessThan(6000);
    // A wheel turned on for a second (a notch every 50 ms), then let go: the radii the view passes through.
    const sweep = (delta: number) => {
      const radii: number[] = [];
      for (let frame = 0; frame < 180; frame++) {
        if (frame < 60 && frame % 3 === 0) orbit.zoom(delta);
        orbit.step(1 / 60);
        radii.push(orbit.radius);
      }
      return radii;
    };
    const inward = sweep(-600);
    expect(Math.min(...inward), 'past the near limit, a little').toBeLessThan(2400 - 50);
    expect(Math.min(...inward)).toBeGreaterThan(2400 / 1.1);
    expect(orbit.radius).toBeGreaterThanOrEqual(2400 - 1e-6);
    expect(orbit.radius).toBeCloseTo(2400, -1);
    const outward = sweep(900);
    expect(Math.max(...outward), 'past the far limit, a little').toBeGreaterThan(9000 + 200);
    expect(Math.max(...outward)).toBeLessThan(9000 * 1.1);
    expect(orbit.radius).toBeLessThanOrEqual(9000 + 1e-6);
    expect(orbit.radius).toBeCloseTo(9000, -1);
  });

  // Catches the camera jumping out to minDist the moment the visitor turns at the desk (closer than the limits allow).
  it('keeps a camera that starts inside the minimum distance where it is, until it has moved out past it', () => {
    const orbit = new Orbit(eyeAt(0, 75, 1600), settings.center, settings, false);
    run(orbit, 0.5);
    expect(orbit.radius).toBeCloseTo(1600, 0);
    orbit.zoom(-400);
    run(orbit, 1.5);
    expect(orbit.radius).toBeCloseTo(1600, 0);
    orbit.zoom(2000);
    run(orbit, 1);
    expect(orbit.radius).toBeGreaterThan(2400);
    for (let i = 0; i < 20; i++) orbit.zoom(-600);
    run(orbit, 2);
    expect(orbit.radius).toBeGreaterThanOrEqual(2400);
    expect(orbit.radius).toBeCloseTo(2400, -1);
  });

  // Catches a let-go drag that stops dead (no inertia), coasts for ever, or coasts under reduced motion.
  it('coasts after a quick drag and comes to rest, but not under reduced motion', () => {
    let now = 0;
    const clock = () => now;
    const realNow = performance.now;
    performance.now = clock;
    try {
      for (const still of [false, true]) {
        const orbit = new Orbit(eyeAt(0, 70, 6000), settings.center, settings, still);
        for (let i = 0; i < 5; i++) {
          now += 16;
          orbit.drag(-20, 0, 900);
        }
        orbit.release();
        const letGo = orbit.azimuth;
        run(orbit, 3);
        if (still) expect(orbit.azimuth).toBe(letGo);
        else expect(orbit.azimuth - letGo).toBeGreaterThan(0.1);
        expect(orbit.turning).toBe(0);
      }
    } finally {
      performance.now = realNow;
    }
  });

  // Catches a tilt that turns over the top or under the floor, a tilt limit that stops dead instead of giving a little,
  // and one left stretched after the drag lets go.
  it('gives a little past the tilt limits while dragged, and springs back inside once let go', () => {
    const orbit = new Orbit(eyeAt(30, 60, 5000), settings.center, settings, false);
    const tilt = () => THREE.MathUtils.radToDeg(toSpherical(orbit.eye().sub(orbit.pivot)).polar);
    orbit.drag(0, 5000, 900);
    run(orbit, 0.3);
    expect(tilt(), 'stretched past the low limit').toBeLessThan(38 - 1);
    expect(tilt(), 'by no more than the band gives').toBeGreaterThan(38 - 6);
    orbit.release();
    run(orbit, 1.5);
    expect(tilt()).toBeGreaterThanOrEqual(38 - 1e-6);
    orbit.drag(0, -9000, 900);
    orbit.release();
    run(orbit, 1.5);
    expect(THREE.MathUtils.radToDeg(orbit.polar)).toBeLessThanOrEqual(80 + 1e-6);
  });

  // Catches a coast whose speed rises again after the let-go (a let-go handed more speed than the view had: on a slow
  // machine, 100 ms frames, the view has caught up with the pointer by then), one that never stops, and a press that
  // does not stop it.
  it('slows monotonically to rest after a flick at any frame rate, and stops at once under a press', () => {
    let now = 0;
    const realNow = performance.now;
    performance.now = () => now;
    try {
      const flick = () => {
        const orbit = new Orbit(eyeAt(0, 70, 6000), settings.center, settings, false);
        for (let i = 0; i < 6; i++) {
          now += 16;
          orbit.drag(-25, 0, 900);
          orbit.step(0.1);
        }
        now += 16;
        orbit.drag(-25, 0, 900);
        orbit.release();
        return orbit;
      };
      // Frames from 4 ms to 100 ms, in an uneven order.
      const frames = [0.016, 0.1, 0.004, 0.033, 0.008, 0.07, 0.016, 0.05];
      const orbit = flick();
      const speeds = [orbit.turning];
      for (let k = 0; speeds.at(-1)! > 0 && k < 400; k++) {
        orbit.step(frames[k % frames.length]);
        speeds.push(orbit.turning);
      }
      expect(speeds[0], 'it was moving when let go').toBeGreaterThan(1);
      expect(speeds.at(-1), 'and comes to rest').toBe(0);
      speeds.slice(1).forEach((speed, k) => expect(speed, `frame ${k + 1}`).toBeLessThanOrEqual(speeds[k] + 1e-9));
      const pressed = flick();
      pressed.step(0.05);
      const at = pressed.azimuth;
      pressed.hold();
      pressed.step(0.05);
      expect(pressed.turning).toBe(0);
      expect(pressed.azimuth).toBe(at);
    } finally {
      performance.now = realNow;
    }
  });

  // Catches a room without an orbit_center (the first room) giving the orbit nowhere to turn.
  it('reads the limits off orbit_center, and fits them to the floor without one', () => {
    const root = new THREE.Object3D();
    const node = new THREE.Object3D();
    node.name = 'orbit_center';
    node.position.set(-50, 950, 1150);
    Object.assign(node.userData, { minDist: 2.4, maxDist: 9, minPolarDeg: 38, maxPolarDeg: 80 });
    root.add(node);
    root.updateMatrixWorld(true);
    expect(readOrbit(root)).toMatchObject({ limits: { minDist: 2400, maxDist: 9000 } });
    const bare = readOrbit(new THREE.Object3D());
    expect(bare.limits.minDist).toBeGreaterThan(0);
    expect(bare.limits.maxDist).toBeGreaterThan(bare.limits.minDist);
  });
});

describe('wheels and Home', () => {
  // Catches a mouse wheel that zooms at a different speed in Firefox (3 lines a notch) than in Chromium (100 px a notch).
  it('reads a wheel notch the same in lines as in pixels, and Shift as sideways', () => {
    const event = { deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false };
    expect(wheelPixels({ ...event, deltaY: 3, deltaMode: 1 }, 900)).toEqual(wheelPixels({ ...event, deltaY: 100 }, 900));
    expect(wheelPixels({ ...event, deltaY: 1, deltaMode: 2 }, 900)).toEqual([0, 900]);
    expect(wheelPixels({ ...event, deltaY: 100, shiftKey: true }, 900)).toEqual([100, 0]);
  });

  // Catches a glide home that takes as long from next door as from behind the set (or snaps, or drags on).
  it('takes longer home the further the camera has to go, within bounds', () => {
    expect(homeSeconds(0, 0)).toBeGreaterThanOrEqual(0.9);
    expect(homeSeconds(8.4, 0.3)).toBeGreaterThan(homeSeconds(2, 0.3));
    expect(homeSeconds(8.4, 0.3)).toBeGreaterThan(homeSeconds(8.4, 0));
    expect(homeSeconds(100, Math.PI)).toBe(2.4);
  });
});

describe('the HUD and the tour', () => {
  // Catches the HUD's clock in seconds, 12-hour or locale text (the ruling: hh:mm).
  it('shows the time as hh:mm on a 24-hour clock', () => {
    expect(clockText(new Date(2026, 9, 17, 4, 5, 59))).toBe('04:05');
    expect(clockText(new Date(2026, 9, 17, 16, 30))).toBe('16:30');
  });

  // Catches the tour keeping a stop it has no words for (the projector's), or reordering the plan's stops.
  it('tours the plan’s stops in the plan’s order, only those with a caption', () => {
    const plan = { stops: ['desk', 'projector', 'window', 'space'].map((id, i) => ({ id, label: id, camera: `cam_tour_${i}`, position: [0, 0] as [number, number] })) };
    expect(tourStops(plan).map((s) => s.id)).toEqual(['desk', 'window', 'space']);
  });
});
