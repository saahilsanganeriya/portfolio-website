import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';

const APPS = ['Projects', 'Blog', 'Films', 'A Narrative in a Frame', 'Terminal', 'About', 'Résumé', 'Credits'];

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
    await page.goto('/os#projects/sample-project');
    const reader = page.getByRole('dialog', { name: 'Sample project' });
    await expect(reader.getByRole('heading', { level: 2, name: 'What it does' })).toBeVisible();
    await expect(page).toHaveURL(/#projects\/sample-project$/);

    await page.goto('/os#films/la-la-land');
    await expect(page.getByRole('dialog', { name: 'Films' }).locator('#film-la-la-land')).toBeFocused();
  });

  /** Catches links inside the monitor that would load a page into the iframe instead of a tab or a window. */
  test('links: other sites in a new tab, "Open as page" in the whole tab, site pages in a window', async ({ page }) => {
    await page.goto('/os#projects/sample-project');
    const reader = page.getByRole('dialog', { name: 'Sample project' });
    const source = reader.getByRole('link', { name: 'Source code' });
    await expect(source).toHaveAttribute('target', '_blank');
    await expect(source).toHaveAttribute('rel', 'noopener');
    const asPage = reader.getByRole('link', { name: 'Open as page ↗' });
    await expect(asPage).toHaveAttribute('target', '_top');
    await expect(asPage).toHaveAttribute('href', '/projects/sample-project');
    await asPage.click();
    await expect(page).toHaveURL(/\/projects\/sample-project$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sample project' })).toBeVisible();

    await page.goto('/os#blog/sample-post');
    await page
      .getByRole('dialog', { name: 'How a post looks' })
      .getByRole('link', { name: 'the projects page' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Projects' })).toBeVisible();
    await expect(page).toHaveURL(/\/os#projects$/);
  });

  /** Catches a Terminal whose commands stop reaching the content or the window manager. */
  test('the Terminal lists and opens projects', async ({ page }) => {
    await page.goto('/os#terminal');
    const prompt = page.getByRole('textbox', { name: 'Command' });
    await prompt.fill('ls projects');
    await prompt.press('Enter');
    await expect(page.getByRole('log', { name: 'Terminal output' })).toContainText('sample-project');
    await prompt.fill('open sample-project');
    await prompt.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Sample project' })).toBeVisible();
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
    await page.goto('/os#projects/sample-project');
    await expect(page.getByRole('heading', { level: 2, name: 'What it does' })).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    expect(await seriousAxeViolations(page)).toEqual([]);
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
