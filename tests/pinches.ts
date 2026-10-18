import type { Page } from '@playwright/test';
import type {} from '../src/scene/Application/Application';

// The same trackpad pinch in Chromium (steering.spec.ts) and in WebKit (pinch-webkit.spec.ts): the room must come
// nearer by the fingers' scale in both. Chromium makes it the way Chrome on a Mac does (Input.synthesizePinchGesture
// with a mouse source: wheels with Control held, deltaY -100 ln of each step's scale), at DPR 1: Playwright's emulated
// deviceScaleFactor divides every wheel delta by it (a pinch to 1.5x arrives as -20.3 px in all at DPR 2, -40.5 at
// DPR 1), which a real screen's DPR does not. WebKit gets Safari's gesturestart / gesturechange / gestureend.

/** [scale, finger speed in px/s for Chromium, gesture steps 16 ms apart for WebKit]: a gentle pinch and a brisk one. */
export const PINCHES = [
  [1.5, 800, 9],
  [2.5, 3000, 7],
] as const;

/** From the wide view, a nudge of the wheel into the orbit, then `pinch` at (x, y); the radius before over after. */
export async function pinchRatio(page: Page, x: number, y: number, pinch: () => Promise<unknown>) {
  const radius = () => page.evaluate(() => window.__room!.orbit!.radius);
  const rests = () => page.waitForFunction(() => window.__room!.orbit !== null && !window.__room!.moving, null, { timeout: 30_000 });
  await page.evaluate(() => window.__room!.goto('idle'));
  await page.waitForFunction(() => window.__room?.phase === 'idle' && !window.__room.moving, null, { timeout: 60_000 });
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -5);
  await rests();
  const before = await radius();
  await pinch();
  await rests();
  return before / (await radius());
}

/** Safari's pinch on the room's stage: a gesture to `scale` in `steps` changes, 16 ms apart. */
export const safariPinch = (page: Page, scale: number, steps: number) =>
  page.evaluate(
    async ([to, n]) => {
      const stage = document.querySelector('[data-room-world]')!;
      const fire = (type: string, value: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'scale', { value });
        stage.dispatchEvent(event);
      };
      fire('gesturestart', 1);
      for (let k = 1; k <= n; k++) {
        fire('gesturechange', to ** (k / n));
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      fire('gestureend', to);
    },
    [scale, steps] as const,
  );
