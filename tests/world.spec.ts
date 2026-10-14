import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// The living room (PLAN 11.1, 12.1): the window by each city's clock, the album, the projector's programs, and what
// every hotspot does. Props are clicked where the room projects them on screen.
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: WEBGL_ARGS }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

const os = (page: Page) => page.frameLocator('.room-monitor iframe');
const world = (page: Page) => page.evaluate(() => window.__room!.world);

/** The room after the arrival, stepped back from the desk to the wide view, where every prop is in sight. */
async function inRoom(page: Page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() => window.__room?.phase === 'desk' && !window.__room.moving, null, { timeout: 150_000 });
  await page.waitForFunction(() => window.__room!.world.interactive, null, { timeout: 10_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
}

/**
 * The camera rests at that framing and a frame has been drawn there: a cut (reduced motion) lands at once, but the
 * monitor's CSS layer follows on the next frame, and a click before it would land on the old screen.
 */
async function settledAt(page: Page, phase: string, timeout = 20_000) {
  await page.waitForFunction((p) => window.__room?.phase === p && !window.__room.moving, phase, { timeout });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function clickProp(page: Page, name: string) {
  const point = await page.evaluate((n) => window.__room!.point(n), name);
  expect(point, `${name} is on screen`).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

/** Records every recording the room asks the audio layer for (before the first input it plays none of them). */
async function listenForSounds(page: Page) {
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
}
const sounds = (page: Page) => page.evaluate(() => (window as unknown as { __sounds: string[] }).__sounds);

async function backToIdle(page: Page) {
  await page.evaluate(() => window.__room!.goto('idle'));
  await settledAt(page, 'idle');
}

/** Catches the window lit by the visitor's clock (or UTC) instead of each city's own day and night. */
test('each half of the window shows its own city’s day or night, by that city’s clock', async ({ page }) => {
  // 13:00 in San Francisco is 01:30 the next morning in Delhi.
  await page.clock.setFixedTime('2026-06-21T20:00:00Z');
  await inRoom(page);
  const noon = (await world(page)).window!;
  expect(noon.sf).toMatchObject({ local: '1:00 pm', night: 0 });
  expect(noon.delhi).toMatchObject({ local: '1:30 am', night: 1 });
  expect(noon.sf.loaded).toContain('day');
  expect(noon.delhi.loaded).toContain('night');
  const point = await page.evaluate(() => window.__room!.point('hit_window'));
  await page.mouse.move(point!.x, point!.y);
  await expect(page.locator('.room-label')).toHaveText('San Francisco 1:00 pm · Delhi 1:30 am');

  await page.clock.setFixedTime('2026-06-22T08:00:00Z');
  await page.reload();
  await page.waitForFunction(() => window.__room?.phase === 'desk' && !window.__room.moving, null, { timeout: 150_000 });
  const night = (await world(page)).window!;
  expect(night.sf).toMatchObject({ local: '1:00 am', night: 1 });
  expect(night.delhi).toMatchObject({ local: '1:30 pm', night: 0 });
});

/** Catches an album that does not open from the desk, does not page in both directions, or traps the visitor. */
test('the photo album opens from the desk, pages both ways, and closes with Escape or a click beside it', async ({ page }) => {
  await inRoom(page);
  await clickProp(page, 'hit_album');
  await page.waitForFunction(() => window.__room!.world.album?.state === 'open', null, { timeout: 30_000 });
  await settledAt(page, 'desk');
  let album = (await world(page)).album!;
  expect(album).toMatchObject({ spread: 0, left: 'endpaper', right: 'A Narrative in a Frame' });
  // The whole collection is in it, section by section: favourites first.
  expect(album.pages).toBeGreaterThan(20);
  await expect(page.locator('.room-label')).toBeHidden();

  await clickProp(page, 'album_right');
  await page.waitForFunction(() => window.__room!.world.album?.state === 'turning', null, { timeout: 5_000 });
  await page.waitForFunction(() => window.__room!.world.album?.state === 'open', null, { timeout: 10_000 });
  album = (await world(page)).album!;
  expect(album).toMatchObject({ spread: 1, left: 'Favourites' });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__room!.world.album?.spread === 2 && window.__room!.world.album.state === 'open', null, { timeout: 10_000 });
  await clickProp(page, 'album_left');
  await page.waitForFunction(() => window.__room!.world.album?.spread === 1 && window.__room!.world.album.state === 'open', null, { timeout: 10_000 });
  // Pages far from the open spread are let go: memory stays bounded however long the album is.
  expect((await world(page)).album!.cached).toBeLessThanOrEqual(8);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__room!.world.album?.state === 'closed', null, { timeout: 15_000 });
  // Esc closed the album; the camera stays at the desk and the room takes clicks again.
  expect(await page.evaluate(() => window.__room!.phase)).toBe('desk');

  await backToIdle(page);
  await clickProp(page, 'hit_album');
  await page.waitForFunction(() => window.__room!.world.album?.state === 'open', null, { timeout: 30_000 });
  await page.mouse.click(40, 450);
  await page.waitForFunction(() => window.__room!.world.album?.state === 'closed', null, { timeout: 15_000 });
});

/** Catches page turns that still animate for a visitor who asked for reduced motion. */
test('with reduced motion the album’s pages cut instead of turning', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await inRoom(page);
  await clickProp(page, 'hit_album');
  await page.waitForFunction(() => window.__room!.world.album?.state === 'open', null, { timeout: 30_000 });
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.__room!.world.album)).toMatchObject({ state: 'open', spread: 1 });
  expect((await world(page)).fan?.turnsPerSecond).toBe(0);
});

/** Catches a dial that does not change the program, or a screen that opens the wrong window for what it shows. */
test('the projector’s dial steps through The Reel, Photographs and Short films', async ({ page }) => {
  await inRoom(page);
  await listenForSounds(page);
  expect((await world(page)).projector?.program).toBe('reel');
  await clickProp(page, 'hit_projector_dial');
  await page.waitForFunction(() => window.__room!.world.projector?.program === 'photographs', null, { timeout: 5_000 });
  await page.waitForFunction(() => window.__room!.world.projector?.state === 'playing', null, { timeout: 30_000 });
  const photo = (await world(page)).projector!.photo;
  expect(photo).toBeTruthy();

  await backToIdle(page);
  await clickProp(page, 'hit_projector_dial');
  await page.waitForFunction(() => window.__room!.world.projector?.program === 'shorts', null, { timeout: 5_000 });
  await page.waitForFunction(() => window.__room!.world.projector?.state === 'playing', null, { timeout: 10_000 });

  await backToIdle(page);
  await clickProp(page, 'hit_projector_dial');
  await page.waitForFunction(() => window.__room!.world.projector?.program === 'reel', null, { timeout: 5_000 });
  expect((await sounds(page)).filter((name) => name === 'projector-clack')).toHaveLength(3);
});

/** Catches a prop that does nothing when clicked, opens the wrong window, or plays no sound (PLAN 11.1, 12.1). */
test('every new hotspot does what it says, with a sound where the room has its recording', async ({ page }) => {
  test.setTimeout(420_000);
  await inRoom(page);
  await listenForSounds(page);

  // Room actions that need no window.
  await clickProp(page, 'hit_lava_lamp');
  await expect.poll(async () => (await world(page)).lava).toBe('amber');
  await clickProp(page, 'hit_espresso');
  await expect.poll(async () => (await world(page)).steam?.brewing).toBe(true);

  // Props that take the camera to their framing.
  for (const [proxy, framing] of [
    ['hit_window', 'window'],
    ['hit_photo_wall', 'photos'],
    ['hit_projector', 'projector'],
  ] as const) {
    await backToIdle(page);
    await clickProp(page, proxy);
    await settledAt(page, framing);
  }

  // At the print wall a print opens that photograph in SaahilOS.
  await backToIdle(page);
  await clickProp(page, 'hit_photo_wall');
  await settledAt(page, 'photos');
  await clickProp(page, 'hit_photo_print_0');
  await settledAt(page, 'monitor');
  await expect(os(page).getByRole('dialog', { name: 'A Narrative in a Frame' })).toBeVisible();

  // The oven takes the camera in (its door and the croissant are the world's); with no close-up framing in this room it
  // goes straight for its window. The oven's own sound plays either way.
  await backToIdle(page);
  await clickProp(page, 'hit_oven');
  await expect.poll(() => page.evaluate(() => window.__room!.destination)).not.toBe('idle');

  // Props whose content lives in a SaahilOS window.
  for (const [proxy, window] of [
    ['hit_plaque', 'Films'],
    ['hit_poster_0', 'Films'],
    ['hit_nas', 'Terminal'],
  ] as const) {
    await backToIdle(page);
    await clickProp(page, proxy);
    await settledAt(page, 'monitor');
    await expect(os(page).getByRole('dialog', { name: window }), `${proxy} opens ${window}`).toBeVisible();
  }
  // #films/favourites brings the four favourites into view.
  await expect(os(page).locator('#film-favourites')).toBeVisible();

  expect(await sounds(page)).toEqual(expect.arrayContaining(['lava', 'espresso', 'espresso-brew', 'projector-clack', 'oven']));
});

/** Catches on-demand media (reel, prints, photographs, album pages) creeping into the room's initial load. */
test('the reel, the prints and the photographs load only after the room is interactive', async ({ page }) => {
  const started: { url: string; at: number }[] = [];
  page.on('request', (request) => started.push({ url: request.url(), at: Date.now() }));
  await inRoom(page);
  await page.waitForFunction(() => window.__room!.reel?.state === 'playing', null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__room!.world.prints.every((p) => p.shown > 0), null, { timeout: 30_000 });
  const interactive = await page.evaluate(() => performance.timeOrigin + window.__room!.interactiveAt!);
  const onDemand = started.filter(({ url }) => /reel\.mp4|\/480\.[^/]*\.webp|\/960\.[^/]*\.webp|photographs\.[^/]*\.js|api\/films\.json/.test(url));
  expect(onDemand.length).toBeGreaterThan(3);
  expect(onDemand.filter(({ at }) => at < interactive).map(({ url }) => url)).toEqual([]);
  // The posters hang in the first view, so they are part of it.
  expect((await world(page)).posters).toEqual([true, true, true, true]);
});
