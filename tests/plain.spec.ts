import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const POST = { slug: 'redaction-is-not-enough', title: 'Redaction is not enough', h2: 'What a black bar breaks' };
const PLAIN_PAGES = [
  '/',
  '/blog',
  `/blog/${POST.slug}`,
  '/blog/oppenheimer', // a film review: the film line with its star rating
  '/projects',
  '/projects/real-time-streaming',
  '/films',
  '/credits',
  '/about',
  '/resume',
  '/404',
];

/** Catches a home page whose text index or skip link is missing, which leaves no-WebGL and keyboard visitors stuck. */
test('home shows the text index and "Skip the room" is the first tab stop', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Saahil Sanganeriya' })).toBeVisible();
  const index = page.getByRole('navigation', { name: 'Site index' });
  for (const href of ['/projects', '/blog', '/films', '/story', '/os', '/about', '/resume', '/credits']) {
    await expect(index.locator(`a[href="${href}"]`)).toBeVisible();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip the room' })).toBeFocused();
});

/** Catches the post index dropping posts, e.g. a broken draft filter or collection glob. */
test('/blog lists the posts', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.getByRole('heading', { level: 1, name: 'Writing' })).toBeVisible();
  await expect(page.getByRole('link', { name: POST.title })).toHaveAttribute('href', `/blog/${POST.slug}`);
});

/** Catches a post page that renders without its MDX body or without the tags a shared link needs. */
test('a post renders its body and share tags', async ({ page }) => {
  await page.goto(`/blog/${POST.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: POST.title })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: POST.h2 })).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', POST.title);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\/.+\/og\/default\.png$/);
});

/** Catches an RSS feed that is not well-formed XML or lists no items. */
test('/rss.xml is valid XML with the post in it', async ({ page, request }) => {
  const response = await request.get('/rss.xml');
  expect(response.ok()).toBe(true);
  const xml = await response.text();
  await page.goto('/');
  const result = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    return {
      parseError: doc.querySelector('parsererror')?.textContent ?? null,
      titles: [...doc.querySelectorAll('item > title')].map((t) => t.textContent),
    };
  }, xml);
  expect(result.parseError).toBeNull();
  expect(result.titles).toContain(POST.title);
});

/** Catches the reader-window endpoint returning frontmatter without the rendered body, which leaves OS windows empty. */
test('/content/<collection>/<slug>.json carries frontmatter and rendered HTML', async ({ request }) => {
  const body = await (await request.get(`/content/blog/${POST.slug}.json`)).json();
  expect(body.data.title).toBe(POST.title);
  expect(body.html).toContain(`<h2 id="what-a-black-bar-breaks">${POST.h2}</h2>`);
});

/** Catches WCAG A/AA failures (contrast, names, landmarks) on every plain page; accessibility must score 100. */
test('plain pages have no axe violations', async ({ page }) => {
  for (const path of PLAIN_PAGES) {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(violations.map((v) => `${path}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  }
});

/**
 * Catches /films never showing watches logged after the build (the client refresh not running or not inserting),
 * and a refresh that drops or duplicates the rows the prerendered page already has.
 */
test('/films adds watches from the live feed, newest first, and keeps the prerendered rows', async ({ page }) => {
  const rows = page.locator('[data-diary] li');
  await page.route('**/api/films.json', (route) => route.abort());
  await page.goto('/films');
  const prerendered = await rows.count();
  expect(prerendered).toBeGreaterThan(0);

  const watched = '2099-01-02';
  const entry = { title: 'A Test Film', year: 2099, rating: 4.5, rewatch: false, liked: false, watchedDate: watched, review: 'Short.', url: 'https://letterboxd.com/', slug: 'a-test-film' };
  await page.unroute('**/api/films.json');
  await page.route('**/api/films.json', (route) => route.fulfill({ json: { fetchedAt: `${watched}T08:00:00.000Z`, profile: '', posters: [], entries: [entry] } }));
  await page.reload();
  await expect(rows.first()).toContainText('A Test Film');
  await expect(rows).toHaveCount(prerendered + 1);
  await expect(page.locator('[data-year="2099"] .chrono-label')).toHaveText('2099');
  await expect(page.locator('[data-films-updated] time')).toHaveAttribute('datetime', watched);
});
