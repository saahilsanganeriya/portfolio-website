import { animate, motion, useDragControls, useMotionValue, useReducedMotion } from 'motion/react';
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
import { springOrInstant } from './motion';
import type { WindowState } from './windows';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;

/** Lets an app set the text in its window's status bar (e.g. "12 projects", "Updated 12 Oct"). */
export const WindowStatusContext = createContext<(status: string | null) => void>(() => {});
export const useWindowStatus = () => useContext(WindowStatusContext);

export const windowDomId = (id: string) => `os-win-${id.replace(/[^a-z0-9-]/gi, '-')}`;

interface WindowProps {
  win: WindowState;
  title: string;
  icon: IconName;
  defaultStatus: string;
  pageHref: string | null;
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
  pageHref,
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
  const dragControls = useDragControls();
  const sectionRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Position and size live in motion values, so drags and resizes never re-render the window body.
  const x = useMotionValue(win.frame.x);
  const y = useMotionValue(win.frame.y);
  const width = useMotionValue(win.frame.width);
  const height = useMotionValue(win.frame.height);
  const restoreFrame = useRef(win.frame);
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
    if (win.focusRequest > 0 && section && !section.contains(document.activeElement)) section.focus({ preventScroll: true });
  }, [win.focusRequest]);

  const startDrag = (event: ReactPointerEvent) => {
    if (win.maximized || event.button !== 0) return;
    if ((event.target as Element).closest('button')) return;
    dragControls.start(event);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (win.maximized || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onFocus();
    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);
    document.body.classList.add('os-moving');
    const start = { px: event.clientX, py: event.clientY, width: width.get(), height: height.get() };
    const desktop = desktopRef.current;
    const maxWidth = desktop ? desktop.clientWidth - x.get() : Infinity;
    const maxHeight = desktop ? desktop.clientHeight - y.get() : Infinity;
    const onMove = (move: PointerEvent) => {
      width.set(Math.min(maxWidth, Math.max(MIN_WIDTH, start.width + move.clientX - start.px)));
      height.set(Math.min(maxHeight, Math.max(MIN_HEIGHT, start.height + move.clientY - start.py)));
    };
    const onUp = () => {
      document.body.classList.remove('os-moving');
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  };

  return (
    <motion.section
      ref={sectionRef}
      id={windowDomId(win.id)}
      className="os-window"
      data-active={active || undefined}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      inert={win.minimized}
      style={{ x, y, width, height, zIndex: win.z }}
      drag={!win.maximized}
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      dragConstraints={desktopRef}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={win.minimized ? { opacity: 0, scale: 0.86, transitionEnd: { visibility: 'hidden' } } : { opacity: 1, scale: 1, visibility: 'visible' }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileDrag={{ scale: 1.012 }}
      transition={spring}
      // Iframes (the story reel) would swallow the pointer mid-drag; they ignore it while a window moves.
      onDragStart={() => document.body.classList.add('os-moving')}
      onDragEnd={() => document.body.classList.remove('os-moving')}
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
      {pageHref && (
        <div className="os-toolbar">
          <a className="os-tool" href={pageHref} target="_top">
            Open as page ↗
          </a>
        </div>
      )}
      <div className="os-well">
        <WindowStatusContext value={setStatus}>{children}</WindowStatusContext>
      </div>
      <div className="os-statusbar">
        <p className="os-status-cell" aria-live="polite">
          {status ?? defaultStatus}
        </p>
        <div className="os-status-cell os-status-grip" onPointerDown={startResize} aria-hidden="true" />
      </div>
    </motion.section>
  );
}
