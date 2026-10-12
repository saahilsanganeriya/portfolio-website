// Builds the site, then checks the output: every content entry has its page and JSON body, every page carries the
// tags a shared link needs (title, description, og:title, og:image) and one <h1>, and no internal link or anchor is broken.
// Usage: node scripts/check-routes.mjs [--samples] [--no-build]   (--samples builds with SAMPLES=1: drafts and samples)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const CONTENT = join(ROOT, 'src/content');
const withSamples = process.argv.includes('--samples');

// Pages linked from the text index but built separately; a link to one passes while its page is absent.
const PENDING_ROUTES = ['/os', '/story'];

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
const pending = new Set();

// ---- content entries → expected files ----

const entryIds = (collection) => {
  const dirs = [join(CONTENT, collection), ...(withSamples ? [join(CONTENT, '_samples', collection)] : [])];
  return dirs
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((file) => /^[^_].*\.mdx?$/.test(file))
        .filter((file) => withSamples || !/^draft:\s*true\s*$/m.test(frontmatter(join(dir, file))))
        .map((file) => file.replace(/\.mdx?$/, '')),
    );
};

const frontmatter = (path) => readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';

const expectFile = (path, why) => {
  if (!existsSync(join(DIST, path))) problems.push(`missing ${path} (${why})`);
};

for (const id of entryIds('projects')) {
  expectFile(`projects/${id}/index.html`, `project ${id}`);
  expectFile(`content/projects/${id}.json`, `project ${id}`);
}
for (const id of entryIds('blog')) {
  expectFile(`blog/${id}/index.html`, `post ${id}`);
  expectFile(`content/blog/${id}.json`, `post ${id}`);
}
for (const id of entryIds('pages')) {
  expectFile(`${id}/index.html`, `page ${id}`);
  expectFile(`content/pages/${id}.json`, `page ${id}`);
}
for (const id of entryIds('story')) {
  expectFile(`content/story/${id}.json`, `story chapter ${id}`);
}

// ---- every built page ----

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.html') ? [join(dir, d.name)] : [],
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

const pages = walk(DIST);
for (const file of pages) {
  const page = '/' + relative(DIST, file);
  const html = readHtml(file);

  if (!/<title>[^<\s][^<]*<\/title>/.test(html)) problems.push(`${page}: no <title>`);
  if (!metaContent(html, 'name', 'description')) problems.push(`${page}: no meta description`);
  if (!metaContent(html, 'property', 'og:title')) problems.push(`${page}: no og:title`);
  if (!metaContent(html, 'property', 'og:image')) problems.push(`${page}: no og:image`);
  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) problems.push(`${page}: ${h1s} <h1> elements`);

  for (const [, href] of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) {
    if (!href.startsWith('/') && !href.startsWith('#')) continue;
    if (href.startsWith('//')) continue;
    const [beforeHash, fragment = ''] = href.split('#');
    const pathname = decodeURIComponent(beforeHash.split('?')[0]);
    const target = pathname === '' ? file : resolveTarget(pathname);
    if (!target) {
      const route = pathname.replace(/\/$/, '');
      if (PENDING_ROUTES.includes(route)) pending.add(route);
      else problems.push(`${page}: broken link ${href}`);
      continue;
    }
    if (fragment && target.endsWith('.html') && !readHtml(target).includes(`id="${fragment}"`)) {
      problems.push(`${page}: link ${href} names a missing anchor`);
    }
  }
}

if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join('\n'));
  console.error(`check-routes: ${problems.length} problem(s) in ${pages.length} pages`);
  process.exit(1);
}
for (const route of pending) console.log(`pending: ${route} is linked but not built yet`);
console.log('ok');
