import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';

const APPS = ['Projects', 'In the oven', 'Blog', 'Films', 'A Narrative in a Frame', 'Terminal', 'About', 'Résumé', 'Credits'];
const PROJECT = {
  slug: 'real-time-streaming',
  title: 'A real-time streaming pipeline (Amazon internship)',
  repo: 'https://github.com/saahilsanganeriya/real_time_streaming',
};

async function seriousAxeViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.nodes.length})`);
}

test.describe('desktop', () => {
  /** Catches an app missing from the desktop or a window that never mounts for it. */
  test('every app opens from its desktop icon', async ({ page }) => {
    await page.goto('/os');
    for (const app of APPS) {
      await page.getByRole('button', { name: app, exact: true }).dblclick();
      await expect(page.getByRole('dialog', { name: app })).toBeVisible();
    }
  });

  /** Catches deep links (`#projects/<slug>`, the room's `#films/<id>`) that open the wrong window or none. */
  test('a hash opens and fills that window', async ({ page }) => {
    await page.goto(`/os#projects/${PROJECT.slug}`);
    const reader = page.getByRole('dialog', { name: PROJECT.title });
    await expect(reader.getByRole('heading', { level: 2, name: 'What it does' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#projects/${PROJECT.slug}$`));

    await page.goto('/os#films/la-la-land');
    await expect(page.getByRole('dialog', { name: 'Films' }).locator('#film-la-la-land')).toBeFocused();

    // The room's poster plaque points at the favourites as a group.
    await page.goto('/os#films/favourites');
    await expect(page.getByRole('dialog', { name: 'Films' }).locator('#film-favourites')).toBeFocused();
  });

  /** Catches the oven hotspot's target (`#oven`) opening nothing, or the list arriving empty. */
  test('#oven opens In the oven with its list', async ({ page }) => {
    await page.goto('/os#oven');
    const oven = page.getByRole('dialog', { name: 'In the oven' });
    await expect(oven.getByRole('heading', { level: 2, name: 'In the oven' })).toBeVisible();
    await expect(oven.getByRole('listitem').first()).toBeVisible();
    await expect(oven.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}/);
  });

  /** Catches a project window without its repository button, or one that is too small or out of the Tab order. */
  test('a project window has a View source button next to Copy link', async ({ page }) => {
    await page.goto(`/os#projects/${PROJECT.slug}`);
    const reader = page.getByRole('dialog', { name: PROJECT.title });
    const source = reader.getByRole('link', { name: 'View source' });
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute('href', PROJECT.repo);
    await expect(source).toHaveAttribute('target', '_blank');
    // Polled, because the window opens on a spring from 94% scale.
    await expect.poll(async () => (await source.boundingBox())?.height).toBeGreaterThanOrEqual(30);
    expect((await source.boundingBox())!.width).toBeGreaterThanOrEqual(100);

    // From the window itself, Tab passes the three title-bar controls and lands on View source.
    await reader.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    await expect(source).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(reader.getByRole('button', { name: 'Copy link' })).toBeFocused();
  });

  /** Catches the CC BY paper figure showing without its credit, and a project cover that never loads. */
  test('a project shows its cover and credits its figures', async ({ page }) => {
    await page.goto('/os#projects/samcell');
    const reader = page.getByRole('dialog', { name: 'SAMCell (with samcell-napari and DINOCell)' });
    const cover = reader.locator('.os-cover img');
    await expect(cover).toHaveAttribute('alt', /samcell-napari plugin/);
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const caption = reader.locator('.os-figures figcaption');
    await expect(caption).toContainText('CC BY 4.0');
    await expect(caption.getByRole('link')).toHaveAttribute('href', /10\.1371\/journal\.pone\.0319532/);
  });

  /** Catches a Films window that stops explaining its list: the label, the stars and when the diary last updated. */
  test('Films labels the diary and shows when it last updated', async ({ page }) => {
    // One more entry than the window shows at first, so the older entries are one button away.
    const entries = Array.from({ length: 61 }, (_, i) => ({
      title: `Test Film ${i}`, year: 2026, rating: 3.5, rewatch: false, liked: false, watchedDate: '2026-10-11',
      review: null, url: `https://letterboxd.com/film/test-film-${i}/`, slug: `test-film-${i}`,
    }));
    const fetchedAt = '2026-10-11T18:05:00.000Z';
    await page.route('**/api/films.json', (route) =>
      route.fulfill({ json: { fetchedAt, profile: 'https://letterboxd.com/', posters: [], entries } }),
    );
    await page.goto('/os#films');
    const films = page.getByRole('dialog', { name: 'Films' });
    await expect(films.locator('.os-films-epigraph')).toHaveText('I love movies about making greatness happen.');
    await expect(films.getByRole('heading', { name: 'Four favourites — from Letterboxd' })).toBeVisible();
    await expect(films.getByRole('heading', { name: 'Diary — from Letterboxd, updates every hour' })).toBeVisible();
    await expect(films.getByText(/The stars are my rating out of five/)).toBeVisible();
    const updated = films.locator('.os-films-updated time');
    await expect(updated).toHaveAttribute('datetime', fetchedAt);
    await expect(updated).toContainText('2026');
    await expect(films.locator('#film-test-film-0')).toBeVisible();
    await expect(films.locator('#film-test-film-60')).toHaveCount(0);
    await films.getByRole('button', { name: 'Show older entries' }).click();
    await expect(films.locator('#film-test-film-60')).toBeVisible();

    // A failed live diary says so instead of passing the saved copy off as current.
    await page.unroute('**/api/films.json');
    await page.route('**/api/films.json', (route) => route.fulfill({ status: 503, body: '' }));
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Films' }).getByText(/Letterboxd did not answer/)).toBeVisible();
  });

  /** Catches the wallpaper going missing, which leaves the flat walnut colour the owner ruled out. */
  test('the desktop shows its wallpaper', async ({ page }) => {
    await page.goto('/os');
    const wallpaper = page.locator('.os-wallpaper img');
    await expect.poll(() => wallpaper.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThanOrEqual(960);
  });

  /** Catches links inside the monitor that would load a page into the iframe instead of a tab or a window. */
  test('links: other sites in a new tab, site pages in a window, Copy link copies the window address', async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/os#projects/${PROJECT.slug}`);
    const reader = page.getByRole('dialog', { name: PROJECT.title });
    const source = reader.getByRole('link', { name: 'View source' });
    await expect(source).toHaveAttribute('target', '_blank');
    await expect(source).toHaveAttribute('rel', 'noopener');
    // The site has no plain pages: the window's address (which opens the room and this window) goes to the clipboard.
    await reader.getByRole('button', { name: 'Copy link' }).click();
    await expect(reader.getByRole('button', { name: 'Link copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/projects/${PROJECT.slug}`);
    await expect(page).toHaveURL(new RegExp(`/os#projects/${PROJECT.slug}$`));

    await page.goto('/os#blog/redaction-is-not-enough');
    await page
      .getByRole('dialog', { name: 'Redaction is not enough' })
      .getByRole('link', { name: 'separately' })
      .click();
    await expect(page.getByRole('dialog', { name: 'The same-person problem' })).toBeVisible();
    await expect(page).toHaveURL(/\/os#blog\/the-same-person-problem$/);
  });

  /** Catches a Terminal whose commands stop reaching the content or the window manager. */
  test('the Terminal lists and opens projects', async ({ page }) => {
    await page.goto('/os#terminal');
    const prompt = page.getByRole('textbox', { name: 'Command' });
    await prompt.fill('ls projects');
    await prompt.press('Enter');
    await expect(page.getByRole('log', { name: 'Terminal output' })).toContainText(PROJECT.slug);
    await prompt.fill(`open ${PROJECT.slug}`);
    await prompt.press('Enter');
    await expect(page.getByRole('dialog', { name: PROJECT.title })).toBeVisible();
  });

  /** Catches a break in the contract the room relies on: os-ready, open messages, forwarded pointer events. */
  test('embedded in a frame, it answers the room', async ({ page }) => {
    await page.goto('/404');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const seen: string[] = [];
          (window as unknown as { seen: string[] }).seen = seen;
          window.addEventListener('message', (event) => {
            seen.push(event.data?.type);
            if (event.data?.type === 'os-ready') resolve();
          });
          const frame = document.createElement('iframe');
          frame.src = '/os?embed=1';
          frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
          document.body.append(frame);
        }),
    );
    await page.evaluate(() =>
      document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'open', target: 'about' }, location.origin),
    );
    const os = page.frameLocator('iframe');
    await expect(os.getByRole('dialog', { name: 'About' })).toBeVisible();
    await os.getByRole('dialog', { name: 'About' }).hover();
    await expect.poll(() => page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toContain('mousemove');
  });

  /** Catches contrast, naming and ARIA failures in the chrome and in a reader window. */
  test('axe finds no serious violations', async ({ page }) => {
    await page.goto(`/os#projects/${PROJECT.slug}`);
    await expect(page.getByRole('heading', { level: 2, name: 'What it does' })).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    expect(await seriousAxeViolations(page)).toEqual([]);

    // The windows with their own colours: Films on walnut, the oven list, and the project pictures.
    for (const [hash, name] of [['films', 'Films'], ['oven', 'In the oven'], ['projects', 'Projects']]) {
      await page.goto(`/os#${hash}`);
      // Measured once the open spring has settled; mid-fade, every colour reads lighter than it is.
      await expect(page.getByRole('dialog', { name })).toHaveCSS('opacity', '1');
      expect(await seriousAxeViolations(page), hash).toEqual([]);
    }
  });
});

test.describe('iPhone 13', () => {
  // Chromium with the iPhone 13 viewport, touch and user agent; the project's browser stays Chromium.
  const { defaultBrowserType: _webkit, ...iPhone13 } = devices['iPhone 13'];
  test.use(iPhone13);

  /** Catches the phone layout falling back to floating windows, or Back not returning to the apps. */
  test('an app opens full screen and Back returns to the apps', async ({ page }) => {
    await page.goto('/os');
    await page.getByRole('button', { name: 'Projects', exact: true }).tap();
    const app = page.getByRole('dialog', { name: 'Projects' });
    await expect(app).toBeVisible();
    // Polled, because the app slides in on a spring before it settles at the screen's edges.
    await expect.poll(() => app.boundingBox()).toEqual({ x: 0, y: 0, ...iPhone13.viewport });
    expect(await seriousAxeViolations(page)).toEqual([]);
    await app.getByRole('button', { name: '‹ Back' }).tap();
    await expect(app).toBeHidden();
    await expect(page.getByRole('button', { name: 'Films', exact: true })).toBeVisible();
  });
});
