import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_GUESSES, WORD_LENGTH, isWord, keyMarks, score, shareText, type Mark } from './game';
import { TOPIC_LINES, answerFor, dayNumber } from './words';

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const MARK_WORDS: Record<Mark, string> = { correct: 'right place', present: 'in the word', absent: 'not in it' };
const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

const storageKey = (day: number) => `saahilos.daily-word.${day}`;

// A day's guesses survive a reload; storage can be off (private windows), and then the game simply starts over.
function loadGuesses(day: number): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(day)) ?? '[]');
    return Array.isArray(saved) ? saved.filter((g): g is string => typeof g === 'string').slice(0, MAX_GUESSES) : [];
  } catch {
    return [];
  }
}

function describeRow(guess: string, marks: Mark[]): string {
  return `${guess}: ${marks.map((mark, i) => `${guess[i]} ${MARK_WORDS[mark]}`).join(', ')}`;
}

/** One guess as a strip of five film frames; the frames light one after another when the guess is marked. */
function Strip({ letters, marks, label, shake }: { letters: string; marks?: Mark[]; label: string; shake?: number }) {
  return (
    <li className="os-word-strip" aria-label={label} data-shake={shake || undefined}>
      {Array.from({ length: WORD_LENGTH }, (_, i) => (
        <span
          key={i}
          className="os-word-frame"
          data-mark={marks?.[i]}
          data-filled={letters[i] ? '' : undefined}
          style={{ animationDelay: `${i * 90}ms` }}
          aria-hidden="true"
        >
          {letters[i] ?? ''}
        </span>
      ))}
    </li>
  );
}

function Projector({ word }: { word: string }) {
  return (
    <svg className="os-word-projector" viewBox="0 0 200 76" aria-hidden="true">
      <polygon className="os-word-beam" points="70,40 200,8 200,72" />
      <text className="os-word-screen" x="152" y="44">
        {word}
      </text>
      <g className="os-word-reel" style={{ transformOrigin: '24px 20px' }}>
        <circle cx="24" cy="20" r="15" />
        <path d="M24 7v26M11 20h26M15 11l18 18M33 11L15 29" />
      </g>
      <g className="os-word-reel" style={{ transformOrigin: '54px 22px' }}>
        <circle cx="54" cy="22" r="12" />
        <path d="M54 12v20M44 22h20M47 15l14 14M61 15L47 29" />
      </g>
      <rect className="os-word-body" x="12" y="34" width="52" height="22" rx="3" />
      <rect className="os-word-body" x="62" y="38" width="10" height="12" rx="1" />
      <path className="os-word-legs" d="M20 56l-6 14M56 56l6 14" />
    </svg>
  );
}

export function GameApp() {
  const day = useMemo(() => dayNumber(new Date()), []);
  const { word: answer, topic } = answerFor(day);
  const [guesses, setGuesses] = useState<string[]>(() => loadGuesses(day));
  const [current, setCurrent] = useState('');
  // `notice` is shown (a refused guess); `announcement` is read out (every marked guess, the end) and stays hidden.
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [shake, setShake] = useState(0);
  const [dictionary, setDictionary] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const rootRef = useRef<HTMLDivElement>(null);

  // About 18 KB gzipped, so it loads with the window rather than with the desktop.
  useEffect(() => {
    import('./guesses').then((module) => setDictionary(module.GUESSES));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(day), JSON.stringify(guesses));
    } catch {
      // Storage is off; the game still works for this visit.
    }
  }, [day, guesses]);

  const won = guesses.at(-1) === answer;
  const over = won || guesses.length >= MAX_GUESSES;
  const keys = keyMarks(guesses, answer);

  const reject = (text: string) => {
    setNotice(text);
    setAnnouncement(text);
    setShake((n) => n + 1);
  };

  const press = (key: string) => {
    if (over) return;
    if (key === 'Enter') {
      if (current.length < WORD_LENGTH) return reject('Five letters, please.');
      if (!dictionary) return reject('The word list is still loading.');
      if (!isWord(current, dictionary)) return reject(`${current} is not in the word list.`);
      const next = [...guesses, current];
      setGuesses(next);
      setCurrent('');
      setNotice('');
      if (current === answer) setAnnouncement(`Got it in ${next.length} of ${MAX_GUESSES}.`);
      else if (next.length === MAX_GUESSES) setAnnouncement(`The word was ${answer}.`);
      else setAnnouncement(describeRow(current, score(current, answer)));
      return;
    }
    setNotice('');
    if (key === 'Backspace') return setCurrent((c) => c.slice(0, -1));
    if (/^[A-Z]$/.test(key) && current.length < WORD_LENGTH) setCurrent((c) => c + key);
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  // Typing works while this window has focus; a focused on-screen key handles its own Enter, and other windows'
  // fields (the Terminal's prompt) keep their keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const windowEl = rootRef.current?.closest('[role="dialog"]');
      const active = document.activeElement;
      if (!windowEl?.contains(active) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (event.key === 'Enter' && active instanceof HTMLButtonElement) return;
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      if (key !== 'Enter' && key !== 'Backspace' && !/^[A-Z]$/.test(key)) return;
      event.preventDefault();
      pressRef.current(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const copyResult = () =>
    navigator.clipboard.writeText(shareText(day, guesses, answer, won)).then(
      () => setCopied('copied'),
      () => setCopied('failed'),
    );

  const rows = Array.from({ length: MAX_GUESSES }, (_, i) => {
    if (i < guesses.length) {
      const marks = score(guesses[i], answer);
      return <Strip key={i} letters={guesses[i]} marks={marks} label={`Guess ${i + 1}, ${describeRow(guesses[i], marks)}`} />;
    }
    if (i === guesses.length && !over)
      return (
        <Strip
          key={`current-${shake}`}
          letters={current}
          shake={shake}
          label={`Guess ${i + 1}, typing: ${current ? current.split('').join(' ') : 'nothing yet'}`}
        />
      );
    return <Strip key={i} letters="" label={`Guess ${i + 1}, not played`} />;
  });

  return (
    <div className="os-word" ref={rootRef}>
      <header className="os-word-head">
        <h2 className="os-word-title">
          Word {day + 1}, <span>{today.format(new Date())}</span>
        </h2>
        <p className="os-word-intro">
          A five-letter word from my world: films, code, the kitchen, Delhi or San Francisco. Six tries, and a new word
          every day.
        </p>
        <ul className="os-word-key" aria-label="What the frames mean">
          {(['correct', 'present', 'absent'] as Mark[]).map((mark) => (
            <li key={mark}>
              <span className="os-word-frame os-word-frame-mini" data-mark={mark} aria-hidden="true" />
              {MARK_WORDS[mark]}
            </li>
          ))}
        </ul>
      </header>

      <ol className="os-word-board" aria-label="Your guesses">
        {rows}
      </ol>
      <p className="os-word-message" aria-hidden="true">
        {notice}
      </p>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>

      {over ? (
        <section className="os-word-end" aria-label={won ? 'You won' : 'Game over'}>
          {won && <Projector word={answer} />}
          <p className="os-word-end-line">
            {won ? `Got it in ${guesses.length} of ${MAX_GUESSES}.` : `The word was ${answer}.`} {TOPIC_LINES[topic]}
          </p>
          <p className="os-word-end-actions">
            <button type="button" className="os-tool" onClick={copyResult}>
              <span aria-live="polite">
                {{ idle: 'Copy result', copied: 'Result copied', failed: 'Could not copy' }[copied]}
              </span>
            </button>
            <span>A new word tomorrow.</span>
          </p>
        </section>
      ) : (
        <div className="os-word-keys" role="group" aria-label="Keyboard">
          {KEY_ROWS.map((row, r) => (
            <div key={row} className="os-word-keyrow">
              {r === 2 && (
                <button type="button" className="os-word-keycap os-word-wide" onClick={() => press('Enter')}>
                  Enter
                </button>
              )}
              {row.split('').map((letter) => {
                const mark = keys.get(letter);
                return (
                  <button
                    key={letter}
                    type="button"
                    className="os-word-keycap"
                    data-mark={mark}
                    aria-label={mark ? `${letter}, ${MARK_WORDS[mark]}` : letter}
                    onClick={() => press(letter)}
                  >
                    {letter}
                  </button>
                );
              })}
              {r === 2 && (
                <button type="button" className="os-word-keycap os-word-wide" onClick={() => press('Backspace')}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
