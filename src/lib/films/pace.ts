// The one Letterboxd rate limit for the process (the idea of projectionist's lbpace): every request waits on
// it first, so concurrent callers send at most one request per FLOOR_MS between them.
export const FLOOR_MS = 2000;

export interface Pacer {
  /** Resolves when the caller may send one request; each caller reserves its slot before it sleeps. */
  wait(): Promise<void>;
}

export function createPacer({
  floorMs = FLOOR_MS,
  now = () => Date.now(),
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: { floorMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Pacer {
  let next = 0;
  return {
    async wait() {
      const start = Math.max(now(), next);
      next = start + floorMs;
      const delay = start - now();
      if (delay > 0) await sleep(delay);
    },
  };
}

export const sharedPacer = createPacer();
