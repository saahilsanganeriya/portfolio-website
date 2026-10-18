import { useEffect, useState } from 'react';
import type { OsWallpaper } from '../types';

// The picture covers the desktop; while the viewport is narrower than the picture it is height-bound and drawn wider
// than the viewport. On a phone the crop keeps to the right, where the pillar tips are.
const SIZES = '(max-aspect-ratio: 2560/1981) 129.3vh, 100vw';

/**
 * The room's <html> while it shows the 3D room; it gains `room-ready` once everything the arrival shows has loaded,
 * behind the dark screen, and `room-landed` when the arrival ends and a visitor can act.
 */
function roomRoot(): HTMLElement | null {
  try {
    const root = window.parent !== window ? window.parent.document.documentElement : null;
    return root?.classList.contains('room') ? root : null;
  } catch {
    return null;
  }
}

/**
 * Calls `onReady` when the full-size pictures may load without costing the room its first frame: inside the room once
 * it is ready (still behind the dark screen, so the monitor is sharp when the camera reaches it), elsewhere once the
 * page has loaded and gone idle, and at once on any press or key inside the OS.
 */
function whenFullSizeMayLoad(onReady: () => void): () => void {
  const cleanups: (() => void)[] = [];
  const ready = () => {
    cleanups.forEach((cleanup) => cleanup());
    onReady();
  };
  for (const type of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(type, ready, { once: true });
    cleanups.push(() => window.removeEventListener(type, ready));
  }
  const room = roomRoot();
  if (room) {
    const roomReady = () => room.classList.contains('room-ready') || room.classList.contains('room-landed');
    if (roomReady()) ready();
    else {
      const observer = new MutationObserver(() => roomReady() && ready());
      observer.observe(room, { attributes: true, attributeFilter: ['class'] });
      cleanups.push(() => observer.disconnect());
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }
  const afterLoad = () => {
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200));
    idle(ready, { timeout: 2000 });
  };
  if (document.readyState === 'complete') afterLoad();
  else {
    window.addEventListener('load', afterLoad, { once: true });
    cleanups.push(() => window.removeEventListener('load', afterLoad));
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

/**
 * Webb's Pillars of Creation behind the desktop: a small preview with the room's first load, then the size the
 * screen needs (up to 2560 px for the monitor seen close at twice the pixel density). The browser keeps the preview
 * on screen until the larger picture has arrived.
 */
export function Wallpaper({ wallpaper }: { wallpaper: OsWallpaper }) {
  const [full, setFull] = useState(false);
  useEffect(() => whenFullSizeMayLoad(() => setFull(true)), []);
  return (
    <picture className="os-wallpaper" data-full={full || undefined}>
      <source type="image/avif" srcSet={full ? wallpaper.avif : wallpaper.preview.avif} sizes={SIZES} />
      <img
        src={wallpaper.preview.src}
        srcSet={full ? wallpaper.webp : wallpaper.preview.webp}
        sizes={SIZES}
        width={wallpaper.width}
        height={wallpaper.height}
        alt=""
        decoding="async"
      />
    </picture>
  );
}
