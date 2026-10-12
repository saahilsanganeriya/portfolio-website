import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useId } from 'react';
import { AppBody, describeWindow } from '../apps/registry';
import type { OsApi } from '../types';
import { springOrInstant } from '../wm/motion';
import { windowDomId } from '../wm/Window';
import type { WindowState } from '../wm/windows';

interface PhoneWindowProps {
  win: WindowState;
  covered: boolean;
  os: OsApi;
  onBack: () => void;
}

// Each app fills the screen, newest on top, with no status bar; Back closes the top one (Alana Goyal's phone layout).
function PhoneWindow({ win, covered, os, onBack }: PhoneWindowProps) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const { title, pageHref } = describeWindow(win.route, os.index);
  return (
    <m.section
      id={windowDomId(win.id)}
      className="os-phone-window"
      role="dialog"
      aria-labelledby={titleId}
      inert={covered}
      style={{ zIndex: win.z }}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={springOrInstant(reduceMotion)}
    >
      <div className="os-backbar">
        <button type="button" className="os-back" onClick={onBack}>
          ‹ Back
        </button>
        <p className="os-backbar-title" id={titleId}>
          {title}
        </p>
        {pageHref && (
          <a className="os-tool" href={pageHref} target="_top">
            Open as page ↗
          </a>
        )}
      </div>
      <div className="os-phone-body">
        <AppBody route={win.route} os={os} />
      </div>
    </m.section>
  );
}

export function PhoneWindows({
  windows,
  os,
  onBack,
}: {
  windows: WindowState[];
  os: OsApi;
  onBack: (id: string) => void;
}) {
  const stack = windows.filter((w) => !w.minimized).sort((a, b) => a.z - b.z);
  const topId = stack.at(-1)?.id;
  return (
    <AnimatePresence>
      {stack.map((win) => (
        <PhoneWindow key={win.id} win={win} covered={win.id !== topId} os={os} onBack={() => onBack(win.id)} />
      ))}
    </AnimatePresence>
  );
}
