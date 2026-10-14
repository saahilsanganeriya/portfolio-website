import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { PixelIcon } from '../../assets/PixelIcon';
import { formatDay } from '../../format';
import { useWindowStatus } from '../../wm/Window';
import { decorateLinks } from '../content';
import { DetailsList } from '../Lists';
import { ThreadLoader } from '../Reader';
import { CodeError, loadRepo, loadText, rawUrl, type Commit, type Entry, type Repo } from './data';
import { codeHref, githubHref, parseCodeSlug, type CodeRoute } from './model';
import index from './snapshot/index.json';

// ---- Loading state shared by every view ----

type Async<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; error: unknown };

function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [result, setResult] = useState<Async<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    setResult({ state: 'loading' });
    load().then(
      (value) => live && setResult({ state: 'ready', value }),
      (error: unknown) => live && setResult({ state: 'failed', error }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return result;
}

const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** Says what went wrong in plain words and always leaves a way to the same place on GitHub. */
function Failure({ error, href, what }: { error: unknown; href: string; what: string }) {
  let reason = `${what} did not load`;
  if (error instanceof CodeError) {
    if (error.reason === 'missing') reason = `GitHub has no ${what} here`;
    else if (error.reason === 'limited')
      reason = `GitHub’s hourly limit for visitors is used up${error.resetAt ? `; it resets at ${timeFormat.format(error.resetAt)}` : ''}`;
    else reason = `${what} did not load: ${error.message}`;
  } else if (error instanceof Error) reason = `${what} did not load: ${error.message}`;
  return (
    <div className="os-code-failure" role="alert">
      <p>{reason}.</p>
      <p>
        <a href={href} target="_blank" rel="noopener">
          Open it on GitHub ↗
        </a>
      </p>
    </div>
  );
}

const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---- Rendered Markdown (README and docs), as GitHub rendered it ----

function Rendered({ html, className = '' }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    decorateLinks(root);
    // A picture stored with Git LFS is a pointer file on raw.githubusercontent.com; GitHub serves the bytes elsewhere.
    const onError = (event: Event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || img.dataset.retried) return;
      if (!img.src.startsWith('https://raw.githubusercontent.com/')) return;
      img.dataset.retried = '1';
      img.src = img.src.replace('https://raw.githubusercontent.com/', 'https://media.githubusercontent.com/media/');
    };
    root.addEventListener('error', onError, true);
    return () => root.removeEventListener('error', onError, true);
  }, [html]);
  // In-page links (`#installation`) scroll to their heading instead of changing the OS's window address.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest('a[href^="#"]');
    if (!anchor) return;
    const name = decodeURIComponent(anchor.getAttribute('href')!.slice(1)).replace(/^user-content-/, '');
    const target = ref.current?.querySelector(`[data-anchor="${CSS.escape(name)}"], [id="user-content-${CSS.escape(name)}"]`);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ block: 'start' });
  };
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div ref={ref} className={`os-prose os-readme ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

// ---- The list of his repositories ----

function RepoList() {
  const setStatus = useWindowStatus();
  useEffect(() => {
    setStatus(`${index.repos.length} repositories, from GitHub on ${formatDay(index.fetchedAt.slice(0, 10))}`);
    return () => setStatus(null);
  }, [setStatus]);
  return (
    <div className="os-list os-code-home">
      <header className="os-code-intro">
        <h2>Code</h2>
        <p>
          My public repositories, readable here.{' '}
          <a href={`https://github.com/${index.owner}`} target="_blank" rel="noopener">
            My profile on GitHub ↗
          </a>
        </p>
      </header>
      <DetailsList
        heading="Repositories, most recently changed first"
        metaLabel="Changed"
        rows={index.repos.map((repo) => ({
          href: codeHref({ owner: repo.owner, repo: repo.name, view: 'readme', path: '' }),
          title: repo.name,
          summary: [repo.description, repo.language, repo.fork ? 'a fork' : ''].filter(Boolean).join(' · '),
          meta: formatDay(repo.pushedAt.slice(0, 10), 'short'),
          metaDateTime: repo.pushedAt.slice(0, 10),
        }))}
      />
    </div>
  );
}

// ---- One repository ----

function Breadcrumbs({ repo, route, path, file }: { repo: Repo; route: CodeRoute; path: string; file?: boolean }) {
  const parts = path.split('/').filter(Boolean);
  const at = (end: number): CodeRoute => ({ ...route, view: 'tree', ref: route.ref, path: parts.slice(0, end).join('/') });
  return (
    <nav className="os-code-crumbs" aria-label="Path">
      <ol>
        <li>
          <a href={codeHref(at(0))}>{repo.name}</a>
        </li>
        {parts.map((part, i) => (
          <li key={`${i}-${part}`}>
            {i === parts.length - 1 ? (
              <span aria-current={file ? 'page' : 'location'}>{part}</span>
            ) : (
              <a href={codeHref(at(i + 1))}>{part}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Readme({ repo, route }: { repo: Repo; route: CodeRoute }) {
  const readme = useAsync(() => repo.readme(), [repo]);
  if (readme.state === 'loading') return <ThreadLoader label="Loading the README" />;
  if (readme.state === 'failed') return <Failure error={readme.error} href={githubHref(route)} what="the README" />;
  if (!readme.value) return <p className="os-note">This repository has no README. Its files are under Files.</p>;
  return <Rendered html={readme.value.html} />;
}

function Tree({ repo, route }: { repo: Repo; route: CodeRoute }) {
  const listing = useAsync(() => repo.list(route.path), [repo, route.path]);
  const setStatus = useWindowStatus();
  useEffect(() => {
    if (listing.state === 'ready') setStatus(`${listing.value.length} items in /${route.path}`);
    return () => setStatus(null);
  }, [listing, route.path, setStatus]);
  const link = (entry: Entry): string | null =>
    entry.type === 'submodule'
      ? null
      : codeHref({ ...route, view: entry.type === 'dir' ? 'tree' : 'blob', ref: route.ref, path: entry.path });
  return (
    <>
      <Breadcrumbs repo={repo} route={route} path={route.path} />
      {listing.state === 'loading' && <ThreadLoader label="Loading the files" />}
      {listing.state === 'failed' && <Failure error={listing.error} href={githubHref(route)} what="this folder" />}
      {listing.state === 'ready' &&
        (listing.value.length === 0 ? (
          <p className="os-note">Nothing in this folder.</p>
        ) : (
          <table className="os-code-files">
            <caption className="visually-hidden">Files in /{route.path}</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Size</th>
              </tr>
            </thead>
            <tbody>
              {listing.value.map((entry) => {
                const href = link(entry);
                return (
                  <tr key={entry.path}>
                    <td>
                      <PixelIcon name={entry.type === 'dir' ? 'folder' : 'page'} size={16} />
                      {href ? <a href={href}>{entry.name}</a> : <span>{entry.name} (submodule)</span>}
                    </td>
                    <td>{entry.type === 'file' ? formatBytes(entry.size) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      {(repo.withheld > 0 || repo.truncated) && route.path === '' && (
        <p className="os-code-aside">
          {repo.truncated ? 'This list is cut short. ' : ''}
          {repo.withheld > 0 ? `${repo.withheld === 1 ? 'One file is' : `${repo.withheld} files are`} listed only on GitHub. ` : ''}
          <a href={githubHref(route)} target="_blank" rel="noopener">
            See every file on GitHub ↗
          </a>
        </p>
      )}
    </>
  );
}

// ---- One file ----

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
const MARKDOWN = /\.(md|markdown)$/i;
const BINARY =
  /\.(pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|war|class|so|dylib|dll|exe|bin|o|a|wasm|pt|pth|ckpt|onnx|h5|hdf5|npy|npz|pkl|pickle|parquet|feather|sqlite|db|mp3|mp4|mov|avi|mkv|webm|wav|ogg|flac|m4a|ttf|otf|woff2?|eot|psd|ai|sketch|xlsx?|docx?|pptx?|key|numbers|pages|gba|nds|apk|aab|keystore|tif|tiff|heic|dmg|iso)$/i;
const TEXT_LIMIT = 1_500_000;
const HIGHLIGHT_LIMIT = 300_000;

function CodeBlock({ text, path }: { text: string; path: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setHtml(null);
    if (text.length > HIGHLIGHT_LIMIT) return;
    import('./highlight').then(({ highlightLines, languageFor }) => live && setHtml(highlightLines(text, languageFor(path))));
    return () => {
      live = false;
    };
  }, [text, path]);
  return (
    <pre className="os-code-text" tabIndex={0} aria-label={`Contents of ${path}`}>
      {html === null ? <code>{text}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}
    </pre>
  );
}

interface NotebookCell {
  cell_type: 'markdown' | 'code' | 'raw';
  source: string | string[];
}

/** A Jupyter notebook as its cells: Markdown as text, code highlighted as Python. Outputs stay on GitHub. */
function Notebook({ text, path }: { text: string; path: string }) {
  let cells: NotebookCell[];
  try {
    cells = (JSON.parse(text) as { cells?: NotebookCell[] }).cells ?? [];
  } catch {
    return <CodeBlock text={text} path={`${path}.json`} />;
  }
  const source = (cell: NotebookCell) => (Array.isArray(cell.source) ? cell.source.join('') : cell.source);
  return (
    <div className="os-notebook">
      <p className="os-code-aside">A notebook: its cells are below; the outputs (plots, tables) are on GitHub.</p>
      {cells.map((cell, i) =>
        cell.cell_type === 'code' ? (
          <CodeBlock key={i} text={source(cell)} path={`cell-${i + 1}.py`} />
        ) : (
          <p key={i} className="os-notebook-text">
            {source(cell)}
          </p>
        ),
      )}
    </div>
  );
}

function FileBody({ repo, route }: { repo: Repo; route: CodeRoute }) {
  const { path } = route;
  const size = repo.size(path);
  const raw = rawUrl(repo, path);
  const tooLarge = size !== null && size > TEXT_LIMIT;
  const isImage = IMAGE.test(path);
  const isBinary = BINARY.test(path);
  const content = useAsync(async (): Promise<{ doc: string | null; text: string | null }> => {
    if (isImage || isBinary || tooLarge) return { doc: null, text: null };
    const doc = MARKDOWN.test(path) ? await repo.doc(path) : null;
    return { doc, text: doc ? null : await loadText(repo, path) };
  }, [repo, path]);

  const setStatus = useWindowStatus();
  useEffect(() => {
    const lines = content.state === 'ready' && content.value.text !== null ? content.value.text.split('\n').length : null;
    setStatus([lines !== null ? `${lines} lines` : '', size !== null ? formatBytes(size) : ''].filter(Boolean).join(', ') || null);
    return () => setStatus(null);
  }, [content, size, setStatus]);

  const links = (
    <p className="os-code-filelinks">
      <a href={raw} target="_blank" rel="noopener">
        Raw ↗
      </a>
      <a href={githubHref(route)} target="_blank" rel="noopener">
        Open on GitHub ↗
      </a>
    </p>
  );

  let body: ReactNode;
  if (isImage) {
    body = (
      <figure className="os-code-image">
        <img src={/\.svg$/i.test(path) ? `${raw}?sanitize=true` : raw} alt={`${path}, an image in ${repo.name}`} />
      </figure>
    );
  } else if (isBinary || tooLarge) {
    body = (
      <p className="os-note">
        {tooLarge ? 'This file is too large to show here' : 'This is a binary file'}
        {size !== null ? ` (${formatBytes(size)})` : ''}. Its raw copy and its page on GitHub are above.
      </p>
    );
  } else if (content.state === 'loading') {
    body = <ThreadLoader label={`Loading ${path}`} />;
  } else if (content.state === 'failed') {
    body = <Failure error={content.error} href={githubHref(route)} what="this file" />;
  } else if (content.value.doc) {
    body = <Rendered html={content.value.doc} />;
  } else {
    const text = content.value.text ?? '';
    if (text.startsWith('version https://git-lfs.github.com/spec/')) {
      body = <p className="os-note">This file is stored with Git LFS, so GitHub keeps its contents elsewhere. Open it on GitHub.</p>;
    } else if (/\.ipynb$/i.test(path)) {
      body = <Notebook text={text} path={path} />;
    } else {
      body = <CodeBlock text={text} path={path} />;
    }
  }

  return (
    <>
      <Breadcrumbs repo={repo} route={route} path={path} file />
      {links}
      {body}
    </>
  );
}

// ---- Commits ----

function Commits({ repo, route }: { repo: Repo; route: CodeRoute }) {
  const commits = useAsync(() => repo.commits(), [repo]);
  if (commits.state === 'loading') return <ThreadLoader label="Loading the commits" />;
  if (commits.state === 'failed') return <Failure error={commits.error} href={githubHref(route)} what="the commits" />;
  const list: Commit[] = commits.value;
  return (
    <>
      <ol className="os-code-commits">
        {list.map((commit) => (
          <li key={commit.sha}>
            <span className="os-code-commit-message">{commit.message}</span>
            <span className="os-code-commit-meta">
              <code>{commit.sha.slice(0, 7)}</code>
              {commit.date && <time dateTime={commit.date}>{formatDay(commit.date.slice(0, 10), 'short')}</time>}
            </span>
          </li>
        ))}
      </ol>
      <p className="os-code-aside">
        The last {list.length} commits on {repo.ref.length === 40 ? repo.ref.slice(0, 7) : repo.ref}.{' '}
        <a href={githubHref({ ...route, view: 'commits' })} target="_blank" rel="noopener">
          The full history on GitHub ↗
        </a>
      </p>
    </>
  );
}

// ---- The window ----

const TABS: { view: 'readme' | 'tree' | 'commits'; label: string }[] = [
  { view: 'readme', label: 'README' },
  { view: 'tree', label: 'Files' },
  { view: 'commits', label: 'Commits' },
];

function RepoWindow({ route }: { route: CodeRoute }) {
  const repo = useAsync(() => loadRepo(route.owner, route.repo, route.ref), [route.owner, route.repo, route.ref]);
  const home: CodeRoute = { owner: route.owner, repo: route.repo, view: 'readme', path: '' };
  if (repo.state === 'loading') return <ThreadLoader label={`Loading ${route.repo}`} />;
  if (repo.state === 'failed')
    return (
      <div className="os-code">
        <Failure error={repo.error} href={githubHref(route)} what={`${route.owner}/${route.repo}`} />
      </div>
    );
  const r = repo.value;
  const active = route.view === 'blob' ? 'tree' : route.view === 'other' ? 'readme' : route.view;
  const snapshotLine = r.fetchedAt
    ? `Read from a snapshot of ${r.defaultBranch} at ${r.rawRef.slice(0, 7)}, ${formatDay(r.fetchedAt.slice(0, 10))}`
    : `Read live from GitHub at ${r.ref.length === 40 ? r.ref.slice(0, 7) : r.ref}`;
  return (
    <article className="os-code">
      <header className="os-code-head">
        <div className="os-code-title">
          <h2>
            <span className="os-code-owner">{r.owner} /</span> {r.name}
          </h2>
          <a className="os-tool" href={githubHref({ ...home, ref: route.ref })} target="_blank" rel="noopener">
            <PixelIcon name="source" size={13} />
            Open on GitHub ↗
          </a>
        </div>
        {r.description && <p className="os-code-description">{r.description}</p>}
        <p className="os-code-facts">
          {[r.language, r.license, r.fork ? `forked from ${r.fork}` : null, snapshotLine].filter(Boolean).join(' · ')}
        </p>
        <nav className="os-code-tabs" aria-label={`${r.name} sections`}>
          {TABS.map((tab) => (
            <a
              key={tab.view}
              href={codeHref({ ...home, view: tab.view, ref: route.ref })}
              aria-current={active === tab.view ? 'page' : undefined}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </header>
      <div className="os-code-body">
        {route.view === 'other' && (
          <p className="os-code-aside">
            The link was to {route.path}, which this window does not show.{' '}
            <a href={githubHref(route)} target="_blank" rel="noopener">
              Open it on GitHub ↗
            </a>
          </p>
        )}
        {active === 'readme' && <Readme repo={r} route={route} />}
        {route.view === 'tree' && <Tree repo={r} route={route} />}
        {route.view === 'blob' && <FileBody repo={r} route={route} />}
        {route.view === 'commits' && <Commits repo={r} route={route} />}
      </div>
    </article>
  );
}

/** The Code window: his repositories, each with its README, files and recent commits, inside SaahilOS. */
export default function CodeApp({ slug }: { slug?: string }) {
  const route = slug ? parseCodeSlug(slug) : null;
  if (!route) return <RepoList />;
  return <RepoWindow key={`${route.owner}/${route.repo}`.toLowerCase()} route={route} />;
}
