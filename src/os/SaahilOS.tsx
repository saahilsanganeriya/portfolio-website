import { AnimatePresence, LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
import { AppBody, describeWindow } from './apps/registry';
import { PhoneWindows } from './mobile/PhoneShell';
import './os.css';
import { classifyLink, formatRoute, parseTarget, windowIdFor } from './routes';
import type { AppId, OsApi, OsIndex } from './types';
import { DesktopIcons } from './wm/Desktop';
import { Shutdown } from './wm/Shutdown';
import { Taskbar, useClock } from './wm/Taskbar';
import { Window, windowDomId } from './wm/Window';
import { initialWindows, topWindow, windowsReducer } from './wm/windows';

// Phones, small windows and touch-first devices get full-screen apps; the monitor in the room always gets the desktop.
const PHONE_QUERY = '(max-width: 767.98px), (pointer: coarse)';
const DEFAULT_APP = 'projects';

function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const usePhoneQuery = () =>
  useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );

interface SaahilOSProps {
  index: OsIndex;
  /** Inside the room's monitor. Read from `?embed=1` when not given, since /os is a static page. */
  embedded?: boolean;
}

export default function SaahilOS({ index, embedded: embeddedProp }: SaahilOSProps) {
  const [embedded, setEmbedded] = useState(embeddedProp ?? false);
  const phone = usePhoneQuery() && !embedded;
  const [state, dispatch] = useReducer(windowsReducer, initialWindows);
  const [power, setPower] = useState<'on' | 'shutting' | 'off'>('on');
  const [selectedIcon, setSelectedIcon] = useState<AppId | null>(null);
  const desktopRef = useRef<HTMLElement>(null);
  const clock = useClock();

  const top = topWindow(state);
  const topRoute = top ? formatRoute(top.route) : '';
  const topRouteRef = useRef(topRoute);
  topRouteRef.current = topRoute;
  const powerRef = useRef(power);
  powerRef.current = power;

  const open = useCallback((target: string, focus = true) => {
    const route = parseTarget(target);
    if (!route) return;
    const desktop = desktopRef.current;
    dispatch({
      type: 'open',
      id: windowIdFor(route),
      route,
      focus,
      desktop: {
        width: desktop?.clientWidth ?? window.innerWidth,
        height: desktop?.clientHeight ?? window.innerHeight,
      },
    });
  }, []);

  const os: OsApi = useMemo(
    () => ({ index, embedded, phone, open: (target) => open(target) }),
    [index, embedded, phone, open],
  );

  // Boot: a hash opens its window; otherwise the desktop opens Projects, the way Henry's opened his showcase.
  useEffect(() => {
    const isEmbedded = embeddedProp ?? new URLSearchParams(window.location.search).get('embed') === '1';
    setEmbedded(isEmbedded);
    const route = parseTarget(window.location.hash);
    if (route) open(formatRoute(route), false);
    else if (isEmbedded || !window.matchMedia(PHONE_QUERY).matches) open(DEFAULT_APP, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The hash names the front window. replaceState keeps window changes out of the back button's history,
  // which inside the monitor iframe would otherwise be the room's history too.
  const booted = useRef(false);
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      return;
    }
    if (window.location.hash.slice(1) === topRoute) return;
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', topRoute ? `#${topRoute}` : pathname + search);
  }, [topRoute]);

  useEffect(() => {
    const onHashChange = () => {
      const route = parseTarget(window.location.hash);
      if (route && formatRoute(route) !== topRouteRef.current) open(formatRoute(route));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [open]);

  // The room posts {type:'open', target} into the monitor; only the same-origin parent is listened to.
  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; target?: unknown } | null;
      if (data?.type !== 'open' || typeof data.target !== 'string') return;
      if (powerRef.current !== 'on') setPower('on');
      open(data.target);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'os-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [open]);

  // Links to anything with a window open that window; the rest keep their own target (see routes.classifyLink).
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as Element).closest('a[href]');
    if (!anchor || anchor.getAttribute('target') === '_blank') return;
    const link = classifyLink(anchor.getAttribute('href')!, window.location.origin);
    if (link.kind !== 'window') return;
    event.preventDefault();
    open(formatRoute(link.route));
  };

  const close = (id: string) => {
    const next = topWindow({ ...state, windows: state.windows.filter((w) => w.id !== id) });
    dispatch({ type: 'close', id });
    if (next)
      requestAnimationFrame(() => document.getElementById(windowDomId(next.id))?.focus({ preventScroll: true }));
  };

  const shutDown = () => {
    dispatch({ type: 'reset' });
    setPower('shutting');
  };

  const restart = () => {
    setPower('on');
    if (!phone) open(DEFAULT_APP, false);
  };

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div className="os" data-embedded={embedded || undefined} onClick={onClick}>
          {power === 'on' ? (
            <>
              <header className="os-phonebar">
                <p>SaahilOS</p>
                <p>
                  <time>{clock}</time>
                </p>
              </header>
              <main
                id="content"
                ref={desktopRef}
                className="os-desktop"
                tabIndex={-1}
                onPointerDown={(event) => event.target === event.currentTarget && setSelectedIcon(null)}
              >
                <h1 className="visually-hidden">SaahilOS</h1>
                <DesktopIcons
                  phone={phone}
                  selected={selectedIcon}
                  onSelect={setSelectedIcon}
                  onOpen={(id) => open(id)}
                />
                <p className="os-desktop-hint">
                  {phone ? 'Tap an app to open it.' : 'Double-click an icon to open it.'}
                </p>
                {phone ? (
                  <PhoneWindows windows={state.windows} os={os} onBack={close} />
                ) : (
                  <AnimatePresence>
                    {state.windows.map((win) => {
                      const description = describeWindow(win.route, index);
                      return (
                        <Window
                          key={win.id}
                          win={win}
                          {...description}
                          active={win.id === top?.id}
                          desktopRef={desktopRef}
                          onFocus={() => dispatch({ type: 'focus', id: win.id })}
                          onClose={() => close(win.id)}
                          onMinimize={() => dispatch({ type: 'minimize', id: win.id })}
                          onToggleMaximize={() => dispatch({ type: 'toggleMaximize', id: win.id })}
                        >
                          <AppBody route={win.route} os={os} />
                        </Window>
                      );
                    })}
                  </AnimatePresence>
                )}
              </main>
              <Taskbar
                windows={state.windows}
                activeId={top?.id}
                index={index}
                clock={clock}
                onTab={(id) => dispatch({ type: 'taskbar', id })}
                onOpen={(id) => open(id)}
                onShutDown={shutDown}
              />
            </>
          ) : (
            <Shutdown phase={power} onDone={() => setPower('off')} onRestart={restart} />
          )}
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
