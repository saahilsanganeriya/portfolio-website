import { readdirSync, readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

const phrases: string[] = JSON.parse(readFileSync(new URL('../src/content/sticky-notes.json', import.meta.url), 'utf8'));
// The photography set in its order, read from its YAML so a new set moves the darkroom's test with it.
const PHOTOS_DIR = new URL('../src/content/photography/', import.meta.url);
const SET = readdirSync(PHOTOS_DIR)
  .filter((file) => /^[^_].*\.ya?ml$/.test(file))
  .map((file) => {
    const yaml = readFileSync(new URL(file, PHOTOS_DIR), 'utf8');
    const field = (key: string) => JSON.parse(yaml.match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1] ?? 'null');
    return { slug: file.replace(/\.ya?ml$/, ''), sharpie: String(field('sharpie')), order: Number(field('order') ?? 1e9) };
  })
  .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

// The props a visitor clicks in room v3 (BRIEF-ROUND-7 §4): the espresso machine pours a cup, the oven opens on a
// croissant, the lava lamp changes colour, the projector runs on the wall; the sticky notes carry his phrases and the
// darkroom line his photographs. Each describe loads the room once and its tests run in order on that page. Props are
// clicked where the room projects them on screen.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS } });

type World = NonNullable<Window['__room']>['world'];
const world = (page: Page): Promise<World> => page.evaluate(() => window.__room!.world);

const shaderErrors = new WeakMap<Page, string[]>();

async function openRoom(browser: Browser, reducedMotion: 'reduce' | 'no-preference') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion });
  const errors: string[] = [];
  shaderErrors.set(page, errors);
  page.on('console', (message) => /Shader Error|VALIDATE_STATUS false/.test(message.text()) && errors.push(message.text().slice(0, 300)));
  await page.goto('/');
  await page.waitForFunction(() => window.__room?.landedAt != null, null, { timeout: 200_000 });
  await page.waitForFunction(() => window.__room!.world.interactive, null, { timeout: 10_000 });
  await page.evaluate(() => {
    const audio = window.__room!.audio as unknown as { sfx(name: string, at?: unknown): void };
    const heard: string[] = [];
    (window as unknown as { __sounds: string[] }).__sounds = heard;
    const sfx = audio.sfx.bind(audio);
    audio.sfx = (name, at) => {
      heard.push(name);
      sfx(name, at);
    };
  });
  return page;
}

const sounds = (page: Page) => page.evaluate(() => (window as unknown as { __sounds: string[] }).__sounds);

/** The camera rests at that framing and a frame has been drawn there. */
async function settledAt(page: Page, phase: string) {
  await page.waitForFunction((p) => window.__room?.phase === p && !window.__room.moving, phase, { timeout: 30_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function fromIdle(page: Page) {
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
}

async function clickProp(page: Page, name: string) {
  const point = await page.evaluate((n) => window.__room!.point(n), name);
  expect(point, `${name} is on screen`).not.toBeNull();
  // Once the monitor's frame has moved off the prop (it follows the camera a frame late).
  await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point!)).not.toBe('IFRAME');
  await page.mouse.click(point!.x, point!.y);
}

test.describe('room v3 interactions', () => {
  // One room for the whole group, its tests in order: a failure skips the rest of this group only.
  test.describe.configure({ mode: 'serial', timeout: 300_000 });
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await openRoom(browser, 'no-preference');
  });
  test.afterAll(async () => page.close());

  /** Catches an espresso click that only steams (the old shot), a cup that fills at once, or a pour with no recording. */
  test('the espresso machine pours a cup over a few seconds, with its recorded pour', async () => {
    await fromIdle(page);
    await clickProp(page, 'hit_espresso');
    await settledAt(page, 'espresso');
    await expect.poll(async () => (await world(page)).espresso?.phase, { timeout: 10_000 }).toBe('pouring');
    // Part way through, the stream runs and the cup is neither empty nor full.
    await expect
      .poll(async () => {
        const espresso = (await world(page)).espresso!;
        return espresso.streaming && espresso.level > 0.05 && espresso.level < 0.95;
      }, { timeout: 8_000, intervals: [100] })
      .toBe(true);
    await expect.poll(async () => (await world(page)).espresso, { timeout: 15_000 }).toMatchObject({ phase: 'full', level: 1, streaming: false });
    expect((await world(page)).steam?.brewing).toBe(true);
    expect(await sounds(page)).toContain('espresso-pour');
  });

  /** Catches a door that does not open to the room's angle, a croissant that cannot be clicked, or a door left open. */
  test('the oven door swings open on a croissant that opens the Kitchen, and shuts on the next click', async () => {
    await fromIdle(page);
    await clickProp(page, 'hit_oven');
    await settledAt(page, 'oven');
    await expect.poll(async () => (await world(page)).oven, { timeout: 10_000 }).toMatchObject({ open: true, doorDeg: 82, croissantActive: true });
    expect((await world(page)).oven!.glow).toBeGreaterThan(1.3);
    await clickProp(page, 'hit_oven');
    await expect.poll(async () => (await world(page)).oven, { timeout: 10_000 }).toMatchObject({ open: false, doorDeg: 0, croissantActive: false });
    expect(await sounds(page)).toEqual(expect.arrayContaining(['oven-open', 'oven-close']));
    // Open again: the croissant leads to the recipes.
    await clickProp(page, 'hit_oven');
    await expect.poll(async () => (await world(page)).oven?.croissantActive, { timeout: 10_000 }).toBe(true);
    await clickProp(page, 'hit_croissant');
    await settledAt(page, 'monitor');
    await expect(page.frameLocator('.room-monitor iframe').getByRole('dialog', { name: 'Kitchen' })).toBeVisible();
  });

  /** Catches a lamp that jumps between colours, stops at one, or leaves the room's light as it was. */
  test('the lava lamp blends to its next colour set and tints the light around it', async () => {
    await fromIdle(page);
    const before = (await world(page)).lava!;
    await clickProp(page, 'hit_lava_lamp');
    await expect.poll(async () => (await world(page)).lava!.index, { timeout: 5_000 }).toBe((before.index + 1) % 4);
    // The blend takes over a second: one probe catches it part way.
    await expect.poll(async () => (await world(page)).lava!.blend, { timeout: 3_000, intervals: [50] }).toBeLessThan(1);
    await expect.poll(async () => (await world(page)).lava!.blend, { timeout: 5_000 }).toBe(1);
    expect((await world(page)).lava!.tint).not.toEqual(before.tint);
    expect(await sounds(page)).toContain('lava');
  });

  /** Catches a projector that only flies there, plays nothing, plays silently, or cannot be stopped. */
  test('the projector runs the film on the wall with its sound, and a click on the picture stops it', async () => {
    await fromIdle(page);
    await clickProp(page, 'hit_projector');
    await settledAt(page, 'projector');
    await expect.poll(async () => (await world(page)).projector, { timeout: 15_000 }).toMatchObject({ program: 'story', state: 'playing', running: true, inView: true });
    const t0 = (await world(page)).projector!.time;
    await expect.poll(async () => (await world(page)).projector!.time, { timeout: 5_000 }).toBeGreaterThan(t0);
    expect(await page.evaluate(() => window.__room!.audio.graph().projectorRunning)).toBe(true);
    expect(await sounds(page)).toContain('projector-clack');
    // From its framing the projector is behind the camera: a click on the picture stops it.
    await clickProp(page, 'hit_projection');
    await expect.poll(async () => (await world(page)).projector?.running, { timeout: 5_000 }).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__room!.audio.graph().projectorRunning)).toBe(false);
  });

  /** Catches the dial losing the Photographs program, or turning to it without running it. */
  test('the projector’s dial turns to his photographs and runs them', async () => {
    await fromIdle(page);
    await clickProp(page, 'hit_projector_dial');
    await expect.poll(async () => (await world(page)).projector, { timeout: 15_000 }).toMatchObject({ program: 'photographs', running: true });
    expect((await world(page)).projector!.photo).toBe('diner');
  });

  /** Catches notes without his phrases, phrases in the wrong order, or a note that does not answer the pointer. */
  test('the sticky notes carry his phrases, and a note lifts under the pointer', async () => {
    expect((await world(page)).stickies).toEqual(phrases);
    await page.evaluate(() => window.__room!.goto('desk'));
    await settledAt(page, 'desk');
    // The desk's free look turns the view toward the pointer, so the note moves: follow it until the view settles on it.
    for (let i = 0; i < 6; i++) {
      const point = await page.evaluate(() => window.__room!.point('hit_sticky_note_3'));
      await page.mouse.move(point!.x, point!.y);
      await page.waitForTimeout(400);
      if ((await page.evaluate(() => window.__room!.lift('hit_sticky_note_3'))) > 0) break;
    }
    await expect.poll(() => page.evaluate(() => window.__room!.lift('hit_sticky_note_3')), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.locator('.room-label')).toHaveText(phrases[3]);
  });

  /**
   * Catches prints off the set's order or Chinatown off the hero clip, a hero no bigger than the rest, a hover label that
   * is not his marker line, and a print that opens no photograph.
   */
  test('the darkroom hangs the set in its order with Chinatown biggest, and a print opens its photograph', async () => {
    await page.evaluate(() => window.__room!.goto('photos'));
    await settledAt(page, 'photos');
    await expect.poll(async () => (await world(page)).darkroom!.prints.every((p) => p.shown === 1), { timeout: 30_000 }).toBe(true);
    const { prints, light } = (await world(page)).darkroom!;
    expect(light).toBe('wall-bake');
    expect(prints.map((p) => p.slug)).toEqual(SET.slice(0, prints.length).map((p) => p.slug));
    expect(prints[0]).toMatchObject({ hero: true, slug: 'chinatown-bus', caption: SET[0].sharpie });
    const area = ({ paper: [w, h] }: { paper: number[] }) => w * h;
    expect(Math.max(...prints.slice(1).map(area))).toBeLessThan(area(prints[0]));
    const point = await page.evaluate(() => window.__room!.point('hit_darkroom_print_3'));
    await page.mouse.move(point!.x, point!.y);
    await expect(page.locator('.room-label')).toHaveText(SET[3].sharpie);
    await clickProp(page, 'hit_darkroom_print_0');
    await settledAt(page, 'monitor');
    await expect
      .poll(() => page.evaluate(() => (document.querySelector('.room-monitor iframe') as HTMLIFrameElement).contentWindow!.location.hash))
      .toContain(`photography/${SET[0].slug}`);
  });

  /** Catches a room shader that fails to compile (the projector's picture went black on a redefined variable). */
  test('every shader the interactions used compiled', async () => {
    expect(shaderErrors.get(page)).toEqual([]);
  });
});

test.describe('room v3 interactions with reduced motion', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await openRoom(browser, 'reduce');
  });
  test.afterAll(async () => page.close());

  /** Catches a reduced-motion visitor watching a pour instead of getting the poured cup. */
  test('the espresso cup is full at once, with no stream', async () => {
    await fromIdle(page);
    await clickProp(page, 'hit_espresso');
    await settledAt(page, 'espresso');
    await expect.poll(async () => (await world(page)).espresso, { timeout: 5_000 }).toMatchObject({ phase: 'full', level: 1, streaming: false });
    expect(await sounds(page)).toContain('espresso-pour');
  });

  /** Catches the oven door swinging for a reduced-motion visitor. */
  test('the oven door is open at once', async () => {
    await fromIdle(page);
    await clickProp(page, 'hit_oven');
    await settledAt(page, 'oven');
    // The first probe after the click already has the door at its stop: no frames in between.
    await expect.poll(async () => (await world(page)).oven?.open, { timeout: 5_000 }).toBe(true);
    expect((await world(page)).oven!.doorDeg).toBe(82);
  });

  /** Catches the lamp's colours blending for a reduced-motion visitor. */
  test('the lava lamp changes colour at once', async () => {
    await fromIdle(page);
    await clickProp(page, 'hit_lava_lamp');
    await expect.poll(async () => (await world(page)).lava!.index, { timeout: 5_000 }).toBe(1);
    expect((await world(page)).lava!.blend).toBe(1);
  });

  /** Catches prints fading in (or swaying) for a reduced-motion visitor instead of hanging there, still, once drawn. */
  test('the darkroom’s prints appear at once and hold still', async () => {
    await page.evaluate(() => window.__room!.goto('photos'));
    await settledAt(page, 'photos');
    await expect.poll(async () => (await world(page)).darkroom!.prints.every((p) => p.size !== null), { timeout: 30_000 }).toBe(true);
    const darkroom = (await world(page)).darkroom!;
    expect(darkroom.prints.map((p) => p.shown)).toEqual(darkroom.prints.map(() => 1));
    expect(darkroom.swaying).toBe(false);
  });

  /** Catches the film refusing to run when a reduced-motion visitor asks for it. */
  test('the projector still runs the film the visitor asked for', async () => {
    await fromIdle(page);
    await clickProp(page, 'hit_projector');
    await settledAt(page, 'projector');
    await expect.poll(async () => (await world(page)).projector, { timeout: 15_000 }).toMatchObject({ state: 'playing', running: true });
  });
});
