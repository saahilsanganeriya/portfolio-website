import { readFileSync } from 'node:fs';
import { devices, expect, test, type Page } from '@playwright/test';

// The SaahilOS Terminal, one test per command. Commands are typed with the page's keyboard, never filled into the
// field, so every test also proves the prompt holds the keyboard the way a visitor's typing reaches it.

const SWE_SIM = (() => {
  const snapshot = JSON.parse(
    readFileSync(new URL('../src/os/apps/code/snapshot/repos/saahilsanganeriya--swe-sim.json', import.meta.url), 'utf8'),
  ) as { commits: { sha: string; message: string }[] };
  const [latest] = snapshot.commits;
  return { sha: latest!.sha.slice(0, 7), subject: latest!.message.split('\n')[0]! };
})();
const ABOUT_FIRST_WORDS = 'When I was in kindergarten';
const PROJECT = { slug: 'swe-sim', title: 'swe-sim: a SWE simulator for coding-agent tasks' };

async function openTerminal(page: Page, url = '/os?embed=1') {
  await page.goto(url);
  // About opens once the OS has hydrated; a double-click before that reaches only the server's markup.
  await expect(page.getByRole('dialog', { name: 'About' })).toBeVisible();
  await page.getByRole('button', { name: 'Terminal', exact: true }).dblclick();
  const prompt = page.getByRole('dialog', { name: 'Terminal' }).getByRole('textbox');
  await expect(prompt).toBeFocused();
  const log = page.getByRole('log', { name: 'Terminal output' });
  const run = async (command: string) => {
    await page.keyboard.type(command);
    await page.keyboard.press('Enter');
  };
  return { prompt, log, run };
}

test.describe('Terminal', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Catches the prompt losing the keyboard to its own window, or a first command landing in the middle of the boot log. */
  test('the prompt keeps the keyboard, and a first key prints the boot log before the command', async ({ page }) => {
    const { log, run, prompt } = await openTerminal(page);
    await run('whoami');
    const lines = await log.locator('p').allTextContents();
    const echo = lines.findIndex((l) => l.endsWith('$ whoami'));
    expect(lines.slice(0, echo).some((l) => l.includes('Type help for the commands'))).toBe(true);
    // Raised again from its title bar, the window hands the keyboard straight back to the prompt.
    await page.getByRole('dialog', { name: 'Terminal' }).locator('.os-titlebar-text').click();
    await expect(prompt).toBeFocused();
  });

  /** Catches help missing a command a visitor needs. */
  test('help lists the commands', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('help');
    for (const command of ['ls [folder]', 'cd <folder>', 'cat <file>', 'open <name>', 'git log', 'whoami', 'history', 'clear'])
      await expect(log).toContainText(command);
  });

  /** Catches ls refusing the names it prints itself (projects/ with its slash), or a folder listed without titles. */
  test('ls lists home, a folder by the name it printed, and says when nothing is there', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('ls');
    await expect(log).toContainText('about.txt  resume.pdf  projects/  writing/  code/  photos/');
    await run('ls projects/');
    await expect(log.locator('p').filter({ hasText: `${PROJECT.slug}.md` })).toContainText(PROJECT.title);
    await run('ls nowhere');
    await expect(log).toContainText("ls: cannot access 'nowhere': No such file or directory");
  });

  /** Catches cd not moving, the prompt not following it, or a file accepted as a folder. */
  test('cd moves through the tree and the prompt and pwd follow', async ({ page }) => {
    const { log, run, prompt } = await openTerminal(page);
    await run('cd projects');
    await expect(prompt).toHaveAccessibleName('Command, in ~/projects');
    await run('pwd');
    await expect(log).toContainText('/home/saahil/projects');
    await run('cd ../about.txt');
    await expect(log).toContainText('cd: not a directory: ../about.txt');
    await run('cd');
    await expect(prompt).toHaveAccessibleName('Command, in ~');
  });

  /** Catches cat printing nothing for a page, or treating a folder as a file. */
  test('cat prints About, a project and a post as text', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('cat about.txt');
    await expect(log).toContainText(ABOUT_FIRST_WORDS);
    await run(`cat projects/${PROJECT.slug}.md`);
    await expect(log).toContainText(`# ${PROJECT.title}`);
    await run('cat writing/safe-to-run-twice.md');
    await expect(log).toContainText('# Safe to run twice');
    await run('cat projects');
    await expect(log).toContainText('cat: projects: Is a directory');
  });

  /** Catches open reaching no window for an app, a file or a slug. */
  test('open shows an app, a file or a project in its window', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run(`open projects/${PROJECT.slug}.md`);
    await expect(page.getByRole('dialog', { name: PROJECT.title })).toBeVisible();
    await page.getByRole('dialog', { name: 'Terminal' }).locator('.os-titlebar-text').click();
    await run('open contact');
    await expect(page.getByRole('dialog', { name: 'Contact' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Terminal' }).locator('.os-titlebar-text').click();
    await run('open nothing-here');
    await expect(log).toContainText('open: nothing-here: nothing by that name. Try ls.');
  });

  /** Catches whoami saying nothing about whose machine this is. */
  test('whoami names him', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('whoami');
    await expect(log).toContainText('saahil');
    await expect(log).toContainText('Saahil Sanganeriya, software engineer at Mercor.');
  });

  /** Catches history forgetting commands, and Up not bringing the last one back. */
  test('history numbers what was typed, and Up recalls it', async ({ page }) => {
    const { log, run, prompt } = await openTerminal(page);
    await run('pwd');
    await run('history');
    await expect(log).toContainText('   1  pwd');
    await expect(log).toContainText('   2  history');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(prompt).toHaveValue('pwd');
  });

  /** Catches clear or Ctrl+L leaving the old output on screen. */
  test('clear and Ctrl+L empty the screen', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('help');
    await run('clear');
    await expect(log.locator('p')).toHaveCount(0);
    await run('pwd');
    await page.keyboard.press('Control+l');
    await expect(log.locator('p')).toHaveCount(0);
  });

  /** Catches git log outside a repository pretending to work, or inside one not reading the snapshot's commits. */
  test('git log reads a repository in ~/code, and refuses outside one', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('git log');
    await expect(log).toContainText('fatal: not a git repository');
    await run('cd code/swe-sim');
    await run('git log');
    await expect(log).toContainText(`${SWE_SIM.sha}  `);
    await expect(log).toContainText(SWE_SIM.subject);
  });

  /** Catches Tab finishing nothing, or finishing a folder without its slash. */
  test('Tab finishes a file and a folder', async ({ page }) => {
    const { prompt } = await openTerminal(page);
    await page.keyboard.type('cat ab');
    await page.keyboard.press('Tab');
    await expect(prompt).toHaveValue('cat about.txt ');
    await prompt.fill('');
    await page.keyboard.type('cd pro');
    await page.keyboard.press('Tab');
    await expect(prompt).toHaveValue('cd projects/');
  });

  /** Catches rm -rf / failing to play its fake wipe, or leaving the desktop dark afterwards. */
  test('rm -rf / wipes the desktop for a moment, then everything is back', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('rm -rf /');
    await expect(page.locator('.os')).toHaveAttribute('data-wiped', '');
    await expect(log).toContainText('removing ~/projects');
    await expect(log).toContainText('nice try.');
    await expect(page.locator('.os')).not.toHaveAttribute('data-wiped');
    await expect(page.getByRole('navigation', { name: 'Apps' }).getByRole('button', { name: 'About' })).toBeVisible();
  });

  /** Catches sudo answering anything but the sudoers line. */
  test('sudo is refused, and the incident reported', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('sudo rm -rf /');
    await expect(log).toContainText('saahil is not in the sudoers file. This incident will be reported.');
    await expect(page.locator('.os')).not.toHaveAttribute('data-wiped');
  });

  /** Catches exit leaving the Terminal open. */
  test('exit closes the Terminal', async ({ page }) => {
    const { run } = await openTerminal(page);
    await run('exit');
    await expect(page.getByRole('dialog', { name: 'Terminal' })).toHaveCount(0);
  });

  /** Catches vim with no way out: the start screen says how to quit, and :q! works. */
  test('vim shows how to quit, and :q! quits', async ({ page }) => {
    const { log, run, prompt } = await openTerminal(page);
    await run('vim');
    await expect(log).toContainText('type  :q<Enter>');
    await expect(prompt).toHaveAccessibleName('vim command');
    await run('hello');
    await run(':q!');
    await expect(log).toContainText('Back in the shell.');
    await expect(prompt).toHaveAccessibleName('Command, in ~');
  });

  /** Catches ssh nas losing the projectionist status, or another host pretending to connect. */
  test('ssh nas prints projectionist’s status, from its write-up', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('ssh nas');
    await expect(log).toContainText('stages          15');
    await expect(log).toContainText('Connection to nas closed.');
    await run('ssh example.com');
    await expect(log).toContainText('ssh: connect to host example.com port 22: Connection refused');
  });

  /** Catches an unknown command printing nothing. */
  test('an unknown command gets a short reply', async ({ page }) => {
    const { log, run } = await openTerminal(page);
    await run('make coffee');
    await expect(log).toContainText('make: command not found. Type help.');
  });
});

test.describe('Terminal on an iPhone 13', () => {
  const { defaultBrowserType: _webkit, ...iPhone13 } = devices['iPhone 13'];
  test.use(iPhone13);

  /** Catches a phone keyboard that autocorrects commands, or output that pushes the prompt out of view. */
  test('a tap gives the prompt the keyboard, without autocorrect, and the prompt stays in view', async ({ page }) => {
    await page.goto('/os?embed=0#terminal');
    const terminal = page.getByRole('dialog', { name: 'Terminal' });
    const prompt = terminal.getByRole('textbox', { name: /^Command/ });
    await terminal.locator('.os-terminal-log').tap();
    await expect(prompt).toBeFocused();
    await expect(prompt).toHaveAttribute('autocorrect', 'off');
    await expect(prompt).toHaveAttribute('autocapitalize', 'none');
    await page.keyboard.type('cat about.txt');
    await page.keyboard.press('Enter');
    await expect(terminal.getByRole('log')).toContainText(ABOUT_FIRST_WORDS);
    await expect.poll(async () => {
      const box = (await prompt.boundingBox())!;
      return box.y + box.height <= iPhone13.viewport.height;
    }).toBe(true);
  });
});
