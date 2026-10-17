// The Terminal's small file tree, built from what the desktop already shows: one folder or file per app, one file
// per project, post, photograph and recipe, one folder per public repository. Folders list themselves only when
// first visited, so the Terminal's own load stays small; nothing here can be written.
import type { OsIndex } from '../../types';
import { loadContent, loadJson } from '../content';

export const HOME = '/home/saahil';

export interface FileNode {
  kind: 'file';
  name: string;
  /** The window `open` shows for it. */
  open?: string;
  /** A one-line description for `ls` (a project's or a post's title). */
  title?: string;
  read: () => Promise<string[]>;
}

export interface DirNode {
  kind: 'dir';
  name: string;
  open?: string;
  title?: string;
  /** Set on a repository's folders: `git log` works anywhere inside one. */
  repo?: { owner: string; name: string };
  list: () => Promise<VNode[]>;
}

export type VNode = FileNode | DirNode;

const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
};

const dir = (name: string, list: () => Promise<VNode[]>, extra: Partial<DirNode> = {}): DirNode => ({
  kind: 'dir',
  name,
  list: once(list),
  ...extra,
});

const file = (name: string, read: () => Promise<string[]>, extra: Partial<FileNode> = {}): FileNode => ({
  kind: 'file',
  name,
  read,
  ...extra,
});

const binary = (name: string, open: string) =>
  file(name, async () => [`${name}: not text. Try: open ${name}`], { open });

/** A rendered page as the lines `cat` prints: headings, paragraphs and list items, diagrams as they are drawn. */
export function plainText(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [...doc.body.querySelectorAll('h2, h3, p, li, pre')].filter(
    (el) => !el.closest('figcaption') && !(el.tagName === 'P' && el.closest('li')),
  );
  return blocks.flatMap((el, i) => {
    const text = el.tagName === 'PRE' ? (el.textContent ?? '').replace(/\n$/, '') : (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const line = el.tagName === 'H2' || el.tagName === 'H3' ? `## ${text}` : el.tagName === 'LI' ? `- ${text}` : text;
    return i === 0 ? [line] : ['', line];
  });
}

async function readEntry(collection: string, slug: string, head: string[]): Promise<string[]> {
  const { html } = await loadContent<unknown>(collection, slug);
  return [...head, '', ...plainText(html)];
}

const photoName = (slug: string) => `${slug}.jpg`;

function repoFolder(owner: string, name: string): DirNode {
  const repo = once(async () => (await import('../code/data')).loadRepo(owner, name));
  const children = (path: string) => async (): Promise<VNode[]> => {
    const loaded = await repo();
    const entries = await loaded.list(path);
    return entries.map((entry) =>
      entry.type === 'dir'
        ? dir(entry.name, children(entry.path), {
            repo: { owner, name },
            open: `code/${owner}/${name}/tree/${loaded.defaultBranch}/${entry.path}`,
          })
        : file(
            entry.name,
            async () => {
              const readme = path === '' && /^readme(\.md)?$/i.test(entry.name) ? await loaded.readme() : null;
              if (readme) return plainText(readme.html);
              return [`${entry.name}: ${entry.size.toLocaleString('en-US')} bytes. Read it in the Code window: open ${entry.name}`];
            },
            { open: `code/${owner}/${name}/blob/${loaded.defaultBranch}/${entry.path}` },
          ),
    );
  };
  return dir(name, children(''), { repo: { owner, name }, open: `code/${owner}/${name}` });
}

interface CodeIndex {
  repos: { owner: string; name: string; description: string }[];
}
interface Book {
  title: string;
  author: string;
  year: number;
}
interface Recipe {
  slug: string;
  title: string;
}

/** The whole tree, rooted at `/`; the visitor starts in HOME. */
export function buildTree(index: OsIndex): DirNode {
  const home = dir(
    'saahil',
    async () => [
      file('about.txt', () => readEntry('pages', 'about', []), { open: 'about' }),
      binary('resume.pdf', 'resume'),
      dir(
        'projects',
        async () =>
          index.projects.map((p) =>
            file(`${p.slug}.md`, () => readEntry('projects', p.slug, [`# ${p.title}`, p.summary]), {
              open: `projects/${p.slug}`,
              title: p.title,
            }),
          ),
        { open: 'projects' },
      ),
      dir(
        'writing',
        async () =>
          index.posts.map((p) =>
            file(`${p.slug}.md`, () => readEntry('blog', p.slug, [`# ${p.title}`, p.date]), {
              open: `blog/${p.slug}`,
              title: p.title,
            }),
          ),
        { open: 'blog' },
      ),
      dir(
        'code',
        async () => {
          const { repos } = (await import('../code/snapshot/index.json')).default as CodeIndex;
          return repos.map((r) => ({ ...repoFolder(r.owner, r.name), title: r.description || undefined }));
        },
        { open: 'code' },
      ),
      dir(
        'photos',
        async () =>
          index.photography.map((p) => ({
            ...binary(photoName(p.slug), `photography/${p.slug}`),
            title: [p.title, p.place, p.year].filter(Boolean).join(', '),
          })),
        { open: 'photography' },
      ),
      dir(
        'films',
        async () => [
          file(
            'diary.txt',
            async () =>
              index.films.entries.length === 0
                ? ['The diary is empty.']
                : index.films.entries
                    .slice(0, 10)
                    .map((f) => `${f.watchedDate}  ${f.title} (${f.year})${f.rewatch ? ', again' : ''}`),
            { open: 'films' },
          ),
        ],
        { open: 'films' },
      ),
      file(
        'books.txt',
        async () => {
          const { books } = await loadJson<{ books: Book[] }>('/content/books.json');
          return books.length === 0 ? ['No books listed yet.'] : books.map((b) => `${b.title}, ${b.author} (${b.year})`);
        },
        { open: 'books' },
      ),
      dir(
        'kitchen',
        async () => {
          const { recipes } = await loadJson<{ recipes: Recipe[] }>('/content/recipes.json');
          return recipes.map((r) =>
            file(`${r.slug}.md`, () => readEntry('recipes', r.slug, [`# ${r.title}`]), {
              open: `recipes/${r.slug}`,
              title: r.title,
            }),
          );
        },
        { open: 'recipes' },
      ),
      file('voyager.txt', () => readEntry('voyager', 'voyager', []), { open: 'voyager' }),
    ],
    { open: 'about' },
  );
  return dir('', async () => [dir('home', async () => [home])]);
}

// ---- paths ----

/** An absolute, normalised path for what the visitor typed, from the folder they are in. */
export function resolvePath(cwd: string, typed: string): string {
  const raw = typed === '~' || typed.startsWith('~/') ? HOME + typed.slice(1) : typed.startsWith('/') ? typed : `${cwd}/${typed}`;
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** The node at an absolute path, or null; folders list themselves on the way down. */
export async function lookup(root: DirNode, path: string): Promise<VNode | null> {
  let node: VNode = root;
  for (const part of path.split('/').filter(Boolean)) {
    if (node.kind !== 'dir') return null;
    const children: VNode[] = await node.list();
    const next: VNode | undefined = children.find((child) => child.name === part);
    if (!next) return null;
    node = next;
  }
  return node;
}

/** How a path is shown in the prompt: HOME as `~`. */
export const displayPath = (path: string) =>
  path === HOME ? '~' : path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
