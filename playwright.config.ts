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
    // The production build with SAMPLES=1, so the draft sample post and the samples are on the pages under test.
    command: `SAMPLES=1 npx astro build && npx astro preview --ignore-lock --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
