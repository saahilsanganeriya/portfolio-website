// The story reel: native scroll drives a strip of Super 8 frames, one scroll step per frame, and a spring plays the
// claw's pull-down between them. The projector pass, the thread, the keys, autoplay and the controls all hang off one
// requestAnimationFrame loop that sleeps whenever nothing moves. Without the `data-reel="live"` flag (no JavaScript,
// or reduced motion) the page stays a static sequence of frames and only the embed link targets are fixed here.
import { FilmPass, type FilmState } from './film-shader';
import { Thread, type Point } from './thread';

type Kind = 'title' | 'card' | 'scene' | 'end';

interface Frame {
  el: HTMLElement;
  kind: Kind;
  photo: HTMLImageElement | null;
  focus: [number, number];
  head: [number, number];
  tail: [number, number];
  slack: number;
  tie: [number, number] | null;
  /** Seconds autoplay holds this frame; 0 ends the reel. */
  dwell: number;
}

interface Geometry {
  gateWidth: number;
  gateHeight: number;
  pitch: number;
  frameWidth: number;
  frameHeight: number;
  filmLeft: number;
  imageLeft: number;
  imageRight: number;
  filmRight: number;
  /** Strip translation that centres frame 0 in the gate. */
  centre: number;
  step: number;
  reelTop: number;
}

// Super 8 runs at 18 frames a second, so grain, gate weave and flicker change at that rate.
const TICK = 1 / 18;
// The projector keeps running this long after the film last moved; autoplay keeps it running throughout.
const SETTLE_MS = 2500;
// The pull-down spring, a little underdamped so each frame settles in the gate.
const STRIP_STIFFNESS = 260;
const STRIP_DAMPING = 2 * 0.8 * Math.sqrt(STRIP_STIFFNESS);
const SPRING_STEP = 1 / 120;
// A photo drifts this many percent of its height per scroll step; it is scaled up so the drift never shows an edge.
const PARALLAX = 7;
const PHOTO_SCALE = 1.12;

const pair = (value: string | undefined, fallback: [number, number] = [0, 0]): [number, number] => {
  const [a, b] = (value ?? '').split(',').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Inside the SaahilOS window, links leave the iframe: the site's own pages replace the room, others open a new tab.
function retargetLinksForEmbed(): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.getAttribute('href')!.startsWith('#')) continue;
    if (link.origin === location.origin) {
      link.target = '_top';
    } else {
      link.target = '_blank';
      link.rel = 'noopener';
    }
  }
}

export function startReel(): void {
  const root = document.documentElement;
  if (root.dataset.embed !== undefined) retargetLinksForEmbed();
  const found = document.querySelector<HTMLElement>('[data-reel]');
  if (!found || root.dataset.reel !== 'live') return;
  const reel: HTMLElement = found;

  const gate = reel.querySelector<HTMLElement>('[data-gate]')!;
  const strip = reel.querySelector<HTMLElement>('[data-strip]')!;
  const steps = reel.querySelectorAll<HTMLElement>('[data-step]');
  const threadCanvas = reel.querySelector<HTMLCanvasElement>('[data-thread]')!;
  const filmCanvas = reel.querySelector<HTMLCanvasElement>('[data-film]')!;
  const controls = reel.querySelector<HTMLElement>('[data-controls]')!;
  const playButton = controls.querySelector<HTMLButtonElement>('[data-play]')!;
  const backButton = controls.querySelector<HTMLButtonElement>('[data-back]')!;
  const nextButton = controls.querySelector<HTMLButtonElement>('[data-next]')!;
  const counter = controls.querySelector<HTMLElement>('[data-count]')!;

  const frames: Frame[] = [...strip.querySelectorAll<HTMLElement>('[data-frame]')].map((el) => ({
    el,
    kind: el.dataset.kind as Kind,
    photo: el.querySelector<HTMLImageElement>('img[data-photo]'),
    focus: pair(el.dataset.focus, [50, 50]),
    head: pair(el.dataset.head),
    tail: pair(el.dataset.tail),
    slack: Number(el.dataset.slack) || 1.1,
    tie: el.dataset.tie ? pair(el.dataset.tie) : null,
    dwell: Number(el.dataset.dwell) || 0,
  }));
  const last = frames.length - 1;

  const listeners = new AbortController();
  const on = { signal: listeners.signal };
  const thread = new Thread(threadCanvas);
  let film: FilmPass | null = null;
  let geo = measure();

  let scrollSteps = (scrollY - geo.reelTop) / geo.step;
  let pos = clamp(Math.round(scrollSteps), 0, last);
  let velocity = 0;
  let active = -1;
  let raf = 0;
  let lastTime = 0;
  let lastMotion = -Infinity;
  let tickClock = 0;
  let seed = 0;
  let weave: [number, number] = [0, 0];
  let flicker = 0;
  let leak: [number, number] = [0, 0.5];
  const dust = new Float32Array(9);
  let autoplay = location.hash === '#autoplay';
  let dwellClock = 0;
  let filmDirty = true;
  let pointer: Point | null = null;
  let projectorReady = false;

  function measure(): Geometry {
    const first = frames[0].el;
    const pitch = frames[1].el.offsetTop - first.offsetTop;
    const imageLeft = strip.offsetLeft + first.offsetLeft;
    return {
      gateWidth: gate.clientWidth,
      gateHeight: gate.clientHeight,
      pitch,
      frameWidth: first.offsetWidth,
      frameHeight: first.offsetHeight,
      filmLeft: strip.offsetLeft,
      imageLeft,
      imageRight: imageLeft + first.offsetWidth,
      filmRight: strip.offsetLeft + strip.offsetWidth,
      centre: (gate.clientHeight - first.offsetHeight) / 2,
      step: steps[0].offsetHeight,
      reelTop: reel.getBoundingClientRect().top + scrollY,
    };
  }

  function resize(): void {
    geo = measure();
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    thread.resize(geo.gateWidth, geo.gateHeight, scale);
    film?.resize(geo.gateWidth, geo.gateHeight, scale);
    scrollSteps = (scrollY - geo.reelTop) / geo.step;
    if (projectorReady) {
      holdThread();
      thread.place();
      thread.draw();
    }
    filmDirty = true;
    wake();
  }

  const targetIndex = () => clamp(Math.round(scrollSteps), 0, last);
  const frameTop = (i: number) => geo.centre - pos * geo.pitch + i * geo.pitch + weave[1];

  function goTo(index: number): void {
    dwellClock = 0;
    window.scrollTo({ top: geo.reelTop + clamp(index, 0, last) * geo.step, behavior: 'instant' });
  }

  function indexForId(id: string): number {
    return frames.findIndex((frame) => frame.el.id === id || frame.el.parentElement?.id === id);
  }

  // ---- the thread's hold points, in gate pixels ----

  function framePoint(i: number, [x, y]: [number, number]): Point {
    const edge = (geo.imageLeft - geo.filmLeft) * 0.35;
    const left = geo.imageLeft + weave[0];
    const px = x <= 0 ? left - edge : x >= 1 ? left + geo.frameWidth + edge : left + x * geo.frameWidth;
    return { x: px, y: frameTop(i) + y * geo.frameHeight };
  }

  // A point in a frame's photo, through object-fit: cover, the object-position focus and the parallax transform.
  function photoPoint(i: number, [u, v]: [number, number]): Point {
    const { photo, focus } = frames[i];
    const w = geo.frameWidth;
    const h = geo.frameHeight;
    const naturalWidth = photo?.naturalWidth || Number(photo?.getAttribute('width')) || w;
    const naturalHeight = photo?.naturalHeight || Number(photo?.getAttribute('height')) || h;
    const cover = Math.max(w / naturalWidth, h / naturalHeight);
    const shownWidth = naturalWidth * cover;
    const shownHeight = naturalHeight * cover;
    const x = (w - shownWidth) * (focus[0] / 100) + u * shownWidth;
    const y = (h - shownHeight) * (focus[1] / 100) + v * shownHeight;
    const drift = (photoDrift(i) / 100) * h;
    return {
      x: geo.imageLeft + weave[0] + w / 2 + (x - w / 2) * PHOTO_SCALE,
      y: frameTop(i) + h / 2 + (y - h / 2) * PHOTO_SCALE + drift,
    };
  }

  function holdThread(): void {
    const i = clamp(Math.round(pos), 0, last);
    const frame = frames[i];
    const tail = frame.tie ? photoPoint(i, frame.tie) : framePoint(i, frame.tail);
    thread.hold(framePoint(i, frame.head), tail, frame.slack, frame.tie !== null);
  }

  // ---- what is on screen ----

  const photoDrift = (i: number) => clamp((scrollSteps - i) * PARALLAX, -5, 5);

  function setActive(index: number, now: number): void {
    if (index === active) return;
    if (active >= 0) delete frames[active].el.dataset.active;
    active = index;
    const frame = frames[index];
    frame.el.dataset.active = '';
    counter.textContent = String(index + 1);
    backButton.setAttribute('aria-disabled', String(index === 0));
    nextButton.setAttribute('aria-disabled', String(index === last));
    dwellClock = 0;
    // Photos load a couple of frames ahead of the gate; the strip clips them, so lazy loading alone would wait too long.
    for (let k = index - 1; k <= index + 2; k++) {
      const photo = frames[k]?.photo;
      if (photo) photo.loading = 'eager';
    }
    // A new scene starts on a fresh length of film, where light has leaked in at the edge.
    if ((frame.kind === 'card' || frame.kind === 'end') && now > 0) {
      leak = [0.9, 0.25 + Math.random() * 0.5];
      lastMotion = now;
    }
  }

  function place(): void {
    strip.style.transform = `translate3d(${weave[0]}px, ${geo.centre - pos * geo.pitch + weave[1]}px, 0)`;
    const near = Math.round(pos);
    for (let i = Math.max(0, near - 1); i <= Math.min(last, near + 1); i++) {
      const photo = frames[i].photo;
      if (photo) photo.style.transform = `translate3d(0, ${photoDrift(i)}%, 0) scale(${PHOTO_SCALE})`;
    }
  }

  // Most film frames carry no dust; now and then a speck or two lands somewhere on the picture.
  function scatterDust(): void {
    dust.fill(0);
    for (let k = 0; k < 3; k++) {
      if (Math.random() > 0.18) continue;
      dust[k * 3] = geo.imageLeft + Math.random() * geo.frameWidth;
      dust[k * 3 + 1] = geo.centre + Math.random() * geo.frameHeight;
      dust[k * 3 + 2] = 1.2 + Math.random() * 2.2;
    }
  }

  function renderFilm(): void {
    if (!film) return;
    const state: FilmState = {
      strip: [geo.filmLeft, geo.imageLeft, geo.imageRight, geo.filmRight],
      offset: geo.centre - pos * geo.pitch,
      pitch: geo.pitch,
      frameHeight: geo.frameHeight,
      frames: frames.length,
      weave,
      seed,
      flicker,
      leak,
      dust,
    };
    film.render(state);
    filmDirty = false;
  }

  function setAutoplay(on: boolean): void {
    autoplay = on;
    playButton.textContent = on ? 'Pause' : 'Play';
    dwellClock = 0;
    if (on) {
      lastMotion = performance.now();
      if (targetIndex() === last) goTo(0);
    }
    wake();
  }

  // ---- the loop ----

  function loop(now: number): void {
    raf = 0;
    // The first frame after waking may carry a timestamp from before the wake, so it counts as one 60 Hz frame.
    const dt = lastTime < 0 ? 1 / 60 : clamp((now - lastTime) / 1000, 0, 0.1);
    lastTime = now;

    const target = targetIndex();
    const before = pos;
    // Semi-implicit Euler in small steps, so a slow frame (a long dt) cannot blow the spring up.
    for (let left = dt; left > 0; left -= SPRING_STEP) {
      const h = Math.min(left, SPRING_STEP);
      velocity += (STRIP_STIFFNESS * (target - pos) - STRIP_DAMPING * velocity) * h;
      pos += velocity * h;
    }
    if (Math.abs(target - pos) < 5e-4 && Math.abs(velocity) < 5e-3) {
      pos = target;
      velocity = 0;
    }
    const moving = pos !== before || pos !== target;
    if (moving) {
      lastMotion = now;
      filmDirty = true;
    }

    const projecting = autoplay || now - lastMotion < SETTLE_MS;
    if (projecting) {
      tickClock += dt;
      while (tickClock >= TICK) {
        tickClock -= TICK;
        seed = (seed + 1) % 997;
        weave = [clamp(weave[0] * 0.6 + (Math.random() - 0.5) * 1.1, -1.2, 1.2), clamp(weave[1] * 0.5 + (Math.random() - 0.5) * 0.6, -0.6, 0.6)];
        flicker = Math.random() * 0.035;
        scatterDust();
        filmDirty = true;
      }
    } else if (weave[0] || weave[1] || flicker) {
      weave = [0, 0];
      flicker = 0;
      dust.fill(0);
      filmDirty = true;
    }
    if (leak[0] > 0.002) {
      leak = [leak[0] * Math.exp(-dt / 0.45), leak[1]];
      filmDirty = true;
    } else {
      leak = [0, leak[1]];
    }

    setActive(clamp(Math.round(pos), 0, last), now);
    if (autoplay && !moving) {
      dwellClock += dt;
      if (dwellClock >= frames[active].dwell) {
        if (active < last) goTo(active + 1);
        else setAutoplay(false);
      }
    }

    place();
    let threadMoving = false;
    if (projectorReady) {
      holdThread();
      thread.drag(-velocity * geo.pitch * dt);
      threadMoving = thread.step(dt);
      if (threadMoving) thread.draw();
    }
    if (filmDirty) renderFilm();

    if (moving || projecting || threadMoving || leak[0] > 0) raf = requestAnimationFrame(loop);
  }

  function wake(): void {
    if (raf) return;
    lastTime = -1;
    raf = requestAnimationFrame(loop);
  }

  // ---- input ----

  addEventListener(
    'scroll',
    () => {
      scrollSteps = (scrollY - geo.reelTop) / geo.step;
      wake();
    },
    { passive: true, ...on },
  );

  addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const el = event.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      // Below the reel (the footer) the page scrolls as usual.
      if (scrollY > geo.reelTop + last * geo.step + 1) return;
      const i = targetIndex();
      let to: number;
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
        case 'PageDown':
          to = i + 1;
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'PageUp':
          to = i - 1;
          break;
        case ' ':
          if (el.closest('button, a, summary')) return;
          to = event.shiftKey ? i - 1 : i + 1;
          break;
        case 'Home':
          to = 0;
          break;
        case 'End':
          to = last;
          break;
        default:
          return;
      }
      if (to < 0 || to > last) return;
      event.preventDefault();
      goTo(to);
    },
    on,
  );

  gate.addEventListener(
    'pointermove',
    (event) => {
      const rect = gate.getBoundingClientRect();
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (pointer) thread.pull(at.x, at.y, at.x - pointer.x, at.y - pointer.y);
      pointer = at;
      wake();
    },
    { passive: true, ...on },
  );
  gate.addEventListener('pointerleave', () => (pointer = null), on);

  // In-page links (the scene list) move the reel rather than jumping into the clipped strip.
  reel.addEventListener(
    'click',
    (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      const index = link ? indexForId(link.hash.slice(1)) : -1;
      if (index < 0) return;
      event.preventDefault();
      history.replaceState(history.state, '', link!.hash);
      goTo(index);
    },
    on,
  );
  addEventListener(
    'hashchange',
    () => {
      const index = indexForId(location.hash.slice(1));
      if (index >= 0) goTo(index);
    },
    on,
  );

  // Tabbing into a frame (a link in it) brings that frame into the gate.
  strip.addEventListener(
    'focusin',
    (event) => {
      const index = frames.findIndex((frame) => frame.el.contains(event.target as Node));
      if (index >= 0 && index !== targetIndex()) goTo(index);
    },
    on,
  );

  playButton.addEventListener('click', () => setAutoplay(!autoplay), on);
  backButton.addEventListener('click', () => goTo(targetIndex() - 1), on);
  nextButton.addEventListener('click', () => goTo(targetIndex() + 1), on);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(gate);

  // Turning reduced motion on mid-visit drops back to the static sequence.
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
    'change',
    (query) => {
      if (!query.matches) return;
      listeners.abort();
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
      delete root.dataset.reel;
      strip.style.transform = '';
      for (const frame of frames) if (frame.photo) frame.photo.style.transform = '';
    },
    on,
  );

  // ---- start ----

  controls.hidden = false;
  if (autoplay) setAutoplay(true);
  const startAt = indexForId(location.hash.slice(1));
  if (startAt >= 0) {
    goTo(startAt);
    scrollSteps = startAt;
  }
  pos = targetIndex();
  setActive(pos, 0);
  place();
  resize();

  // The thread and the projector pass start once the page is idle, so neither delays the words.
  const startProjector = () => {
    projectorReady = true;
    holdThread();
    thread.place();
    thread.draw();
    film = FilmPass.create(filmCanvas);
    film?.resize(geo.gateWidth, geo.gateHeight, Math.min(devicePixelRatio || 1, 1.5));
    renderFilm();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(startProjector, { timeout: 1500 });
  else setTimeout(startProjector, 300);
}
