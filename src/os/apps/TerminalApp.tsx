import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react';
import type { OsApi } from '../types';
import { loadContent } from './content';
import { bootLog, runCommand, type TermLine } from './terminal/commands';

const PROMPT = 'saahil@projectionist:~$';
const BOOT_LINE_MS = 110;
const MAX_LINES = 400;

async function readAbout(): Promise<string | null> {
  try {
    const { html } = await loadContent<unknown>('pages', 'about');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const paragraphs = [...doc.body.querySelectorAll('p, li, h2, h3')].map((el) => el.textContent?.trim() ?? '');
    return paragraphs.filter(Boolean).join('\n\n') || null;
  } catch {
    return null;
  }
}

export function TerminalApp({ os }: { os: OsApi }) {
  const reduceMotion = useReducedMotion();
  const [lines, setLines] = useState<TermLine[]>([]);
  const [value, setValue] = useState('');
  const history = useRef<string[]>([]);
  const historyAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const append = (more: TermLine[]) => setLines((prev) => [...prev, ...more].slice(-MAX_LINES));

  // The boot log prints a line at a time, like a service starting; with reduced motion it prints at once.
  useEffect(() => {
    const log = bootLog(os.index, new Date());
    if (reduceMotion) {
      setLines(log);
      return;
    }
    const timers = log.map((entry, i) => window.setTimeout(() => append([entry]), i * BOOT_LINE_MS));
    return () => timers.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!os.phone) inputRef.current?.focus({ preventScroll: true });
  }, [os.phone]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = value;
    setValue('');
    if (input.trim()) history.current.push(input);
    historyAt.current = history.current.length;
    append([{ text: `${PROMPT} ${input}`, tone: 'echo' }]);
    const result = await runCommand(input, { index: os.index, open: os.open, readAbout });
    if (result.clear) setLines([]);
    else append(result.lines);
  };

  const recall = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const past = history.current;
    historyAt.current = Math.max(0, Math.min(past.length, historyAt.current + (event.key === 'ArrowUp' ? -1 : 1)));
    setValue(past[historyAt.current] ?? '');
  };

  return (
    // A click anywhere on the screen puts the cursor back in the prompt, as on a real terminal.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="os-terminal" onClick={() => window.getSelection()?.isCollapsed && inputRef.current?.focus()}>
      <div className="os-terminal-log" role="log" aria-label="Terminal output">
        {lines.map((entry, i) => (
          <p key={i} className={`os-term-${entry.tone}`}>
            {entry.text || ' '}
          </p>
        ))}
      </div>
      <form className="os-terminal-prompt" onSubmit={submit}>
        <span className="os-term-ps1" aria-hidden="true">
          {PROMPT}
        </span>
        <input
          ref={inputRef}
          aria-label="Command"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={recall}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
        />
      </form>
      <div ref={endRef} />
    </div>
  );
}
