import AxeBuilder from '@axe-core/playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { devices, expect, test, type Page } from '@playwright/test';

// Opened on its own, /os becomes the room; ?embed=1 is the document the monitor frames (desktop layout), and
// ?embed=0 the same document unframed, for the phone layout here (linked nowhere).

// The desktop holds the work and the machine; the Personal folder holds the rest (the room opens those directly too).
const DESKTOP = ['About', 'Projects', 'Writing', 'Code', 'Résumé', 'In the oven', 'Personal', 'Terminal', 'Credits'];
const PERSONAL = ['Films', 'A Narrative in a Frame', 'Books', 'Kitchen', 'Voyager Golden Record'];
const REMOVED = ['Welcome', 'The Thread', 'Daily word'];
/** The first `## ` heading of a content entry, so these tests follow rewrites of the copy instead of pinning it. */
const firstH2 = (collection: string, slug: string): string =>
  readFileSync(new URL(`../src/content/${collection}/${slug}.mdx`, import.meta.url), 'utf8').match(/^## (.+)$/m)![1].trim();
// The About page's first paragraph and how many photos of him it places, read from the page so a rewrite moves the test too.
const ABOUT = (() => {
  const mdx = readFileSync(new URL('../src/content/pages/about.mdx', import.meta.url), 'utf8').replace(/^---[\s\S]*?---/, '');
  const firstParagraph = mdx.split(/\n{2,}/).map((block) => block.trim()).find((block) => /^[A-Z]/.test(block))!;
  return { firstWords: firstParagraph.split(/[,.]/)[0], photos: (mdx.match(/<MePhoto\b/g) ?? []).length };
})();
// The first featured photograph in the collection, read from its YAML so a new photo set moves the tests with it.
const PHOTO = (() => {
  const dir = new URL('../src/content/photography/', import.meta.url);
  const entries = readdirSync(dir)
    .filter((file) => /^[^_].*\.ya?ml$/.test(file))
    .map((file) => {
      const yaml = readFileSync(new URL(file, dir), 'utf8');
      const field = (key: string) => yaml.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] ?? '';
      return {
        slug: file.replace(/\.ya?ml$/, ''),
        title: field('title'),
        caption: field('caption'),
        igCaption: field('igCaption'),
        featured: field('featured') === 'true',
        order: Number(field('order') || 1e9),
      };
    })
    .filter((photo) => photo.featured)
    .sort((a, b) => a.order - b.order);
  return entries[0];
})();
const PROJECT = {
  slug: 'real-time-streaming',
  title: 'A real-time streaming pipeline (Amazon internship)',
  repo: 'https://github.com/saahilsanganeriya/real_time_streaming',
};

// The Code window's fixture: a small repository in the committed snapshot, its README's title and a root file. File
// bodies come from raw.githubusercontent.com, which tests stand in for, so they never depend on the network.
const NAPARI = (() => {
  const snapshot = JSON.parse(
    readFileSync(new URL('../src/os/apps/code/snapshot/repos/saahilsanganeriya--samcell-napari.json', import.meta.url), 'utf8'),
  ) as { readme: { html: string }; tree: { entries: [string, string, number][] } };
  return {
    slug: 'saahilsanganeriya/samcell-napari',
    title: snapshot.readme.html.match(/<h1[^>]*>([^<]+)<\/h1>/)![1],
    file: snapshot.tree.entries.find(([path, type]) => type === 'b' && path === 'pyproject.toml')![0],
  };
})();
async function serveGithubFiles(page: Page, body: string | null) {
  await page.route('https://raw.githubusercontent.com/**', (route) =>
    body === null ? route.fulfill({ status: 500, body: '' }) : route.fulfill({ body, contentType: 'text/plain' }),
  );
  await page.route('https://camo.githubusercontent.com/**', (route) => route.abort());
  await page.route('https://media.githubusercontent.com/**', (route) => route.abort());
}

// Books, Recipes and Voyager read build-time JSON; these stand in for it, empty and with synthetic entries.
const shelf = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/shelves/${name}.json`, import.meta.url), 'utf8')) as unknown;
async function serveShelves(page: Page, mode: 'empty' | 'sample') {
  const empty = mode === 'empty';
  await page.route('**/content/books.json', (route) => route.fulfill({ json: empty ? { books: [] } : shelf('books') }));
  await page.route('**/content/recipes.json', (route) =>
    route.fulfill({ json: empty ? { recipes: [] } : shelf('recipes') }),
  );
  await page.route('**/content/recipes/sample-loaf.json', (route) => route.fulfill({ json: shelf('recipe-sample-loaf') }));
  await page.route('**/content/voyager/voyager.json', (route) =>
    empty ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ json: shelf('voyager') }),
  );
}

async function seriousAxeViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.nodes.length})`);
}

test.describe('desktop', () => {
  /** Catches an app missing from the desktop or the Personal folder, or a window that never mounts for it. */
  test('every app opens from its desktop icon or the Personal folder', async ({ page }) => {
    await page.goto('/os?embed=1');
    const icons = page.getByRole('navigation', { name: 'Apps' });
    await expect(icons.getByRole('button')).toHaveText(DESKTOP);
    for (const app of DESKTOP) {
      await icons.getByRole('button', { name: app, exact: true }).dblclick();
      await expect(page.getByRole('dialog', { name: app })).toBeVisible();
    }
    const folder = page.getByRole('dialog', { name: 'Personal' });
    for (const app of PERSONAL) {
      // Each window opens on top; opening the folder again brings it back to the front.
      await icons.getByRole('button', { name: 'Personal' }).dblclick();
      await folder.getByRole('link', { name: app }).click();
      await expect(page.getByRole('dialog', { name: app })).toBeVisible();
    }
  });

  /** Catches the deleted Welcome, The Thread or Daily word coming back on the desktop, in Start, or by their old hashes. */
  test('the removed apps are gone', async ({ page }) => {
    await page.goto('/os?embed=1#story');
    // An unknown window name opens About, the window the OS opens when nothing is named.
    await expect(page.getByRole('dialog', { name: 'About' })).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    const menu = page.getByRole('navigation', { name: 'Start menu' });
    await expect(menu.getByRole('button', { name: 'Code' })).toBeVisible();
    for (const name of REMOVED) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
      await expect(page.getByRole('dialog', { name })).toHaveCount(0);
    }
    for (const hash of ['game', 'welcome']) {
      await page.goto(`/os?embed=1#${hash}`);
      await page.reload();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(page.getByRole('dialog', { name: 'About' })).toBeVisible();
    }
  });

  /** Catches an About action that opens the wrong window or none, or a résumé button that navigates instead of downloading. */
  test('About’s four ways on: Projects, Writing, Code and the résumé PDF', async ({ page }) => {
    const ways = page.getByRole('dialog', { name: 'About' }).getByRole('navigation', { name: 'Start here' });
    for (const [label, window] of [
      ['Projects', 'Projects'],
      ['Writing', 'Writing'],
      ['Code', 'Code'],
    ]) {
      // A fresh boot each time, since the window an action opens covers About.
      await page.goto('/os?embed=1');
      await ways.getByRole('link', { name: new RegExp(`^${label}`) }).click();
      await expect(page.getByRole('dialog', { name: window })).toBeVisible();
    }
    await page.goto('/os?embed=1');
    const download = page.waitForEvent('download');
    await ways.getByRole('link', { name: /^Résumé/ }).click();
    expect((await download).suggestedFilename()).toBe('Saahil-Sanganeriya-resume.pdf');
    await expect(page).toHaveURL(/\/os\?embed=1#about$/);
  });

  /** Catches a Code window that cannot show a repository's README, its file tree or a file from GitHub. */
  test('the code viewer shows a README, the file tree and a file', async ({ page }) => {
    await serveGithubFiles(page, '[build-system]\nrequires = ["setuptools>=42"]  # the build backend\n');
    await page.goto('/os?embed=1#code');
    const list = page.getByRole('dialog', { name: 'Code' });
    await list.getByRole('link', { name: /^samcell-napari/ }).click();
    const repo = page.getByRole('dialog', { name: 'samcell-napari' });
    await expect(repo.getByRole('heading', { level: 1, name: NAPARI.title })).toBeVisible();
    await expect(repo.getByRole('link', { name: 'Open on GitHub ↗' }).first()).toHaveAttribute('href', `https://github.com/${NAPARI.slug}`);

    await repo.getByRole('link', { name: 'Files' }).click();
    await expect(repo.getByRole('link', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
    const files = repo.getByRole('table');
    await expect(files.getByRole('link', { name: 'samcell_napari' })).toBeVisible();
    await files.getByRole('link', { name: NAPARI.file, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#code/${NAPARI.slug}/blob/HEAD/${NAPARI.file}$`));
    const code = repo.getByRole('region', { name: `Contents of ${NAPARI.file}` });
    await expect(code.locator('.l')).toHaveCount(2);
    await expect(code.locator('.tk-c')).toHaveText('# the build backend');
    await expect(code.locator('.tk-s').first()).toHaveText('"setuptools>=42"');

    // GitHub not answering is said in words, with the way to the same file on GitHub.
    await page.unroute('https://raw.githubusercontent.com/**');
    await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ status: 500, body: '' }));
    await page.reload();
    const failed = page.getByRole('dialog', { name: 'samcell-napari' }).getByRole('alert');
    await expect(failed).toContainText('this file did not load: GitHub answered HTTP 500');
    await expect(failed.getByRole('link', { name: 'Open it on GitHub ↗' })).toHaveAttribute(
      'href',
      `https://github.com/${NAPARI.slug}/blob/HEAD/${NAPARI.file}`,
    );
  });

  /** Catches a link inside SaahilOS that would take the visitor out of the room: View source, a README's GitHub link, other sites. */
  test('links stay inside SaahilOS', async ({ page }) => {
    await serveGithubFiles(page, '');
    await page.route('https://polyhaven.com/**', (route) =>
      route.fulfill({ body: '<!doctype html><title>Poly Haven</title><p>A stand-in page.</p>', contentType: 'text/html' }),
    );
    // View source opens the project's repository in the Code window, not a tab.
    await page.goto(`/os?embed=1#projects/${PROJECT.slug}`);
    const source = page.getByRole('dialog', { name: PROJECT.title }).getByRole('link', { name: 'View source' });
    await expect(source).toHaveAttribute('href', PROJECT.repo);
    await expect(source).not.toHaveAttribute('target', /.+/);
    await source.click();
    await expect(page.getByRole('dialog', { name: 'real_time_streaming' })).toBeVisible();
    await expect(page).toHaveURL(/\/os\?embed=1#code\/saahilsanganeriya\/real_time_streaming$/);

    // A README's link to another of his repositories opens that one; a link to a site that refuses framing gets a tab.
    await page.goto(`/os?embed=1#code/${NAPARI.slug}`);
    const readme = page.getByRole('dialog', { name: 'samcell-napari' });
    await expect(readme.getByRole('link', { name: 'PyPI' }).first()).toHaveAttribute('target', '_blank');
    await readme.locator('.os-readme a[href="https://github.com/saahilsanganeriya/SAMCell"]').first().click();
    await expect(page.getByRole('dialog', { name: 'SAMCell', exact: true })).toBeVisible();

    // A site that allows framing opens in SaahilOS's browser, which may not navigate the room.
    await page.goto('/os?embed=1#credits');
    await page.getByRole('dialog', { name: 'Credits' }).locator('a[href^="https://polyhaven.com/"]').first().click();
    const browser = page.getByRole('dialog', { name: 'polyhaven.com' });
    const frame = browser.locator('iframe');
    await expect(frame).toHaveAttribute('src', /^https:\/\/polyhaven\.com\//);
    expect(await frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    await expect(page.frameLocator('.os-browser-frame').getByText('A stand-in page.')).toBeVisible();

    // No link anywhere targets the whole tab, and the OS is still the page that was opened.
    for (const hash of ['about', `projects/${PROJECT.slug}`, 'credits', `code/${NAPARI.slug}`]) {
      await page.goto(`/os?embed=1#${hash}`);
      await page.reload();
      await expect(page.getByRole('dialog').first()).toBeVisible();
      await expect(page.locator('a[target="_top"]'), hash).toHaveCount(0);
    }
    expect(new URL(page.url()).pathname).toBe('/os');
  });

  /** Catches a keyboard visitor who cannot reach About's ways on or walk the Code window's tabs and files. */
  test('a keyboard walks About’s ways on and the code viewer', async ({ page }) => {
    await serveGithubFiles(page, 'line one\n');
    await page.goto('/os?embed=1');
    const about = page.getByRole('dialog', { name: 'About' });
    await expect(about.getByRole('heading', { level: 2 })).toBeVisible();
    await about.focus();
    const code = about.getByRole('link', { name: /^Code/ });
    for (let i = 0; i < 12 && !(await code.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(code).toBeFocused();
    await page.keyboard.press('Enter');
    const list = page.getByRole('dialog', { name: 'Code' });
    await expect(list).toBeVisible();
    const row = list.getByRole('link', { name: /^samcell-napari/ });
    for (let i = 0; i < 40 && !(await row.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(row).toBeFocused();
    await page.keyboard.press('Enter');
    const repo = page.getByRole('dialog', { name: 'samcell-napari' });
    const filesTab = repo.getByRole('link', { name: 'Files' });
    for (let i = 0; i < 12 && !(await filesTab.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(filesTab).toBeFocused();
    await page.keyboard.press('Enter');
    const file = repo.getByRole('link', { name: NAPARI.file, exact: true });
    for (let i = 0; i < 30 && !(await file.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(file).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(repo.getByRole('region', { name: `Contents of ${NAPARI.file}` })).toContainText('line one');
  });

  /** Catches deep links (`#projects/<slug>`, the room's `#films/<id>`) that open the wrong window or none. */
  test('a hash opens and fills that window', async ({ page }) => {
    await page.goto(`/os?embed=1#projects/${PROJECT.slug}`);
    const reader = page.getByRole('dialog', { name: PROJECT.title });
    await expect(reader.getByRole('heading', { level: 2, name: firstH2('projects', PROJECT.slug) })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#projects/${PROJECT.slug}$`));

    await page.goto('/os?embed=1#films/la-la-land');
    await expect(page.getByRole('dialog', { name: 'Films' }).locator('#film-la-la-land')).toBeFocused();

    // The room's poster plaque points at the favourites as a group.
    await page.goto('/os?embed=1#films/favourites');
    await expect(page.getByRole('dialog', { name: 'Films' }).locator('#film-favourites')).toBeFocused();
  });

  /** Catches the oven hotspot's target (`#oven`) opening nothing, or the list arriving empty. */
  test('#oven opens In the oven with its list', async ({ page }) => {
    await page.goto('/os?embed=1#oven');
    const oven = page.getByRole('dialog', { name: 'In the oven' });
    await expect(oven.getByRole('heading', { level: 2, name: 'In the oven' })).toBeVisible();
    await expect(oven.getByRole('listitem').first()).toBeVisible();
    await expect(oven.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}/);
  });

  /** Catches a project window without its repository button, or one that is too small or out of the Tab order. */
  test('a project window has a View source button next to Copy link', async ({ page }) => {
    await page.goto(`/os?embed=1#projects/${PROJECT.slug}`);
    const reader = page.getByRole('dialog', { name: PROJECT.title });
    const source = reader.getByRole('link', { name: 'View source' });
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute('href', PROJECT.repo);
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
    await page.goto('/os?embed=1#projects/samcell');
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
    await page.goto('/os?embed=1#films');
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

  /** Catches a boot that opens anything but About, or an About without his portrait, its text and the photos beside it. */
  test('About opens first with the portrait, the ways on, the page text and its photos', async ({ page }) => {
    await page.goto('/os?embed=1');
    const about = page.getByRole('dialog', { name: 'About' });
    await expect(about.getByRole('heading', { level: 2, name: 'Saahil Sanganeriya' })).toBeVisible();
    const portrait = about.getByRole('img', { name: 'Saahil Sanganeriya' });
    await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const ways = about.getByRole('navigation', { name: 'Start here' }).getByRole('link');
    await expect(ways).toHaveCount(4);
    // The page body is the About page as written, with each photo the page names set beside its paragraph.
    await expect(about.locator('.os-prose p').filter({ hasText: ABOUT.firstWords })).toBeVisible();
    await expect(about.locator('.os-prose img')).toHaveCount(ABOUT.photos);
  });

  /** Catches a photograph's deep link opening the wrong one, and full-size files loading before a photograph is opened. */
  test('A Narrative in a Frame: thumbnails first, the full photograph on open', async ({ page }) => {
    await page.goto('/os?embed=1#photography');
    const exhibit = page.getByRole('dialog', { name: 'A Narrative in a Frame' });
    await expect(exhibit.getByRole('heading', { name: 'Favourites' })).toBeVisible();
    const thumbs = exhibit.locator('.os-print img');
    await expect.poll(() => thumbs.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    // The widest file each <picture> may choose from, across its sources.
    const widestOffered = (pictures: Element[]) =>
      Math.max(
        ...pictures.flatMap((picture) =>
          [...picture.querySelectorAll('source, img')].flatMap((el) =>
            (el.getAttribute('srcset') ?? '').split(',').map((part) => Number.parseInt(part.trim().split(' ')[1], 10)),
          ),
        ),
      );
    expect(await exhibit.locator('.os-print picture').evaluateAll(widestOffered)).toBeLessThanOrEqual(960);

    await page.goto(`/os?embed=1#photography/${PHOTO.slug}`);
    const photo = page.getByRole('dialog', { name: 'A Narrative in a Frame' });
    await expect(photo.getByRole('heading', { level: 2, name: PHOTO.title, exact: true })).toBeVisible();
    const full = photo.locator('.os-photo-figure img');
    await expect(full).toHaveAttribute('alt', PHOTO.caption);
    // His Instagram caption shows with the photograph when the entry has one, and nothing stands in when it does not.
    const instagram = photo.locator('.os-photo-ig');
    if (PHOTO.igCaption) await expect(instagram).toContainText(PHOTO.igCaption.split('\\n')[0]);
    else await expect(instagram).toHaveCount(0);
    await expect.poll(() => full.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect(await photo.locator('.os-photo-figure picture').evaluateAll(widestOffered)).toBeGreaterThan(960);
    await photo.getByRole('link', { name: 'Next ›' }).click();
    await expect(page).toHaveURL(/#photography\/[a-z0-9-]+$/);
    await expect(photo.getByRole('heading', { level: 2, name: PHOTO.title, exact: true })).toBeHidden();
  });

  /** Catches a shelf window that errors or reads as broken while its content is not written yet (zero entries). */
  test('Books, Recipes and Voyager read well with nothing published', async ({ page }) => {
    await serveShelves(page, 'empty');
    for (const [hash, name, note] of [
      ['books', 'Books', 'No books on the shelf yet.'],
      ['recipes', 'Kitchen', 'No recipes written up yet.'],
      ['voyager', 'Voyager Golden Record', 'This page is not published yet.'],
    ]) {
      await page.goto(`/os?embed=1#${hash}`);
      const win = page.getByRole('dialog', { name });
      await expect(win.locator('.os-note'), hash).toHaveText(note);
      await expect(win).toHaveCSS('opacity', '1');
      expect(await seriousAxeViolations(page), hash).toEqual([]);
    }
  });

  /** Catches the shelves dropping what the content gives them: a book's line, a recipe's ingredients or method, the record's text. */
  test('Books, Recipes and Voyager render their entries', async ({ page }) => {
    await serveShelves(page, 'sample');
    await page.goto('/os?embed=1#books');
    const books = page.getByRole('dialog', { name: 'Books' });
    await expect(books.getByRole('listitem')).toHaveCount(2);
    await expect(books.getByRole('heading', { level: 3, name: 'Sample Book One' })).toBeVisible();
    await expect(books.getByText('Test Author, 1994')).toBeVisible();
    await expect(books.getByText('A line about the first book.')).toBeVisible();
    await expect(books.locator('.os-status-cell').first()).toHaveText('2 books');

    await page.goto('/os?embed=1#recipes');
    const recipes = page.getByRole('dialog', { name: 'Kitchen' });
    await recipes.getByRole('link', { name: /Sample loaf/ }).click();
    await expect(page).toHaveURL(/#recipes\/sample-loaf$/);
    await expect(recipes.getByRole('heading', { level: 2, name: 'Sample loaf' })).toBeVisible();
    await expect(recipes.locator('.os-facts')).toContainText('1 loaf');
    // An adapted recipe credits its source with a link, which opens in a new tab.
    const credit = recipes.getByRole('link', { name: 'A Test Kitchen, Sample Loaf' });
    await expect(credit).toHaveAttribute('href', 'https://example.org/sample-loaf');
    await expect(credit).toHaveAttribute('target', '_blank');
    const ingredients = recipes.getByRole('region', { name: 'Ingredients' });
    await expect(ingredients.getByRole('heading', { level: 4, name: 'For the levain' })).toBeVisible();
    await expect(ingredients.getByRole('listitem')).toHaveText(['500 g flour', '50 g starter', '50 g water']);
    await expect(recipes.getByRole('heading', { level: 2, name: 'Method' })).toBeVisible();
    await expect(recipes.getByText('Bake.')).toBeVisible();
    await expect(recipes.getByRole('img', { name: 'A test picture.' })).toBeVisible();
    await expect(recipes).toHaveCSS('opacity', '1');
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Kitchen' }).getByRole('heading', { level: 2, name: 'Sample loaf' })).toBeVisible();
    expect(await seriousAxeViolations(page), 'recipe').toEqual([]);
    await recipes.getByRole('link', { name: '‹ All recipes' }).click();
    await expect(recipes.getByRole('link', { name: /Sample loaf/ })).toBeVisible();

    await page.goto('/os?embed=1#voyager');
    const voyager = page.getByRole('dialog', { name: 'Voyager Golden Record' });
    await expect(voyager.getByRole('heading', { level: 2, name: 'The Voyager Golden Record' })).toBeVisible();
    await expect(voyager.getByText('A test paragraph.')).toBeVisible();
    // One window per fresh load: a hash change alone stacks windows, whose overlapping controls axe then flags.
    for (const [hash, name] of [
      ['books', 'Books'],
      ['voyager', 'Voyager Golden Record'],
    ]) {
      await page.goto(`/os?embed=1#${hash}`);
      await page.reload();
      await expect(page.getByRole('dialog', { name })).toHaveCSS('opacity', '1');
      expect(await seriousAxeViolations(page), hash).toEqual([]);
    }
  });

  /** Catches the wallpaper going missing, or showing without the credit line its CC BY licence requires. */
  test('the desktop shows its wallpaper with its credit', async ({ page }) => {
    await page.goto('/os?embed=1');
    const wallpaper = page.locator('.os-wallpaper img');
    await expect.poll(() => wallpaper.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThanOrEqual(960);
    const credit = page.locator('.os-wallpaper-credit');
    await expect(credit).toContainText('NASA, ESA, CSA, STScI; J. DePasquale, A. Koekemoer, A. Pagan (STScI).');
    await expect(credit.getByRole('link')).toHaveAttribute('href', 'https://esawebb.org/images/weic2216a/');
  });

  /** Catches a site link inside a window loading a page instead of a window, or Copy link copying a bare path. */
  test('site links open their window, and Copy link copies the window address', async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/os?embed=1#projects/${PROJECT.slug}`);
    const reader = page.getByRole('dialog', { name: PROJECT.title });
    // The site has no plain pages: the window's address (which opens the room and this window) goes to the clipboard.
    await reader.getByRole('button', { name: 'Copy link' }).click();
    await expect(reader.getByRole('button', { name: 'Link copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/projects/${PROJECT.slug}`);
    await expect(page).toHaveURL(new RegExp(`/os\\?embed=1#projects/${PROJECT.slug}$`));

    await page.goto('/os?embed=1#blog/redaction-is-not-enough');
    await page
      .getByRole('dialog', { name: 'Redaction is not enough' })
      .getByRole('link', { name: 'separately' })
      .click();
    await expect(page.getByRole('dialog', { name: 'The same-person problem' })).toBeVisible();
    await expect(page).toHaveURL(/\/os\?embed=1#blog\/the-same-person-problem$/);
  });

  /** Catches a Terminal whose commands stop reaching the content or the window manager. */
  test('the Terminal lists and opens projects', async ({ page }) => {
    await page.goto('/os?embed=1#terminal');
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
    await serveGithubFiles(page, 'import napari  # the viewer\n');
    await page.goto(`/os?embed=1#projects/${PROJECT.slug}`);
    await expect(page.getByRole('heading', { level: 2, name: firstH2('projects', PROJECT.slug) })).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    expect(await seriousAxeViolations(page)).toEqual([]);

    // Every window with its own colours or layout, each alone in a fresh load (stacked windows overlap their controls).
    for (const [hash, name, ready] of [
      ['films', 'Films', '#film-favourites'],
      ['oven', 'In the oven', 'h3'],
      ['projects', 'Projects', '.os-row'],
      ['about', 'About', '.os-prose p'],
      ['personal', 'Personal', '.os-folder-item'],
      ['code', 'Code', '.os-row'],
      [`code/${NAPARI.slug}`, 'samcell-napari', '.os-readme h1'],
      [`code/${NAPARI.slug}/tree`, 'samcell-napari', '.os-code-files td'],
      [`code/${NAPARI.slug}/blob/main/samcell_napari/__init__.py`, 'samcell-napari', '.os-code-text .l'],
      [`code/${NAPARI.slug}/commits`, 'samcell-napari', '.os-code-commits li'],
      ['photography', 'A Narrative in a Frame', '.os-print'],
      [`photography/${PHOTO.slug}`, 'A Narrative in a Frame', '.os-photo-figure'],
    ]) {
      await page.goto(`/os?embed=1#${hash}`);
      await page.reload();
      const win = page.getByRole('dialog', { name });
      await expect(win.locator(ready).first(), hash).toBeVisible();
      // Measured once the open spring has settled; mid-fade, every colour reads lighter than it is.
      await expect(win).toHaveCSS('opacity', '1');
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
    await page.goto('/os?embed=0');
    // A phone boots into About, like the monitor; Back shows the apps.
    const about = page.getByRole('dialog', { name: 'About' });
    await expect(about).toBeVisible();
    await about.getByRole('button', { name: '‹ Back' }).tap();
    await expect(about).toBeHidden();
    await page.getByRole('button', { name: 'Projects', exact: true }).tap();
    const app = page.getByRole('dialog', { name: 'Projects' });
    await expect(app).toBeVisible();
    // Polled, because the app slides in on a spring before it settles at the screen's edges.
    await expect.poll(() => app.boundingBox()).toEqual({ x: 0, y: 0, ...iPhone13.viewport });
    expect(await seriousAxeViolations(page)).toEqual([]);
    await app.getByRole('button', { name: '‹ Back' }).tap();
    await expect(app).toBeHidden();
    await expect(page.getByRole('button', { name: 'Code', exact: true })).toBeVisible();
  });

  /** Catches the new and changed windows failing axe, or spilling sideways, on a phone. */
  test('About, Code, the shelves, the folder and the photographs fit a phone and pass axe', async ({ page }) => {
    await serveShelves(page, 'sample');
    await serveGithubFiles(page, '[build-system]\nrequires = ["setuptools>=42"]\n');
    for (const [hash, name] of [
      ['about', 'About'],
      ['code', 'Code'],
      [`code/${NAPARI.slug}`, 'samcell-napari'],
      [`code/${NAPARI.slug}/tree`, 'samcell-napari'],
      [`code/${NAPARI.slug}/blob/main/${NAPARI.file}`, 'samcell-napari'],
      ['books', 'Books'],
      ['recipes/sample-loaf', 'Kitchen'],
      ['voyager', 'Voyager Golden Record'],
      ['personal', 'Personal'],
      ['photography', 'A Narrative in a Frame'],
      ['photography/cansupport', 'A Narrative in a Frame'],
    ]) {
      await page.goto(`/os?embed=0#${hash}`);
      await page.reload();
      const app = page.getByRole('dialog', { name });
      await expect.poll(() => app.boundingBox(), hash).toEqual({ x: 0, y: 0, ...iPhone13.viewport });
      const body = app.locator('.os-phone-body');
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth), hash).toBeLessThanOrEqual(0);
      expect(await seriousAxeViolations(page), hash).toEqual([]);
    }
  });
});
