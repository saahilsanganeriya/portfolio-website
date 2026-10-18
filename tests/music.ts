import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';
import { powerCurve } from '../src/scene/audio/state';

// The music's first-gesture checks, run in Chromium (audio.spec.ts) and in WebKit (audio-webkit.spec.ts).

/**
 * Safari's rule, in every browser: a context made outside a press or key starts suspended, and resume() counts only
 * when called inside the handler of a press or key, in any same-origin frame (a message posted on from a frame arrives
 * too late). Init scripts run in every frame before the page's own, so these listeners see each gesture first.
 */
export function strictAutoplay() {
  const top = window.top as Window & { inGesture?: boolean };
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'touchstart', 'touchend', 'keydown']) {
    window.addEventListener(
      type,
      () => {
        top.inGesture = true;
        setTimeout(() => (top.inGesture = false), 0);
      },
      { capture: true },
    );
  }
  if (window !== top) return;
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(options?: AudioContextOptions) {
      super(options);
      if (!top.inGesture) void super.suspend();
    }
    resume() {
      return top.inGesture ? super.resume() : new Promise<void>(() => {});
    }
  };
}

const graph = (page: Page) => page.evaluate(() => window.__room!.audio!.graph());
// The same sound from the moment it is made, while the room still loads (window.__room comes once it has loaded).
const soundGraph = (page: Page) => page.evaluate(() => window.__roomAudio?.graph() ?? null);
const os = (page: Page) => page.frameLocator('.room-monitor iframe');
const FIRST_FADE_S = 1.5;
const curve = powerCurve(0, 1);
/** The master's level `t` seconds into the first fade (at 100 % volume), read off the curve the room schedules. */
const fadeAt = (t: number) => curve[Math.min(curve.length - 1, Math.max(0, Math.round((t / FIRST_FADE_S) * (curve.length - 1))))];

/** The arrival has ended at the monitor; then the camera goes back to the desk, where the room is visible around it. */
export async function arrived(page: Page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 120_000 });
  await page.evaluate(() => window.__room!.goto('desk'));
  await page.waitForFunction(() => window.__room?.phase === 'desk' && !window.__room.moving, null, { timeout: 30_000 });
}

/** Asserts the sound has started and is fading up from silence along the first fade, then reaches full level. */
async function fadesUpFromSilence(page: Page) {
  const first = (await (
    await page.waitForFunction(() => {
      const g = window.__roomAudio?.graph() as { context: string; master: number | null; time?: number } | undefined;
      return g?.context === 'running' ? { master: g.master ?? 0, time: g.time ?? 0 } : null;
    }, null, { timeout: 15_000 })
  ).jsonValue())!;
  // The fade starts when the sound is made, at the context's time 0 when a press makes both, later when the sound takes
  // over a context a press made before it (so the fade is then at most this far in).
  expect(first.master, `the master at ${first.time.toFixed(2)} s into the fade`).toBeLessThanOrEqual(fadeAt(first.time + 0.15) + 0.02);
  await page.waitForFunction((from) => ((window.__roomAudio?.graph() as { time?: number } | undefined)?.time ?? 0) > from + 1.6, first.time, { timeout: 30_000 });
  expect((await soundGraph(page))!.master).toBeGreaterThan(0.99);
}

/** Holds back the responses matching `url` until released; resolves `requested` once the page has asked for one. */
async function holdBack(page: Page, url: string) {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  let requested = () => {};
  const asked = new Promise<void>((resolve) => (requested = resolve));
  await page.route(url, async (route) => {
    requested();
    await released;
    await route.continue();
  });
  return { requested: asked, release };
}

/** The places a first press must start the music from, each a different path to the sound. */
const FIRST_PRESSES: Record<string, { path: string; press(page: Page): Promise<void> }> = {
  'on the room': { path: '/', press: (page) => page.mouse.click(720, 880) },
  // The HUD's own button (its name and role lines let presses through to the room).
  'on the HUD': { path: '/', press: (page) => page.locator('[data-tour-open]').click() },
  'inside SaahilOS on the monitor': { path: '/about', press: (page) => os(page).getByRole('dialog', { name: 'About' }).click() },
  'at the start of a drag': {
    path: '/',
    async press(page) {
      await page.mouse.move(300, 450);
      await page.mouse.down();
      // Started by the press itself, before the drag has moved anything.
      await expect.poll(async () => (await graph(page)).context, { timeout: 15_000 }).toBe('running');
      for (let x = 310; x <= 400; x += 10) await page.mouse.move(x, 450);
      await page.mouse.up();
    },
  },
};

export function musicTests() {
  /**
   * Catches a Sound button that claims sound plays while the browser holds it back (or the reverse), a waiting room
   * with no hint that it has sound, and a status line that promises music the browser blocked.
   */
  test('before any gesture the music waits for one, and the Sound button and the status say so', async ({ page }) => {
    await page.addInitScript(strictAutoplay);
    await arrived(page);
    const sound = page.getByRole('button', { name: 'Sound' });
    expect((await graph(page)).context).not.toBe('running');
    expect((await graph(page)).master).toBe(0);
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await expect(sound).toHaveAttribute('data-hint', '');
    await expect(sound).toHaveAttribute('title', 'Sound starts with your first click or key press');
    await expect(page.locator('[data-room-status]')).toHaveText(/Music starts with your first click or key press/);

    await page.keyboard.press('KeyA');
    await expect.poll(async () => (await graph(page)).context, { timeout: 15_000 }).toBe('running');
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    await expect(sound).toHaveAttribute('title', 'Sound is on');
    await expect(sound).not.toHaveAttribute('data-hint');
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await expect(sound).toHaveAttribute('title', 'Sound is off');
  });

  for (const [where, { path, press }] of Object.entries(FIRST_PRESSES)) {
    /** Catches a first press there that never reaches the sound, and a start at full level instead of the fade. */
    test(`a first press ${where} starts the music, fading up from silence`, async ({ page }) => {
      await page.addInitScript(strictAutoplay);
      await arrived(page, path);
      expect((await graph(page)).context).not.toBe('running');
      await press(page);
      await fadesUpFromSilence(page);
    });
  }

  /**
   * Catches a key on the BIOS screen that starts nothing (the music waited for the room), one that starts the sound at
   * full level instead of the fade, and one that shows the room before its atlases are on the GPU.
   */
  test('a key on the BIOS screen starts the music, fading up from silence, and the room still waits for its atlases', async ({ page }) => {
    await page.addInitScript(strictAutoplay);
    const desk = await holdBack(page, '**/room/atlas/desk.*');
    await page.goto('/');
    const boot = page.locator('[data-boot]');
    // The room's sound is made once room.glb has loaded; the desk atlas is still on its way.
    await page.waitForFunction(() => window.__roomAudio != null, null, { timeout: 60_000 });
    await desk.requested;
    await expect(boot.getByText('Press any key for sound')).toBeVisible();
    expect((await soundGraph(page))!.context).not.toBe('running');
    await page.keyboard.press('KeyA');
    await fadesUpFromSilence(page);
    await expect(boot.getByText('Sound on')).toBeVisible();
    // The music has run its whole fade and the room has not been shown: the press asked for sound, not for the room.
    await expect(boot).toBeVisible();
    expect(await page.evaluate(() => window.__room?.startedAt ?? null)).toBeNull();
    desk.release();
    await page.waitForFunction(() => window.__room?.startedAt != null, null, { timeout: 120_000 });
    const atlases = await page.evaluate(() => window.__roomStats!.atlases);
    for (const atlas of atlases) expect(atlas, `${atlas.name} full before the first visible frame`).toMatchObject({ state: 'full', beforeFirstFrame: true });
    await expect(page.locator('[data-room-status]')).toHaveText(/Music is on/);
    await expect(page.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * Catches a press that comes before the room's sound exists (room.glb still loading) being lost, as Safari loses a
   * gesture's permission outside its own handler, and a second sound context made beside the one that press started.
   */
  test('a key before room.glb has loaded is not lost: the music starts once the room’s sound is made', async ({ page }) => {
    await page.addInitScript(strictAutoplay);
    await page.addInitScript(() => {
      if (window !== window.top) return;
      const Native = window.AudioContext;
      const made = { count: 0 };
      (window as unknown as { contextsMade: typeof made }).contextsMade = made;
      window.AudioContext = class extends Native {
        constructor(options?: AudioContextOptions) {
          super(options);
          made.count++;
        }
      };
    });
    const room = await holdBack(page, '**/room/room.glb');
    await page.goto('/');
    const boot = page.locator('[data-boot]');
    await room.requested;
    await page.keyboard.press('KeyA');
    await expect(boot.getByText('Sound on')).toBeVisible();
    expect(await page.evaluate(() => window.__roomAudio ?? null), 'the room’s sound is not made yet').toBeNull();
    room.release();
    await fadesUpFromSilence(page);
    expect(await page.evaluate(() => (window as unknown as { contextsMade: { count: number } }).contextsMade.count)).toBe(1);
  });

  /** Catches a volume or mute that resets on the next visit, and a remembered mute that autoplay or a first input overrides. */
  test('volume and mute are remembered; a remembered mute stays off until Sound is pressed', async ({ page }) => {
    await page.addInitScript(strictAutoplay);
    await arrived(page);
    const volume = page.getByRole('slider', { name: 'Volume' });
    const sound = page.getByRole('button', { name: 'Sound' });
    await page.keyboard.press('KeyA');
    await expect.poll(async () => (await graph(page)).context, { timeout: 15_000 }).toBe('running');
    await volume.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await expect(volume).toHaveValue('80');
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    expect(await graph(page)).toMatchObject({ volume: 0.8, muted: true });

    await page.reload();
    await arrived(page);
    await expect(volume).toHaveValue('80');
    // A visitor who turned the sound off is not nagged by the glow, and neither a key nor a click turns it back on.
    await expect(sound).not.toHaveAttribute('data-hint');
    await expect(page.locator('[data-room-status]')).toHaveText(/sound is off, as you left it/i);
    await page.keyboard.press('KeyA');
    await page.mouse.click(720, 880);
    expect(await graph(page)).toMatchObject({ context: 'none', muted: true, volume: 0.8 });
    await expect(sound).toHaveAttribute('aria-pressed', 'false');

    await sound.click();
    await expect.poll(async () => (await graph(page)).context, { timeout: 15_000 }).toBe('running');
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    expect(await graph(page)).toMatchObject({ muted: false, volume: 0.8 });
    // The slider is a loudness control: the master gain is its square.
    await expect.poll(async () => (await graph(page)).master, { timeout: 15_000 }).toBeCloseTo(0.64, 2);
  });
}
