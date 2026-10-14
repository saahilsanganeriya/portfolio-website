import { APP_IDS, type AppId, type Route } from './types';

const isAppId = (value: string): value is AppId => (APP_IDS as readonly string[]).includes(value);

/** `projects/swe-sim`, `#films/la-la-land` or `about` → a route; anything else → null. */
export function parseTarget(target: string): Route | null {
  const clean = decodeURIComponent(target.replace(/^#/, '').trim()).replace(/\/+$/, '');
  const [app, ...rest] = clean.split('/');
  if (!isAppId(app)) return null;
  const slug = rest.join('/');
  return slug ? { app, slug } : { app };
}

export function formatRoute(route: Route): string {
  return route.slug ? `${route.app}/${route.slug}` : route.app;
}

// Projects and posts open one reader window per slug; a films or photography slug points inside that app's one window.
export function windowIdFor(route: Route): string {
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
    case 'photography':
    case 'terminal':
    case 'oven':
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

/** A same-site URL that has an OS window (`/projects/x`, `/about`, `/os#films`) → its route. */
function routeForUrl(url: URL): Route | null {
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] === 'os') return url.hash ? parseTarget(url.hash) : null;
  const app = PATH_APPS[parts[0] ?? ''];
  if (!app || parts.length > 2) return null;
  if (parts[1] && app !== 'projects' && app !== 'blog') return null;
  if (app === 'films' && url.hash) return { app, slug: url.hash.slice(1) };
  return parts[1] ? { app, slug: parts[1] } : { app };
}

type LinkTarget = { kind: 'window'; route: Route } | { kind: 'top' } | { kind: 'external' } | { kind: 'other' };

/** How a link inside the OS behaves: open a window, replace the whole tab, or open a new tab. */
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
  if (url.origin !== origin) return { kind: 'external' };
  // Files (the résumé PDF, feeds) open in a new tab rather than inside the monitor.
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return { kind: 'external' };
  const route = routeForUrl(url);
  return route ? { kind: 'window', route } : { kind: 'top' };
}
