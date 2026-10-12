// Reads the member's public Letterboxd RSS politely and merges it over the archive; never fails the caller.
//   timeout 10 s per attempt · one retry after 1–3 s of jitter · none after 403/429 · redirects not followed
//   · every attempt waits on the shared pacer (≤ 1 request per 2 s) · only the RSS, never paginated user pages.
import { buildFilmsData, FEED_URL, mergeEntries, withholdNamedReviews, type FilmsData } from './merge.ts';
import { sharedPacer, type Pacer } from './pace.ts';
import { parseFeed } from './parse.ts';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 ' +
  "(saahilsanganeriya.com; reads one member's own public diary feed)";
const TIMEOUT_MS = 10_000;
const ONE_HOUR_MS = 60 * 60 * 1000;

class FeedBlockedError extends Error {}

export interface FeedOptions {
  fetchImpl?: typeof fetch;
  pacer?: Pacer;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function fetchFeed({
  fetchImpl = fetch,
  pacer = sharedPacer,
  random = Math.random,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: FeedOptions = {}): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    await pacer.wait();
    try {
      const response = await fetchImpl(FEED_URL, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5' },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 403 || response.status === 429) {
        throw new FeedBlockedError(`HTTP ${response.status} from Letterboxd`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} from Letterboxd`);
      const body = await response.text();
      // Cloudflare can answer 200 with a challenge page instead of the feed.
      if (!body.includes('<rss')) throw new Error('the answer was not an RSS feed');
      return body;
    } catch (error) {
      if (error instanceof FeedBlockedError || attempt === 2) throw error;
      await sleep(1000 + random() * 2000);
    }
  }
}

export interface Collected {
  data: FilmsData;
  /** Why the feed was not used; absent when the live feed was merged. */
  failure?: string;
}

/**
 * `base` with the live feed merged over it (feed wins per film and watched date). On any failure returns `base`
 * unchanged with the reason. Live reviews that name anyone in `privateNames` lose their text.
 */
export async function collectFilms(
  base: FilmsData,
  { readFeed = () => fetchFeed(), now = () => new Date(), privateNames = [] as readonly string[] } = {},
): Promise<Collected> {
  try {
    const { entries } = parseFeed(await readFeed());
    if (entries.length === 0) throw new Error('the feed held no diary entries');
    const live = withholdNamedReviews(entries, privateNames);
    return { data: buildFilmsData(mergeEntries(base.entries, live), now().toISOString()) };
  } catch (error) {
    return { data: base, failure: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The live films for a long-running server: at most one feed read per hour per process (failed or not; the slot is
 * taken before the read, so concurrent calls never read twice), the last good merge kept, one warning per failed
 * read. Vercel ISR caches the route for an hour on top of this.
 */
export function createFilmsSource(
  fallback: FilmsData,
  { readFeed = () => fetchFeed(), now = () => new Date(), privateNames = [] as readonly string[], warn = console.warn } = {},
) {
  let current = fallback;
  let nextReadAt = 0;
  return async function films(): Promise<FilmsData> {
    if (now().getTime() < nextReadAt) return current;
    nextReadAt = now().getTime() + ONE_HOUR_MS;
    const { data, failure } = await collectFilms(current, { readFeed, now, privateNames });
    if (failure) warn(`films: live feed unavailable, serving the archive and the last good copy (${failure})`);
    else current = data;
    return current;
  };
}

/** Comma-separated names whose mention withholds a live review, kept out of git (FILMS_PRIVATE_NAMES). */
export const privateNamesFrom = (value: string | undefined) =>
  (value ?? '').split(',').map((name) => name.trim()).filter(Boolean);
