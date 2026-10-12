import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

// `~` marks a pause, so the log reads like a machine doing the work rather than text appearing.
const SCRIPT = [
  'Saving the open windows… done.',
  'Rewinding the reels~.~.~.~ done.',
  'Switching off the projector lamp… done.',
  'Watering the mango plant… done.',
  'time={now} level=INFO msg="run finished" stage=shutdown',
  '',
  'Goodnight.',
].join('\n');

const CHAR_MS = 16;
const PAUSE_MS = 320;

interface ShutdownProps {
  phase: 'shutting' | 'off';
  onDone: () => void;
  onRestart: () => void;
}

export function Shutdown({ phase, onDone, onRestart }: ShutdownProps) {
  const reduceMotion = useReducedMotion();
  const script = useRef(SCRIPT.replace('{now}', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')));
  const [shown, setShown] = useState('');
  const restartRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== 'shutting') return;
    const text = script.current;
    const finish = () => {
      setShown(text.replaceAll('~', ''));
      window.setTimeout(onDone, reduceMotion ? 0 : 900);
    };
    if (reduceMotion) {
      finish();
      return;
    }
    let i = 0;
    let timer = 0;
    const step = () => {
      const ch = text[i++];
      if (ch === undefined) return finish();
      if (ch !== '~') setShown((prev) => prev + ch);
      timer = window.setTimeout(step, ch === '~' || ch === '\n' ? PAUSE_MS : CHAR_MS);
    };
    step();
    // Any key or click skips to the end.
    const skip = () => {
      window.clearTimeout(timer);
      finish();
    };
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('pointerdown', skip, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === 'off') restartRef.current?.focus();
  }, [phase]);

  return (
    <main id="content" className="os-shutdown" tabIndex={-1}>
      {phase === 'shutting' ? (
        <pre className="os-shutdown-log">
          {shown}
        </pre>
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
