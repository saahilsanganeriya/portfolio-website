import { DESKTOP_APPS, type AppId, type Route } from '../types';

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  id: string;
  route: Route;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Where the window opened; drags and resizes live in the window's own motion values after that. */
  frame: Frame;
  /** Bumped each time a person opens the window, so keyboard focus moves into it; 0 for windows the OS opened. */
  focusRequest: number;
  /** Where on the desktop it was opened from (the icon or link), so it can grow out of that point. */
  origin: Point | null;
}

export interface Point {
  x: number;
  y: number;
}

export interface WindowsState {
  windows: WindowState[];
  nextZ: number;
  cascade: number;
}

export type WindowsAction =
  | {
      type: 'open';
      id: string;
      route: Route;
      desktop: { width: number; height: number };
      focus: boolean;
      origin?: Point | null;
      /** The window a visit lands on (a window address); the boot's own window is first anyway. */
      first?: boolean;
    }
  | { type: 'focus'; id: string }
  | { type: 'close'; id: string }
  | { type: 'minimize'; id: string }
  | { type: 'toggleMaximize'; id: string }
  | { type: 'taskbar'; id: string }
  | { type: 'reset' };

export const initialWindows: WindowsState = { windows: [], nextZ: 1, cascade: 0 };

const update = (state: WindowsState, id: string, change: (w: WindowState) => Partial<WindowState>): WindowState[] =>
  state.windows.map((w) => (w.id === id ? { ...w, ...change(w) } : w));

export function topWindow(state: WindowsState): WindowState | undefined {
  return state.windows
    .filter((w) => !w.minimized)
    .reduce<WindowState | undefined>((top, w) => (!top || w.z > top.z ? w : top), undefined);
}

export function windowsReducer(state: WindowsState, action: WindowsAction): WindowsState {
  switch (action.type) {
    case 'open': {
      const existing = state.windows.find((w) => w.id === action.id);
      if (existing) {
        return {
          ...state,
          nextZ: state.nextZ + 1,
          windows: update(state, action.id, (w) => ({
            route: action.route,
            minimized: false,
            z: state.nextZ,
            focusRequest: action.focus ? w.focusRequest + 1 : w.focusRequest,
          })),
        };
      }
      const opened: WindowState = {
        id: action.id,
        route: action.route,
        z: state.nextZ,
        minimized: false,
        maximized: false,
        frame: frameFor(action.route, state.cascade, action.desktop, action.first || state.cascade === 0),
        focusRequest: action.focus ? 1 : 0,
        origin: action.origin ?? null,
      };
      return { windows: [...state.windows, opened], nextZ: state.nextZ + 1, cascade: state.cascade + 1 };
    }
    case 'focus': {
      const top = topWindow(state);
      if (top?.id === action.id) return state;
      return { ...state, nextZ: state.nextZ + 1, windows: update(state, action.id, () => ({ z: state.nextZ })) };
    }
    case 'close':
      return { ...state, windows: state.windows.filter((w) => w.id !== action.id) };
    case 'minimize':
      return { ...state, windows: update(state, action.id, () => ({ minimized: true })) };
    case 'toggleMaximize':
      return { ...state, windows: update(state, action.id, (w) => ({ maximized: !w.maximized })) };
    case 'taskbar': {
      // Win98: a click on the front window's tab minimises it; any other tab restores and raises its window.
      const isTop = topWindow(state)?.id === action.id;
      return {
        ...state,
        nextZ: state.nextZ + 1,
        windows: update(state, action.id, (w) => ({ minimized: isTop ? !w.minimized : false, z: state.nextZ })),
      };
    }
    case 'reset':
      return initialWindows;
  }
}

export interface AppWindowSize {
  width: number;
  height: number;
}

// Three sizes so windows feel of a set: lists, readers and wide windows; About (the first view) and the folder are their own.
const LIST: AppWindowSize = { width: 640, height: 520 };
const READER: AppWindowSize = { width: 720, height: 600 };
const WIDE: AppWindowSize = { width: 880, height: 640 };

const SIZES: Record<AppId | 'reader', AppWindowSize> = {
  about: { width: 780, height: 700 },
  projects: LIST,
  blog: LIST,
  oven: LIST,
  books: LIST,
  credits: LIST,
  reader: READER,
  resume: READER,
  recipes: READER,
  voyager: READER,
  code: WIDE,
  browser: WIDE,
  films: WIDE,
  photography: WIDE,
  terminal: { width: 760, height: 460 },
  personal: { width: 520, height: 300 },
};

// Must match the icon grid in os.css: rows of 88 px from 12 px down, columns 88 px wide with 4 px between.
const ICON_ROW = 88;
const ICON_COLUMN = 92;
const ICONS_TOP = 12;
const CASCADE_STEP = 28;
// A visit's first window (About, or the window its address names) stands nearly the desktop's height, so its opening
// lines are above the fold; later windows cascade at their own sizes.
const FIRST_WIDTH = 880;
const FIRST_MARGIN = 12;

// Short desktops wrap the icons into more columns; new windows open to the right of all of them.
function iconGutter(desktopHeight: number): number {
  const rows = Math.max(1, Math.floor((desktopHeight - 2 * ICONS_TOP) / ICON_ROW));
  return 8 + Math.ceil(DESKTOP_APPS.length / rows) * ICON_COLUMN + 8;
}

/** Where a new window opens: cascading down-right from the icon column, always inside the desktop. */
export function frameFor(route: Route, cascade: number, desktop: { width: number; height: number }, first = false): Frame {
  const size = route.slug && (route.app === 'projects' || route.app === 'blog') ? SIZES.reader : SIZES[route.app];
  const clamp = (value: number, max: number) => Math.max(8, Math.min(value, max));
  // The folder is a handful of icons: it keeps its size even when it opens first.
  if (first && route.app !== 'personal') {
    const width = Math.min(Math.max(size.width, FIRST_WIDTH), desktop.width - 16);
    return { x: clamp(iconGutter(desktop.height), desktop.width - width - 8), y: FIRST_MARGIN, width, height: desktop.height - 2 * FIRST_MARGIN };
  }
  const width = Math.min(size.width, desktop.width - 16);
  const height = Math.min(size.height, desktop.height - 16);
  const step = (cascade % 8) * CASCADE_STEP;
  return {
    x: clamp(iconGutter(desktop.height) + step, desktop.width - width - 8),
    y: clamp(16 + step, desktop.height - height - 8),
    width,
    height,
  };
}
