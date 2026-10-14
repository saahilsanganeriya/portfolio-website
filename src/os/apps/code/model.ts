// Addresses inside the Code window mirror GitHub's own: `code/<owner>/<repo>[/tree|blob|commits/<ref>/<path>]`, so a
// github.com link maps onto a window by swapping the host for `#code/`. Kept free of React and of the snapshot, since
// the link rules in routes.ts (in the OS's first load) use it.

export const OWNER = 'saahilsanganeriya';

export type CodeView = 'readme' | 'tree' | 'blob' | 'commits' | 'other';

export interface CodeRoute {
  owner: string;
  repo: string;
  view: CodeView;
  /** Branch, tag or commit; absent means the repository's default branch. */
  ref?: string;
  /** A path in the repository (tree, blob), or the rest of a GitHub address this window does not show (other). */
  path: string;
}

/** `saahilsanganeriya/SAMCell/blob/main/README.md` → a route; null for anything that is not owner/repo[/…]. */
export function parseCodeSlug(slug: string): CodeRoute | null {
  const [owner, rawRepo, kind, ref, ...rest] = slug.split('/');
  const repo = rawRepo?.replace(/\.git$/, '');
  if (!owner || !repo) return null;
  const path = rest.join('/');
  switch (kind) {
    case undefined:
    case '':
      return { owner, repo, view: 'readme', path: '' };
    case 'tree':
      return { owner, repo, view: 'tree', ref: ref || undefined, path };
    case 'blob':
    case 'raw':
      return path ? { owner, repo, view: 'blob', ref, path } : { owner, repo, view: 'tree', ref: ref || undefined, path: '' };
    case 'commits':
      return { owner, repo, view: 'commits', ref: ref || undefined, path: '' };
    case 'commit':
      return { owner, repo, view: 'commits', path: '' };
    default:
      return { owner, repo, view: 'other', path: [kind, ref, ...rest].filter(Boolean).join('/') };
  }
}

export function formatCodeSlug(route: CodeRoute): string {
  const base = `${route.owner}/${route.repo}`;
  switch (route.view) {
    case 'readme':
      return base;
    case 'tree':
      return route.ref || route.path ? `${base}/tree/${[route.ref ?? 'HEAD', route.path].filter(Boolean).join('/')}` : `${base}/tree`;
    case 'blob':
      return `${base}/blob/${route.ref ?? 'HEAD'}/${route.path}`;
    case 'commits':
      return route.ref ? `${base}/commits/${route.ref}` : `${base}/commits`;
    case 'other':
      return `${base}/${route.path}`;
  }
}

/** The in-OS link for a route, each path segment escaped so file names with spaces or # survive the hash. */
export function codeHref(route: CodeRoute): string {
  return `#code/${formatCodeSlug(route).split('/').map(encodeURIComponent).join('/')}`;
}

/** The same place on github.com, for the window's "Open on GitHub" link. */
export function githubHref(route: CodeRoute): string {
  return `https://github.com/${formatCodeSlug(route).split('/').map(encodeURIComponent).join('/')}`;
}

// First path segments on github.com that are site pages, not users.
const GITHUB_PAGES = new Set([
  'about', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise', 'explore', 'features', 'issues', 'join',
  'login', 'marketplace', 'notifications', 'orgs', 'pricing', 'pulls', 'search', 'security', 'settings', 'site',
  'sponsors', 'topics', 'trending',
]);

/**
 * A github.com address → the Code window's slug: '' for the owner's profile (the list of his repositories), the
 * repository path otherwise; null for other people's profiles and GitHub's own pages, which open in a new tab.
 */
export function codeSlugForGithub(url: URL): string | null {
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length === 0 || GITHUB_PAGES.has(parts[0].toLowerCase())) return null;
  if (parts.length === 1) return parts[0].toLowerCase() === OWNER ? '' : null;
  return parts.join('/');
}
