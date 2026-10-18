// Builds the site, then checks the output: every content entry has an address that is the room opening its SaahilOS
// window on the monitor, and its JSON body; no other page exists beyond the documents framed inside the room and the
// 404 page; every page carries the tags a shared link needs (title, description, og:title, og:image) and one <h1>;
// no internal link or anchor is broken, and no link is glued to the word next to it; no built file carries an email
// address or a mailto: link other than the owner's own (About and Contact print it).
// Usage: node scripts/check-routes.mjs [--samples] [--no-build]   (--samples builds with SAMPLES=1: draft posts too)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// /api/films.json is rendered on demand, so the build is in server mode and the prerendered pages land in dist/client.
const DIST = join(ROOT, 'dist', 'client');
const CONTENT = join(ROOT, 'src/content');
const withSamples = process.argv.includes('--samples');

if (!process.argv.includes('--no-build')) {
  const env = { ...process.env, ...(withSamples ? { SAMPLES: '1' } : {}) };
  const build = spawnSync('npx', ['astro', 'build'], { cwd: ROOT, env, encoding: 'utf8' });
  if (build.status !== 0) {
    process.stdout.write(build.stdout + build.stderr);
    console.error('check-routes: build failed');
    process.exit(1);
  }
}

const problems = [];

// ---- content entries → their room page (route → the window it opens; '' for none) and JSON body ----

const entryIds = (collection) => {
  const dir = join(CONTENT, collection);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^[^_].*\.mdx?$/.test(file))
    .filter((file) => withSamples || !/^draft:\s*true\s*$/m.test(frontmatter(join(dir, file))))
    .map((file) => file.replace(/\.mdx?$/, ''));
};

const frontmatter = (path) => readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';

const expectFile = (path, why) => {
  if (!existsSync(join(DIST, path))) problems.push(`missing ${path} (${why})`);
};

const ROOM_PAGES = new Map([
  ['/', ''],
  ['/projects/', 'projects'],
  ['/blog/', 'blog'],
  ['/films/', 'films'],
  ['/credits/', 'credits'],
]);
for (const id of entryIds('projects')) {
  ROOM_PAGES.set(`/projects/${id}/`, `projects/${id}`);
  expectFile(`content/projects/${id}.json`, `project ${id}`);
}
for (const id of entryIds('blog')) {
  ROOM_PAGES.set(`/blog/${id}/`, `blog/${id}`);
  expectFile(`content/blog/${id}.json`, `post ${id}`);
}
for (const id of entryIds('pages')) {
  ROOM_PAGES.set(`/${id}/`, id);
  expectFile(`content/pages/${id}.json`, `page ${id}`);
}

// ---- SaahilOS window routes ----

// SaahilOS opens windows from client-side hashes (/os#terminal, /os#projects/<slug>, /os#films/<poster>) and from a
// room page's data-open, so such a name is an app and an entry, not an HTML id.
const OS_APPS = JSON.parse(
  readFileSync(join(ROOT, 'src/os/types.ts'), 'utf8')
    .match(/APP_IDS = (\[[^\]]*\])/)[1]
    .replaceAll("'", '"')
    .replace(/,\s*\]$/, ']'),
);
const yamlIds = (collection) =>
  existsSync(join(CONTENT, collection))
    ? readdirSync(join(CONTENT, collection)).filter((f) => /^[^_].*\.ya?ml$/.test(f)).map((f) => f.replace(/\.ya?ml$/, ''))
    : [];
const OS_SLUGS = {
  projects: new Set(entryIds('projects')),
  blog: new Set(entryIds('blog')),
  recipes: new Set(entryIds('recipes')),
  photography: new Set(yamlIds('photography')),
  films: new Set(JSON.parse(readFileSync(join(CONTENT, 'films.json'), 'utf8')).posters ?? []),
};
const osRouteProblem = (fragment) => {
  const [app, slug, ...rest] = fragment.split('/');
  if (!OS_APPS.includes(app)) return 'names no SaahilOS app';
  // The Code window takes any GitHub path (owner/repo/…); it says so itself when GitHub has nothing there.
  if (app === 'code') return slug === undefined || rest.length > 0 ? null : 'names no repository (code/<owner>/<repo>)';
  if (slug !== undefined && (rest.length > 0 || !OS_SLUGS[app]?.has(slug))) return 'names no SaahilOS window';
  return null;
};

// ---- every built page ----

// Framed inside the room (/os?embed=1 on the monitor); opened on its own it replaces itself with the room. The 404
// page is the only other page.
const FRAMED_PAGES = new Set(['/os/']);
const ERROR_PAGE = '/404.html';

const walk = (dir, keep) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name), keep) : keep.test(d.name) ? [join(dir, d.name)] : [],
  );

const htmlCache = new Map();
const readHtml = (path) => {
  if (!htmlCache.has(path)) htmlCache.set(path, readFileSync(path, 'utf8'));
  return htmlCache.get(path);
};

const metaContent = (html, attr, name) =>
  html.match(new RegExp(`<meta[^>]*\\s${attr}="${name}"[^>]*\\scontent="([^"]*)"`))?.[1] ??
  html.match(new RegExp(`<meta[^>]*\\scontent="([^"]*)"[^>]*\\s${attr}="${name}"`))?.[1];

const resolveTarget = (pathname) => {
  const candidates = pathname.endsWith('/')
    ? [`${pathname}index.html`]
    : /\.[a-z0-9]+$/i.test(pathname)
      ? [pathname]
      : [`${pathname}/index.html`, `${pathname}.html`];
  return candidates.map((c) => join(DIST, c)).find((c) => existsSync(c));
};

const pages = walk(DIST, /\.html$/);
const roomPagesSeen = new Set();
for (const file of pages) {
  const page = '/' + relative(DIST, file);
  const route = page.replace(/index\.html$/, '');
  const html = readHtml(file);

  if (ROOM_PAGES.has(route)) {
    roomPagesSeen.add(route);
    const open = html.match(/<main\b[^>]*\sdata-room\b[^>]*>/)?.[0].match(/\sdata-open(?:="([^"]*)")?/);
    const expected = ROOM_PAGES.get(route);
    if (!open) problems.push(`${page}: not the room (no <main data-room data-open>)`);
    else if ((open[1] ?? '') !== expected) problems.push(`${page}: opens "${open[1] ?? ''}", expected "${expected}"`);
    else if (expected && osRouteProblem(expected)) problems.push(`${page}: data-open "${expected}" ${osRouteProblem(expected)}`);
  } else if (FRAMED_PAGES.has(route)) {
    if (!/window\.top === window\.self[^\n]*has\('embed'\)/.test(html)) problems.push(`${page}: opened on its own, it does not send the visitor to the room`);
  } else if (route !== ERROR_PAGE) {
    problems.push(`${page}: a plain page; every address is the room`);
  }

  if (!/<title>[^<\s][^<]*<\/title>/.test(html)) problems.push(`${page}: no <title>`);
  if (!metaContent(html, 'name', 'description')) problems.push(`${page}: no meta description`);
  if (!metaContent(html, 'property', 'og:title')) problems.push(`${page}: no og:title`);
  if (!metaContent(html, 'property', 'og:image')) problems.push(`${page}: no og:image`);
  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) problems.push(`${page}: ${h1s} <h1> elements`);
  // compressHTML drops a template line break that sits between a word and a link, gluing the two ("asRSS").
  for (const [glued] of html.matchAll(/[A-Za-z.,;:!?]<a\b[^>]*>[^<]{0,20}|<\/a>[A-Za-z]{1,20}/g)) {
    problems.push(`${page}: no space around a link: ${glued}`);
  }

  for (const [, href] of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) {
    if (!href.startsWith('/') && !href.startsWith('#')) continue;
    if (href.startsWith('//')) continue;
    const [beforeHash, fragment = ''] = href.split('#');
    const pathname = decodeURIComponent(beforeHash.split('?')[0]);
    const target = pathname === '' ? file : resolveTarget(pathname);
    if (!target) {
      problems.push(`${page}: broken link ${href}`);
      continue;
    }
    // The room's front page opens a window from its hash too (/#contact), as /os does inside the monitor.
    if (fragment && beforeHash && ['', '/os'].includes(pathname.replace(/\/$/, ''))) {
      const problem = osRouteProblem(decodeURIComponent(fragment));
      if (problem) problems.push(`${page}: link ${href} ${problem}`);
      continue;
    }
    if (fragment && target.endsWith('.html') && !readHtml(target).includes(`id="${fragment}"`)) {
      problems.push(`${page}: link ${href} names a missing anchor`);
    }
  }
}

// ---- no contact address ----

// The one address the site prints is the owner's own (src/site.ts; he confirmed the spelling without a 'y'). Any
// other address in a built file must be on a domain reserved for examples (RFC 2606, RFC 6761), as the posts' made-up
// ones are, and a mailto: may only reach the owner, so a misspelt copy of his address fails the build.
const OWNER_ADDRESS = 'saahilsanganeria666@gmail.com';
const TEXT_FILE = /\.(html|js|mjs|json|xml|txt|css|svg|webmanifest|map)$/i;
const ADDRESS = /[\w.%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi;
const EXAMPLE_DOMAIN = /(^|\.)(example\.(com|net|org)|example|invalid|test|localhost)$/i;
const MAILTO = /mailto:([^"'`$\\\s<>)?]*)/gi;
for (const file of walk(DIST, TEXT_FILE)) {
  const text = readFileSync(file, 'utf8');
  const where = '/' + relative(DIST, file);
  for (const [link, to] of text.matchAll(MAILTO)) {
    // The OS builds its links from the address at run time, so a bare `mailto:` prefix in a script is the owner's too.
    if (to !== OWNER_ADDRESS && !(to === '' && /\.m?js$/.test(file))) problems.push(`${where}: ${link} reaches someone other than the owner`);
  }
  for (const [address, domain] of text.matchAll(ADDRESS)) {
    if (address.toLowerCase() !== OWNER_ADDRESS && !EXAMPLE_DOMAIN.test(domain)) {
      problems.push(`${where}: an email address (${address}); the site prints only the owner's (${OWNER_ADDRESS})`);
    }
  }
}

for (const route of ROOM_PAGES.keys()) {
  if (!roomPagesSeen.has(route)) problems.push(`missing ${route} (the room opening ${ROOM_PAGES.get(route) || 'no window'})`);
}

if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join('\n'));
  console.error(`check-routes: ${problems.length} problem(s) in ${pages.length} pages`);
  process.exit(1);
}
console.log('ok');
