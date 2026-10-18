import { HOME_EVENT } from '../scene/Camera/events';
import type { RoomHandle, StationName } from '../scene/main';
import tour from '../scene/tour.json';

type Segment = [[number, number], [number, number]];

/** public/room/floorplan.json, written from the blend file: plan coordinates are the room's x and z in metres. */
export interface FloorPlan {
  /** The floor; its sides without a wall are the room's open front. */
  outline: [number, number][];
  /** The corner set's floor fading into the void beyond its solid edge. */
  fadeOutline?: [number, number][];
  /** The two walls of the corner set as one line: the left wall's free end, the corner, the back wall's free end. */
  corner?: [number, number][];
  walls?: Segment[];
  windows?: Segment[];
  doors?: Segment[];
  furniture?: { label?: string; polygon: [number, number][] }[];
  /** The tour's stops in order, professional first: each names the camera node that frames it and its spot on the plan. */
  stops: { id: string; label: string; camera: string; position: [number, number] }[];
}

/** src/scene/tour.json: what the tour says at each of the plan's stops, by the stop's id. */
export const CAPTIONS: ReadonlyMap<string, string> = new Map(tour.stops.map(({ id, caption }) => [id, caption]));

/**
 * The stops the map offers and the played tour visits: the plan's own, in its order and with its labels; a stop with
 * no caption here is not part of the tour.
 */
export function tourStops(plan: Pick<FloorPlan, 'stops'>) {
  return plan.stops.flatMap((stop) => {
    const caption = CAPTIONS.get(stop.id);
    return caption ? [{ ...stop, caption }] : [];
  });
}
/**
 * Which caption the glide shows at path second `time`: the stop whose stretch of the path the camera is in (from halfway
 * after the stop before to halfway before the next, less a short gap for the cross-fade), `stops.length` for the
 * stretch home to the desk, or -1 between two.
 */
export function captionAt(time: number, stops: readonly number[], end: number): number {
  const knots = [...stops, end];
  for (let k = 0; k < knots.length; k++) {
    const from = k === 0 ? 0 : (knots[k - 1] + knots[k]) / 2;
    const to = k === knots.length - 1 ? end : (knots[k] + knots[k + 1]) / 2;
    if (time >= from + CAPTION_GAP_S && time < to - CAPTION_GAP_S) return k;
  }
  return -1;
}

export const FLOORPLAN_URL = '/room/floorplan.json';
// Step by step (reduced motion), the tour rests this long at each stop once the camera has landed, to read its caption.
const HOLD_MS = 4500;
// The glide takes this long a leg (start to the first stop, stop to stop, the last stop home), within the bounds.
const GLIDE_LEG_S = 7.5;
const GLIDE_BOUNDS_S = [45, 70] as const;
// Between two stops' captions the old one fades out and the new one in.
const CAPTION_GAP_S = 0.4;
const CAPTION_FADE_MS = 500;
// Around the room's outline, so the walls' strokes and the markers at the edges stay inside the drawing.
const PLAN_MARGIN_M = 0.35;
// The you-are-here wedge's length, as a share of the plan's width.
const HERE_SCALE = 0.1;
// Numbered markers closer than this (a share of the plan's width, about one marker) are pushed apart to stay readable.
const MARKER_GAP = 0.075;
// A camera resting elsewhere (the desk it lands at, a prop's close-up) is at the stop it looks at, if one is this near.
const AT_STOP_M = 0.5;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The floor plan, or null when the room has none (the tour then stays hidden). */
export async function loadFloorPlan(): Promise<FloorPlan | null> {
  try {
    const response = await fetch(FLOORPLAN_URL);
    if (!response.ok) return null;
    const plan = (await response.json()) as FloorPlan;
    return Array.isArray(plan.outline) && Array.isArray(plan.stops) ? plan : null;
  } catch (error) {
    console.warn('room tour: no floor plan', error);
    return null;
  }
}

interface Stop {
  label: string;
  caption: string;
  station: StationName;
  position: [number, number];
  item: HTMLButtonElement;
  marker: HTMLElement;
}

/** Each tour stop with its framing; a stop the room cannot frame is left out. */
function placeStops(room: RoomHandle, plan: FloorPlan) {
  return tourStops(plan).flatMap((stop) => {
    const station = stop.camera.replace(/^cam_/, '');
    if (!room.has(station)) {
      console.warn(`room tour: the room has no ${stop.camera} for the stop "${stop.label}"`);
      return [];
    }
    return [{ ...stop, station }];
  });
}

/**
 * The map: opened by "Take the tour", closed by Close or Escape. A stop (clicked, or Enter on it) flies the camera there;
 * "Play the tour" glides through every stop in order without stopping and comes back to the desk, each stop's caption
 * fading in as it comes into view (reduced motion: one stop at a time, a pause at each). Any input meanwhile (a click,
 * a key, the wheel, Escape) brakes it where it is.
 */
export function mountTour(open: HTMLButtonElement, panel: HTMLElement, room: RoomHandle, plan: FloorPlan) {
  const q = <T extends Element>(selector: string) => panel.querySelector<T>(selector)!;
  const svg = q<SVGSVGElement>('[data-tour-svg]');
  const here = q<SVGGElement>('[data-tour-here]');
  const caption = q<HTMLElement>('[data-tour-caption]');
  const play = q<HTMLButtonElement>('[data-tour-play]');
  const list = q<HTMLOListElement>('[data-tour-stops]');
  const markers = q<HTMLElement>('[data-tour-markers]');

  const placed = placeStops(room, plan);
  const points = [...plan.outline, ...placed.map((s) => s.position)];
  const minX = Math.min(...points.map(([x]) => x)) - PLAN_MARGIN_M;
  const minZ = Math.min(...points.map(([, z]) => z)) - PLAN_MARGIN_M;
  const width = Math.max(...points.map(([x]) => x)) + PLAN_MARGIN_M - minX;
  const height = Math.max(...points.map(([, z]) => z)) + PLAN_MARGIN_M - minZ;
  svg.setAttribute('viewBox', `${minX} ${minZ} ${width} ${height}`);
  q<HTMLElement>('[data-tour-plan]').style.aspectRatio = `${width} / ${height}`;

  const polygonPoints = (polygon: [number, number][]) => polygon.map(([x, z]) => `${x},${z}`).join(' ');
  const floor = q<SVGPolygonElement>('[data-tour-outline]');
  floor.setAttribute('points', polygonPoints(plan.outline));
  // With walls of its own, the outline is only the floor's edge; without, it stands for the walls.
  if (plan.walls || plan.corner) floor.classList.add('room-tour-floor');
  // The corner set's two walls, drawn as one line so the corner itself is a mitred angle.
  const corner = q<SVGPolylineElement>('[data-tour-corner]');
  if (plan.corner) corner.setAttribute('points', polygonPoints(plan.corner));
  else corner.remove();
  const segments = (group: SVGGElement, list: Segment[] | undefined, className: string) => {
    for (const [[x1, z1], [x2, z2]] of list ?? []) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', className);
      Object.entries({ x1, y1: z1, x2, y2: z2 }).forEach(([k, v]) => line.setAttribute(k, String(v)));
      group.append(line);
    }
  };
  const walls = q<SVGGElement>('[data-tour-walls]');
  if (!plan.corner) segments(walls, plan.walls, 'room-tour-wall');
  segments(walls, plan.windows, 'room-tour-window-gap');
  segments(walls, plan.windows, 'room-tour-window');
  const furniture = q<SVGGElement>('[data-tour-furniture]');
  for (const piece of plan.furniture ?? []) {
    const shape = document.createElementNS(SVG_NS, 'polygon');
    shape.setAttribute('class', 'room-tour-furniture');
    shape.setAttribute('points', polygonPoints(piece.polygon));
    furniture.append(shape);
  }
  // A door is a gap in the wall (a stroke in the panel's colour) with its swing drawn as a dashed quarter circle.
  const doors = q<SVGGElement>('[data-tour-doors]');
  for (const [[x1, z1], [x2, z2]] of plan.doors ?? []) {
    const gap = document.createElementNS(SVG_NS, 'line');
    gap.setAttribute('class', 'room-tour-door');
    Object.entries({ x1, y1: z1, x2, y2: z2 }).forEach(([k, v]) => gap.setAttribute(k, String(v)));
    const r = Math.hypot(x2 - x1, z2 - z1);
    const swing = document.createElementNS(SVG_NS, 'path');
    swing.setAttribute('class', 'room-tour-door-swing');
    swing.setAttribute('d', `M${x2},${z2} A${r},${r} 0 0 1 ${x1 - (z2 - z1)},${z1 + (x2 - x1)} L${x1},${z1}`);
    doors.append(gap, swing);
  }

  const spots = spread(
    placed.map((s) => s.position),
    width * MARKER_GAP,
    [minX, minZ, minX + width, minZ + height],
  );
  const stops: Stop[] = [];
  placed.forEach((stop, i) => {
    const { station } = stop;
    const number = String(stops.length + 1);
    const item = document.createElement('button');
    item.type = 'button';
    item.dataset.stop = String(i);
    item.innerHTML = `<span class="n" aria-hidden="true"></span><span></span>`;
    item.firstElementChild!.textContent = number;
    item.lastElementChild!.textContent = stop.label;
    const li = document.createElement('li');
    li.append(item);
    list.append(li);
    const marker = document.createElement('span');
    marker.textContent = number;
    marker.style.left = `${((spots[i][0] - minX) / width) * 100}%`;
    marker.style.top = `${((spots[i][1] - minZ) / height) * 100}%`;
    markers.append(marker);
    stops.push({ label: stop.label, caption: stop.caption, station, position: stop.position, item, marker });
    const go = () => {
      stopPlaying();
      room.visit(station);
    };
    item.addEventListener('click', go);
    marker.addEventListener('click', go);
    const light = (on: boolean) => marker.toggleAttribute('data-lit', on);
    item.addEventListener('pointerenter', () => light(true));
    item.addEventListener('pointerleave', () => light(false));
    item.addEventListener('focus', () => light(true));
    item.addEventListener('blur', () => light(false));
  });

  // ---- the played tour: the map shrinks to a small you-are-here inset carrying each stop's caption ----
  type Playing =
    | { mode: 'glide'; route: Stop[]; arrived: boolean }
    | { mode: 'steps'; expected: StationName; timer: number };
  let playing: Playing | null = null;

  const say = (heading: string, line = '') => {
    const strong = document.createElement('strong');
    strong.textContent = heading;
    caption.replaceChildren(strong, ...(line ? [document.createTextNode(` ${line}`)] : []));
  };
  const sayStop = (stop: Stop) => say(`${stops.indexOf(stop) + 1} of ${stops.length} · ${stop.label}.`, stop.caption);

  // The glide's captions cross-fade: the old one fades out, the text changes, the new one fades in.
  let wantedCaption = -2;
  let captionTimer = 0;
  const showCaption = (route: Stop[], index: number) => {
    if (index === wantedCaption) return;
    wantedCaption = index;
    caption.dataset.fade = 'out';
    clearTimeout(captionTimer);
    captionTimer = window.setTimeout(() => {
      if (index < 0) return;
      if (index < route.length) sayStop(route[index]);
      else say('Back at the desk.');
      caption.dataset.fade = 'in';
    }, CAPTION_FADE_MS);
  };

  const visitStop = (index: number) => {
    if (playing?.mode !== 'steps') return;
    const stop = stops[index];
    const at = stop ? stop.station : 'desk';
    playing.expected = at;
    if (stop) sayStop(stop);
    else say('Back at the desk.');
    room.visit(at, () => {
      if (playing?.mode !== 'steps' || playing.expected !== at) return;
      if (index >= stops.length) {
        stopPlaying(false);
        ended = true;
        return;
      }
      playing.timer = window.setTimeout(() => visitStop(index + 1), HOLD_MS);
    });
  };

  function stopPlaying(clearCaption = true) {
    if (!playing) return;
    if (playing.mode === 'steps') clearTimeout(playing.timer);
    // The Stop button, or the map closing: the glide slows to rest where it is.
    else if (!playing.arrived) room.stopGlide();
    playing = null;
    clearTimeout(captionTimer);
    wantedCaption = -2;
    caption.removeAttribute('data-fade');
    panel.removeAttribute('data-playing');
    play.textContent = 'Play the tour';
    if (clearCaption) caption.textContent = '';
  }

  play.addEventListener('click', () => {
    if (playing) return stopPlaying();
    const played = stops;
    panel.setAttribute('data-playing', '');
    play.textContent = 'Stop the tour';
    const seconds = Math.min(GLIDE_BOUNDS_S[1], Math.max(GLIDE_BOUNDS_S[0], (played.length + 1) * GLIDE_LEG_S));
    const glide: Playing = { mode: 'glide', route: played, arrived: false };
    playing = glide;
    const gliding = room.glideTour(
      played.map(({ station }) => ({ station, distance: 1 })),
      seconds,
      () => {
        if (playing !== glide) return;
        glide.arrived = true;
        say('Back at the desk.');
        stopPlaying(false);
        ended = true;
      },
      plan,
    );
    if (gliding) return;
    // Reduced motion (or a paused room): one stop at a time, a pause at each.
    playing = { mode: 'steps', expected: stops[0]?.station ?? 'desk', timer: 0 };
    visitStop(0);
  });

  // A wheel anywhere brakes the glide too, also over this inset where the pointer rests after pressing Play.
  window.addEventListener('wheel', () => playing?.mode === 'glide' && room.stopGlide(), { passive: true });

  // ---- opening, closing and the keyboard ----
  let frame = 0;
  let current: Stop | undefined;
  // A played tour that came home keeps its last line ("Back at the desk.") until the camera moves again.
  let ended = false;
  const follow = () => {
    frame = requestAnimationFrame(follow);
    const view = room.view();
    const angle = (Math.atan2(view.dirZ, view.dirX) * 180) / Math.PI;
    here.setAttribute('transform', `translate(${view.x} ${view.z}) rotate(${angle}) scale(${width * HERE_SCALE})`);
    let at: Stop | undefined;
    if (playing?.mode === 'glide') {
      // Braked by the visitor, or the camera sent somewhere else: they lead now.
      if (!view.glide || view.glide.braking) stopPlaying();
      else {
        const index = captionAt(view.glide.time, view.glide.stops, view.glide.end);
        showCaption(playing.route, index);
        at = playing.route[index];
      }
    } else {
      // The visitor moved the camera somewhere the played tour did not ask for: they lead now.
      if (playing && view.destination !== playing.expected) stopPlaying();
      at = view.moving ? undefined : (stops.find((s) => s.station === view.destination) ?? nearestStop(view.targetX, view.targetZ));
    }
    if (view.moving) ended = false;
    if (at === current) return;
    current?.item.removeAttribute('aria-current');
    current?.marker.removeAttribute('data-current');
    current = at;
    at?.item.setAttribute('aria-current', 'location');
    at?.marker.setAttribute('data-current', '');
    if (at && !playing && !ended) say(`You are here: ${at.label}.`);
  };

  const nearestStop = (x: number, z: number) => {
    const distance = (s: Stop) => Math.hypot(s.position[0] - x, s.position[1] - z);
    const nearest = stops.reduce<Stop | undefined>((best, s) => (!best || distance(s) < distance(best) ? s : best), undefined);
    return nearest && distance(nearest) <= AT_STOP_M ? nearest : undefined;
  };

  const setOpen = (on: boolean) => {
    panel.hidden = !on;
    open.setAttribute('aria-expanded', String(on));
    cancelAnimationFrame(frame);
    if (on) {
      // The visitor chose the tour: the arrival's own step into the monitor no longer comes.
      room.takeOver();
      follow();
      (current ?? stops[0])?.item.focus();
    } else {
      stopPlaying();
      open.focus();
    }
  };
  open.addEventListener('click', () => setOpen(open.getAttribute('aria-expanded') !== 'true'));
  q<HTMLButtonElement>('[data-tour-close]').addEventListener('click', () => setOpen(false));
  // Home: the visit starts over from the wide view, so the map closes and a played tour ends (Home has already taken
  // the camera off the glide). Focus moves only if it was inside the map.
  document.addEventListener(HOME_EVENT, () => {
    if (panel.hidden) return;
    const hadFocus = panel.contains(document.activeElement);
    stopPlaying();
    panel.hidden = true;
    open.setAttribute('aria-expanded', 'false');
    cancelAnimationFrame(frame);
    if (hadFocus) open.focus();
  });

  // Arrow keys move between the stops (Tab does too); the room must not also take them as a step.
  list.addEventListener('keydown', (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const at = stops.findIndex((s) => s.item === document.activeElement);
    stops[(at + step + stops.length) % stops.length]?.item.focus();
  });
  // Escape closes the map wherever focus is, before the room would take it as "back out"; while the tour glides, the
  // first Escape only brakes it where it is.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || panel.hidden) return;
      event.preventDefault();
      if (playing?.mode === 'glide' && room.stopGlide()) return;
      setOpen(false);
    },
    { capture: true },
  );

  open.hidden = stops.length === 0;
}

/** Pushes points closer than `gap` apart (a few rounds, each pair half each way), kept inside `bounds`. */
function spread(points: readonly [number, number][], gap: number, [x0, z0, x1, z1]: [number, number, number, number]) {
  const spots = points.map(([x, z]) => [x, z] as [number, number]);
  for (let round = 0; round < 12; round++) {
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const dx = spots[j][0] - spots[i][0];
        const dz = spots[j][1] - spots[i][1];
        const d = Math.hypot(dx, dz);
        if (d >= gap) continue;
        // Two stops on the same spot part sideways, the later one to the right.
        const [ux, uz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
        const push = (gap - d) / 2;
        spots[i] = [spots[i][0] - ux * push, spots[i][1] - uz * push];
        spots[j] = [spots[j][0] + ux * push, spots[j][1] + uz * push];
      }
    }
    for (const spot of spots) {
      spot[0] = Math.min(x1, Math.max(x0, spot[0]));
      spot[1] = Math.min(z1, Math.max(z0, spot[1]));
    }
  }
  return spots;
}
