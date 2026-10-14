import type { RoomHandle, StationName } from '../scene/main';
import tour from '../scene/tour.json';

type Segment = [[number, number], [number, number]];

/** public/room/floorplan.json, written from the blend file: plan coordinates are the room's x and z in metres. */
export interface FloorPlan {
  /** The floor; its sides without a wall are the room's open front. */
  outline: [number, number][];
  walls?: Segment[];
  windows?: Segment[];
  doors?: Segment[];
  furniture?: { label?: string; polygon: [number, number][] }[];
  /** Every framing the room has a stop for, at its spot on the plan. */
  stops: { id: string; label: string; camera: string; position: [number, number] }[];
}

/**
 * src/scene/tour.json: the stops the map offers and the played tour visits, in order (the work first). The plan's
 * geometry stays the room's own; a stop takes its spot from the plan's stop with the same camera (or id).
 */
export interface TourStop {
  id: string;
  label: string;
  /** The room's camera node, `cam_tour_<n>`. */
  camera: string;
  caption: string;
  /** Stands the camera this many times further back than its node, for a framing authored too close. */
  distance?: number;
}

export const TOUR_STOPS: readonly TourStop[] = tour.stops;
export const FLOORPLAN_URL = '/room/floorplan.json';
// The played tour rests this long at each stop once the camera has landed, long enough to read its caption.
const HOLD_MS = 4500;
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
  distance: number;
  position: [number, number];
  item: HTMLButtonElement;
  marker: HTMLElement;
}

/** Each tour stop with its camera and spot on the plan; a stop the room cannot frame is left out. */
function placeStops(room: RoomHandle, plan: FloorPlan) {
  return TOUR_STOPS.flatMap((stop) => {
    const spot = plan.stops.find((s) => s.camera === stop.camera) ?? plan.stops.find((s) => s.id === stop.id);
    // The room's own stop with this id stands in when the tour's camera is gone (the room renumbered its framings).
    const camera = room.has(stop.camera.replace(/^cam_/, '')) ? stop.camera : (spot?.camera ?? stop.camera);
    const station = camera.replace(/^cam_/, '');
    if (!spot || !room.has(station)) {
      console.warn(`room tour: the room has no ${stop.camera} for the stop "${stop.label}"`);
      return [];
    }
    return [{ ...stop, station, position: spot.position }];
  });
}

/**
 * The map: opened by "Take the tour", closed by Close or Escape. A stop (clicked, or Enter on it) flies the camera there;
 * "Play the tour" visits every stop in order and comes back to the desk. Anything the visitor does with the camera
 * meanwhile (a prop, an arrow key, another stop) ends the played tour where it is.
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
  if (plan.walls) floor.classList.add('room-tour-floor');
  const segments = (group: SVGGElement, list: Segment[] | undefined, className: string) => {
    for (const [[x1, z1], [x2, z2]] of list ?? []) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', className);
      Object.entries({ x1, y1: z1, x2, y2: z2 }).forEach(([k, v]) => line.setAttribute(k, String(v)));
      group.append(line);
    }
  };
  const walls = q<SVGGElement>('[data-tour-walls]');
  segments(walls, plan.walls, 'room-tour-wall');
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
    const distance = stop.distance ?? 1;
    stops.push({ label: stop.label, caption: stop.caption, station, distance, position: stop.position, item, marker });
    const go = () => {
      stopPlaying();
      room.visit(station, undefined, distance);
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
  let playing: { expected: StationName; timer: number } | null = null;

  const say = (heading: string, line = '') => {
    const strong = document.createElement('strong');
    strong.textContent = heading;
    caption.replaceChildren(strong, ...(line ? [document.createTextNode(` ${line}`)] : []));
  };

  const visitStop = (index: number) => {
    if (!playing) return;
    const stop = stops[index];
    const at = stop ? stop.station : 'desk';
    playing.expected = at;
    if (stop) say(`${index + 1} of ${stops.length} · ${stop.label}.`, stop.caption);
    else say('Back at the desk.');
    room.visit(
      at,
      () => {
        if (!playing || playing.expected !== at) return;
        if (index >= stops.length) return stopPlaying(false);
        playing.timer = window.setTimeout(() => visitStop(index + 1), HOLD_MS);
      },
      stop?.distance,
    );
  };

  function stopPlaying(clearCaption = true) {
    if (!playing) return;
    clearTimeout(playing.timer);
    playing = null;
    panel.removeAttribute('data-playing');
    play.textContent = 'Play the tour';
    if (clearCaption) caption.textContent = '';
  }

  play.addEventListener('click', () => {
    if (playing) return stopPlaying();
    playing = { expected: stops[0]?.station ?? 'desk', timer: 0 };
    panel.setAttribute('data-playing', '');
    play.textContent = 'Stop the tour';
    visitStop(0);
  });

  // ---- opening, closing and the keyboard ----
  let frame = 0;
  let current: Stop | undefined;
  const follow = () => {
    frame = requestAnimationFrame(follow);
    const view = room.view();
    const angle = (Math.atan2(view.dirZ, view.dirX) * 180) / Math.PI;
    here.setAttribute('transform', `translate(${view.x} ${view.z}) rotate(${angle}) scale(${width * HERE_SCALE})`);
    // The visitor moved the camera somewhere the played tour did not ask for: they lead now.
    if (playing && view.destination !== playing.expected) stopPlaying();
    const at = view.moving ? undefined : (stops.find((s) => s.station === view.destination) ?? nearestStop(view.targetX, view.targetZ));
    if (at === current) return;
    current?.item.removeAttribute('aria-current');
    current?.marker.removeAttribute('data-current');
    current = at;
    at?.item.setAttribute('aria-current', 'location');
    at?.marker.setAttribute('data-current', '');
    if (at && !playing) say(`You are here: ${at.label}.`);
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

  // Arrow keys move between the stops (Tab does too); the room must not also take them as a step.
  list.addEventListener('keydown', (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const at = stops.findIndex((s) => s.item === document.activeElement);
    stops[(at + step + stops.length) % stops.length]?.item.focus();
  });
  // Escape closes the map wherever focus is, before the room would take it as "back out".
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || panel.hidden) return;
      event.preventDefault();
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
