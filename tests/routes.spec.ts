import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

/** The first `## ` heading of a content entry, so these tests follow rewrites of the copy instead of pinning it. */
const firstH2 = (collection: string, slug: string): string =>
  readFileSync(new URL(`../src/content/${collection}/${slug}.mdx`, import.meta.url), 'utf8').match(/^## (.+)$/m)![1].trim();
const POST = { slug: 'redaction-is-not-enough', title: 'Redaction is not enough', h2: firstH2('blog', 'redaction-is-not-enough') };

/** Catches a shared post link previewing as the site's home instead of the post (the room carries each page's tags). */
test('a post address is the room opening that post, with the post’s own share tags', async ({ request }) => {
  const html = await (await request.get(`/blog/${POST.slug}`)).text();
  expect(html).toMatch(new RegExp(`<main[^>]*\\sdata-room\\b[^>]*\\sdata-open="blog/${POST.slug}"`));
  expect(html).toContain(`<title>${POST.title} – Saahil Sanganeriya</title>`);
  expect(html).toMatch(new RegExp(`<meta property="og:title" content="${POST.title}"`));
  expect(html).toMatch(/<meta property="og:type" content="article"/);
  expect(html).toMatch(/<meta property="og:image" content="https:\/\/[^"]+\/og\/default\.png"/);
  expect(html).not.toContain(POST.h2);
});

/** Catches an RSS feed that is not well-formed XML or lists no items. */
test('/rss.xml is valid XML with the post in it', async ({ page, request }) => {
  const response = await request.get('/rss.xml');
  expect(response.ok()).toBe(true);
  const xml = await response.text();
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
  expect(body.html).toMatch(new RegExp(`<h2 id="[^"]+">${POST.h2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>`));
});

/** Catches WCAG A/AA failures on the one page that is not the room. */
test('the 404 page has no axe violations', async ({ page }) => {
  await page.goto('/404');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
});

test.describe('the framed documents, opened on their own', () => {
  // A phone gets the drawn monitor, so these run without the 3D room.
  const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
  test.use(iPhone13);

  /** Catches /os opening as a bare page of its own instead of on the monitor. */
  test('/os#<window> becomes the room with that window open', async ({ page }) => {
    await page.goto('/os#terminal');
    await expect(page).toHaveURL(/\/#terminal$/);
    await expect(page.frameLocator('[data-monitor-glass] iframe').getByRole('dialog', { name: 'Terminal' })).toBeVisible();
  });

  /** Catches /story playing the reel as a page of its own instead of in SaahilOS's The Thread window. */
  test('/story becomes the room with The Thread window open', async ({ page }) => {
    await page.goto('/story');
    await expect(page).toHaveURL(/\/#story$/);
    await expect(page.frameLocator('[data-monitor-glass] iframe').getByRole('dialog', { name: 'The Thread' })).toBeVisible();
  });
});
