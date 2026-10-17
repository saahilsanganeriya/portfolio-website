import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { clockText } from '../src/components/RoomHud';
import { tourStops } from '../src/components/RoomTourMap';
import { Orbit, readOrbit, toSpherical } from '../src/scene/Camera/orbit';

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
  // Catches a wheel that zooms the wrong way for the platform (deltaY < 0 is toward the screen: in), and zoom limits that break.
  it('moves in for a negative deltaY, out for a positive one, and stops at the limits', () => {
    const orbit = new Orbit(eyeAt(0, 70, 6000), settings.center, settings, false);
    orbit.zoom(-300);
    run(orbit, 1);
    expect(orbit.radius).toBeLessThan(6000);
    for (let i = 0; i < 50; i++) orbit.zoom(-600);
    run(orbit, 2);
    expect(orbit.radius).toBeGreaterThanOrEqual(2400);
    expect(orbit.radius).toBeCloseTo(2400, -1);
    for (let i = 0; i < 50; i++) orbit.zoom(900);
    run(orbit, 2);
    expect(orbit.radius).toBeLessThanOrEqual(9000);
    expect(orbit.radius).toBeCloseTo(9000, -1);
  });

  // Catches the camera jumping out to minDist the moment the visitor turns at the desk (closer than the limits allow).
  it('keeps a camera that starts inside the minimum distance where it is, until it has moved out past it', () => {
    const orbit = new Orbit(eyeAt(0, 75, 1600), settings.center, settings, false);
    run(orbit, 0.5);
    expect(orbit.radius).toBeCloseTo(1600, 0);
    orbit.zoom(-400);
    run(orbit, 1);
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

  // Catches a tilt that turns over the top or under the floor.
  it('holds the tilt inside its limits', () => {
    const orbit = new Orbit(eyeAt(30, 60, 5000), settings.center, settings, false);
    orbit.drag(0, -5000, 900);
    orbit.release();
    expect(THREE.MathUtils.radToDeg(toSpherical(orbit.eye().sub(orbit.pivot)).polar)).toBeGreaterThanOrEqual(38 - 1e-6);
    orbit.drag(0, 9000, 900);
    orbit.release();
    expect(THREE.MathUtils.radToDeg(orbit.polar)).toBeLessThanOrEqual(80 + 1e-6);
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
