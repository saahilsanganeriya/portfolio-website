import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type {} from '../src/scene/Application/Application';

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
// Software WebGL is slow; the springs run on the clock, so slow frames only stretch the waits.
test.describe.configure({ timeout: 180_000 });

const room = (page: Page) =>
  page.evaluate(() => {
    const r = window.__room!;
    return {
      phase: r.phase,
      destination: r.destination,
      moving: r.moving,
      stations: r.stations,
      look: r.look,
      light: r.light,
      textureWidths: r.textureWidths,
      orbit: r.orbit,
      view: r.view,
    };
  });
const TURN = Math.PI * 2;
/** Radians per CSS pixel of drag on the 900 px stage (the orbit turns 1.1 pi per stage height). */
const RAD_PER_PX = (Math.PI * 1.1) / 900;

async function settledAt(page: Page, station: string, timeout = 30_000) {
  await page.waitForFunction((s) => window.__room?.phase === s && !window.__room.moving, station, { timeout });
}

const os = (page: Page) => page.frameLocator('.room-monitor iframe');

/** The room after its arrival at the monitor, stepped back to the wide view. */
async function inRoom(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
}

/** Records every station the camera heads for from now on, in order. */
async function watchDestinations(page: Page) {
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
}
const destinations = (page: Page) => page.evaluate(() => (window as unknown as { seen: string[] }).seen);

/**
 * Catches a click during the arrival that also sends the camera on from the monitor (to the desk, as a click on empty
 * space does once the visitor is there) instead of only landing it, and a skip that lands anywhere but the monitor.
 */
test('a click on empty space during the arrival lands it at the monitor, and the camera stays there', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.moving && window.__room.landedAt == null, null, { timeout: 120_000, polling: 50 });
  await page.mouse.click(5, 5);
  expect(await room(page)).toMatchObject({ phase: 'monitor', destination: 'monitor', moving: false });
  await watchDestinations(page);
  await page.waitForTimeout(1500);
  expect(await destinations(page)).toEqual(['monitor']);
});

/**
 * Catches Escape not stepping back from the monitor where a visit lands (T52 fix 1), or not letting the visitor out
 * from the desk into the room (brief §0: click out of the monitor to explore).
 */
test('Escape steps back from the monitor to the desk, and from the desk out to the wide view', async ({ page }) => {
  await page.goto('/');
  await settledAt(page, 'monitor', 120_000);
  await page.keyboard.press('Escape');
  await settledAt(page, 'desk');
  await page.keyboard.press('Escape');
  await settledAt(page, 'idle');
});

/**
 * Catches a click beside the screen that sends the camera all the way out to the wide view, or nowhere: with the
 * keyboard inside SaahilOS (a window address focuses its window) the press moves focus off the glass first, and that
 * press must step back once, not twice.
 */
test('a click beside the screen steps back from the monitor to the desk, with or without focus in SaahilOS', async ({ page }) => {
  await page.goto('/projects/swe-sim');
  await settledAt(page, 'monitor', 120_000);
  await expect.poll(() => page.evaluate(() => document.activeElement?.matches('.room-monitor iframe') ?? false)).toBe(true);
  await watchDestinations(page);
  await page.mouse.click(40, 450);
  await settledAt(page, 'desk');
  await page.waitForTimeout(800);
  expect(await destinations(page)).toEqual(['monitor', 'desk']);

  await page.evaluate(() => window.__room!.goto('monitor'));
  await settledAt(page, 'monitor');
  await page.mouse.click(40, 450);
  await settledAt(page, 'desk');
});

/**
 * Catches Escape doing nothing while the keyboard is inside SaahilOS (where a window address puts it), and an Escape
 * that only closes SaahilOS's Start menu also stepping the camera back.
 */
test('Escape inside SaahilOS steps back to the desk, unless it closed the Start menu', async ({ page }) => {
  await page.goto('/projects/swe-sim');
  await settledAt(page, 'monitor', 120_000);
  // SaahilOS's buttons are on the page before React makes them live, and a click before that is lost; the address's
  // window opens only once SaahilOS is live.
  await expect(os(page).getByRole('dialog', { name: 'swe-sim: a SWE simulator for coding-agent tasks' })).toBeVisible();
  await os(page).getByRole('button', { name: 'Start', exact: true }).click();
  const menu = os(page).getByRole('navigation', { name: 'Start menu' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.waitForTimeout(800);
  expect(await room(page)).toMatchObject({ destination: 'monitor' });
  await page.keyboard.press('Escape');
  await settledAt(page, 'desk');
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

/** Drags across the stage by (dx, dy) in steps; `rest` waits before letting go, so the turn hands no speed to the inertia. */
async function drag(page: Page, dx: number, dy = 0, { from = [720, 520], rest = true } = {}) {
  const [x, y] = from;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) await page.mouse.move(x + (dx * i) / 16, y + (dy * i) / 16);
  if (rest) await page.waitForTimeout(150);
  await page.mouse.up();
}

const orbitRests = (page: Page) => page.waitForFunction(() => window.__room!.orbit !== null && window.__room!.orbit.turning === 0 && !window.__room!.moving, null, { timeout: 30_000 });

/**
 * Catches a drag that turns the view only a little (round 7's limited look) instead of the whole set, an orbit that
 * cannot go all the way round, a drag that also clicks what is under it, a wall that stays solid when the camera is
 * behind it (or fades while the camera is in front), and a faded wall whose hotspots still take the pointer.
 */
test('a drag turns the set all the way round, and each wall turns see-through from behind', async ({ page }) => {
  await inRoom(page);
  const sectors = new Set<number>();
  const walls: Record<string, number[]> = {};
  // From the front, the window's city view shows; it is checked hidden from every side the camera turns to below.
  const front = await page.evaluate(() => window.__room!.walls);
  for (const wall of front) expect(wall.outside.every((o) => o.shown), `the ${wall.name} wall's outside from the front`).toBe(true);
  // ...and it is drawn: the window's middle is the city, not the void colour (#14110F) of a hidden view.
  const pane = (await page.evaluate(() => window.__room!.point('hit_window')))!;
  const pixels = await sharp(await page.screenshot({ clip: { x: pane.x - 30, y: pane.y - 20, width: 60, height: 40 } }))
    .removeAlpha()
    .raw()
    .toBuffer();
  const mean = [0, 1, 2].map((c) => pixels.reduce((sum, v, i) => (i % 3 === c ? sum + v : sum), 0) / (pixels.length / 3));
  const fromVoid = Math.max(...mean.map((v, c) => Math.abs(v - [20, 17, 15][c])));
  expect(fromVoid, `the window from the wide view is ${mean.map(Math.round)}`).toBeGreaterThan(40);
  let unwrapped = 0;
  let last: number | null = null;
  // Into the orbit, then twelve turns of 30°, one way: the camera passes every side of the set.
  for (let k = 0; k < 13; k++) {
    await drag(page, -(Math.PI / 6) / RAD_PER_PX);
    await orbitRests(page);
    const r = await room(page);
    expect(r.destination, 'a drag never clicks a prop or toggles a framing').toBe('orbit');
    const azimuth = r.orbit!.azimuth;
    if (last !== null) unwrapped += azimuth - last;
    last = azimuth;
    sectors.add(Math.floor((((azimuth % TURN) + TURN) % TURN) / (TURN / 8)));
    for (const wall of await page.evaluate(() => window.__room!.walls)) {
      (walls[wall.name] ??= []).push(wall.opacity);
      // What lies outside a wall (the window's city view and sky) never shows while that wall is faded, below 0.9 when
      // a mask holds it (from there it fades in under its cover with the wall; diorama.test owns that).
      if (wall.opacity < (wall.masked ? 0.9 : 1)) expect(wall.outside.filter((o) => o.shown).map((o) => o.name), `outside the faded ${wall.name} wall`).toEqual([]);
    }
    // From a wall's outside, its hotspots are not in the way of the pointer.
    const faded = (await page.evaluate(() => window.__room!.walls)).filter((w) => w.opacity < 0.5);
    for (const wall of faded) {
      for (const proxy of wall.proxies) {
        const at = await page.evaluate((n) => window.__room!.point(n), proxy);
        if (at) expect(await page.evaluate(({ x, y }) => window.__room!.hit(x, y), at), `${proxy} on the faded ${wall.name} wall`).not.toBe(proxy);
      }
    }
  }
  expect(unwrapped, 'the set turned a whole turn and more').toBeGreaterThan(TURN * 0.95);
  expect([...sectors].sort(), 'every eighth of the circle was seen').toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  // Every wall was gone at some point of the turn and whole at another.
  for (const [name, opacities] of Object.entries(walls)) {
    expect(Math.min(...opacities), `the ${name} wall from behind`).toBeLessThan(0.05);
    expect(Math.max(...opacities), `the ${name} wall from the front`).toBe(1);
  }
  // From the side, past the back wall's free end (80° round, where the wall still stands whole), the city behind it stays
  // boxed in by the wall's void-coloured mask (set v4's window_view_mask), which holds all of it; a room without one
  // hides it there instead (tests/diorama.test.ts).
  const side = (80 * Math.PI) / 180;
  for (let k = 0; k < 3; k++) {
    const { azimuth } = (await room(page)).orbit!;
    const delta = ((((side - azimuth) % TURN) + TURN * 1.5) % TURN) - Math.PI;
    if (Math.abs(delta) < 0.02) break;
    await drag(page, -Math.max(-2, Math.min(2, delta)) / RAD_PER_PX);
    await orbitRests(page);
  }
  const back = (await page.evaluate(() => window.__room!.walls)).find((w) => w.name === 'back')!;
  expect(back.opacity, 'the back wall from the side').toBe(1);
  expect(back.masked, 'the mask holds the city behind the back wall').toBe(true);
  expect(back.outside.every((o) => o.shown), 'the city behind the back wall, from the side, in its mask').toBe(true);
});

/** Catches keys that step framings instead of turning the set, a zoom key that does nothing, and a lost way back. */
test('arrow keys turn the set, + and - zoom, Escape goes back to the wide view, Page Down steps a framing', async ({ page }) => {
  await inRoom(page);
  await page.keyboard.press('ArrowRight');
  await orbitRests(page);
  const turned = (await room(page)).orbit!;
  await page.keyboard.press('ArrowRight');
  await orbitRests(page);
  expect((await room(page)).orbit!.azimuth - turned.azimuth).toBeCloseTo(Math.PI / 12, 1);
  await page.keyboard.press('+');
  await orbitRests(page);
  await expect.poll(async () => (await room(page)).orbit!.radius).toBeLessThan(turned.radius - 100);
  await page.keyboard.press('Escape');
  await settledAt(page, 'idle');
  const { stations } = await room(page);
  await page.keyboard.press('PageDown');
  await settledAt(page, stations[stations.indexOf('idle') + 1]);
});

/** Catches the orbit's inertia, glides or sway under reduced motion: each input lands at once and then holds still. */
test('with reduced motion a key turns the set at once, a drag lets go without coasting, and nothing drifts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await settledAt(page, 'monitor', 120_000);
  await page.keyboard.press('Escape');
  await settledAt(page, 'desk');
  await page.keyboard.press('ArrowLeft');
  const first = (await room(page)).orbit!;
  expect(first.turning).toBe(0);
  await page.keyboard.press('ArrowLeft');
  expect(first.azimuth - (await room(page)).orbit!.azimuth).toBeCloseTo(Math.PI / 12, 3);
  // A fast flick, let go while moving: no speed carries on.
  await drag(page, 300, 0, { rest: false });
  const released = await room(page);
  expect(released.orbit!.turning).toBe(0);
  await page.waitForTimeout(1500);
  const later = await room(page);
  expect(later.orbit!.azimuth).toBeCloseTo(released.orbit!.azimuth, 6);
  expect([later.view.x, later.view.z]).toEqual([released.view.x, released.view.z]);
});

/** Catches the wheel at the monitor moving the camera, or not reaching the OS window under the pointer (the friend's "weird" scrolling). */
test('at the monitor the wheel scrolls the OS window under the pointer, and the camera stays still', async ({ page }) => {
  await page.goto('/about');
  await settledAt(page, 'monitor', 120_000);
  const body = os(page).getByRole('dialog', { name: 'About' }).locator('p').nth(2);
  await expect(body).toBeVisible();
  const box = (await body.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // The scrolling box that holds the paragraph under the pointer.
  const scroller = () =>
    body.evaluate((paragraph) => {
      let el: Element | null = paragraph;
      while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
      return el ? el.scrollTop : null;
    });
  // About only overflows once its photos have laid out, so wait for the scrolling body before measuring.
  await expect.poll(scroller, { message: 'About has a scrolling body', timeout: 15_000 }).not.toBeNull();
  const before = { scroll: await scroller(), view: (await room(page)).view };
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 200);
  await expect.poll(scroller).toBeGreaterThan(before.scroll! + 100);
  await page.waitForTimeout(600);
  const after = await room(page);
  expect(after).toMatchObject({ phase: 'monitor', destination: 'monitor', moving: false, orbit: null });
  expect([after.view.x, after.view.z, after.view.targetX, after.view.targetZ]).toEqual([before.view.x, before.view.z, before.view.targetX, before.view.targetZ]);
  // The wheel on the bezel beside the screen does not move the camera either.
  await page.mouse.move(30, 450);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(600);
  expect(await room(page)).toMatchObject({ phase: 'monitor', destination: 'monitor', orbit: null });
});

/** Catches a pointer that slips off the glass pulling the camera out, and the ways out (back control, drag) that do not. */
test('the monitor is left by the back control or a drag, not by the pointer slipping off the screen', async ({ page }) => {
  await page.goto('/about');
  await settledAt(page, 'monitor', 120_000);
  await page.mouse.move(720, 450);
  await page.mouse.move(25, 450);
  await page.waitForTimeout(1200);
  expect(await room(page)).toMatchObject({ destination: 'monitor' });
  const back = page.getByRole('button', { name: 'To the desk' });
  await expect(back).toBeVisible();
  await back.click();
  await settledAt(page, 'desk');
  await expect(back).toBeHidden();
  await page.evaluate(() => window.__room!.goto('monitor'));
  await settledAt(page, 'monitor');
  // A drag that starts on the bezel takes the camera out into the orbit.
  await drag(page, 260, 0, { from: [25, 450] });
  await expect.poll(async () => (await room(page)).destination).toBe('orbit');
});

/**
 * Catches the glass sliding under a resting pointer while the camera flies elsewhere and pulling it back into the
 * monitor (it sent the camera bound for the photo board back to the screen).
 */
test('a pointer resting beside the glass does not pull a passing camera into the monitor', async ({ page }) => {
  await page.goto('/');
  await settledAt(page, 'monitor', 120_000);
  await page.keyboard.press('Escape');
  await settledAt(page, 'desk');
  const note = await page.evaluate(() => window.__room!.point('hit_sticky_note_0'));
  await page.mouse.move(note!.x, note!.y);
  await page.waitForTimeout(600);
  await watchDestinations(page);
  // Toward the darkroom wall the screen sweeps across under the resting pointer.
  await page.evaluate(() => window.__room!.goto('photos'));
  await settledAt(page, 'photos');
  await page.waitForTimeout(1000);
  // From the desk straight to the darkroom: never by way of the monitor.
  expect(await destinations(page)).toEqual(['desk', 'photos']);
});

/**
 * Catches a corner label without his name, title or the visitor's time (hh:mm), one that sits over the monitor, or one
 * a screen reader hears every minute.
 */
test('the HUD shows his name, Software Engineer and the local time, and keeps off the monitor', async ({ page }) => {
  await page.goto('/');
  await settledAt(page, 'monitor', 120_000);
  const hud = page.locator('[data-room-hud]');
  await expect(hud).toHaveAttribute('data-hidden', '');
  await page.keyboard.press('Escape');
  await settledAt(page, 'desk');
  await expect(hud).not.toHaveAttribute('data-hidden', '');
  await expect(hud).toHaveText(/Saahil Sanganeriya\s*Software Engineer\s*\d{2}:\d{2}/);
  const shown = await hud.locator('time').textContent();
  // The page's own clock now and a minute ago (the minute may turn between the two reads).
  const local = await page.evaluate(() =>
    [0, 60_000].map((ago) => {
      const at = new Date(Date.now() - ago);
      return [at.getHours(), at.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
    }),
  );
  expect(local).toContain(shown);
  expect(await hud.locator('[aria-live]').count()).toBe(0);
  const label = (await hud.boundingBox())!;
  const glass = (await page.evaluate(() => window.__room!.monitorRect()))!;
  const meets = label.x < glass.right && label.x + label.width > glass.left && label.y < glass.bottom && label.y + label.height > glass.top;
  expect(meets, 'the label and the glass do not meet at the desk').toBe(false);
  const { violations } = await new AxeBuilder({ page }).include('[data-room-hud]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
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

  /**
   * A phone that draws 60 frames a second, however slowly this machine draws them: the light room measures its frame
   * rate before it starts and below 30 fps falls back to the drawn monitor (tested below), which on a loaded machine
   * left a test that needs the room nothing to turn. Only the frames' timestamps are steady; timers keep real time.
   */
  async function steadyFrames(page: Page) {
    await page.addInitScript(() => {
      const native = window.requestAnimationFrame.bind(window);
      let nativeAt = -1;
      let at = performance.now();
      window.requestAnimationFrame = (callback) =>
        native((now) => {
          if (now !== nativeAt) {
            nativeAt = now;
            at += 1000 / 60;
          }
          callback(at);
        });
    });
  }

  /** Catches a phone page that pans or zooms under a finger instead of turning the set, or that goes into the monitor anyway. */
  test('a finger turns the set on a phone, and the room then stays out of the monitor', async ({ page }) => {
    await steadyFrames(page);
    await page.goto('/');
    // The room has started its arrival (polled on a timer: a slow phone page draws too few frames to poll on them).
    await page.waitForFunction(() => window.__room?.startedAt != null, null, { timeout: 120_000, polling: 100 });
    // Touches through the browser's input pipeline, so touch-action and pointer events are what a phone gets.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: 420 }] });
    await touch('touchStart', 100);
    for (let x = 110; x <= 220; x += 10) await touch('touchMove', x);
    await touch('touchEnd');
    await expect.poll(async () => (await room(page)).destination).toBe('orbit');
    expect(await page.evaluate(() => scrollX + scrollY)).toBe(0);
    // Past the moment the arrival would have flown into the monitor by itself.
    await page.waitForTimeout(3000);
    expect(await room(page)).toMatchObject({ phase: 'orbit', destination: 'orbit' });
    await expect(page.locator('html')).not.toHaveClass(/room-os/);
  });

  /** Catches a phone's BIOS screen asking for a key it has not got, or offering to skip to a room that is not ready. */
  test('on a phone the BIOS screen offers a tap for sound and nothing to skip', async ({ page }) => {
    await page.goto('/');
    const boot = page.locator('[data-boot]');
    await expect(boot).toBeVisible();
    await expect(boot.getByRole('progressbar', { name: 'Loading the room' })).toBeAttached();
    await expect(boot.getByText('Tap for sound')).toBeVisible();
    await expect(boot.getByText('Press any key for sound')).toBeHidden();
    expect(await boot.innerText()).not.toMatch(/skip/i);
  });

  /** Catches an address on a phone that loses its window on the way into the monitor. */
  test('a phone opening /about ends on About in SaahilOS', async ({ page }) => {
    await page.goto('/about');
    await page.waitForFunction(() => /room-os|room-2d/.test(document.documentElement.className), null, { timeout: 120_000 });
    await expect(page.frameLocator('[data-monitor-glass] iframe').getByRole('dialog', { name: 'About' })).toBeVisible();
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
