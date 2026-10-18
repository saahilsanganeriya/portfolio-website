import { devices, expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// How drag, scroll and pinch feel (brief round 9 §1.5): a flick coasts and eases out, a press stops it; the tilt and
// zoom limits give a little and spring back; one zoom speed for every wheel; the platform's own directions; a pinch
// zooms the room and never the page. The wheel at the monitor (it scrolls the OS) is navigation.spec's; Safari's pinch
// gestures are pinch-webkit.spec's.

// Headless Chromium only has WebGL through SwiftShader; the room needs it.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const orbit = (page: Page) => page.evaluate(() => window.__room!.orbit);
const destination = (page: Page) => page.evaluate(() => window.__room!.destination);

async function settledAt(page: Page, station: string, timeout = 30_000) {
  await page.waitForFunction((s) => window.__room?.phase === s && !window.__room.moving, station, { timeout });
}

async function inRoom(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
}

const orbitRests = (page: Page) => page.waitForFunction(() => window.__room!.orbit !== null && !window.__room!.moving, null, { timeout: 30_000 });

/** Samples the orbit every frame from now on; `stop` returns the samples. */
async function sampleOrbit(page: Page) {
  await page.evaluate(() => {
    const samples: { t: number; azimuth: number; polar: number; radius: number; turning: number }[] = [];
    (window as unknown as { samples: typeof samples }).samples = samples;
    const sample = () => {
      const o = window.__room!.orbit;
      if (o) samples.push({ t: performance.now(), azimuth: o.azimuth, polar: o.polar, radius: o.radius, turning: o.turning });
      requestAnimationFrame(sample);
    };
    sample();
  });
  return () =>
    page.evaluate(() => (window as unknown as { samples: { t: number; azimuth: number; polar: number; radius: number; turning: number }[] }).samples.slice());
}

/**
 * A flick: a press, eight moves 60 px apart and the let-go, dispatched in the page in one go, as a hand's flick arrives
 * (Playwright's own moves come more than 80 ms apart on a loaded machine, which the room rightly reads as a slow drag).
 * Pointer 1 is the mouse's, so the stage's pointer capture takes it.
 */
const flick = (page: Page) =>
  page.evaluate(() => {
    const stage = document.querySelector('[data-room-world]')!;
    const fire = (type: string, x: number) =>
      stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: 500 }));
    fire('pointerdown', 900);
    for (let x = 840; x >= 420; x -= 60) fire('pointermove', x);
    fire('pointerup', 420);
  });

/** Wheel events as a browser would send them, on the room's stage (deltaMode 1 = lines, which Playwright cannot send). */
const wheelOnStage = (page: Page, events: { deltaX?: number; deltaY: number; deltaMode?: number; ctrlKey?: boolean }[]) =>
  page.evaluate(async (list) => {
    const stage = document.querySelector('[data-room-world]')!;
    for (const init of list) {
      stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 720, clientY: 520, ...init }));
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  }, events);

test.describe('in Chromium', () => {
  /**
   * Catches a let-go that stops dead (no inertia), a coast that speeds up again, wobbles or never ends, and a press
   * that does not stop it.
   */
  test('after a flick the set keeps turning, slows without ever speeding up, and stops; a press stops it at once', async ({ page }) => {
    await inRoom(page);
    const stop = await sampleOrbit(page);
    await flick(page);
    const releasedAt = await page.evaluate(() => performance.now());
    const letGo = (await orbit(page))!;
    await page.waitForFunction(() => window.__room!.orbit?.turning === 0, null, { timeout: 30_000 });
    const samples = await stop();
    const after = samples.filter((s) => s.t >= releasedAt);
    expect(after.at(-1)!.azimuth - letGo.azimuth, 'the set kept turning after the let-go').toBeGreaterThan(0.05);
    const moving = after.filter((s) => s.turning > 0);
    expect(moving.length, 'frames of the coast').toBeGreaterThan(3);
    after.slice(1).forEach((s, i) => expect(s.turning, `frame ${i + 1} of the coast`).toBeLessThanOrEqual(after[i].turning + 1e-9));
    expect(after.at(-1)!.turning).toBe(0);

    // A second flick, then a press: the coast stops where it is.
    await flick(page);
    await expect.poll(async () => (await orbit(page))!.turning).toBeGreaterThan(0.1);
    await page.mouse.down();
    expect((await orbit(page))!.turning, 'stopped by the press').toBe(0);
    const held = (await orbit(page))!.azimuth;
    await page.waitForTimeout(400);
    // Still (the pivot's last glide to the set's centre may move it a few hundred-thousandths of a radian).
    expect((await orbit(page))!.azimuth).toBeCloseTo(held, 3);
    await page.mouse.up();
  });

  /** Catches a zoom limit that stops dead, gives without end, or stays stretched once the wheel stops. */
  test('the wheel pushed past the near and far limits gives a little, then springs back inside', async ({ page }) => {
    await inRoom(page);
    const { minDist, maxDist } = await page.evaluate(() => window.__room!.orbitSettings.limits);
    await page.mouse.move(720, 520);
    await page.mouse.wheel(0, -100);
    await orbitRests(page);
    for (const [delta, limit] of [
      [-200, minDist],
      [200, maxDist],
    ] as const) {
      const stop = await sampleOrbit(page);
      // A wheel kept turning for about a second, as a hand does.
      for (let i = 0; i < 40; i++) {
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(25);
      }
      await page.waitForFunction(() => !window.__room!.moving, null, { timeout: 30_000 });
      const radii = (await stop()).map((s) => s.radius);
      const end = (await orbit(page))!.radius;
      const far = delta < 0 ? Math.min(...radii) : Math.max(...radii);
      test.info().annotations.push({ type: `limit ${limit}`, description: `furthest ${far.toFixed(0)}, settled ${end.toFixed(0)}` });
      expect(Math.abs(far - limit), 'it went past the limit').toBeGreaterThan(limit * 0.01);
      expect(Math.abs(far - limit), 'by a little').toBeLessThan(limit * 0.11);
      expect(Math.abs(end - limit), 'and settled back on it').toBeLessThan(1);
    }
    expect(await destination(page)).toBe('orbit');
  });

  /**
   * Catches one wheel zooming at another's speed: a mouse notch in lines (Firefox, deltaMode 1), in pixels (Chromium)
   * and a trackpad's run of small pixel deltas covering the same distance must zoom the same.
   */
  test('a notch in lines, a notch in pixels and a trackpad’s small steps of the same size zoom the same', async ({ page }) => {
    await inRoom(page);
    const ways: Record<string, Parameters<typeof wheelOnStage>[1]> = {
      'pixels (Chromium)': Array.from({ length: 3 }, () => ({ deltaY: -100 })),
      'lines (Firefox)': Array.from({ length: 3 }, () => ({ deltaY: -3, deltaMode: 1 })),
      'trackpad (25 × 12 px)': Array.from({ length: 25 }, () => ({ deltaY: -12 })),
    };
    const ratios: Record<string, number> = {};
    for (const [name, events] of Object.entries(ways)) {
      await page.evaluate(() => window.__room!.goto('idle'));
      await settledAt(page, 'idle');
      // Into the orbit by one tiny step, from the wide view each time.
      await wheelOnStage(page, [{ deltaY: -5 }]);
      await orbitRests(page);
      const start = (await orbit(page))!.radius;
      await wheelOnStage(page, events);
      await orbitRests(page);
      ratios[name] = Math.log((await orbit(page))!.radius / start);
    }
    test.info().annotations.push({ type: 'ln(radius ratio)', description: JSON.stringify(ratios) });
    const [pixels, lines, trackpad] = Object.values(ratios);
    expect(pixels).toBeLessThan(-0.2);
    expect(Math.abs(lines / pixels - 1), 'lines vs pixels').toBeLessThan(0.02);
    expect(Math.abs(trackpad / pixels - 1), 'trackpad vs mouse').toBeLessThan(0.02);
  });

  /**
   * Catches a direction that is not the platform's: the set must follow a drag (its front swings with the pointer, its
   * back the other way, as a turntable under the hand), a sideways trackpad swipe must turn it the way the fingers go
   * (deltaX < 0 where content follows the fingers), and the wheel must zoom as the page would scroll (deltaY < 0 in).
   */
  test('the set follows a drag and a sideways swipe, and the wheel zooms as the page would scroll', async ({ page }) => {
    await inRoom(page);
    const point = (name: string) => page.evaluate((n) => window.__room!.point(n)!, name);
    // A first small turn takes the pivot to the set's centre, so what follows is the turn alone.
    await page.mouse.move(700, 600);
    await page.mouse.down();
    for (let x = 700; x >= 660; x -= 10) await page.mouse.move(x, 600);
    await page.waitForTimeout(200);
    await page.mouse.up();
    await orbitRests(page);
    const front = await point('hit_record_player');
    const back = await point('hit_pale_blue_dot');
    const dragFrom = (await orbit(page))!.azimuth;
    await page.mouse.move(700, 600);
    await page.mouse.down();
    for (let x = 700; x <= 800; x += 10) await page.mouse.move(x, 600);
    await page.waitForTimeout(200);
    await page.mouse.up();
    await orbitRests(page);
    expect((await point('hit_record_player')).x - front.x, 'the front of the set moved right with the pointer').toBeGreaterThan(5);
    expect((await point('hit_pale_blue_dot')).x - back.x, 'the back wall moved the other way').toBeLessThan(-2);

    // A swipe to the right on a trackpad (content following the fingers sends deltaX < 0): the same way as the drag.
    const before = (await orbit(page))!;
    expect(before.azimuth, 'the drag to the right lowered the azimuth').toBeLessThan(dragFrom);
    await wheelOnStage(page, Array.from({ length: 10 }, () => ({ deltaX: -12, deltaY: 1 })));
    await orbitRests(page);
    const swiped = (await orbit(page))!;
    expect(swiped.azimuth - before.azimuth, 'turned the drag’s way (the azimuth falls, as it did for the drag)').toBeLessThan(-0.05);
    expect(Math.abs(Math.log(swiped.radius / before.radius)), 'a sideways swipe does not zoom').toBeLessThan(0.01);

    // Up and down: deltaY < 0 (the wheel toward the screen, two fingers pulled down) moves in.
    await wheelOnStage(page, Array.from({ length: 4 }, () => ({ deltaY: -60 })));
    await orbitRests(page);
    const zoomed = (await orbit(page))!;
    expect(zoomed.radius).toBeLessThan(swiped.radius * 0.9);
    expect(Math.abs(zoomed.azimuth - swiped.azimuth), 'an upward scroll does not turn').toBeLessThan(0.01);
  });

  /**
   * Catches a trackpad pinch (Chromium and Firefox send a wheel with Control held) that zooms the page instead of the
   * room, that zooms the wrong way, that the page controls let through, and one at the monitor that zooms the page or
   * pulls the camera in through the glass.
   */
  test('a trackpad pinch zooms the room, never the page, over the room, its controls and the OS on the monitor', async ({ page }) => {
    await page.goto('/about');
    await settledAt(page, 'monitor', 120_000);
    // Every wheel's fate, seen after the room's handlers, in the page and inside the OS's frame.
    const watch = `window.__wheels = []; addEventListener('wheel', (e) => window.__wheels.push({ ctrl: e.ctrlKey, prevented: e.defaultPrevented }));`;
    await page.evaluate(watch);
    const frame = page.frame({ url: /\/os/ })!;
    await frame.evaluate(watch);
    const wheels = async (where: Page | typeof frame) => where.evaluate(() => (window as unknown as { __wheels: { ctrl: boolean; prevented: boolean }[] }).__wheels.splice(0));

    // At the monitor, over the OS: spreading the fingers (deltaY < 0) does nothing; pinching in (deltaY > 0) leaves the glass.
    await page.mouse.move(720, 450);
    await page.keyboard.down('Control');
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -6);
    await page.waitForTimeout(300);
    expect(await destination(page)).toBe('monitor');
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 8);
    await expect.poll(() => destination(page)).toBe('orbit');
    const inFrame = await wheels(frame);
    expect(inFrame.length, 'the pinch reached the OS’s frame').toBeGreaterThan(0);
    expect(inFrame.every((w) => w.ctrl && w.prevented), 'and the page never zoomed from it').toBe(true);

    // Over the room, from the wide view: in and out, the room's way round.
    await page.keyboard.up('Control');
    await page.evaluate(() => window.__room!.goto('idle'));
    await settledAt(page, 'idle');
    await page.mouse.move(720, 600);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 1);
    await orbitRests(page);
    const start = (await orbit(page))!.radius;
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -8);
    await orbitRests(page);
    const pinchedOut = (await orbit(page))!.radius;
    expect(pinchedOut, 'fingers apart: in').toBeLessThan(start * 0.8);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 8);
    await orbitRests(page);
    expect((await orbit(page))!.radius, 'fingers together: out').toBeGreaterThan(pinchedOut * 1.25);

    // Over the page's own controls (the Home button) too.
    const home = (await page.getByRole('button', { name: 'Home', exact: true }).boundingBox())!;
    await page.mouse.move(home.x + home.width / 2, home.y + home.height / 2);
    const overButton = (await orbit(page))!.radius;
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -8);
    await page.keyboard.up('Control');
    await orbitRests(page);
    expect((await orbit(page))!.radius).toBeLessThan(overButton * 0.9);
    const inPage = await wheels(page);
    expect(inPage.length).toBeGreaterThan(0);
    expect(inPage.every((w) => w.ctrl && w.prevented), 'no pinch reached the browser’s zoom').toBe(true);
    expect(await page.evaluate(() => [visualViewport!.scale, devicePixelRatio])).toEqual([1, 1]);
  });
});

test.describe('on a phone', () => {
  const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
  test.use(iPhone13);

  /** Catches two fingers on a phone that pan or zoom the page, or zoom the room the wrong way, instead of pinching the room. */
  test('two fingers spreading on a phone zoom the room in, and the page stays put', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => /room-os|room-2d/.test(document.documentElement.className), null, { timeout: 120_000, polling: 250 });
    test.skip((await page.locator('html.room-2d').count()) > 0, 'this machine is too slow for the light room: the drawn monitor took over');
    await page.getByRole('button', { name: 'Back to the room' }).tap();
    await settledAt(page, 'idle');
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', spread?: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: spread === undefined ? [] : [{ x: 195 - spread, y: 400, id: 1 }, { x: 195 + spread, y: 400, id: 2 }],
      });
    // The fingers 80 px apart, then 92 (past the 6 px a drag needs), then 280: about three times as far apart.
    await touch('touchStart', 40);
    await touch('touchMove', 46);
    await expect.poll(() => destination(page)).toBe('orbit');
    const from = (await orbit(page))!.radius;
    for (let spread = 56; spread <= 140; spread += 12) await touch('touchMove', spread);
    await touch('touchEnd');
    await page.waitForFunction(() => !window.__room!.moving, null, { timeout: 30_000, polling: 250 });
    const to = (await orbit(page))!.radius;
    test.info().annotations.push({ type: 'pinch', description: `${from.toFixed(0)} → ${to.toFixed(0)}` });
    expect(to / from, 'the room came about three times nearer').toBeLessThan(0.45);
    expect(to / from).toBeGreaterThan(0.25);
    expect(await page.evaluate(() => [scrollX + scrollY, visualViewport!.scale])).toEqual([0, 1]);
  });
});
