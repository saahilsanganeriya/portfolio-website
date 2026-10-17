import { createHash } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

// One port per checkout, so test runs in parallel worktrees never reuse each other's server.
const port = 4400 + (createHash('sha1').update(process.cwd()).digest().readUInt16BE(0) % 500);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 4,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The production build with SAMPLES=1, so any draft post is on the pages under test too;
    // scripts/preview.mjs serves it because `astro preview` does not support the Vercel adapter's on-demand route.
    command: `SAMPLES=1 npx astro build && node scripts/preview.mjs --host 127.0.0.1 --port ${port}`,
    // The Contact window renders its form only with a Web3Forms key; tests build with a stand-in (never the real key)
    // and answer for api.web3forms.com themselves, so no run sends mail.
    env: { PUBLIC_WEB3FORMS_ACCESS_KEY: 'playwright-stand-in-key' },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
