import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// Home (brief round 9 §1.4, owner 2026-10-17): a button beside "Take the tour" that glides back to the wide view every
// visit starts from, from anywhere: mid-drag, mid-tour, zoomed out, behind a wall, at the monitor.

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const room = (page: Page) =>
  page.evaluate(() => {
    const r = window.__room!;
    return { phase: r.phase, destination: r.destination, moving: r.moving, orbit: r.orbit, view: r.view, walls: r.walls };
  });

/** At rest at `station`, a frame past the landing: a flight lands within a share of its distance, then sits exactly. */
async function settledAt(page: Page, station: string, timeout = 30_000) {
  await page.waitForFunction((s) => window.__room?.phase === s && !window.__room.moving, station, { timeout });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** The wide view as the room frames it (its look-at point is exact; the eye sways about it), read after a visit there. */
interface Pose {
  targetX: number;
  targetZ: number;
  /** Plan distance from the eye to what it looks at (m). */
  reach: number;
}
const poseOf = ({ view }: Awaited<ReturnType<typeof room>>): Pose => ({
  targetX: view.targetX,
  targetZ: view.targetZ,
  reach: Math.hypot(view.x - view.targetX, view.z - view.targetZ),
});

/** The room after its arrival, stepped back to the wide view; returns that view's pose. */
async function inRoom(page: Page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
  return poseOf(await room(page));
}

/**
 * Home has landed at the wide view: at rest there, out of the orbit, looking at the wide view's own point and standing
 * as far from it (within 3 %: the idle sway turns the eye about that point and bobs it a few centimetres).
 */
async function expectHome(page: Page, home: Pose) {
  await settledAt(page, 'idle');
  const now = await room(page);
  expect(now).toMatchObject({ phase: 'idle', destination: 'idle', moving: false, orbit: null });
  const pose = poseOf(now);
  expect(Math.hypot(pose.targetX - home.targetX, pose.targetZ - home.targetZ), 'looks at the wide view’s point (m)').toBeLessThan(0.001);
  expect(Math.abs(pose.reach / home.reach - 1), `stands ${pose.reach.toFixed(2)} m from it, not ${home.reach.toFixed(2)} m`).toBeLessThan(0.03);
}

const homeButton = (page: Page) => page.getByRole('button', { name: 'Home', exact: true });

/** Drags across the stage by (dx, dy) in steps, letting go only after a rest (no coast). */
async function drag(page: Page, dx: number, dy = 0, from = [720, 520]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from[0] + (dx * i) / 12, from[1] + (dy * i) / 12);
  await page.waitForTimeout(150);
  await page.mouse.up();
}
const orbitRests = (page: Page) => page.waitForFunction(() => window.__room!.orbit !== null && !window.__room!.moving, null, { timeout: 30_000 });

/** Records the camera's plan position every frame from now on; `stop` returns them with their times (ms). */
async function trackCamera(page: Page) {
  await page.evaluate(() => {
    const track: { t: number; x: number; z: number; destination: string }[] = [];
    (window as unknown as { track: typeof track }).track = track;
    const sample = () => {
      const { view } = window.__room!;
      track.push({ t: performance.now(), x: view.x, z: view.z, destination: view.destination });
      requestAnimationFrame(sample);
    };
    sample();
  });
  return () => page.evaluate(() => (window as unknown as { track: { t: number; x: number; z: number; destination: string }[] }).track.slice());
}

/**
 * Catches a Home button that is missing, unnamed, out of the keyboard's reach, or not beside the tour's; a Home key (H)
 * that does nothing; and Home from the monitor that leaves the OS open on screen instead of going to the wide view.
 */
test('Home sits beside Take the tour, answers Tab, Enter and H, and leaves the monitor for the wide view', async ({ page }) => {
  await page.goto('/about');
  await settledAt(page, 'monitor', 120_000);
  const home = homeButton(page);
  const tour = page.getByRole('button', { name: 'Take the tour' });
  await expect(home).toBeVisible({ timeout: 15_000 });
  await expect(tour).toBeVisible();
  await expect(home).toHaveAttribute('aria-keyshortcuts', 'H');
  const [a, b] = [(await tour.boundingBox())!, (await home.boundingBox())!];
  expect(Math.abs(a.y - b.y), 'on the tour button’s row').toBeLessThan(2);
  expect(b.x - (a.x + a.width), 'just right of it').toBeGreaterThanOrEqual(0);
  expect(b.x - (a.x + a.width)).toBeLessThan(24);
  const { violations } = await new AxeBuilder({ page }).include('.room-ways').analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  // From the monitor, by the keyboard: Tab reaches it right after the tour, Enter takes the camera out to the wide view.
  await tour.focus();
  await page.keyboard.press('Tab');
  await expect(home).toBeFocused();
  await page.keyboard.press('Enter');
  await settledAt(page, 'idle');
  await expect(page.getByRole('button', { name: 'Back to the room' })).toBeHidden();
  await expect(home, 'focus stays on Home').toBeFocused();
  const pose = poseOf(await room(page));

  // H from a framing elsewhere.
  await page.evaluate(() => window.__room!.goto('photos'));
  await settledAt(page, 'photos');
  await page.keyboard.press('h');
  await expectHome(page, pose);
});

/**
 * Catches Home pressed during a drag that the drag then takes back (the orbit restarts under the still-moving pointer,
 * or the coast of the let-go carries the camera off the wide view), and a release that also clicks a framing.
 */
test('Home in the middle of a drag cancels the drag and its coast, and lands at the wide view', async ({ page }) => {
  const home = await inRoom(page);
  await page.mouse.move(700, 500);
  await page.mouse.down();
  for (let x = 700; x >= 380; x -= 40) await page.mouse.move(x, 500);
  await expect.poll(async () => (await room(page)).destination).toBe('orbit');
  await page.keyboard.press('h');
  // The pointer keeps moving and lets go fast, as a flick would.
  for (let x = 380; x >= 140; x -= 60) await page.mouse.move(x, 520);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await room(page)).destination, 'the rest of the drag did not take the camera back').toBe('idle');
  await expectHome(page, home);
});

/**
 * Catches Home that cuts straight through the set from behind it (or snaps there), leaves a see-through wall faded once
 * it is back in front, and a glide home whose length does not grow with the way it has to go.
 */
test('Home from behind a wall swings round the set, the walls come back, and a longer way takes longer', async ({ page }) => {
  const home = await inRoom(page);
  // A short turn first: the time home from nearby.
  await drag(page, -120);
  await orbitRests(page);
  let stop = await trackCamera(page);
  await homeButton(page).click();
  await expectHome(page, home);
  const near = await stop();
  const nearMs = near.findLast((s) => s.destination === 'idle')!.t - near[0].t;

  // Half a turn round: behind the back wall, which fades.
  const perRad = 900 / (Math.PI * 1.6);
  for (let k = 0; k < 3; k++) {
    await drag(page, -(Math.PI / 3) * perRad);
    await orbitRests(page);
  }
  const behind = await room(page);
  const back = behind.walls.find((w) => w.name === 'back')!;
  expect(back.opacity, 'the back wall from behind').toBeLessThan(0.05);
  stop = await trackCamera(page);
  const begun = Date.now();
  await homeButton(page).click();
  await expectHome(page, home);
  const far = await stop();
  const tookMs = Date.now() - begun;
  for (const wall of (await room(page)).walls) expect(wall.opacity, `the ${wall.name} wall, in front again`).toBe(1);

  // The eye stays out of the set on the way: never nearer the orbit's centre than the closest it started or ended.
  const { center } = await page.evaluate(() => window.__room!.orbitSettings);
  const fromCentre = (s: { x: number; z: number }) => Math.hypot(s.x - center.x / 1000, s.z - center.z / 1000);
  const ends = Math.min(fromCentre(far[0]), fromCentre(far.at(-1)!));
  expect(Math.min(...far.map(fromCentre)), 'it swung round the set, not through it').toBeGreaterThan(ends * 0.85);
  // Smooth: many frames, none jumping more than a fifth of the way.
  const total = far.slice(1).reduce((sum, s, i) => sum + Math.hypot(s.x - far[i].x, s.z - far[i].z), 0);
  const jumps = far.slice(1).map((s, i) => Math.hypot(s.x - far[i].x, s.z - far[i].z));
  expect(jumps.filter((d) => d > 0).length, 'frames that moved').toBeGreaterThan(5);
  expect(Math.max(...jumps) / total, 'the largest step, as a share of the way').toBeLessThan(0.2);
  const farMs = far.findLast((s) => s.destination === 'idle')!.t - far[0].t;
  test.info().annotations.push({ type: 'home durations', description: `near ${nearMs.toFixed(0)} ms, from behind ${farMs.toFixed(0)} ms (wall clock ${tookMs} ms)` });
  expect(farMs, 'from behind takes longer than from nearby').toBeGreaterThan(nearMs);
});

/** Catches Home from far out (zoomed out to the limit) that stays out there, or lands short. */
test('Home from zoomed all the way out lands at the wide view', async ({ page }) => {
  const home = await inRoom(page);
  await page.mouse.move(720, 520);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 300);
  const { maxDist } = await page.evaluate(() => window.__room!.orbitSettings.limits);
  await expect.poll(async () => (await room(page)).orbit?.radius ?? 0, { timeout: 15_000 }).toBeGreaterThan(maxDist * 0.98);
  await homeButton(page).click();
  await expectHome(page, home);
});

/** Catches Home during the played tour that leaves the glide running, the map open, or the tour still "playing". */
test('Home during the played tour ends the tour, closes the map and lands at the wide view', async ({ page }) => {
  const home = await inRoom(page);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await page.getByRole('button', { name: 'Play the tour' }).click();
  await page.waitForFunction(() => (window.__room!.view.glide?.time ?? 0) > 3, null, { timeout: 60_000 });
  await homeButton(page).click();
  await expectHome(page, home);
  expect((await room(page)).view.glide).toBeNull();
  await expect(page.locator('[data-tour]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Take the tour' })).toHaveAttribute('aria-expanded', 'false');
  // Opened again, the map offers to play, not to stop.
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(page.getByRole('button', { name: 'Play the tour' })).toBeVisible();
});

/** Catches Home under reduced motion that glides instead of cutting. */
test('with reduced motion Home is a cut', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/about');
  await settledAt(page, 'monitor', 120_000);
  await page.keyboard.press('Escape');
  await settledAt(page, 'desk');
  await page.keyboard.press('ArrowLeft');
  expect((await room(page)).destination).toBe('orbit');
  await homeButton(page).click();
  // The next frame is already there: no frame in between.
  expect(await room(page)).toMatchObject({ phase: 'idle', moving: false, orbit: null });
});
