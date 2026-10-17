import { expect, test, type Page, type Route } from '@playwright/test';
import { SITE } from '../src/site';

// The Contact window posts to Web3Forms; every test here answers for api.web3forms.com, so no run sends mail. The test
// build carries a stand-in access key (playwright.config.ts), never the real one.
const ENDPOINT = 'https://api.web3forms.com/submit';
const VISITOR = { name: 'Test User', email: 'user@example.com', message: 'A test message from the Playwright suite.' };

async function openContact(page: Page) {
  await page.goto('/os?embed=1#contact');
  const contact = page.getByRole('dialog', { name: 'Contact' });
  await expect(contact.getByRole('textbox', { name: 'Your name' })).toBeVisible();
  return contact;
}

async function fill(page: Page) {
  const contact = page.getByRole('dialog', { name: 'Contact' });
  await contact.getByRole('textbox', { name: 'Your name' }).fill(VISITOR.name);
  await contact.getByRole('textbox', { name: 'Your email' }).fill(VISITOR.email);
  await contact.getByRole('textbox', { name: 'Message' }).fill(VISITOR.message);
}

test.use({ viewport: { width: 1440, height: 900 } });

/** Catches a send that posts the wrong fields, shows no in-flight state, or keeps the message after it went. */
test('a message goes to Web3Forms with the honeypot field, and the window says it was sent', async ({ page }) => {
  let release!: () => void;
  const answered = new Promise<void>((resolve) => (release = resolve));
  const bodies: Record<string, unknown>[] = [];
  await page.route(ENDPOINT, async (route: Route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await answered;
    await route.fulfill({ json: { success: true, message: 'Email sent successfully!' } });
  });
  const contact = await openContact(page);
  await expect(contact).toContainText('All messages get forwarded straight to my personal email.');
  await fill(page);
  await contact.getByRole('button', { name: 'Send' }).click();
  const sending = contact.getByRole('button', { name: 'Sending…' });
  await expect(sending).toHaveAttribute('aria-disabled', 'true');
  await expect(contact.getByRole('textbox', { name: 'Message' })).toHaveAttribute('readonly', '');
  release();
  await expect(contact.getByRole('status')).toHaveText(`Sent. Thanks, ${VISITOR.name}. I will reply to ${VISITOR.email}.`);
  await expect(contact.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    access_key: 'playwright-stand-in-key',
    name: VISITOR.name,
    email: VISITOR.email,
    message: VISITOR.message,
    botcheck: false,
    subject: `Message from ${VISITOR.name} on saahilsanganeriya.com`,
  });
  // The owner's address is nowhere in the window, nor in what it sent.
  await expect(contact).not.toContainText(SITE.email);
  expect(JSON.stringify(bodies[0])).not.toContain(SITE.email);
});

/** Catches a refused or failed send that loses the visitor's message or says nothing. */
test('a refusal and a failed network each say so, and keep the message', async ({ page }) => {
  await page.route(ENDPOINT, (route) =>
    route.fulfill({ status: 400, json: { success: false, message: 'Invalid access key' } }),
  );
  const contact = await openContact(page);
  await fill(page);
  await contact.getByRole('button', { name: 'Send' }).click();
  await expect(contact.getByRole('alert')).toHaveText(
    'Not sent: Invalid access key. Your message is still here; try again in a minute.',
  );
  await expect(contact.getByRole('textbox', { name: 'Message' })).toHaveValue(VISITOR.message);

  await page.unroute(ENDPOINT);
  await page.route(ENDPOINT, (route) => route.abort('connectionfailed'));
  await contact.getByRole('button', { name: 'Send' }).click();
  await expect(contact.getByRole('alert')).toContainText('Not sent: no answer from the form service.');
  await expect(contact.getByRole('textbox', { name: 'Your name' })).toHaveValue(VISITOR.name);
});

/** Catches a bot that ticks the hidden honeypot getting a message through. */
test('a ticked honeypot sends nothing', async ({ page }) => {
  let posts = 0;
  await page.route(ENDPOINT, (route) => {
    posts += 1;
    return route.fulfill({ json: { success: true, message: 'Email sent successfully!' } });
  });
  const contact = await openContact(page);
  const trap = contact.locator('input[name="botcheck"]');
  await expect(trap).toBeHidden();
  await fill(page);
  await trap.evaluate((box: HTMLInputElement) => (box.checked = true));
  await contact.getByRole('button', { name: 'Send' }).click();
  await expect(contact.getByRole('status')).toContainText('Sent.');
  expect(posts).toBe(0);
});

/** Catches a form a keyboard cannot fill in order, or errors a screen reader is not pointed to. */
test('a keyboard fills the fields in order, and each missing field says what it needs', async ({ page }) => {
  let posts = 0;
  await page.route(ENDPOINT, (route) => {
    posts += 1;
    return route.fulfill({ json: { success: true } });
  });
  const contact = await openContact(page);
  const name = contact.getByRole('textbox', { name: 'Your name' });
  await name.focus();
  await page.keyboard.press('Tab');
  await expect(contact.getByRole('textbox', { name: 'Your email' })).toBeFocused();
  await page.keyboard.type('not-an-address');
  await page.keyboard.press('Tab');
  await expect(contact.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(contact.getByRole('button', { name: 'Send' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAccessibleDescription('Add your name.');
  await expect(contact.getByRole('textbox', { name: 'Your email' })).toHaveAccessibleDescription(
    'That does not look like an email address.',
  );
  await expect(contact.getByRole('textbox', { name: 'Message' })).toHaveAccessibleDescription('Write a message.');
  expect(posts).toBe(0);
});
