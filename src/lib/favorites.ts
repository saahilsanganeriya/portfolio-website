// The four films pinned on the member's Letterboxd profile. Letterboxd answers profile-page requests with 403 and
// the RSS carries no favourites, so the account export's profile.csv is the source. Its boxd.it short links are
// resolved politely: a browser User-Agent, 10 s per request, every request on the shared pacer (≤ 1 per 2 s).
import { sharedPacer, type Pacer } from './films/pace.ts';
import { parseCsv } from './films/parse.ts';

export interface Favorite {
  /** Letterboxd film slug, as in https://letterboxd.com/film/<slug>/. */
  slug: string;
  title: string;
  year: number;
  director: string;
  /** Hand-drawn runtime art (`/room/posters/<slug>.avif`, a .ktx2 beside it), or null to draw it with renderPoster. */
  poster: string | null;
}

export interface Favorites {
  source: string;
  updated: string;
  films: Favorite[];
}

export const FAVORITES_SOURCE = 'letterboxd profile.csv Favorite Films';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 ' +
  "(saahilsanganeriya.com; resolves one member's own four favourite films)";
const TIMEOUT_MS = 10_000;
const SHORT_LINK = /^https:\/\/boxd\.it\/[A-Za-z0-9]+$/;
const FILM_URL = /^https:\/\/letterboxd\.com\/film\/([a-z0-9-]+)\/?$/;

/** The boxd.it links in profile.csv's Favorite Films column, in profile order. */
export function parseFavoriteLinks(profileCsv: string): string[] {
  const [header, row] = parseCsv(profileCsv);
  const column = header?.indexOf('Favorite Films') ?? -1;
  if (column < 0 || !row) throw new Error('profile.csv has no Favorite Films column');
  const links = (row[column] ?? '').split(',').map((link) => link.trim()).filter(Boolean);
  const odd = links.find((link) => !SHORT_LINK.test(link));
  if (odd) throw new Error(`profile.csv lists a favourite that is not a boxd.it link: ${odd}`);
  return links;
}

export function slugFromFilmUrl(url: string): string {
  const slug = FILM_URL.exec(url)?.[1];
  if (!slug) throw new Error(`not a Letterboxd film URL: ${url}`);
  return slug;
}

const decodeEntities = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const meta = (html: string, attr: string, name: string) =>
  html.match(new RegExp(`<meta[^>]*\\s${attr}="${name}"[^>]*\\scontent="([^"]*)"`))?.[1] ??
  html.match(new RegExp(`<meta[^>]*\\scontent="([^"]*)"[^>]*\\s${attr}="${name}"`))?.[1];

/** Title, year and director from a film page's Open Graph and Twitter card tags; "A, B" becomes "A and B". */
export function parseFilmPage(html: string): Omit<Favorite, 'slug' | 'poster'> {
  const heading = decodeEntities(meta(html, 'property', 'og:title') ?? '');
  const match = /^(.*\S)\s+\((\d{4})\)$/.exec(heading);
  if (!match) throw new Error(`film page has no "Title (Year)" og:title: ${heading || 'none'}`);
  if (meta(html, 'name', 'twitter:label1') !== 'Directed by') throw new Error('film page names no director');
  const directors = decodeEntities(meta(html, 'name', 'twitter:data1') ?? '').split(/\s*,\s*/).filter(Boolean);
  if (directors.length === 0) throw new Error('film page names no director');
  const director = directors.length === 1 ? directors[0] : `${directors.slice(0, -1).join(', ')} and ${directors.at(-1)}`;
  return { title: match[1], year: Number(match[2]), director };
}

export interface ResolveOptions {
  fetchImpl?: typeof fetch;
  pacer?: Pacer;
}

async function politeGet(url: string, { fetchImpl = fetch, pacer = sharedPacer }: ResolveOptions) {
  await pacer.wait();
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 403 || response.status === 429) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).host} for ${url}; try again later`);
  }
  return response;
}

/** One favourite from its boxd.it link: the redirect names the slug, the film page the title, year and director. */
export async function resolveFavorite(link: string, options: ResolveOptions = {}): Promise<Omit<Favorite, 'poster'>> {
  const redirect = await politeGet(link, options);
  const location = redirect.headers.get('location');
  if (redirect.status < 300 || redirect.status > 399 || !location) {
    throw new Error(`${link} did not redirect to a film (HTTP ${redirect.status})`);
  }
  const slug = slugFromFilmUrl(new URL(location, link).href);
  const page = await politeGet(`https://letterboxd.com/film/${slug}/`, options);
  if (!page.ok) throw new Error(`HTTP ${page.status} for the ${slug} film page`);
  return { slug, ...parseFilmPage(await page.text()) };
}

/** The new favorites.json; `updated` moves only when the list itself changed, so a re-run is a no-op. */
export function buildFavorites(films: Favorite[], previous: Favorites | null, now: Date): Favorites {
  if (previous && JSON.stringify(previous.films) === JSON.stringify(films)) return previous;
  return { source: FAVORITES_SOURCE, updated: now.toISOString(), films };
}
