// The browser lets a page start sound only from inside a visitor's gesture. Safari counts the gesture only in the
// handler that receives it (a message posted on from the OS's frame arrives too late), so the room listens in that
// frame's own window as well as its page's.

// A press, a release (a tap grants the permission at its release), a touch, a key: every event that can carry it.
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'touchstart', 'touchend', 'keydown'] as const;
// Moving focus is not input to the room: these keys alone start nothing.
export const FOCUS_KEYS: ReadonlySet<string> = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape', 'CapsLock']);

/**
 * Calls `onGesture` from inside every press, tap or key in `view` (the page's window or a same-origin frame's), in the
 * capture phase so nothing in the page can stop it first. Keys that only move focus are left out. Returns the remover.
 */
export function listenForGestures(view: Window, onGesture: (event: Event) => void): () => void {
  const handler = (event: Event) => {
    // The event may come from another window's realm, so no instanceof here.
    const key = (event as KeyboardEvent).key;
    if (event.type === 'keydown' && typeof key === 'string' && FOCUS_KEYS.has(key)) return;
    onGesture(event);
  };
  for (const type of GESTURE_EVENTS) view.addEventListener(type, handler, { capture: true });
  return () => {
    for (const type of GESTURE_EVENTS) view.removeEventListener(type, handler, { capture: true });
  };
}

/**
 * The same for a same-origin frame's document, again after each load (a phone's drawn monitor may load a new page).
 * A frame the room cannot reach into (another origin) is skipped.
 */
export function listenInFrame(frame: HTMLIFrameElement, onGesture: (event: Event) => void): () => void {
  let remove = () => {};
  const attach = () => {
    remove();
    try {
      const view = frame.contentWindow;
      remove = view && view.location.href !== 'about:blank' ? listenForGestures(view, onGesture) : () => {};
    } catch {
      remove = () => {};
    }
  };
  attach();
  frame.addEventListener('load', attach);
  return () => {
    frame.removeEventListener('load', attach);
    remove();
  };
}

/**
 * A sound context made inside a gesture that comes before the room's sound exists (room.glb still loading), so the
 * permission that gesture carries is kept: the context runs, and the room's sound takes it over once made. Null where
 * the browser has no Web Audio.
 */
export function gestureContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  // Safari may still hold a context made in a gesture as `interrupted`; resuming it in the same handler counts.
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  return ctx;
}
