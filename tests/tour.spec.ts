import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { FloorPlan } from '../src/components/RoomTourMap';
import type {} from '../src/scene/Application/Application';

// "Take the tour" and its map of the room (brief §0, §1, §6): the room's own public/room/floorplan.json gives the stops,
// their order (professional first) and labels; src/scene/tour.json says what the tour says at each. Every stop's camera
// exists in today's room (the map leaves out a stop it cannot frame).
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const PLAN: FloorPlan = JSON.parse(readFileSync(new URL('../public/room/floorplan.json', import.meta.url), 'utf8'));
const CAPTIONS = new Map<string, string>(
  JSON.parse(readFileSync(new URL('../src/scene/tour.json', import.meta.url), 'utf8')).stops.map((s: { id: string; caption: string }) => [s.id, s.caption]),
);
const STOPS = PLAN.stops.filter((s) => CAPTIONS.has(s.id)).map((s) => ({ ...s, caption: CAPTIONS.get(s.id)! }));
type Stop = (typeof STOPS)[number];
const station = (stop: Stop) => stop.camera.replace(/^cam_/, '');

/** The arrival has landed and the tour's button has appeared. */
async function arrived(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Take the tour' })).toBeVisible({ timeout: 15_000 });
}

const settledAt = (page: Page, at: string, timeout = 30_000) =>
  page.waitForFunction((s) => window.__room?.phase === s && !window.__room.moving, at, { timeout });

const map = (page: Page) => page.getByRole('region', { name: 'Map of the room' });
const stopButtons = (page: Page) => map(page).getByRole('list', { name: 'Stops' }).getByRole('button');
// Spots off the glass at the edges of the frame; the test clicks the first with no prop under it at that moment.
const EDGE_SPOTS: [number, number][] = [
  [720, 860],
  [60, 450],
  [1380, 450],
  [720, 60],
  [200, 860],
  [1240, 860],
];

interface GlideFrame {
  t: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  glide: { time: number } | null;
  caption: string;
  opacity: number;
  markX: number;
  markZ: number;
}

/** Records every frame from now on: the camera in plan, the glide's clock, the caption and the inset's mark. */
async function recordGlide(page: Page) {
  await page.evaluate(() => {
    const frames: unknown[] = [];
    (window as unknown as { glideFrames: unknown[] }).glideFrames = frames;
    const caption = document.querySelector('[data-tour-caption]')!;
    const here = document.querySelector('[data-tour-here]')!;
    const tick = () => {
      const v = window.__room!.view;
      const [, markX, markZ] = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(here.getAttribute('transform') ?? '') ?? [];
      frames.push({
        t: performance.now(),
        x: v.x,
        z: v.z,
        tx: v.targetX,
        tz: v.targetZ,
        glide: v.glide && { time: v.glide.time },
        caption: caption.textContent,
        opacity: Number(getComputedStyle(caption).opacity),
        markX: Number(markX),
        markZ: Number(markZ),
      });
      requestAnimationFrame(tick);
    };
    tick();
  });
}

const glideFrames = (page: Page) => page.evaluate(() => (window as unknown as { glideFrames: GlideFrame[] }).glideFrames);

/**
 * Catches a map that does not open, a stop that does not fly the camera there, a you-are-here mark that stays put, a
 * played tour that stops at its stops (owner, round 8: it glides), skips one, passes a projector, shows no caption or
 * keeps the full panel over the frame, never returns to the desk, or runs far from a minute, and an Escape that leaves
 * the map open.
 */
test('the map opens, a stop flies the camera there, the tour glides through every stop with its caption and returns', async ({ page }) => {
  test.setTimeout(420_000);
  await arrived(page);
  const open = page.getByRole('button', { name: 'Take the tour' });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(map(page)).toBeVisible();
  await expect(stopButtons(page)).toHaveText(STOPS.map((s, i) => `${i + 1}${s.label}`));
  // The projector left the room in round 8: no stop of the tour is it.
  expect(STOPS.map((s) => s.id)).not.toContain('projector');
  await expect(map(page)).not.toContainText(/projector/i);
  // The camera rests at the desk or its monitor, at the first stop: the map says so (once the camera has come to rest:
  // the map may open while the arrival's step into the monitor is still flying).
  await page.waitForFunction(() => !window.__room!.moving, null, { timeout: 60_000 });
  await expect(stopButtons(page).first()).toHaveAttribute('aria-current', 'location');

  const second = STOPS[1];
  await stopButtons(page).nth(1).click();
  await settledAt(page, station(second));
  await expect(stopButtons(page).nth(1)).toHaveAttribute('aria-current', 'location');
  // The mark sits where the camera is (plan coordinates are the room's x and z in metres).
  const mark = await page.evaluate(() => {
    const view = window.__room!.view;
    const transform = document.querySelector('[data-tour-here]')!.getAttribute('transform')!;
    const [, x, z] = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(transform)!.map(Number);
    return { view, x, z };
  });
  expect(mark.x).toBeCloseTo(mark.view.x, 2);
  expect(mark.z).toBeCloseTo(mark.view.z, 2);

  // Play: one glide through every stop and home, the map shrunk to an inset, each stop's caption fading in and out.
  await recordGlide(page);
  await map(page).getByRole('button', { name: 'Play the tour' }).click();
  await expect(map(page).getByRole('button', { name: 'Stop the tour' })).toBeVisible();
  await expect(map(page).getByRole('list', { name: 'Stops' })).toBeHidden();
  const inset = (await map(page).boundingBox())!;
  expect(inset.height, 'the inset leaves the frame alone').toBeLessThan(200);
  expect(inset.width).toBeLessThan(450);
  await expect(page.locator('[data-tour-caption]')).toHaveText('Back at the desk.', { timeout: 120_000 });
  await settledAt(page, 'desk');
  await expect(map(page).getByRole('button', { name: 'Play the tour' })).toBeVisible();
  await expect(map(page).getByRole('list', { name: 'Stops' })).toBeVisible();

  const frames = await glideFrames(page);
  const gliding = frames.filter((f) => f.glide !== null);
  const seconds = (gliding.at(-1)!.t - gliding[0].t) / 1000;
  test.info().annotations.push({ type: 'glide', description: `${seconds.toFixed(1)} s, ${gliding.length} frames` });
  expect(seconds, 'about a minute').toBeGreaterThanOrEqual(45);
  expect(seconds).toBeLessThanOrEqual(70);
  // Never at rest between its start and its end: every frame moves the eye or what it looks at.
  const still = gliding.slice(1).filter((f, i) => f.t > gliding[i].t && Math.hypot(f.x - gliding[i].x, f.z - gliding[i].z, f.tx - gliding[i].tx, f.tz - gliding[i].tz) === 0);
  expect(still.map((f) => ((f.t - gliding[0].t) / 1000).toFixed(2)), 'frames the camera stood still').toEqual([]);
  // The path's clock never stops either, so the glide never dwells at a stop.
  expect(gliding.every((f, i) => i === 0 || f.glide!.time > gliding[i - 1].glide!.time || f.t === gliding[i - 1].t)).toBe(true);
  // Each stop's caption shows at full strength while the camera passes it, in the order the tour plays them, then the
  // way home.
  // (The map's "You are here" line is still fading out in the glide's first frames.)
  const shown = gliding
    .filter((f) => f.opacity > 0.98 && !f.caption.startsWith('You are here'))
    .map((f) => f.caption)
    .filter((c, i, all) => c !== all[i - 1]);
  expect(shown).toEqual([...STOPS.map((s, i) => `${i + 1} of ${STOPS.length} · ${s.label}. ${s.caption}`), 'Back at the desk.']);
  // Between two captions the old one fades out before the new one fades in.
  expect(gliding.some((f) => f.opacity < 0.05)).toBe(true);
  // The inset's mark follows the camera.
  const mid = gliding[Math.floor(gliding.length / 2)];
  expect(mid.markX).toBeCloseTo(mid.x, 1);
  expect(mid.markZ).toBeCloseTo(mid.z, 1);

  await page.keyboard.press('Escape');
  await expect(map(page)).toBeHidden();
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  // Escape closed the map only; the camera did not also back out of the desk.
  expect(await page.evaluate(() => window.__room!.destination)).toBe('desk');
});

/** Catches a glide that keeps going after a visitor's input, jumps instead of slowing, or lets the input act as well. */
test('any input during the glide slows it to rest where it is, and does nothing else', async ({ page }) => {
  test.setTimeout(420_000);
  await arrived(page);
  await page.mouse.move(5, 5);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  const stations = STOPS.map(station);
  let empty: [number, number] = EDGE_SPOTS[0];
  const inputs: [string, () => Promise<void>][] = [
    ['a click on the room', () => page.mouse.click(...empty)],
    ['a key', () => page.keyboard.press('ArrowRight')],
    // Over the inset, where the pointer rests after pressing Play.
    ['the wheel', () => page.mouse.wheel(0, 240)],
    ['Escape', () => page.keyboard.press('Escape')],
  ];
  for (const [name, input] of inputs) {
    await map(page).getByRole('button', { name: 'Play the tour' }).click();
    await page.waitForFunction(() => (window.__room!.view.glide?.time ?? 0) > 6, null, { timeout: 30_000 });
    if (name === 'a click on the room') {
      // A spot with no prop under it, so the click would otherwise step the camera out to the wide view.
      const free = await page.evaluate((spots) => spots.find(([x, y]) => window.__room!.hit(x, y) === null) ?? null, EDGE_SPOTS);
      expect(free, 'a spot with nothing under the click').not.toBeNull();
      empty = free!;
    }
    const before = await page.evaluate(() => window.__room!.view);
    await input();
    await page.waitForFunction(() => !window.__room!.moving, null, { timeout: 10_000 });
    const after = await page.evaluate(() => window.__room!.view);
    expect(after.glide, `${name}: the glide ended`).toBeNull();
    expect(stations, `${name}: it rests at the stop it was passing, not at a station the input chose`).toContain(after.destination);
    expect(Math.hypot(after.x - before.x, after.z - before.z), `${name}: it slowed where it was`).toBeLessThan(0.6);
    expect(Math.hypot(after.x - before.x, after.z - before.z), `${name}: it slowed, not stopped dead`).toBeGreaterThan(0.01);
    await page.waitForTimeout(1500);
    const later = await page.evaluate(() => window.__room!.view);
    expect(Math.hypot(later.x - after.x, later.z - after.z), `${name}: it stays at rest`).toBeLessThan(0.005);
    // The map is whole again; Escape only braked the glide and left the map open.
    await expect(map(page).getByRole('button', { name: 'Play the tour' })).toBeVisible();
    await expect(map(page).getByRole('list', { name: 'Stops' })).toBeVisible();
  }
});

/** Catches the step-by-step tour lost for reduced motion: a cut to each stop, a pause to read it, then home. */
test('with reduced motion, Play visits the stops one by one, each with its caption, and comes back', async ({ browser }) => {
  test.setTimeout(420_000);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await arrived(page);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const watch = () => {
      const at = window.__room!.destination;
      if (seen.at(-1) !== at) seen.push(at);
      requestAnimationFrame(watch);
    };
    watch();
  });
  await map(page).getByRole('button', { name: 'Play the tour' }).click();
  const caption = page.locator('[data-tour-caption]');
  await expect(caption).toHaveText(`1 of ${STOPS.length} · ${STOPS[0].label}. ${STOPS[0].caption}`);
  expect(await page.evaluate(() => window.__room!.view.glide)).toBeNull();
  await expect(caption).toHaveText(`2 of ${STOPS.length} · ${STOPS[1].label}. ${STOPS[1].caption}`, { timeout: 20_000 });
  await expect(caption).toHaveText('Back at the desk.', { timeout: 120_000 });
  await settledAt(page, 'desk');
  // The page's own frame loop records the last cut on its next frame, which a slow machine draws late.
  await expect.poll(() => page.evaluate(() => (window as unknown as { seen: string[] }).seen.at(-1))).toBe('desk');
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen.slice(seen.indexOf(station(STOPS[0])))).toEqual([...STOPS.map(station), 'desk']);
  await page.close();
});

/** Catches a played tour that keeps pulling the camera after the visitor has taken it somewhere else. */
test('anything the visitor does with the camera ends the played tour', async ({ page }) => {
  await arrived(page);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await map(page).getByRole('button', { name: 'Play the tour' }).click();
  await page.waitForFunction(() => (window.__room!.view.glide?.time ?? 0) > 3, null, { timeout: 30_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await expect(map(page).getByRole('button', { name: 'Play the tour' })).toBeVisible();
  // The map is whole again, with its stops.
  await expect(map(page).getByRole('list', { name: 'Stops' })).toBeVisible();
  await settledAt(page, 'idle');
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__room!.destination)).toBe('idle');
});

/** Catches serious or critical WCAG failures on the map overlay. */
test('the map has no serious axe violations', async ({ page }) => {
  await arrived(page);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(map(page)).toBeVisible();
  // Colours are read once the button has finished warming (a contrast check mid-transition reads a blend of two states).
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const { violations } = await new AxeBuilder({ page }).include('#room-tour').include('[data-tour-open]').withTags(AXE_TAGS).analyze();
  test.info().attach('axe-map.json', { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
});

/**
 * Catches the you-are-here mark drawn off the plan, on top of Play the tour (T98): the wide view stands 8 m in front of
 * the set, below the plan, and every visit opens the map from there now. The mark stays on the plan's edge and the
 * caption says where the visitor is.
 */
test('from the wide view the map marks the visitor on the plan’s edge, clear of Play the tour', async ({ page }) => {
  await arrived(page);
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(map(page)).toBeVisible();
  const [dot, plan, play] = await Promise.all(
    [page.locator('.room-tour-dot'), page.locator('[data-tour-plan]'), map(page).getByRole('button', { name: 'Play the tour' })].map(async (l) => (await l.boundingBox())!),
  );
  const centre = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
  expect(centre.x, 'on the plan across').toBeGreaterThanOrEqual(plan.x);
  expect(centre.x).toBeLessThanOrEqual(plan.x + plan.width);
  expect(centre.y, 'and up and down').toBeGreaterThanOrEqual(plan.y);
  expect(centre.y).toBeLessThanOrEqual(plan.y + plan.height);
  expect(dot.y + dot.height <= play.y || dot.x + dot.width <= play.x || dot.x >= play.x + play.width, 'not on Play the tour').toBe(true);
  await expect(map(page).locator('[data-tour-caption]')).toHaveText('You are here: the wide view.');
});

/** Catches a tour the keyboard cannot reach, see or drive: Tab to the button (warmed), Enter, arrows and Tab through stops, Enter, Escape. */
test('the keyboard reaches the tour, walks its stops, flies to one and closes the map', async ({ page }) => {
  await arrived(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Open SaahilOS' })).toBeFocused();
  // The arrival ends at the monitor, where the HUD's way back out comes first.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'To the desk' })).toBeFocused();
  await page.keyboard.press('Tab');
  const open = page.getByRole('button', { name: 'Take the tour' });
  await expect(open).toBeFocused();
  // The keyboard's focus warms the button to walnut with a paper edge, as the pointer's hover does.
  await expect.poll(() => open.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(59, 42, 30)');
  await page.keyboard.press('Enter');
  await expect(map(page)).toBeVisible();
  await expect(stopButtons(page).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(stopButtons(page).nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(stopButtons(page).nth(2)).toBeFocused();
  // The arrows moved between stops only; the room did not take them as steps (it stays where the arrival left it).
  expect(['desk', 'monitor']).toContain(await page.evaluate(() => window.__room!.destination));
  await page.keyboard.press('Enter');
  await settledAt(page, station(STOPS[2]));
  await page.keyboard.press('Escape');
  await expect(map(page)).toBeHidden();
  await expect(open).toBeFocused();
});
