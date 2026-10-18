import type { RoomCard, RoomHandle, ScreenRect } from '../scene/main';

// How often the corner label checks where the camera is (the monitor, the glass under the label, an object's card to
// show): cheap, and quick enough that the way back shows as the camera turns toward the screen.
const WATCH_MS = 200;
// The card keeps this far from the object it names and from the stage's edges, clear of the corner label above and the
// tour and Sound row below (CSS pixels).
const CARD_GAP = 20;
const CARD_EDGE = 16;
const CARD_TOP = 96;
const CARD_BOTTOM = 72;
// On a narrow stage the tour and Home sit in a row above the Sound controls.
const CARD_BOTTOM_NARROW = 120;
// Narrower than this, the card sits above the bottom row instead of beside the object.
const CARD_DOCK_BELOW = 640;

/** The visitor's local time as hh:mm on a 24-hour clock. */
export function clockText(at: Date) {
  return [at.getHours(), at.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
}

const overlaps = (a: DOMRect, b: ScreenRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * The corner label: the clock (it changes once a minute, on the minute, and is never announced), hidden while the
 * camera is at the monitor or the glass lies under it, with the way back shown at the monitor instead. Home, beside
 * the tour's button, appears with it.
 */
export function mountHud(hud: HTMLElement, back: HTMLButtonElement, room: RoomHandle, stage: HTMLElement) {
  const time = hud.querySelector<HTMLTimeElement>('[data-room-hud-time]')!;
  let tick = 0;
  const showTime = () => {
    const now = new Date();
    time.textContent = time.dateTime = clockText(now);
    tick = window.setTimeout(showTime, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  };
  showTime();

  const watch = () => {
    const atMonitor = room.view().destination === 'monitor';
    const glass = atMonitor ? null : room.monitorRect();
    hud.toggleAttribute('data-hidden', atMonitor || (glass !== null && overlaps(hud.getBoundingClientRect(), glass)));
    back.hidden = !atMonitor;
  };
  watch();
  const watcher = window.setInterval(watch, WATCH_MS);

  back.addEventListener('click', () => {
    room.back();
    back.hidden = true;
    stage.focus({ preventScroll: true });
  });

  const card = stage.querySelector<HTMLElement>('[data-room-card]');
  const stopCard = card ? mountCard(card, stage.querySelector<HTMLElement>('[data-room-card-status]')!, room, stage) : () => {};

  // Focus stays on Home: a keyboard visitor can press it again, or Tab on to the tour.
  const home = stage.querySelector<HTMLButtonElement>('[data-room-home]');
  if (home) {
    home.hidden = false;
    home.addEventListener('click', () => room.home());
  }

  return () => {
    clearTimeout(tick);
    clearInterval(watcher);
    stopCard();
  };
}

/**
 * The card beside an object a click has flown the camera to: shown once the camera rests there, kept beside the object
 * every frame (the view leans with the pointer), announced once, and gone when the camera leaves. Learn more opens the
 * object's window on the monitor and gives the keyboard to it; focus left on a card that goes returns to the room.
 */
export function mountCard(card: HTMLElement, status: HTMLElement, room: RoomHandle, stage: HTMLElement) {
  const title = card.querySelector<HTMLElement>('[data-room-card-title]')!;
  const line = card.querySelector<HTMLElement>('[data-room-card-line]')!;
  const more = card.querySelector<HTMLButtonElement>('[data-room-card-more]')!;
  let shown: string | null = null;
  let frame = 0;

  const hide = () => {
    if (shown === null) return;
    shown = null;
    cancelAnimationFrame(frame);
    const hadFocus = card.contains(document.activeElement);
    card.hidden = true;
    card.removeAttribute('data-shown');
    status.textContent = '';
    if (hadFocus) stage.focus({ preventScroll: true });
  };
  const follow = () => {
    const state = room.card();
    if (!state) return hide();
    if (state.id !== shown) show(state);
    place(card, state.rect, stage);
    frame = requestAnimationFrame(follow);
  };
  const show = (state: RoomCard) => {
    shown = state.id;
    title.textContent = state.title;
    line.textContent = state.line;
    more.hidden = !state.more;
    card.hidden = false;
    status.textContent = `${state.title}. ${state.line}`;
    // Placed before it fades in, so it never flashes at the corner.
    place(card, state.rect, stage);
    requestAnimationFrame(() => card.setAttribute('data-shown', ''));
    // The next Tab reaches Learn more: after a click on the room the browser would carry on from the room (into the
    // monitor). Focus another control holds (Home, the map) stays where it is.
    const active = document.activeElement;
    if (!active || active === document.body || active === stage) card.focus({ preventScroll: true });
  };

  more.addEventListener('click', () => {
    if (!room.learnMore()) return;
    hide();
    stage.querySelector<HTMLIFrameElement>('.room-monitor iframe')?.focus({ preventScroll: true });
  });
  const watcher = window.setInterval(() => {
    if (shown === null && room.card()) follow();
  }, WATCH_MS);
  return () => {
    clearInterval(watcher);
    cancelAnimationFrame(frame);
  };
}

/** Beside the object: to its right, else its left, else at the stage's right edge; on a narrow stage, above the bottom row. */
function place(card: HTMLElement, rect: ScreenRect | null, stage: HTMLElement) {
  const box = stage.getBoundingClientRect();
  const [width, height] = [card.offsetWidth, card.offsetHeight];
  const bottom = box.height - height - (box.width < CARD_DOCK_BELOW ? CARD_BOTTOM_NARROW : CARD_BOTTOM);
  let left: number;
  let top: number;
  if (box.width < CARD_DOCK_BELOW || !rect) {
    left = box.width < CARD_DOCK_BELOW ? CARD_EDGE : box.width - width - CARD_EDGE;
    top = box.width < CARD_DOCK_BELOW ? bottom : (box.height - height) / 2;
  } else {
    const [objLeft, objRight] = [rect.left - box.left, rect.right - box.left];
    left = objRight + CARD_GAP;
    if (left + width > box.width - CARD_EDGE) left = objLeft - CARD_GAP - width;
    if (left < CARD_EDGE) left = box.width - width - CARD_EDGE;
    top = (rect.top + rect.bottom) / 2 - box.top - height / 2;
  }
  top = Math.max(Math.min(top, bottom), Math.min(CARD_TOP, bottom));
  card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
