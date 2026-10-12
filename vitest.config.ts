import { defineConfig } from 'vitest/config';

// Unit tests only: Playwright owns tests/*.spec.ts and fails when vitest collects them.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
