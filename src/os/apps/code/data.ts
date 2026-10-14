// Where the Code window's data comes from. The owner's repositories at their snapshot (`npm run repos`, committed)
// need no network but raw.githubusercontent.com for file bodies. Anything else (another person's repository, or one
// of his at another branch) is read live from GitHub's public API, which allows 60 requests an hour per visitor.
import { cleanGithubHtml } from './github-html';

export interface Snapshot {
  owner: string;
  name: string;
  description: string;
  htmlUrl: string;
  defaultBranch: string;
  sha: string;
  language: string | null;
  license: string | null;
  fork: string | null;
  docs: Record<string, string>;
  pushedAt: string;
  fetchedAt: string;
  readme: { path: string; html: string } | null;
  tree: { truncated: boolean; withheld: number; entries: [path: string, type: 't' | 'b' | 'c', size: number][] };
  commits: Commit[];
}

export interface Entry {
  name: string;
  path: string;
  type: 'dir' | 'file' | 'submodule';
  /** Bytes; 0 for folders. */
  size: number;
}

export interface Commit {
  sha: string;
  message: string;
  date: string;
}

export interface Repo {
  source: 'snapshot' | 'live';
  owner: string;
  name: string;
  description: string;
  htmlUrl: string;
  defaultBranch: string;
  /** The branch, tag or commit shown. */
  ref: string;
  /** What file bodies are read at: the snapshot's commit, or the ref asked for. */
  rawRef: string;
  language: string | null;
  license: string | null;
  fork: string | null;
  /** When the snapshot was taken; null when live. */
  fetchedAt: string | null;
  /** Files the snapshot leaves out, and whether the tree was cut short. */
  withheld: number;
  truncated: boolean;
  readme: () => Promise<{ path: string; html: string } | null>;
  list: (dir: string) => Promise<Entry[]>;
  /** A file's size when known ahead of time (the snapshot), so large files are not fetched. */
  size: (path: string) => number | null;
  /** A Markdown file rendered by GitHub, or null when there is no rendered copy. */
  doc: (path: string) => Promise<string | null>;
  commits: () => Promise<Commit[]>;
}

export class CodeError extends Error {
  constructor(
    readonly reason: 'missing' | 'limited' | 'failed',
    message: string,
    /** For 'limited': when GitHub lets this visitor ask again. */
    readonly resetAt?: Date,
  ) {
    super(message);
  }
}

const repoFiles = import.meta.glob<Snapshot>('./snapshot/repos/*.json', { import: 'default' });
const docFiles = import.meta.glob<{ path: string; html: string }>('./snapshot/docs/*/*.json', { import: 'default' });

// GitHub treats owner and repository names case-insensitively, and links in the site's content do too.
const snapshotKey = (owner: string, name: string) => `${owner}--${name}`.toLowerCase();
const snapshots = new Map(
  Object.entries(repoFiles).map(([path, load]) => [path.match(/([^/]+)\.json$/)![1].toLowerCase(), load]),
);

export const rawUrl = (repo: Pick<Repo, 'owner' | 'name' | 'rawRef'>, path: string) =>
  `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.rawRef}/${path.split('/').map(encodeURIComponent).join('/')}`;

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const byFoldersThenName = (a: Entry, b: Entry) =>
  Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name, 'en', { numeric: true });

function fromSnapshot(snapshot: Snapshot): Repo {
  let children: Map<string, Entry[]> | null = null;
  const sizes = new Map(snapshot.tree.entries.map(([path, , size]) => [path, size]));
  return {
    source: 'snapshot',
    owner: snapshot.owner,
    name: snapshot.name,
    description: snapshot.description,
    htmlUrl: snapshot.htmlUrl,
    defaultBranch: snapshot.defaultBranch,
    ref: snapshot.defaultBranch,
    rawRef: snapshot.sha,
    language: snapshot.language,
    license: snapshot.license,
    fork: snapshot.fork,
    fetchedAt: snapshot.fetchedAt,
    withheld: snapshot.tree.withheld,
    truncated: snapshot.tree.truncated,
    readme: async () => snapshot.readme,
    list: async (dir) => {
      if (!children) {
        children = new Map();
        for (const [path, type, size] of snapshot.tree.entries) {
          const entry: Entry = {
            name: path.slice(path.lastIndexOf('/') + 1),
            path,
            type: type === 't' ? 'dir' : type === 'c' ? 'submodule' : 'file',
            size,
          };
          const siblings = children.get(parentOf(path)) ?? [];
          siblings.push(entry);
          children.set(parentOf(path), siblings);
        }
        for (const list of children.values()) list.sort(byFoldersThenName);
      }
      return children.get(dir) ?? [];
    },
    size: (path) => sizes.get(path) ?? null,
    doc: async (path) => {
      const id = snapshot.docs[path];
      const load = id && docFiles[`./snapshot/docs/${snapshot.owner}--${snapshot.name}/${id}.json`];
      return load ? (await load()).html : null;
    },
    commits: async () => snapshot.commits,
  };
}

// ---- Live: GitHub's public API, for repositories and branches outside the snapshot ----

const HTML = 'application/vnd.github.html+json';
const TIMEOUT_MS = 15_000;
const responses = new Map<string, Promise<unknown>>();

/** One GET per address for the life of the page; a failed one is forgotten so a retry asks again. */
function api<T>(path: string, accept = 'application/vnd.github+json'): Promise<T> {
  const key = `${accept} ${path}`;
  let request = responses.get(key);
  if (!request) {
    request = fetch(`https://api.github.com${path}`, { headers: { Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) }).then(
      async (response) => {
        if (response.status === 404) throw new CodeError('missing', `${path} is not on GitHub`);
        if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
          const reset = Number(response.headers.get('x-ratelimit-reset'));
          throw new CodeError('limited', 'GitHub’s hourly limit for visitors is used up', reset ? new Date(reset * 1000) : undefined);
        }
        if (!response.ok) throw new CodeError('failed', `GitHub answered HTTP ${response.status}`);
        return accept === HTML ? response.text() : response.json();
      },
    );
    request.catch(() => responses.delete(key));
    responses.set(key, request);
  }
  return request as Promise<T>;
}

const commitLine = (message: string) =>
  message
    .split('\n')[0]
    .replace(/^(Merge pull request #\d+) from \S+/, '$1')
    .replace(/^(Merge branch '[^']*') of \S+/, '$1');

interface ApiRepo {
  name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  default_branch: string;
  language: string | null;
  license: { spdx_id: string } | null;
  fork: boolean;
  parent?: { full_name: string };
}

interface ApiContent {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size: number;
}

async function live(owner: string, name: string, ref?: string): Promise<Repo> {
  const meta = await api<ApiRepo>(`/repos/${owner}/${name}`);
  const shown = ref ?? meta.default_branch;
  const base = `/repos/${meta.owner.login}/${meta.name}`;
  const at = `ref=${encodeURIComponent(shown)}`;
  return {
    source: 'live',
    owner: meta.owner.login,
    name: meta.name,
    description: meta.description ?? '',
    htmlUrl: meta.html_url,
    defaultBranch: meta.default_branch,
    ref: shown,
    rawRef: shown,
    language: meta.language,
    license: meta.license && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : null,
    fork: meta.fork ? (meta.parent?.full_name ?? 'another repository') : null,
    fetchedAt: null,
    withheld: 0,
    truncated: false,
    readme: async () => {
      try {
        const html = await api<string>(`${base}/readme?${at}`, HTML);
        return { path: 'README.md', html: cleanGithubHtml(html) };
      } catch (error) {
        if (error instanceof CodeError && error.reason === 'missing') return null;
        throw error;
      }
    },
    list: async (dir) => {
      const list = await api<ApiContent[] | ApiContent>(`${base}/contents/${dir.split('/').map(encodeURIComponent).join('/')}?${at}`);
      return (Array.isArray(list) ? list : [])
        .map((item) => ({
          name: item.name,
          path: item.path,
          type: item.type === 'dir' ? ('dir' as const) : item.type === 'submodule' ? ('submodule' as const) : ('file' as const),
          size: item.size,
        }))
        .sort(byFoldersThenName);
    },
    size: () => null,
    doc: async (path) => {
      try {
        return cleanGithubHtml(await api<string>(`${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}?${at}`, HTML));
      } catch {
        return null;
      }
    },
    commits: async () =>
      (await api<{ sha: string; commit: { message: string; committer: { date: string } | null } }[]>(
        `${base}/commits?sha=${encodeURIComponent(shown)}&per_page=30`,
      )).map((c) => ({ sha: c.sha, message: commitLine(c.commit.message), date: c.commit.committer?.date ?? '' })),
  };
}

/** The repository a route names: its snapshot when that covers the ref asked for, otherwise GitHub, live. */
export async function loadRepo(owner: string, name: string, ref?: string): Promise<Repo> {
  const load = snapshots.get(snapshotKey(owner, name));
  if (load) {
    const snapshot = await load();
    const covered = !ref || ref === 'HEAD' || ref === snapshot.defaultBranch || (ref.length >= 7 && snapshot.sha.startsWith(ref));
    if (covered) return fromSnapshot(snapshot);
  }
  return live(owner, name, ref === 'HEAD' ? undefined : ref);
}

const RAW_TIMEOUT_MS = 20_000;

/** A file's text from raw.githubusercontent.com (public, CORS-enabled). */
export async function loadText(repo: Repo, path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(rawUrl(repo, path), { signal: AbortSignal.timeout(RAW_TIMEOUT_MS) });
  } catch (error) {
    throw new CodeError('failed', `GitHub did not answer (${error instanceof Error ? error.message : String(error)})`);
  }
  if (response.status === 404) throw new CodeError('missing', `${path} is not on GitHub at ${repo.rawRef.slice(0, 7)}`);
  if (!response.ok) throw new CodeError('failed', `GitHub answered HTTP ${response.status}`);
  return response.text();
}
