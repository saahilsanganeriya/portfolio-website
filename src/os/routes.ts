import { codeSlugForGithub, parseCodeSlug } from './apps/code/model';
import { APP_IDS, type AppId, type Route } from './types';

const isAppId = (value: string): value is AppId => (APP_IDS as readonly string[]).includes(value);

/** `projects/swe-sim`, `#films/la-la-land` or `about` → a route; anything else → null. */
export function parseTarget(target: string): Route | null {
  let clean: string;
  try {
    clean = decodeURIComponent(target.replace(/^#/, '').trim()).replace(/\/+$/, '');
  } catch {
    return null;
  }
  const [app, ...rest] = clean.split('/');
  if (!isAppId(app)) return null;
  const slug = rest.join('/');
  return slug ? { app, slug } : { app };
}

export function formatRoute(route: Route): string {
  return route.slug ? `${route.app}/${route.slug}` : route.app;
}

// Projects and posts open one reader window per slug, repositories one Code window each; a films, photography or
// recipes slug points inside that app's one window.
export function windowIdFor(route: Route): string {
  if (route.app === 'code' && route.slug) {
    const code = parseCodeSlug(route.slug);
    if (code) return `code/${code.owner}/${code.repo}`.toLowerCase();
  }
  return route.slug && (route.app === 'projects' || route.app === 'blog') ? formatRoute(route) : route.app;
}

/** The window's own address on the site; visiting it loads the room and opens this window on the monitor. */
export function windowHref(route: Route): string | null {
  switch (route.app) {
    case 'projects':
    case 'blog':
      return route.slug ? `/${route.app}/${route.slug}` : `/${route.app}`;
    case 'films':
      return route.slug ? `/films#${route.slug}` : '/films';
    case 'about':
    case 'resume':
    case 'credits':
      return `/${route.app}`;
    // No pages of their own: the room's address opens them on the monitor (the bookshelf, the oven, the record).
    case 'books':
    case 'voyager':
      return `/#${route.app}`;
    case 'recipes':
    case 'code':
      return route.slug ? `/#${route.app}/${route.slug}` : `/#${route.app}`;
    case 'photography':
    case 'terminal':
    case 'oven':
    case 'browser':
      return null;
  }
}

const PATH_APPS: Record<string, AppId> = {
  projects: 'projects',
  blog: 'blog',
  films: 'films',
  about: 'about',
  resume: 'resume',
  credits: 'credits',
};

/** A same-site URL that has an OS window (`/projects/x`, `/about`, `/os#films`, `/#books`) → its route. */
function routeForUrl(url: URL): Route | null {
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] === 'os') return url.hash ? parseTarget(url.hash) : null;
  const app = PATH_APPS[parts[0] ?? ''];
  if (!app || parts.length > 2) return null;
  if (parts[1] && app !== 'projects' && app !== 'blog') return null;
  if (app === 'films' && url.hash) return { app, slug: url.hash.slice(1) };
  return parts[1] ? { app, slug: parts[1] } : { app };
}

// Sites checked to allow framing (no X-Frame-Options and no frame-ancestors; evidence/T45/frame-headers.txt) open in
// SaahilOS's own browser window; every other site opens in a new tab. GitHub forbids framing: the Code window reads it.
export const FRAMEABLE_HOSTS: readonly string[] = [
  'en.wikipedia.org',
  'commons.wikimedia.org',
  'saahilsanganeriaphotography.wordpress.com',
  'esawebb.org',
  'napari.org',
  'opensource.org',
  'polyhaven.com',
  'ambientcg.com',
  'threejs.org',
];

type LinkTarget = { kind: 'window'; route: Route } | { kind: 'external' } | { kind: 'other' };

/**
 * How a link inside the OS behaves. Own pages, GitHub and the framable sites open a window; everything else opens in
 * a new tab. Nothing replaces the whole tab, so a visitor never leaves the room.
 */
export function classifyLink(href: string, origin: string): LinkTarget {
  if (href.startsWith('#')) {
    const route = parseTarget(href);
    return route ? { kind: 'window', route } : { kind: 'other' };
  }
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return { kind: 'other' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'other' };
  if (url.origin !== origin) {
    const code = codeSlugForGithub(url);
    if (code !== null) return { kind: 'window', route: code ? { app: 'code', slug: code } : { app: 'code' } };
    if (FRAMEABLE_HOSTS.includes(url.hostname)) return { kind: 'window', route: { app: 'browser', slug: url.href } };
    return { kind: 'external' };
  }
  // Files (the résumé PDF, feeds) open in a new tab rather than inside the monitor.
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return { kind: 'external' };
  // An own address with no window of its own (the room's front page) opens About, the window the room opens first.
  return { kind: 'window', route: routeForUrl(url) ?? { app: 'about' } };
}
