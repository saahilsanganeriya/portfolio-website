import { parseTarget } from '../../routes';
import type { OsIndex } from '../../types';
import { APPS } from '../registry';
import { HOME, displayPath, lookup, resolvePath, type DirNode, type VNode } from './fs';

export type Tone = 'plain' | 'muted' | 'warn' | 'echo';

export interface TermLine {
  text: string;
  tone: Tone;
  /** For an echoed command: the folder the prompt showed. */
  cwd?: string;
}

export interface Shell {
  index: OsIndex;
  root: DirNode;
  cwd: string;
  previousCwd: string;
  history: string[];
  open: (target: string) => void;
}

export interface TermResult {
  lines: TermLine[];
  clear?: boolean;
  /** Printed a line at a time, like the boot log (at once with reduced motion). */
  paced?: boolean;
  /** The desktop goes dark while the lines print, and comes back at the first blank line. */
  wipe?: boolean;
  /** The Terminal's window closes after the lines. */
  exit?: boolean;
  /** Input now goes to the fake vim until it is quit. */
  vim?: boolean;
}

const line = (text: string, tone: Tone = 'plain'): TermLine => ({ text, tone });
const lines = (texts: string[], tone: Tone = 'plain') => texts.map((text) => line(text, tone));
const pad = (text: string, width: number) => (text.length >= width ? `${text}  ` : text.padEnd(width));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const COMMANDS = [
  'help', 'ls', 'cd', 'pwd', 'cat', 'open', 'git', 'whoami', 'history', 'clear',
  'echo', 'ssh', 'vim', 'sudo', 'rm', 'exit',
] as const;

const HELP: [string, string][] = [
  ['ls [folder]', 'list a folder (try: ls projects)'],
  ['cd <folder>', 'change folder; cd alone goes home'],
  ['cat <file>', 'print a file (try: cat about.txt)'],
  ['open <name>', 'open an app, a project, a post or a file in its window'],
  ['git log', 'recent commits, inside a repository in ~/code'],
  ['whoami', 'who this is'],
  ['history', 'what you have typed'],
  ['clear', 'clear the screen (or Ctrl+L)'],
];

/** What the Terminal prints when it opens, in the key=value style of the owner's NAS service. */
export function bootLog(index: OsIndex, now: Date): TermLine[] {
  const stamp = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const latest = index.films.entries[0];
  const entries = [
    'msg="saahilos terminal starting"',
    `msg="mounted" dir=~/projects files=${index.projects.length}`,
    `msg="mounted" dir=~/writing files=${index.posts.length}`,
    `msg="mounted" dir=~/photos files=${index.photography.length}`,
    ...(latest ? [`msg="diary synced" last="${latest.title} (${latest.year})"`] : []),
  ];
  return [
    ...entries.map((rest, i) => line(`time=${stamp(i * 140)} level=INFO ${rest}`, 'muted')),
    line(''),
    line('Type help for the commands, or try ls.', 'muted'),
  ];
}

// ---- the commands ----

async function list(shell: Shell, args: string[]): Promise<TermResult> {
  const targets = args.filter((a) => !a.startsWith('-'));
  const out: TermLine[] = [];
  for (const [i, typed] of (targets.length ? targets : ['.']).entries()) {
    const node = await lookup(shell.root, resolvePath(shell.cwd, typed));
    if (!node) {
      out.push(line(`ls: cannot access '${typed}': No such file or directory`, 'warn'));
      continue;
    }
    if (targets.length > 1) out.push(...(i ? [line('')] : []), line(`${typed}:`));
    if (node.kind === 'file') {
      out.push(line(node.name));
      continue;
    }
    const children = await node.list();
    if (children.length === 0) continue;
    const names = children.map((c) => (c.kind === 'dir' ? `${c.name}/` : c.name));
    if (children.some((c) => c.title)) {
      const width = Math.max(...names.map((n) => n.length)) + 2;
      children.forEach((c, k) => out.push(line(c.title ? `${pad(names[k]!, width)}${c.title}` : names[k]!)));
    } else out.push(line(names.join('  ')));
  }
  return { lines: out };
}

async function changeDir(shell: Shell, typed: string | undefined): Promise<TermResult> {
  const target = typed === undefined ? HOME : typed === '-' ? shell.previousCwd : resolvePath(shell.cwd, typed);
  const node = await lookup(shell.root, target);
  if (!node) return { lines: [line(`cd: no such file or directory: ${typed}`, 'warn')] };
  if (node.kind !== 'dir') return { lines: [line(`cd: not a directory: ${typed}`, 'warn')] };
  shell.previousCwd = shell.cwd;
  shell.cwd = target;
  return { lines: typed === '-' ? [line(displayPath(target))] : [] };
}

async function concatenate(shell: Shell, args: string[]): Promise<TermResult> {
  if (args.length === 0) return { lines: [line('cat: name a file, e.g. cat about.txt', 'warn')] };
  const out: TermLine[] = [];
  for (const typed of args) {
    const node = await lookup(shell.root, resolvePath(shell.cwd, typed));
    if (!node) out.push(line(`cat: ${typed}: No such file or directory`, 'warn'));
    else if (node.kind === 'dir') out.push(line(`cat: ${typed}: Is a directory. Try: ls ${typed}`, 'warn'));
    else {
      try {
        out.push(...lines(await node.read()));
      } catch {
        out.push(line(`cat: ${typed}: could not be read just now. Try: open ${typed}`, 'warn'));
      }
    }
  }
  return { lines: out };
}

async function findWindow(shell: Shell, name: string): Promise<{ target: string; title: string } | null> {
  const node = await lookup(shell.root, resolvePath(shell.cwd, name)).catch(() => null);
  if (node?.open) return { target: node.open, title: node.title ?? node.name };
  const route = parseTarget(name);
  if (route) {
    if (!route.slug) return { target: name, title: APPS[route.app].label };
    const entry = shell.index.projects.find((p) => p.slug === route.slug) ?? shell.index.posts.find((p) => p.slug === route.slug);
    return { target: name, title: entry?.title ?? name };
  }
  const project = shell.index.projects.find((p) => p.slug === name);
  if (project) return { target: `projects/${project.slug}`, title: project.title };
  const post = shell.index.posts.find((p) => p.slug === name);
  if (post) return { target: `blog/${post.slug}`, title: post.title };
  return null;
}

async function openWindow(shell: Shell, args: string[]): Promise<TermResult> {
  const name = args.join(' ');
  if (!name) return { lines: [line('open: name an app, a project, a post or a file, e.g. open contact', 'warn')] };
  const found = await findWindow(shell, name);
  if (!found) return { lines: [line(`open: ${name}: nothing by that name. Try ls.`, 'warn')] };
  shell.open(found.target);
  return { lines: [line(`opening ${found.title}`, 'muted')] };
}

async function git(shell: Shell, args: string[]): Promise<TermResult> {
  const [sub] = args;
  if (!sub) return { lines: [line('usage: git log', 'warn')] };
  const node = await lookup(shell.root, shell.cwd);
  const repo = node?.kind === 'dir' ? node.repo : undefined;
  if (sub !== 'log' && sub !== 'status') return { lines: [line(`git: '${sub}' is not a git command here. Try git log.`, 'warn')] };
  if (!repo) {
    return {
      lines: [
        line('fatal: not a git repository (or any of the parent directories): .git', 'warn'),
        line('Try: cd ~/code/travel-agent-gym, then git log', 'muted'),
      ],
    };
  }
  const loaded = await (await import('../code/data')).loadRepo(repo.owner, repo.name);
  if (sub === 'status') return { lines: lines([`On branch ${loaded.defaultBranch}`, 'nothing to commit, working tree clean']) };
  const commits = (await loaded.commits()).slice(0, 10);
  if (commits.length === 0) return { lines: [line('No commits to show.', 'muted')] };
  return {
    lines: [
      ...commits.map((c) => line(`${c.sha.slice(0, 7)}  ${c.date.slice(0, 10)}  ${c.message.split('\n')[0]}`)),
      line(''),
      line(`${repo.name}, as of the snapshot. open . shows it in the Code window.`, 'muted'),
    ],
  };
}

const WIPE_TARGETS = new Set(['/', '/*', '~', '~/', '~/*', '*', '.', '/home', '/home/saahil']);

function remove(shell: Shell, args: string[]): TermResult {
  const recursive = args.some((a) => /^-[a-zA-Z]*r/i.test(a));
  const paths = args.filter((a) => !a.startsWith('-'));
  if (paths.length === 0) return { lines: [line('rm: missing operand', 'warn')] };
  if (!recursive || !paths.some((p) => WIPE_TARGETS.has(p))) {
    return { lines: paths.map((p) => line(`rm: cannot remove '${p}': Read-only file system`, 'warn')) };
  }
  const { index } = shell;
  return {
    paced: true,
    wipe: true,
    lines: [
      ...lines([
        `removing ~/projects (${plural(index.projects.length, 'file')})`,
        `removing ~/writing (${plural(index.posts.length, 'file')})`,
        `removing ~/photos (${plural(index.photography.length, 'file')})`,
        'removing ~/code',
        'removing ~/about.txt',
        'removing /bin /etc /usr',
      ]),
      line(''),
      line('nice try.'),
      line('Everything is back. It is a static site.', 'muted'),
    ],
  };
}

// Facts from the projectionist write-up (src/content/projects/projectionist.mdx), not a live connection.
const NAS_STATUS = [
  'Connected to the NAS: a four-bay Synology with a four-core Celeron.',
  '',
  'projectionist   one Go service in one container, a 17 MB static binary',
  'stages          15, each on its own schedule; state in SQLite',
  'gate            heavy jobs pause while anyone but me is watching',
  'limits          a quarter of the usual CPU weight, 1 GB of memory',
  'left to port    two old scripts: backing up Plex, taking in new arrivals',
  '',
];

function secureShell(args: string[]): TermResult {
  const host = args.filter((a) => !a.startsWith('-')).at(-1)?.replace(/^.*@/, '');
  if (!host) return { lines: [line('usage: ssh nas', 'warn')] };
  if (host !== 'nas' && host !== 'projectionist') {
    return { lines: [line(`ssh: connect to host ${host} port 22: Connection refused`, 'warn')] };
  }
  return {
    paced: true,
    lines: [...lines(NAS_STATUS), line('Connection to nas closed. The write-up: open projectionist', 'muted')],
  };
}

// The real Vim's start screen, so a visitor knows the way out before they need it.
const VIM_SCREEN = [
  '~',
  '~',
  '~                     VIM - Vi IMproved',
  '~',
  '~              type  :q<Enter>               to exit',
  '~',
  '"[No Name]" 0L, 0B',
];

/** One line typed while the fake vim is open: a quit command leaves it, anything else stays in. */
export function vimInput(input: string, tries: number): TermResult & { quit: boolean } {
  if (/^\s*(:(q|q!|qa!?|wq!?|x)|ZZ|ZQ)\s*$/.test(input)) return { lines: [line('Back in the shell.', 'muted')], quit: true };
  return { lines: tries >= 2 ? [line('Still in vim. Type :q! and press Enter.', 'muted')] : [], quit: false };
}

export async function runCommand(input: string, shell: Shell): Promise<TermResult> {
  const [command = '', ...args] = input.trim().split(/\s+/);
  switch (command) {
    case '':
      return { lines: [] };
    case 'help':
      return {
        lines: [
          ...HELP.map(([name, what]) => line(`${pad(name, 14)}${what}`)),
          line(''),
          line('Tab finishes a name. Up and Down walk the history.', 'muted'),
        ],
      };
    case 'clear':
      return { lines: [], clear: true };
    case 'pwd':
      return { lines: [line(shell.cwd)] };
    case 'whoami':
      return { lines: [line('saahil'), line('Saahil Sanganeriya, software engineer at Mercor. cat ~/about.txt for the rest.', 'muted')] };
    case 'history':
      return { lines: shell.history.map((h, i) => line(`${String(i + 1).padStart(4)}  ${h}`)) };
    case 'echo':
      return { lines: [line(args.join(' '))] };
    case 'ls':
      return list(shell, args);
    case 'cd':
      return changeDir(shell, args[0]);
    case 'cat':
    case 'less':
    case 'more':
      return concatenate(shell, args);
    case 'open':
      return openWindow(shell, args);
    case 'git':
      return git(shell, args);
    case 'rm':
      return remove(shell, args);
    case 'sudo':
      return { lines: [line('saahil is not in the sudoers file. This incident will be reported.', 'warn')] };
    case 'ssh':
      return secureShell(args);
    case 'vim':
    case 'vi':
      return { lines: lines(VIM_SCREEN, 'muted'), vim: true };
    case 'exit':
    case 'logout':
      return { lines: [line('logout', 'muted')], exit: true };
    default:
      return { lines: [line(`${command}: command not found. Type help.`, 'warn')] };
  }
}

// ---- Tab ----

const commonPrefix = (words: string[]) =>
  words.reduce((prefix, word) => {
    let i = 0;
    while (i < prefix.length && prefix[i] === word[i]) i++;
    return prefix.slice(0, i);
  });

/**
 * Tab on a line: finishes the command name, or the last word as a path from the current folder (folders only after
 * cd). Returns the new line, and the choices to print when the word could still be several things.
 */
export async function complete(input: string, shell: Shell): Promise<{ value: string; choices: string[] }> {
  const words = input.split(' ');
  const word = words.at(-1) ?? '';
  const done = (choices: { name: string; dir: boolean }[]): { value: string; choices: string[] } => {
    if (choices.length === 0) return { value: input, choices: [] };
    const head = input.slice(0, input.length - word.length);
    const slash = word.lastIndexOf('/');
    const base = slash >= 0 ? word.slice(0, slash + 1) : '';
    if (choices.length === 1) {
      const [only] = choices;
      return { value: `${head}${base}${only!.name}${only!.dir ? '/' : ' '}`, choices: [] };
    }
    const prefix = commonPrefix(choices.map((c) => c.name));
    const value = `${head}${base}${prefix}`;
    return { value, choices: value === input ? choices.map((c) => (c.dir ? `${c.name}/` : c.name)) : [] };
  };
  if (words.length === 1) return done(COMMANDS.filter((c) => c.startsWith(word)).map((name) => ({ name, dir: false })));
  const slash = word.lastIndexOf('/');
  const folder = slash >= 0 ? word.slice(0, slash + 1) || '/' : '.';
  const node = await lookup(shell.root, resolvePath(shell.cwd, folder)).catch(() => null);
  if (node?.kind !== 'dir') return { value: input, choices: [] };
  const stem = word.slice(slash + 1);
  const dirsOnly = words[0] === 'cd';
  const children = await node.list();
  return done(
    children
      .filter((c) => c.name.startsWith(stem) && (!dirsOnly || c.kind === 'dir'))
      .map((c: VNode) => ({ name: c.name, dir: c.kind === 'dir' })),
  );
}
