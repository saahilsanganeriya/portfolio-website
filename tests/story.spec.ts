import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const CHAPTERS = ['Delhi', 'The mill', 'Eighteen', 'Seeing cells', 'Building', 'Home'];

const frames = (page: Page) => page.locator('[data-frame]');

// The chapter whose scene frame is `index`, if any (frame 0 is the title, then a card and a scene per chapter).
const chapterAt = (index: number) => (index % 2 === 0 && index > 0 ? CHAPTERS[index / 2 - 1] : undefined);

async function expectFrameShown(page: Page, index: number): Promise<void> {
  await expect(frames(page).nth(index)).toHaveAttribute('data-active', '');
  const chapter = chapterAt(index);
  if (chapter) await expect(page.getByRole('heading', { level: 2, name: chapter, exact: true })).toBeInViewport();
}

/** Catches scrolling that stops advancing frames, which leaves the later chapters unreachable by scroll. */
test('every chapter is reachable by scrolling, one frame per step', async ({ page }) => {
  await page.goto('/story?embed=1');
  const count = await frames(page).count();
  const step = await page.locator('[data-step]').first().evaluate((el) => (el as HTMLElement).offsetHeight);
  await page.mouse.move(400, 300);
  for (let i = 1; i < count; i++) {
    await page.mouse.wheel(0, step);
    await expectFrameShown(page, i);
  }
});

/** Catches arrow keys that scroll the page without moving the reel, which strands keyboard visitors on one frame. */
test('every chapter is reachable by keyboard, and the scene list jumps to a chapter', async ({ page }) => {
  await page.goto('/story?embed=1');
  const count = await frames(page).count();
  await page.locator('#content').focus();
  for (let i = 1; i < count; i++) {
    await page.keyboard.press('ArrowDown');
    await expectFrameShown(page, i);
  }
  await page.keyboard.press('Home');
  await expectFrameShown(page, 0);
  await page.getByRole('link', { name: /Seeing cells/ }).focus();
  await page.keyboard.press('Enter');
  await expectFrameShown(page, 7);
  await page.keyboard.press('ArrowDown');
  await expectFrameShown(page, 8);
});

/** Catches the browser's own scroll to a fragment overriding the reel, so a shared chapter link opens the wrong frame. */
test('a link to a chapter opens the reel on that chapter', async ({ page }) => {
  await page.goto('/story?embed=1#chapter-4');
  await expectFrameShown(page, 7);
  await page.keyboard.press('ArrowDown');
  await expectFrameShown(page, 8);
});

/** Catches reduced motion leaving words clipped inside the reel's gate instead of a static sequence of frames. */
test('with reduced motion every frame is a static, readable sequence', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/story?embed=1');
  await expect(page.locator('html')).not.toHaveAttribute('data-reel', 'live');
  await expect(page.locator('canvas').first()).toBeHidden();
  const words = page.locator('.title-name, .card-text, .scene-title, .scene-body p, .end-title');
  expect(await words.count()).toBe(1 + CHAPTERS.length * 3 + 1);
  for (const el of await words.all()) {
    await el.scrollIntoViewIfNeeded();
    await expect(el).toBeInViewport();
  }
});

/** Catches a background photo, the closing portrait or a chapter's photo of the owner shipped without alt text. */
test('every image has alt text', async ({ page }) => {
  await page.goto('/story?embed=1');
  const alts = await page.locator('main img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt') ?? ''));
  const ownerPhotos = await page.locator('main figure.me-photo img').count();
  expect(ownerPhotos, 'the owner allows a photo of him in at most three chapters').toBeLessThanOrEqual(3);
  expect(alts).toHaveLength(CHAPTERS.length + 2 + ownerPhotos);
  for (const alt of alts) expect(alt.trim().length).toBeGreaterThan(10);
});

/** Catches the SaahilOS window showing site chrome, or an autoplay that cannot be paused (WCAG 2.2.2). */
test('?embed=1#autoplay drops the chrome, plays by itself and pauses', async ({ page }) => {
  await page.clock.install();
  await page.goto('/story?embed=1#autoplay');
  await expect(page.locator('.reel-bar')).toBeHidden();
  await expect(page.locator('.site-footer')).toBeHidden();
  await expect(page.getByRole('link', { name: 'About me' })).toHaveAttribute('target', '_top');

  const pause = page.getByRole('button', { name: 'Pause' });
  await expect(pause).toBeVisible();
  await page.clock.runFor(6_000);
  await expectFrameShown(page, 1);
  await pause.click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.clock.runFor(30_000);
  await expectFrameShown(page, 1);
});

/** Catches WCAG A/AA failures on the reel, live or static; /story must score 100 for accessibility. */
test('the reel has no axe violations, live or with reduced motion', async ({ page }) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/story?embed=1');
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(violations.map((v) => `${reducedMotion}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  }
});
