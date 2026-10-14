import { SITE } from '../../../site';
import { parseTarget } from '../../routes';
import { DESKTOP_APPS, type OsIndex } from '../../types';

export type Tone = 'plain' | 'muted' | 'info' | 'warn' | 'echo';

export interface TermLine {
  text: string;
  tone: Tone;
}

export interface TermContext {
  index: OsIndex;
  open: (target: string) => void;
  readAbout: () => Promise<string | null>;
}

export interface TermResult {
  lines: TermLine[];
  clear?: boolean;
}

const line = (text: string, tone: Tone = 'plain'): TermLine => ({ text, tone });
const pad = (text: string, width: number) => (text.length >= width ? `${text} ` : text.padEnd(width));
const stars = (rating: number | null) =>
  rating === null ? '     ' : pad('★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : ''), 6);

const HELP: [string, string][] = [
  ['help', 'this list'],
  ['ls projects', 'list the project write-ups'],
  ['ls blog', 'list the posts'],
  ['cat about', 'print the About page'],
  ['open <name>', 'open an app, a project or a post (try: open films)'],
  ['films', 'the latest films from the diary'],
  ['whoami', 'who runs this machine'],
  ['clear', 'clear the screen'],
];

/** The log the Terminal prints when it opens, in the key=value style of the owner's media server. */
export function bootLog(index: OsIndex, now: Date): TermLine[] {
  const stamp = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const latest = index.films.entries[0];
  const entries: [string, string][] = [
    ['INFO', 'msg="projectionist starting" mode=terminal'],
    ['INFO', `msg="shelf mounted" shelf=projects items=${index.projects.length}`],
    ['INFO', `msg="shelf mounted" shelf=blog items=${index.posts.length}`],
    ['INFO', `msg="diary synced"${latest ? ` last="${latest.title} (${latest.year})"` : ''}`],
    ['INFO', 'msg="lamp warm" kelvin=2700'],
    ['WARN', 'msg="mango plant growing slowly" patience=required'],
    ['INFO', 'msg="serving" addr=crt:80'],
  ];
  return [
    ...entries.map(([level, rest], i) =>
      line(`time=${stamp(i * 140)} level=${level} ${rest}`, level === 'WARN' ? 'warn' : 'info'),
    ),
    line(''),
    line('Type help for the commands.', 'muted'),
  ];
}

function findOpenTarget(name: string, index: OsIndex): { target: string; title: string } | null {
  const route = parseTarget(name);
  if (route) {
    const title = route.slug
      ? (index.projects.find((p) => p.slug === route.slug)?.title ??
        index.posts.find((p) => p.slug === route.slug)?.title ??
        name)
      : route.app;
    return { target: name, title };
  }
  const project = index.projects.find((p) => p.slug === name);
  if (project) return { target: `projects/${project.slug}`, title: project.title };
  const post = index.posts.find((p) => p.slug === name);
  if (post) return { target: `blog/${post.slug}`, title: post.title };
  return null;
}

export async function runCommand(input: string, ctx: TermContext): Promise<TermResult> {
  const [command = '', ...args] = input.trim().split(/\s+/);
  const arg = args.join(' ');
  const { index } = ctx;

  switch (command) {
    case '':
      return { lines: [] };
    case 'help':
      return { lines: HELP.map(([name, what]) => line(`${pad(name, 14)}${what}`)) };
    case 'clear':
      return { lines: [], clear: true };
    case 'whoami':
      return {
        lines: [
          line(SITE.name.toLowerCase()),
          line(SITE.description, 'muted'),
          line(SITE.github.replace(/^https:\/\//, ''), 'muted'),
        ],
      };
    case 'ls':
      if (arg === 'projects') {
        if (index.projects.length === 0) return { lines: [line('projects: empty', 'muted')] };
        const width = Math.max(...index.projects.map((p) => p.slug.length)) + 2;
        return { lines: index.projects.map((p) => line(`${pad(p.slug, width)}${pad(String(p.year), 6)}${p.title}`)) };
      }
      if (arg === 'blog') {
        if (index.posts.length === 0) return { lines: [line('blog: empty', 'muted')] };
        const width = Math.max(...index.posts.map((p) => p.slug.length)) + 2;
        return { lines: index.posts.map((p) => line(`${p.date}  ${pad(p.slug, width)}${p.title}`)) };
      }
      if (arg === '') {
        return { lines: [line(DESKTOP_APPS.map((id) => (id === 'projects' || id === 'blog' ? `${id}/` : id)).join('  '))] };
      }
      return { lines: [line(`ls: ${arg}: no such shelf. Try ls projects or ls blog.`, 'warn')] };
    case 'cat': {
      if (arg !== 'about') return { lines: [line(`cat: ${arg || '(nothing)'}: no such file. Try cat about.`, 'warn')] };
      const text = await ctx.readAbout();
      if (!text) return { lines: [line('cat: about: not published yet.', 'warn')] };
      return {
        lines: text.split(/\n{2,}/).flatMap((paragraph, i) => (i ? [line(''), line(paragraph)] : [line(paragraph)])),
      };
    }
    case 'open': {
      if (!arg) return { lines: [line('open: name an app, a project or a post, e.g. open films', 'warn')] };
      const found = findOpenTarget(arg, index);
      if (!found) return { lines: [line(`open: ${arg}: not found. Try ls projects or ls blog.`, 'warn')] };
      ctx.open(found.target);
      return { lines: [line(`opening ${found.title}`, 'muted')] };
    }
    case 'films': {
      const recent = index.films.entries.slice(0, 6);
      if (recent.length === 0) return { lines: [line('films: the diary is empty', 'muted')] };
      return {
        lines: [
          ...recent.map((f) =>
            line(`${f.watchedDate}  ${stars(f.rating)}  ${f.title} (${f.year})${f.rewatch ? ', rewatch' : ''}`),
          ),
          line(''),
          line('open films for the whole diary', 'muted'),
        ],
      };
    }
    default:
      return { lines: [line(`${command}: command not found. Type help.`, 'warn')] };
  }
}
