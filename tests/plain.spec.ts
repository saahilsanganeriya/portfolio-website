import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PLAIN_PAGES = ['/', '/blog', '/blog/sample-post', '/projects', '/projects/sample-project', '/films', '/credits', '/about', '/resume', '/404'];

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
test('/blog lists the sample post', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.getByRole('heading', { level: 1, name: 'Writing' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'How a post looks' })).toHaveAttribute('href', '/blog/sample-post');
});

/** Catches a post page that renders without its MDX body or without the tags a shared link needs. */
test('a post renders its body and share tags', async ({ page }) => {
  await page.goto('/blog/sample-post');
  await expect(page.getByRole('heading', { level: 1, name: 'How a post looks' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'A section heading' })).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'How a post looks');
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
  expect(result.titles).toContain('How a post looks');
});

/** Catches the reader-window endpoint returning frontmatter without the rendered body, which leaves OS windows empty. */
test('/content/<collection>/<slug>.json carries frontmatter and rendered HTML', async ({ request }) => {
  const body = await (await request.get('/content/blog/sample-post.json')).json();
  expect(body.data.title).toBe('How a post looks');
  expect(body.html).toContain('<h2 id="a-section-heading">A section heading</h2>');
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
