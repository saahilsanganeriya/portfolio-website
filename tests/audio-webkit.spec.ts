import { expect, test } from '@playwright/test';
import { musicTests } from './music';

// The music's first-gesture checks in WebKit (Safari's engine), which has WebGL on its own.
test.use({ browserName: 'webkit', launchOptions: { args: [] }, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

// The project is Desktop Chrome; this file must still run in WebKit, or it proves nothing about Safari.
test.beforeEach(({ browserName }) => expect(browserName).toBe('webkit'));

musicTests();
