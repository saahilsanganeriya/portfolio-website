// Light syntax highlighting for the Code window, loaded only when a file is opened: one pass over the text marks
// comments, strings, numbers, keywords and markup names. Not a parser; it is wrong in small ways and never slow.

type Kind = 'c' | 's' | 'n' | 'k' | 't' | 'a';

interface Grammar {
  line?: string[];
  block?: [open: string, close: string][];
  /** Longest first, so `"""` wins over `"`. */
  strings?: string[];
  keywords?: Set<string>;
  caseInsensitive?: boolean;
  /** `<tag attr="…">`: names after `<` are tags, names before `=` inside a tag are attributes. */
  markup?: boolean;
  /** `key:` or `key =` at the start of a line is a key (YAML, TOML, INI). */
  keys?: boolean;
  /** JSON: a string followed by `:` is a key. */
  jsonKeys?: boolean;
}

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

const JS = words(`as async await break case catch class const continue debugger declare default delete do else enum export
  extends false finally for from function get if implements import in instanceof interface keyof let namespace new null
  of private protected public readonly return satisfies set static super switch this throw true try type typeof
  undefined var void while with yield`);
const PYTHON = words(`False None True and as assert async await break case class continue def del elif else except
  finally for from global if import in is lambda match nonlocal not or pass raise return self try while with yield`);
const GO = words(`break case chan const continue default defer else fallthrough false for func go goto if import iota
  interface map nil package range return select struct switch true type var`);
const RUST = words(`as async await break const continue crate dyn else enum extern false fn for if impl in let loop match
  mod move mut pub ref return self Self static struct super trait true type unsafe use where while`);
const CLIKE = words(`abstract auto bool boolean break byte case catch char class const continue data default define do
  double else enum extends extern false final finally float for fun func goto guard if ifdef ifndef endif implements
  import include inline instanceof int interface internal is let long namespace native new null nullptr object open
  override package private protected public register return sealed short signed sizeof static struct super switch
  synchronized template this throw throws true try typedef typename union unsigned using val var virtual void volatile
  when while`);
const SHELL = words(`case do done elif else esac exit export fi for function if in local readonly return set source then
  unset until while`);
const DOCKER = words(`ADD ARG AS CMD COPY ENTRYPOINT ENV EXPOSE FROM HEALTHCHECK LABEL ONBUILD RUN SHELL STOPSIGNAL USER
  VOLUME WORKDIR`);
const SQL = words(`add all alter and as asc by case create default delete desc distinct drop else end exists foreign from
  group having in index inner insert into is join key left like limit not null offset on or order outer primary
  references right select set table then union unique update values view when where with`);

const C_COMMENTS = { line: ['//'], block: [['/*', '*/']] as [string, string][] };

const GRAMMARS: Record<string, Grammar> = {
  js: { ...C_COMMENTS, strings: ['`', '"', "'"], keywords: JS },
  python: { line: ['#'], strings: ['"""', "'''", '"', "'"], keywords: PYTHON },
  go: { ...C_COMMENTS, strings: ['`', '"', "'"], keywords: GO },
  rust: { ...C_COMMENTS, strings: ['"'], keywords: RUST },
  clike: { ...C_COMMENTS, strings: ['"""', '"', "'"], keywords: CLIKE },
  shell: { line: ['#'], strings: ['"', "'"], keywords: SHELL },
  docker: { line: ['#'], strings: ['"', "'"], keywords: DOCKER },
  sql: { line: ['--'], block: [['/*', '*/']], strings: ["'", '"'], keywords: SQL, caseInsensitive: true },
  yaml: { line: ['#'], strings: ['"', "'"], keys: true },
  toml: { line: ['#'], strings: ['"""', '"', "'"], keys: true },
  ini: { line: ['#', ';'], strings: ['"'], keys: true },
  json: { strings: ['"'], keywords: words('true false null'), jsonKeys: true },
  markup: { block: [['<!--', '-->']], strings: ['"', "'"], markup: true },
  css: { block: [['/*', '*/']], strings: ['"', "'"] },
  hash: { line: ['#'], strings: ['"', "'"] },
  tex: { line: ['%'], strings: [] },
  lua: { line: ['--'], strings: ['"', "'"] },
};

const BY_EXTENSION: Record<string, string> = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js',
  py: 'python', pyi: 'python', go: 'go', rs: 'rust',
  c: 'clike', h: 'clike', cc: 'clike', cpp: 'clike', hpp: 'clike', cs: 'clike', java: 'clike', kt: 'clike', kts: 'clike',
  scala: 'clike', swift: 'clike', dart: 'clike', m: 'clike', gradle: 'clike', proto: 'clike',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', sql: 'sql',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini',
  json: 'json', jsonc: 'json', geojson: 'json', webmanifest: 'json',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', astro: 'markup', plist: 'markup',
  css: 'css', scss: 'css', less: 'css', r: 'hash', rb: 'hash', pl: 'hash', tex: 'tex', lua: 'lua',
};

/** The grammar for a file, by name then extension; null means plain text. */
export function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (/^Dockerfile/i.test(name)) return 'docker';
  if (/^(Makefile|GNUmakefile|.*\.mk)$/.test(name)) return 'shell';
  if (/^\.(gitignore|dockerignore|env.*|editorconfig)$/.test(name)) return 'ini';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return BY_EXTENSION[extension] ?? null;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isWord = (ch: string | undefined) => ch !== undefined && /[\w$]/.test(ch);

function tokenize(code: string, grammar: Grammar): [Kind | null, string][] {
  const tokens: [Kind | null, string][] = [];
  let plain = '';
  let inTag = false;
  const push = (kind: Kind | null, text: string) => {
    if (kind === null) {
      plain += text;
      return;
    }
    if (plain) tokens.push([null, plain]);
    plain = '';
    tokens.push([kind, text]);
  };
  let i = 0;
  let lineStart = true;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\n') {
      push(null, ch);
      i++;
      lineStart = true;
      continue;
    }
    if (grammar.keys && lineStart) {
      const key = code.slice(i).match(/^([ \t]*-?[ \t]*)([\w.\-"'[\]]+)(?=[ \t]*[:=])/);
      if (key) {
        push(null, key[1]);
        push('a', key[2]);
        i += key[0].length;
        lineStart = false;
        continue;
      }
    }
    if (ch !== ' ' && ch !== '\t') lineStart = false;

    const block = grammar.block?.find(([open]) => code.startsWith(open, i));
    if (block) {
      const end = code.indexOf(block[1], i + block[0].length);
      const stop = end === -1 ? code.length : end + block[1].length;
      push('c', code.slice(i, stop));
      i = stop;
      continue;
    }
    if (grammar.line?.some((open) => code.startsWith(open, i)) && !(grammar.markup && inTag)) {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      push('c', code.slice(i, stop));
      i = stop;
      continue;
    }
    const quote = grammar.strings?.find((q) => code.startsWith(q, i));
    if (quote && (!grammar.markup || inTag)) {
      let j = i + quote.length;
      while (j < code.length && !code.startsWith(quote, j)) {
        if (code[j] === '\\') j++;
        else if (code[j] === '\n' && quote.length === 1 && quote !== '`') break;
        j++;
      }
      const stop = Math.min(code.length, code.startsWith(quote, j) ? j + quote.length : j);
      const text = code.slice(i, stop);
      push(grammar.jsonKeys && /^\s*:/.test(code.slice(stop, stop + 8)) ? 'a' : 's', text);
      i = stop;
      continue;
    }
    if (grammar.markup && ch === '<' && /[/!?A-Za-z]/.test(code[i + 1] ?? '')) {
      const name = code.slice(i + 1).match(/^[/!?]?[\w:.-]*/)![0];
      push(null, '<');
      push('t', name);
      i += 1 + name.length;
      inTag = true;
      continue;
    }
    if (grammar.markup && inTag && ch === '>') {
      push(null, ch);
      inTag = false;
      i++;
      continue;
    }
    if (/\d/.test(ch) && !isWord(code[i - 1])) {
      const number = code.slice(i).match(/^(0[xob][\da-f_]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)[a-z]*/i)![0];
      push('n', number);
      i += number.length;
      continue;
    }
    if (isWord(ch) && !isWord(code[i - 1])) {
      const word = code.slice(i).match(/^[\w$]+/)![0];
      const isKeyword = grammar.keywords?.has(grammar.caseInsensitive ? word.toLowerCase() : word);
      const isAttribute = grammar.markup && inTag && /^\s*=/.test(code.slice(i + word.length, i + word.length + 4));
      push(isKeyword ? 'k' : isAttribute ? 'a' : null, word);
      i += word.length;
      continue;
    }
    push(null, ch);
    i++;
  }
  if (plain) tokens.push([null, plain]);
  return tokens;
}

/** Lines of HTML (`<span class="l">` each), escaped, with token spans closed and reopened at line ends. */
export function highlightLines(code: string, language: string | null): string {
  const grammar = language ? GRAMMARS[language] : undefined;
  const tokens: [Kind | null, string][] = grammar ? tokenize(code, grammar) : [[null, code]];
  const lines: string[] = [];
  let current = '';
  for (const [kind, text] of tokens) {
    const parts = text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) {
        lines.push(current);
        current = '';
      }
      if (part) current += kind ? `<span class="tk-${kind}">${escapeHtml(part)}</span>` : escapeHtml(part);
    });
  }
  lines.push(current);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines.map((line) => `<span class="l">${line}</span>`).join('');
}
