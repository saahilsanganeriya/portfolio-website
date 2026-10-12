import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

// Typed a character at a time, `~` a pause; the key=value log line prints whole, as a log does.
const SCRIPT = [
  'Saving the open windows… done.',
  'Rewinding the reels~.~.~.~ done.',
  'Switching off the projector lamp… done.',
  'Watering the mango plant… done.',
  'time={now} level=INFO msg="run finished" stage=shutdown',
  '',
  'Goodnight.',
];

const CHAR_MS = 12;
const PAUSE_MS = 180;
const OFF_AFTER_MS = 500;

type Step = { text: string; wait: number };

function steps(lines: string[]): Step[] {
  return lines.flatMap((line) => {
    const typed: Step[] = line.startsWith('time=')
      ? [{ text: line, wait: CHAR_MS }]
      : [...line].map((ch) => (ch === '~' ? { text: '', wait: PAUSE_MS } : { text: ch, wait: CHAR_MS }));
    return [...typed, { text: '\n', wait: PAUSE_MS }];
  });
}

interface ShutdownProps {
  phase: 'shutting' | 'off';
  onDone: () => void;
  onRestart: () => void;
}

export function Shutdown({ phase, onDone, onRestart }: ShutdownProps) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState('');
  const restartRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== 'shutting') return;
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const queue = steps(SCRIPT.map((line) => line.replace('{now}', now)));
    let timer = 0;
    let i = 0;
    const finish = () => {
      window.clearTimeout(timer);
      setShown(queue.map((step) => step.text).join(''));
      timer = window.setTimeout(onDone, reduceMotion ? 0 : OFF_AFTER_MS);
    };
    const next = () => {
      const step = queue[i++];
      if (!step) return finish();
      setShown((prev) => prev + step.text);
      timer = window.setTimeout(next, step.wait);
    };
    if (reduceMotion) finish();
    else next();
    // Any key or click skips to the end.
    window.addEventListener('keydown', finish, { once: true });
    window.addEventListener('pointerdown', finish, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', finish);
      window.removeEventListener('pointerdown', finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === 'off') restartRef.current?.focus();
  }, [phase]);

  return (
    <main id="content" className="os-shutdown" tabIndex={-1}>
      <h1 className="visually-hidden">{phase === 'shutting' ? 'SaahilOS is shutting down' : 'SaahilOS is off'}</h1>
      {phase === 'shutting' ? (
        <pre className="os-shutdown-log">{shown}</pre>
      ) : (
        <div className="os-off">
          <p className="os-off-line">It is now safe to turn off your computer.</p>
          <p className="os-off-actions">
            <button ref={restartRef} type="button" className="os-button" onClick={onRestart}>
              Restart SaahilOS
            </button>
            <a href="/projects" target="_top">
              Read the site as plain pages
            </a>
          </p>
        </div>
      )}
    </main>
  );
}
