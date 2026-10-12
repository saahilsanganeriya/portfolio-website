import { useEffect, useRef, useState } from 'react';
import { PixelIcon } from '../assets/PixelIcon';
import { APPS, describeWindow } from '../apps/registry';
import { APP_IDS, type AppId, type OsIndex } from '../types';
import type { WindowState } from './windows';

const clockFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** The visitor's local time, set after hydration so the server's build time never shows. */
export function useClock(): string {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(clockFormat.format(new Date()));
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return time;
}

interface TaskbarProps {
  windows: WindowState[];
  activeId: string | undefined;
  index: OsIndex;
  clock: string;
  onTab: (id: string) => void;
  onOpen: (id: AppId) => void;
  onShutDown: () => void;
}

export function Taskbar({ windows, activeId, index, clock, onTab, onOpen, onShutDown }: TaskbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const startRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector('button')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !startRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      startRef.current?.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const choose = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <footer className="os-taskbar">
      <button
        ref={startRef}
        type="button"
        className="os-start"
        aria-expanded={menuOpen}
        aria-controls="os-start-menu"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <PixelIcon name="spool" size={16} />
        <span>Start</span>
      </button>
      {menuOpen && (
        <div ref={menuRef} id="os-start-menu" className="os-start-menu">
          <p className="os-start-banner" aria-hidden="true">
            <span>SaahilOS</span>
          </p>
          <nav aria-label="Start menu">
            <ul>
              {APP_IDS.map((id) => (
                <li key={id}>
                  <button type="button" className="os-menu-item" onClick={() => choose(() => onOpen(id))}>
                    <PixelIcon name={APPS[id].icon} size={16} />
                    <span>{APPS[id].label}</span>
                  </button>
                </li>
              ))}
              <li className="os-menu-rule" aria-hidden="true" />
              <li>
                <button type="button" className="os-menu-item" onClick={() => choose(onShutDown)}>
                  <PixelIcon name="power" size={16} />
                  <span>Shut down…</span>
                </button>
              </li>
            </ul>
          </nav>
        </div>
      )}
      <ul className="os-tabs" aria-label="Open windows">
        {windows.map((win) => {
          const { title, icon } = describeWindow(win.route, index);
          const active = win.id === activeId;
          return (
            <li key={win.id}>
              <button type="button" className="os-tab" aria-pressed={active} onClick={() => onTab(win.id)}>
                <PixelIcon name={icon} size={16} />
                <span>{title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="os-tray">
        <time>{clock}</time>
      </p>
    </footer>
  );
}
