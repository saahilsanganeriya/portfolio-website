// Snapshots the owner's public GitHub repositories for SaahilOS's Code window: per repository its README (rendered by
// GitHub), file tree, last 30 commits and every Markdown file rendered, written under src/os/apps/code/snapshot/ and
// committed. File contents are not copied: the window reads them from raw.githubusercontent.com when opened.
// Run locally with a token (5,000 requests an hour); never at build time, where there is none and the limit is 60:
//   GH_TOKEN=$(gh auth token --user saahilsanganeriya) REPOS_WITHHOLD='<pattern>' npm run repos [-- <repo> …]
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanGithubHtml, renderedPath } from '../src/os/apps/code/github-html.ts';

const OWNER = 'saahilsanganeriya';
// The profile repository carries contact badges (a phone number), which never go on the site.
const SKIP = new Set([OWNER]);
const COMMITS = 30;
const TREE_LIMIT = 5000;
const DOCS_LIMIT = 40;
const DOC_MAX_BYTES = 400_000;
// A rendered doc larger than this is left out; the window then shows the file as text.
const DOC_HTML_MAX_BYTES = 300_000;
const TIMEOUT_MS = 30_000;
const OUT = fileURLToPath(new URL('../src/os/apps/code/snapshot/', import.meta.url));
// Words that must not reach the site: the site's trace-scan pattern plus anything the owner asked to keep off it. The
// pattern is kept outside this public repo and passed in as REPOS_WITHHOLD. A tree entry, Markdown file or commit line
// that matches is withheld (and counted, so the window can say so), never altered.
if (!process.env.REPOS_WITHHOLD) {
  console.error('repos: set REPOS_WITHHOLD to the withhold pattern (kept outside the repo; see README, Scripts)');
  process.exit(1);
}
const WITHHELD = new RegExp(process.env.REPOS_WITHHOLD, 'i');
// The site publishes one contact address (src/site.ts); any other address in a README or doc is removed.
const SITE_EMAIL = 'saahilsanganeria666@gmail.com';

if (process.env.VERCEL) {
  console.error('repos: refusing to run at Vercel build time; the snapshot is committed. Run it locally.');
  process.exit(1);
}
const token = process.env.GH_TOKEN;
if (!token) {
  console.error('repos: set GH_TOKEN (GH_TOKEN=$(gh auth token --user saahilsanganeriya) npm run repos)');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET from the GitHub API with a timeout and up to three tries (backoff with jitter) on 5xx and network errors. */
async function gh(path, accept = 'application/vnd.github+json') {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`https://api.github.com${path}`, {
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'saahilos-repos-snapshot',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404) return null;
      if (response.status >= 500 && attempt < 3) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status} ${await response.text()}`);
      return accept.includes('html') ? response.text() : response.json();
    } catch (error) {
      if (attempt >= 3 || String(error).includes('GET ')) throw error;
      await sleep(500 * 2 ** attempt + Math.random() * 300);
    }
  }
}

const HTML = 'application/vnd.github.html+json';

function withoutEmails(html) {
  const keep = (address) => address.toLowerCase() === SITE_EMAIL;
  return html
    .replace(/<a href="mailto:([^"]+)">([^<]*)<\/a>/g, (link, address) => (keep(address) ? link : '(email removed)'))
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (address) => (keep(address) ? address : '(email removed)'))
    .replace(/[\w.-]+ at [\w-]+(?: dot [\w-]+)+/g, '(email removed)');
}

/** A rendered README or doc as the window shows it, or null when it would carry withheld words. */
function publishable(html, at) {
  const clean = withoutEmails(cleanGithubHtml(html, at));
  return WITHHELD.test(clean) ? null : clean;
}

// Merge commits name the other person's branch ("from someone/branch"); the site names no one but the owner.
function commitLine(message) {
  return message
    .split('\n')[0]
    .replace(/^(Merge pull request #\d+) from \S+/, '$1')
    .replace(/^(Merge branch '[^']*') of \S+/, '$1')
    .replace(/<[^@\s>]+@[^>\s]+>/g, '')
    .trim();
}

const docId = (path) => createHash('sha1').update(path).digest('hex').slice(0, 12);

async function snapshot(meta) {
  const name = meta.name;
  const branch = meta.default_branch;
  const head = await gh(`/repos/${OWNER}/${name}/commits/${encodeURIComponent(branch)}`);
  const sha = head.sha;

  const treeResponse = await gh(`/repos/${OWNER}/${name}/git/trees/${sha}?recursive=1`);
  const all = treeResponse.tree.map((e) => [e.path, e.type === 'tree' ? 't' : e.type === 'commit' ? 'c' : 'b', e.size ?? 0]);
  const listable = all.filter(([path]) => !WITHHELD.test(path));
  const entries = listable.slice(0, TREE_LIMIT);

  const readmeHtml = await gh(`/repos/${OWNER}/${name}/readme?ref=${sha}`, HTML);
  const readmePath = (readmeHtml && renderedPath(readmeHtml)) ?? 'README.md';
  const at = (path) => ({ owner: OWNER, repo: name, ref: branch, rawRef: sha, path });
  const readmeBody = readmeHtml && publishable(readmeHtml, at(readmePath));
  const readme = readmeBody ? { path: readmePath, html: readmeBody } : null;

  const commits = (await gh(`/repos/${OWNER}/${name}/commits?sha=${sha}&per_page=${COMMITS}`)).map((c) => {
    const message = commitLine(c.commit.message);
    return {
      sha: c.sha,
      message: WITHHELD.test(message) ? '(message on GitHub)' : message,
      date: c.commit.committer?.date ?? c.commit.author?.date,
    };
  });

  // Every Markdown file but the README, rendered by GitHub, so a design doc reads as a document and not as source.
  const docs = {};
  const markdown = entries
    .filter(([path, type, size]) => type === 'b' && /\.(md|markdown)$/i.test(path) && path !== readme?.path && size <= DOC_MAX_BYTES)
    .filter(([path]) => !/(^|\/)(node_modules|vendor|\.github)\//.test(path))
    .slice(0, DOCS_LIMIT);
  for (const [path] of markdown) {
    const html = await gh(`/repos/${OWNER}/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, HTML);
    const body = html && publishable(html, at(path));
    if (body && body.length <= DOC_HTML_MAX_BYTES) docs[path] = body;
  }

  return {
    repo: {
      owner: OWNER,
      name,
      description: meta.description ?? '',
      htmlUrl: meta.html_url,
      defaultBranch: branch,
      sha,
      language: meta.language ?? null,
      license: meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : null,
      fork: meta.fork ? (meta.parent?.full_name ?? 'another repository') : null,
      // Each rendered Markdown file lives in its own file under docs/<owner>--<name>/, named by this id.
      docs: Object.fromEntries(Object.keys(docs).map((path) => [path, docId(path)])),
      pushedAt: meta.pushed_at,
      fetchedAt: new Date().toISOString(),
      readme,
      tree: {
        truncated: Boolean(treeResponse.truncated) || listable.length > TREE_LIMIT,
        withheld: all.length - listable.length,
        entries,
      },
      commits,
    },
    docs,
  };
}

const only = new Set(process.argv.slice(2));
const listed = (await gh(`/users/${OWNER}/repos?type=owner&per_page=100&sort=pushed`)).filter(
  (r) => !r.private && !r.archived && !SKIP.has(r.name),
);
const chosen = only.size ? listed.filter((r) => only.has(r.name)) : listed;

await mkdir(join(OUT, 'repos'), { recursive: true });
await mkdir(join(OUT, 'docs'), { recursive: true });
for (const summary of chosen) {
  const meta = summary.fork ? await gh(`/repos/${OWNER}/${summary.name}`) : summary;
  const { repo, docs } = await snapshot(meta);
  const key = `${OWNER}--${repo.name}`;
  await writeFile(join(OUT, 'repos', `${key}.json`), `${JSON.stringify(repo)}\n`);
  await rm(join(OUT, 'docs', key), { recursive: true, force: true });
  if (Object.keys(docs).length) {
    await mkdir(join(OUT, 'docs', key), { recursive: true });
    for (const [path, html] of Object.entries(docs))
      await writeFile(join(OUT, 'docs', key, `${docId(path)}.json`), `${JSON.stringify({ path, html })}\n`);
  }
  console.log(
    `repos: ${repo.name} @ ${repo.sha.slice(0, 7)}: ${repo.tree.entries.length} entries${repo.tree.truncated ? ' (truncated)' : ''}, ` +
      `${repo.commits.length} commits, README ${repo.readme ? 'yes' : 'no'}, ${Object.keys(docs).length} docs`,
  );
}

// The Code window's home list: every snapshot on disk, newest push first.
if (!only.size) {
  const keep = new Set(listed.map((r) => `${OWNER}--${r.name}`));
  for (const dir of ['repos', 'docs'])
    for (const file of await readdir(join(OUT, dir)))
      if (!keep.has(file.replace(/\.json$/, ''))) await rm(join(OUT, dir, file), { recursive: true });
}
const index = listed.map((r) => ({
  owner: OWNER,
  name: r.name,
  description: r.description ?? '',
  language: r.language ?? null,
  fork: r.fork,
  pushedAt: r.pushed_at,
}));
await writeFile(join(OUT, 'index.json'), `${JSON.stringify({ owner: OWNER, fetchedAt: new Date().toISOString(), repos: index }, null, 2)}\n`);
console.log(`repos: index of ${index.length} repositories written`);
