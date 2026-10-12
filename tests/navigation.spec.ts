import { devices, expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
// Software WebGL is slow; the springs run on the clock, so slow frames only stretch the waits.
test.describe.configure({ timeout: 180_000 });

const room = (page: Page) =>
  page.evaluate(() => {
    const r = window.__room!;
    return { phase: r.phase, destination: r.destination, moving: r.moving, drifting: r.drifting, stations: r.stations, look: r.look, light: r.light, textureWidths: r.textureWidths };
  });

async function settledAt(page: Page, station: string, timeout = 30_000) {
  await page.waitForFunction((s) => window.__room?.phase === s && !window.__room.moving, station, { timeout });
}

/** The room after its intro, with the first drift stopped, resting on the wide view. */
async function inRoom(page: Page) {
  await page.goto('/');
  await settledAt(page, 'idle', 120_000);
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
}

/** Catches a room that sits still after the intro, or a drift that never comes to rest near the monitor. */
test('with no input, the first drift passes the room’s corners and settles at the desk', async ({ page }) => {
  await page.goto('/');
  await settledAt(page, 'idle', 120_000);
  const visited = new Set<string>();
  await expect
    .poll(
      async () => {
        const r = await room(page);
        visited.add(r.destination);
        return r.phase === 'desk' && !r.moving && !r.drifting;
      },
      { timeout: 60_000, intervals: [200] },
    )
    .toBe(true);
  // Every corner between the wide view and the desk, in the drift's order (no window or photo wall in this room yet).
  expect([...visited]).toEqual(expect.arrayContaining(['idle', 'projector', 'shelf', 'desk']));
});

/** Catches a drift the visitor has to sit through: any key ends it where it was heading, and nothing moves after. */
test('any key ends the first drift, and the camera rests where it was heading', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.drifting && window.__room.destination !== 'idle', null, { timeout: 120_000 });
  await page.keyboard.press('k');
  const heading = (await room(page)).destination;
  expect((await room(page)).drifting).toBe(false);
  await settledAt(page, heading);
  await page.waitForTimeout(4000);
  expect(await room(page)).toMatchObject({ phase: heading, moving: false, drifting: false });
});

/** Catches a click on empty space during the drift that also sends the camera back to the wide view. */
test('a click on empty space ends the first drift and does nothing else', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.drifting && window.__room.destination === 'shelf', null, { timeout: 120_000 });
  // Find a point with no prop under it and click it in the same task, so the drifting camera cannot move in between.
  const clicked = await page.evaluate(() => {
    const corners = [[5, 5], [1435, 5], [5, 895], [1435, 895], [720, 5], [720, 895]];
    const empty = corners.find(([x, y]) => window.__room!.hit(x, y) === null);
    if (!empty) return null;
    const [clientX, clientY] = empty;
    const stage = document.querySelector('[data-room-world]')!;
    const init = { clientX, clientY, bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse' };
    stage.dispatchEvent(new PointerEvent('pointerdown', init));
    stage.dispatchEvent(new PointerEvent('pointerup', init));
    stage.dispatchEvent(new MouseEvent('click', init));
    return empty;
  });
  expect(clicked, 'a corner with no prop under it').not.toBeNull();
  expect(await room(page)).toMatchObject({ destination: 'shelf', drifting: false });
  await settledAt(page, 'shelf');
});

/** Catches arrow keys or the scroll wheel that do nothing, skip a framing, or step more than once per gesture. */
test('arrow keys and the scroll wheel step between framings, one per press or gesture', async ({ page }) => {
  await inRoom(page);
  const { stations } = await room(page);
  const at = stations.indexOf('idle');
  expect(stations).toEqual(expect.arrayContaining(['idle', 'desk', 'monitor', 'projector', 'shelf']));
  expect(stations.indexOf('monitor')).toBe(stations.indexOf('desk') + 1);

  await page.keyboard.press('ArrowRight');
  await settledAt(page, stations[at + 1]);
  await page.keyboard.press('ArrowLeft');
  await settledAt(page, 'idle');

  // One flick of a trackpad: a burst of small deltas (dispatched in one task, so no clock decides it) is one step, not five.
  const flick = (deltaY: number, events: number) =>
    page.evaluate(
      ([deltaY, events]) => {
        const stage = document.querySelector('[data-room-world]')!;
        for (let i = 0; i < events; i++) stage.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
      },
      [deltaY, events],
    );
  await flick(30, 5);
  await settledAt(page, stations[at + 1]);
  await flick(-120, 1);
  await settledAt(page, 'idle');
});

/** Catches a prop that does not answer the pointer, or one that stays lifted after the pointer leaves. */
test('hovering a prop lifts it a little; leaving lets it back down', async ({ page }) => {
  await inRoom(page);
  const mango = await page.evaluate(() => window.__room!.point('hit_mango'));
  await page.mouse.move(mango!.x, mango!.y);
  await expect(page.locator('.room-label')).toHaveText('About');
  await expect.poll(() => page.evaluate(() => window.__room!.lift('hit_mango'))).toBeGreaterThan(4);
  await page.mouse.move(20, 20);
  await expect.poll(() => page.evaluate(() => window.__room!.lift('hit_mango'))).toBe(0);
});

/** Catches a drag that clicks what is under it, turns the view without limit, or keeps its turn after a step. */
test('a drag turns the view within limits, clicks nothing, and the next step looks straight again', async ({ page }) => {
  await inRoom(page);
  // 1,100 px at 35° over 900 px turns 0.75 rad: past the 0.5 rad limit.
  await page.mouse.move(300, 450);
  await page.mouse.down();
  for (let x = 300; x <= 1400; x += 50) await page.mouse.move(x, 450);
  await page.mouse.up();
  await page.mouse.move(720, 450);
  await expect.poll(async () => (await room(page)).look.yaw).toBeGreaterThan(0.45);
  const { look, phase, destination } = await room(page);
  expect(look.yaw).toBeLessThanOrEqual(0.5 + 0.02);
  expect({ phase, destination }).toEqual({ phase: 'idle', destination: 'idle' });
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.abs((await room(page)).look.yaw)).toBeLessThan(0.01);
});

/** Catches glides under reduced motion: steps cut. */
test('with reduced motion an arrow key cuts to the next framing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.phase === 'idle', null, { timeout: 120_000 });
  const { stations } = await room(page);
  await page.keyboard.press('ArrowRight');
  expect(await room(page)).toMatchObject({ phase: stations[stations.indexOf('idle') + 1], moving: false, drifting: false });
});

test.describe('on a phone', () => {
  const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
  test.use(iPhone13);

  /** Catches a phone that gets the desktop room, never reaches the monitor, or ends on neither the OS nor the drawn monitor. */
  test('an iPhone 13 gets the light room, which goes into the monitor and opens SaahilOS full screen', async ({ page }) => {
    const fallbacks: string[] = [];
    page.on('console', (m) => m.text().startsWith('room: ') && fallbacks.push(m.text()));
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/room-light/);
    await page.waitForFunction(() => /room-os|room-2d/.test(document.documentElement.className), null, { timeout: 120_000 });
    await expect(page.frameLocator('[data-monitor-glass] iframe').getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
    const path = (await page.locator('html.room-2d').count()) ? `fell back: ${fallbacks.join('; ')}` : 'light room reached the monitor';
    test.info().annotations.push({ type: 'phone path', description: path });
    if (path.startsWith('fell back')) return; // too slow here: the drawn monitor took over, as it should
    const r = await room(page);
    expect(r).toMatchObject({ light: true, phase: 'monitor' });
    await expect(page).toHaveURL(/\/$/);
    expect(Math.max(...r.textureWidths)).toBeLessThanOrEqual(2048);

    await page.getByRole('button', { name: 'Back to the room' }).tap();
    await settledAt(page, 'idle');
    await expect(page.locator('html')).not.toHaveClass(/room-os/);
    // Tapping the glass goes back in.
    const glass = await page.evaluate(() => window.__room!.point('hit_monitor'));
    await page.touchscreen.tap(glass!.x, glass!.y);
    await expect(page.locator('html')).toHaveClass(/room-os/, { timeout: 30_000 });
  });

  /** Catches a phone page that pans or zooms under a finger instead of turning the view, or that goes into the monitor anyway. */
  test('a finger drags the view on a phone, and the room then stays out of the monitor', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__room?.moving, null, { timeout: 120_000 });
    // Touches through the browser's input pipeline, so touch-action and pointer events are what a phone gets.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: 420 }] });
    await touch('touchStart', 40);
    for (let x = 70; x <= 340; x += 30) await touch('touchMove', x);
    await touch('touchEnd');
    await expect.poll(async () => (await room(page)).look.yaw).toBeGreaterThan(0.1);
    expect(await page.evaluate(() => scrollX + scrollY)).toBe(0);
    // Past the 1.6 s the phone would hold the wide view before going in by itself.
    await page.waitForTimeout(3000);
    expect(await room(page)).toMatchObject({ phase: 'idle', destination: 'idle' });
    await expect(page.locator('html')).not.toHaveClass(/room-os/);
  });

  /** Catches an address on a phone that loses its window on the way into the monitor. */
  test('a phone opening /about ends on About in SaahilOS', async ({ page }) => {
    await page.goto('/about');
    await page.waitForFunction(() => /room-os|room-2d/.test(document.documentElement.className), null, { timeout: 120_000 });
    await expect(page.frameLocator('[data-monitor-glass] iframe').getByRole('heading', { name: 'About' }).first()).toBeVisible();
  });

  /** Catches the light room loading on a device that reports too little memory for it. */
  test('a phone with little memory gets the drawn monitor at once and loads no scene', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { value: 1 }));
    const sceneRequests: string[] = [];
    page.on('request', (r) => /\/_astro\/main\.|\.glb$/.test(r.url()) && sceneRequests.push(r.url()));
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/room-2d/);
    await expect(page.frameLocator('[data-monitor-glass] iframe').getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
    expect(sceneRequests).toEqual([]);
  });

  /** Catches a phone too slow for the light room staying in a stuttering room instead of the drawn monitor. */
  test('a phone too slow for the light room falls back to the drawn monitor', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 40 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/room-light/);
    await expect(page.locator('html')).toHaveClass(/room-2d/, { timeout: 150_000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await expect(page.frameLocator('[data-monitor-glass] iframe').getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__room)).toBeUndefined();
  });
});
