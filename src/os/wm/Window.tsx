import { animate, useMotionValue, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { PixelIcon } from '../assets/PixelIcon';
import type { IconName } from '../assets/icons';
import { linkAttributes } from '../apps/content';
import { springOrInstant } from './motion';
import type { WindowState } from './windows';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

// Drags and resizes follow the captured pointer. Iframes (a framed site) would swallow it mid-move,
// so they ignore pointers while body has .os-moving.
function followPointer(
  event: ReactPointerEvent<HTMLElement>,
  onMove: (dx: number, dy: number) => void,
  onEnd: () => void,
) {
  const target = event.currentTarget;
  const start = { x: event.clientX, y: event.clientY };
  target.setPointerCapture(event.pointerId);
  document.body.classList.add('os-moving');
  const move = (e: PointerEvent) => onMove(e.clientX - start.x, e.clientY - start.y);
  const end = () => {
    document.body.classList.remove('os-moving');
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    onEnd();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

/** Lets an app set the text in its window's status bar (e.g. "12 projects", "Updated 12 Oct"). */
export const WindowStatusContext = createContext<(status: string | null) => void>(() => {});
export const useWindowStatus = () => useContext(WindowStatusContext);

export const windowDomId = (id: string) => `os-win-${id.replace(/[^a-z0-9-]/gi, '-')}`;

/** Copies a window's own address; visiting it loads the room and opens this window on the monitor. */
function CopyLink({ href }: { href: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2400);
    return () => clearTimeout(timer);
  }, [state]);
  const label = { idle: 'Copy link', copied: 'Link copied', failed: 'Could not copy' }[state];
  return (
    <button
      type="button"
      className="os-tool"
      onClick={() =>
        navigator.clipboard.writeText(new URL(href, window.location.origin).href).then(
          () => setState('copied'),
          () => setState('failed'),
        )
      }
    >
      <span aria-live="polite">{label}</span>
    </button>
  );
}

/** The window's toolbar: the project's repository (read in the Code window), and a link to this window to share. */
export function WindowTools({ shareHref, sourceHref }: { shareHref: string | null; sourceHref: string | null }) {
  if (!shareHref && !sourceHref) return null;
  return (
    <div className="os-toolbar">
      {sourceHref && (
        <a className="os-tool" href={sourceHref} {...linkAttributes(sourceHref)}>
          <PixelIcon name="source" size={13} />
          View source
        </a>
      )}
      {shareHref && <CopyLink href={shareHref} />}
    </div>
  );
}

interface WindowProps {
  win: WindowState;
  title: string;
  icon: IconName;
  defaultStatus: string;
  shareHref: string | null;
  sourceHref: string | null;
  active: boolean;
  desktopRef: RefObject<HTMLElement | null>;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  children: ReactNode;
}

export function Window({
  win,
  title,
  icon,
  defaultStatus,
  shareHref,
  sourceHref,
  active,
  desktopRef,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  children,
}: WindowProps) {
  const reduceMotion = useReducedMotion();
  const spring = springOrInstant(reduceMotion);
  const titleId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lifted, setLifted] = useState(false);

  // Position and size live in motion values, so drags and resizes never re-render the window body.
  const x = useMotionValue(win.frame.x);
  const y = useMotionValue(win.frame.y);
  const width = useMotionValue(win.frame.width);
  const height = useMotionValue(win.frame.height);
  const restoreFrame = useRef(win.frame);
  // A window opened from an icon or a link grows out of it, as Win98's windows zoomed out of their buttons.
  const growOrigin = win.origin ? `${win.origin.x - win.frame.x}px ${win.origin.y - win.frame.y}px` : '50% 50%';
  const wasMaximized = useRef(false);

  useEffect(() => {
    const desktop = desktopRef.current;
    if (!desktop || win.maximized === wasMaximized.current) return;
    wasMaximized.current = win.maximized;
    if (win.maximized) restoreFrame.current = { x: x.get(), y: y.get(), width: width.get(), height: height.get() };
    const target = win.maximized
      ? { x: 0, y: 0, width: desktop.clientWidth, height: desktop.clientHeight }
      : restoreFrame.current;
    animate(x, target.x, spring);
    animate(y, target.y, spring);
    animate(width, target.width, spring);
    animate(height, target.height, spring);
    // Only a maximise toggle moves the window here; drags and resizes set the values directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.maximized]);

  useEffect(() => {
    // An app may already have put focus inside (the Terminal's prompt); leave it there.
    const section = sectionRef.current;
    if (win.focusRequest > 0 && section && !section.contains(document.activeElement))
      section.focus({ preventScroll: true });
  }, [win.focusRequest]);

  // A window lifts a little while it moves and settles back on the spring when let go.
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (win.maximized || event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    // That also stops the browser focusing the window, so a click on the title bar would leave the keyboard elsewhere.
    const section = sectionRef.current;
    if (section && !section.contains(document.activeElement)) section.focus({ preventScroll: true });
    const desktop = desktopRef.current;
    const from = { x: x.get(), y: y.get() };
    const maxX = desktop ? desktop.clientWidth - width.get() : Infinity;
    const maxY = desktop ? desktop.clientHeight - height.get() : Infinity;
    setLifted(true);
    followPointer(
      event,
      (dx, dy) => {
        x.set(clamp(from.x + dx, 0, Math.max(0, maxX)));
        y.set(clamp(from.y + dy, 0, Math.max(0, maxY)));
      },
      () => setLifted(false),
    );
  };

  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (win.maximized || event.button !== 0) return;
    event.preventDefault();
    const desktop = desktopRef.current;
    const from = { width: width.get(), height: height.get() };
    const maxWidth = desktop ? desktop.clientWidth - x.get() : Infinity;
    const maxHeight = desktop ? desktop.clientHeight - y.get() : Infinity;
    followPointer(
      event,
      (dx, dy) => {
        width.set(clamp(from.width + dx, MIN_WIDTH, Math.max(MIN_WIDTH, maxWidth)));
        height.set(clamp(from.height + dy, MIN_HEIGHT, Math.max(MIN_HEIGHT, maxHeight)));
      },
      () => {},
    );
  };

  return (
    <m.section
      ref={sectionRef}
      id={windowDomId(win.id)}
      className="os-window"
      data-active={active || undefined}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      inert={win.minimized}
      style={{ x, y, width, height, zIndex: win.z, transformOrigin: growOrigin }}
      initial={{ opacity: 0, scale: win.origin ? 0.3 : 0.94 }}
      animate={
        win.minimized
          ? { opacity: 0, scale: 0.86, transitionEnd: { visibility: 'hidden' } }
          : { opacity: 1, scale: lifted ? 1.012 : 1, visibility: 'visible' }
      }
      exit={{ opacity: 0, scale: 0.96 }}
      transition={spring}
      onPointerDownCapture={onFocus}
    >
      <div className="os-titlebar" onPointerDown={startDrag} onDoubleClick={onToggleMaximize}>
        <PixelIcon name={icon} size={16} />
        <p className="os-titlebar-text" id={titleId}>
          {title}
        </p>
        <div className="os-titlebar-buttons">
          <button type="button" className="os-control" aria-label={`Minimise ${title}`} onClick={onMinimize}>
            <PixelIcon name="minimize" size={8} />
          </button>
          <button
            type="button"
            className="os-control"
            aria-label={`${win.maximized ? 'Restore' : 'Maximise'} ${title}`}
            onClick={onToggleMaximize}
          >
            <PixelIcon name={win.maximized ? 'restore' : 'maximize'} size={8} />
          </button>
          <button type="button" className="os-control" aria-label={`Close ${title}`} onClick={onClose}>
            <PixelIcon name="close" size={8} />
          </button>
        </div>
      </div>
      <WindowTools shareHref={shareHref} sourceHref={sourceHref} />
      {/* Focusable, so a keyboard can scroll a body that has no links of its own (WCAG 2.1.1). */}
      <div className="os-well" tabIndex={0}>
        <WindowStatusContext value={setStatus}>{children}</WindowStatusContext>
      </div>
      <div className="os-statusbar">
        <p className="os-status-cell" aria-live="polite">
          {status ?? defaultStatus}
        </p>
        <div className="os-status-cell os-status-grip" onPointerDown={startResize} aria-hidden="true" />
      </div>
    </m.section>
  );
}
