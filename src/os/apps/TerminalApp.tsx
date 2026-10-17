import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react';
import type { OsApi } from '../types';
import { bootLog, complete, runCommand, vimInput, type Shell, type TermLine, type TermResult } from './terminal/commands';
import { HOME, buildTree, displayPath } from './terminal/fs';

const LINE_MS = 110;
const MAX_LINES = 600;

function Prompt({ cwd }: { cwd: string }) {
  return (
    <span className="os-term-ps1">
      <span className="os-term-user">saahil@saahilos:</span>
      {cwd}$
    </span>
  );
}

export function TerminalApp({ os }: { os: OsApi }) {
  const reduceMotion = useReducedMotion();
  const [lines, setLines] = useState<TermLine[]>([]);
  const [value, setValue] = useState('');
  const [cwd, setCwd] = useState(displayPath(HOME));
  const [vim, setVim] = useState(false);
  const vimTries = useRef(0);
  const historyAt = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Lines waiting to print one at a time (the boot log, a paced reply); a keystroke prints the boot log's rest at once.
  const pending = useRef<{ flush: () => void } | null>(null);
  const shell = useMemo<Shell>(
    () => ({ index: os.index, root: buildTree(os.index), cwd: HOME, previousCwd: HOME, history: [], open: os.open }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const append = (more: TermLine[]) => setLines((prev) => [...prev, ...more].slice(-MAX_LINES));

  const desktop = () => rootRef.current?.closest('.os');
  const setWiped = (wiped: boolean) => desktop()?.toggleAttribute('data-wiped', wiped);

  /** Prints a reply, a line at a time when it asks for that; resolves when the last line is out. */
  const print = (result: TermResult) =>
    new Promise<void>((done) => {
      if (!result.paced || reduceMotion) {
        append(result.lines);
        done();
        return;
      }
      const wipeEnd = result.wipe ? result.lines.findIndex((l) => l.text === '') : -1;
      const step = LINE_MS * (result.wipe ? 2.2 : 1);
      let printed = 0;
      const timers = result.lines.map((entry, i) =>
        window.setTimeout(() => {
          if (i === wipeEnd) setWiped(false);
          append([entry]);
          printed = i + 1;
          if (printed === result.lines.length) {
            pending.current = null;
            done();
          }
        }, i * step),
      );
      if (result.wipe) setWiped(true);
      // A keystroke while it prints puts the rest out at once.
      pending.current = {
        flush: () => {
          timers.forEach(window.clearTimeout);
          pending.current = null;
          setWiped(false);
          append(result.lines.slice(printed));
          done();
        },
      };
    });

  // The boot log prints a line at a time, like a service starting; a keystroke or reduced motion prints it at once.
  useEffect(() => {
    const log = bootLog(os.index, new Date());
    if (reduceMotion) {
      setLines(log);
      return;
    }
    const timers = log.map((entry, i) => window.setTimeout(() => append([entry]), i * LINE_MS));
    pending.current = {
      flush: () => {
        timers.forEach(window.clearTimeout);
        pending.current = null;
        setLines(log);
      },
    };
    return () => {
      timers.forEach(window.clearTimeout);
      setWiped(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The prompt takes the keyboard whenever its window does: opened, raised from the taskbar or clicked on its title.
  useEffect(() => {
    const section = rootRef.current?.closest<HTMLElement>('[role="dialog"]');
    if (!os.phone) inputRef.current?.focus({ preventScroll: true });
    if (!section) return;
    const onFocus = (event: FocusEvent) => event.target === section && inputRef.current?.focus({ preventScroll: true });
    section.addEventListener('focus', onFocus);
    return () => section.removeEventListener('focus', onFocus);
  }, [os.phone]);

  // The newest line stays in view. The scroll area is moved directly: scrollIntoView would scroll the room around the
  // monitor too.
  const toBottom = () => {
    const scroller = rootRef.current?.closest('.os-well, .os-phone-body');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  };
  useEffect(toBottom, [lines]);
  // A phone's keyboard shrinks the visible area after the prompt takes focus; keep the prompt above it.
  useEffect(() => {
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', toBottom);
    return () => viewport?.removeEventListener('resize', toBottom);
  }, []);

  // Commands run one after another; one typed while another is still working waits its turn, as on a real terminal.
  const queue = useRef(Promise.resolve());
  const vimMode = useRef(false);

  const execute = async (input: string) => {
    if (vimMode.current) {
      vimTries.current += 1;
      const result = vimInput(input, vimTries.current);
      append(result.lines);
      if (result.quit) {
        vimMode.current = false;
        setVim(false);
      }
      return;
    }
    if (input.trim()) shell.history.push(input);
    historyAt.current = shell.history.length;
    append([{ text: input, tone: 'echo', cwd: displayPath(shell.cwd) }]);
    let result: TermResult;
    try {
      result = await runCommand(input, shell);
    } catch {
      result = { lines: [{ text: 'That did not work just now. Try again.', tone: 'warn' }] };
    }
    setCwd(displayPath(shell.cwd));
    if (result.clear) setLines([]);
    else await print(result);
    if (result.vim) {
      vimTries.current = 0;
      vimMode.current = true;
      setVim(true);
    }
    if (result.exit) window.setTimeout(() => os.close('terminal'), reduceMotion ? 0 : 500);
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    pending.current?.flush();
    const input = value;
    setValue('');
    queue.current = queue.current.then(() => execute(input));
  };

  const onKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    pending.current?.flush();
    const past = shell.history;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      historyAt.current = Math.max(0, Math.min(past.length, historyAt.current + (event.key === 'ArrowUp' ? -1 : 1)));
      setValue(past[historyAt.current] ?? '');
    } else if (event.key === 'Tab' && !vim) {
      event.preventDefault();
      const input = value;
      const { value: next, choices } = await complete(input, shell);
      setValue(next);
      if (choices.length) append([{ text: input, tone: 'echo', cwd: displayPath(shell.cwd) }, { text: choices.join('  '), tone: 'plain' }]);
    } else if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setLines([]);
    } else if (event.ctrlKey && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
      event.preventDefault();
      append([{ text: `${value}^C`, tone: 'echo', cwd: displayPath(shell.cwd) }]);
      setValue('');
    } else if (event.ctrlKey && event.key.toLowerCase() === 'd' && value === '' && !vim) {
      event.preventDefault();
      append([{ text: 'logout', tone: 'muted' }]);
      window.setTimeout(() => os.close('terminal'), reduceMotion ? 0 : 500);
    } else if (event.key === 'Escape' && (vim || value)) {
      // Used here (leaving vim's insert mode, or clearing the line): the room must not also step back from the screen.
      event.preventDefault();
      if (!vim) setValue('');
    }
  };

  return (
    // A click anywhere on the screen puts the cursor back in the prompt, as on a real terminal.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={rootRef}
      className="os-terminal"
      onClick={() => window.getSelection()?.isCollapsed && inputRef.current?.focus({ preventScroll: true })}
    >
      <div className="os-terminal-log" role="log" aria-label="Terminal output">
        {lines.map((entry, i) => (
          <p key={i} className={`os-term-${entry.tone}`}>
            {entry.tone === 'echo' && entry.cwd !== undefined && (
              <>
                <Prompt cwd={entry.cwd} />{' '}
              </>
            )}
            {entry.text || ' '}
          </p>
        ))}
      </div>
      <form className="os-terminal-prompt" onSubmit={submit}>
        <span aria-hidden="true">{!vim && <Prompt cwd={cwd} />}</span>
        <input
          ref={inputRef}
          aria-label={vim ? 'vim command' : `Command, in ${cwd}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
        />
      </form>
    </div>
  );
}
