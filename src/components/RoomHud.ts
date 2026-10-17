import type { RoomHandle, ScreenRect } from '../scene/main';

// How often the corner label checks where the camera is (the monitor, the glass under the label): cheap, and quick
// enough that the way back shows as the camera turns toward the screen.
const WATCH_MS = 200;

/** The visitor's local time as hh:mm on a 24-hour clock. */
export function clockText(at: Date) {
  return [at.getHours(), at.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
}

const overlaps = (a: DOMRect, b: ScreenRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * The corner label: the clock (it changes once a minute, on the minute, and is never announced), hidden while the
 * camera is at the monitor or the glass lies under it, with the way back shown at the monitor instead.
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

  return () => {
    clearTimeout(tick);
    clearInterval(watcher);
  };
}
