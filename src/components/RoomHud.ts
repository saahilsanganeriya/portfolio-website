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
// Beside its object, the card tries these sides in turn and takes the first that covers no other object (kept this far
// clear of them); an object that fills this share of the stage is the backdrop, not a neighbour.
const CARD_SIDES = ['right', 'left', 'below', 'above'] as const;
const CARD_CLEAR = 8;
const BACKDROP_SHARE = 0.4;

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
    place(card, state, stage);
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
    place(card, state, stage);
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

interface Slot {
  left: number;
  top: number;
}

/**
 * Beside the object: to its right, left, below or above it, the first side that covers no other object; failing that,
 * to its right, else its left, else at the stage's right edge. On a narrow stage, above the bottom row.
 */
function place(card: HTMLElement, { rect, avoid }: RoomCard, stage: HTMLElement) {
  const box = stage.getBoundingClientRect();
  const [width, height] = [card.offsetWidth, card.offsetHeight];
  const bottom = box.height - height - (box.width < CARD_DOCK_BELOW ? CARD_BOTTOM_NARROW : CARD_BOTTOM);
  const highest = Math.min(CARD_TOP, bottom);
  let slot: Slot;
  if (box.width < CARD_DOCK_BELOW || !rect) {
    slot = box.width < CARD_DOCK_BELOW ? { left: CARD_EDGE, top: bottom } : { left: box.width - width - CARD_EDGE, top: (box.height - height) / 2 };
  } else {
    const object = { left: rect.left - box.left, right: rect.right - box.left, top: rect.top - box.top, bottom: rect.bottom - box.top };
    const others = avoid
      .map((r) => ({ left: r.left - box.left - CARD_CLEAR, right: r.right - box.left + CARD_CLEAR, top: r.top - box.top - CARD_CLEAR, bottom: r.bottom - box.top + CARD_CLEAR }))
      .filter((r) => (r.right - r.left) * (r.bottom - r.top) < BACKDROP_SHARE * box.width * box.height);
    const across = clamp((object.top + object.bottom) / 2 - height / 2, highest, bottom);
    const along = clamp((object.left + object.right) / 2 - width / 2, CARD_EDGE, box.width - width - CARD_EDGE);
    const sides: Record<(typeof CARD_SIDES)[number], Slot | null> = {
      right: object.right + CARD_GAP + width <= box.width - CARD_EDGE ? { left: object.right + CARD_GAP, top: across } : null,
      left: object.left - CARD_GAP - width >= CARD_EDGE ? { left: object.left - CARD_GAP - width, top: across } : null,
      below: object.bottom + CARD_GAP <= bottom ? { left: along, top: object.bottom + CARD_GAP } : null,
      above: object.top - CARD_GAP - height >= highest ? { left: along, top: object.top - CARD_GAP - height } : null,
    };
    const clear = (s: Slot) => others.every((r) => s.left >= r.right || s.left + width <= r.left || s.top >= r.bottom || s.top + height <= r.top);
    slot = CARD_SIDES.map((side) => sides[side]).find((s): s is Slot => s !== null && clear(s)) ?? sides.right ?? sides.left ?? { left: box.width - width - CARD_EDGE, top: across };
  }
  const top = clamp(slot.top, highest, bottom);
  card.style.transform = `translate(${Math.round(slot.left)}px, ${Math.round(top)}px)`;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));
