import type { RoomHandle, StationName } from '../scene/main';

/** public/room/floorplan.json, written from the blend file: plan coordinates are the room's x and z in metres. */
export interface FloorPlan {
  outline: [number, number][];
  doors?: [[number, number], [number, number]][];
  furniture?: { label?: string; polygon: [number, number][] }[];
  /** In tour order: the work first, then the rest. */
  stops: { id: string; label: string; camera: string; position: [number, number] }[];
}

export const FLOORPLAN_URL = '/room/floorplan.json';
// The played tour rests this long at each stop once the camera has landed, long enough to read its label.
const HOLD_MS = 2600;
// Around the room's outline, so the walls' strokes and the markers at the edges stay inside the drawing.
const PLAN_MARGIN_M = 0.35;
// The you-are-here wedge's length, as a share of the plan's width.
const HERE_SCALE = 0.1;
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
  station: StationName;
  item: HTMLButtonElement;
  marker: HTMLElement;
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

  const points = [...plan.outline, ...plan.stops.map((s) => s.position)];
  const minX = Math.min(...points.map(([x]) => x)) - PLAN_MARGIN_M;
  const minZ = Math.min(...points.map(([, z]) => z)) - PLAN_MARGIN_M;
  const width = Math.max(...points.map(([x]) => x)) + PLAN_MARGIN_M - minX;
  const height = Math.max(...points.map(([, z]) => z)) + PLAN_MARGIN_M - minZ;
  svg.setAttribute('viewBox', `${minX} ${minZ} ${width} ${height}`);
  q<HTMLElement>('[data-tour-plan]').style.aspectRatio = `${width} / ${height}`;

  const polygonPoints = (polygon: [number, number][]) => polygon.map(([x, z]) => `${x},${z}`).join(' ');
  q<SVGPolygonElement>('[data-tour-outline]').setAttribute('points', polygonPoints(plan.outline));
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

  const stops: Stop[] = [];
  plan.stops.forEach((stop, i) => {
    const station = stop.camera.replace(/^cam_/, '');
    if (!room.has(station)) {
      console.warn(`room tour: the room has no ${stop.camera} for the stop "${stop.label}"`);
      return;
    }
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
    marker.style.left = `${((stop.position[0] - minX) / width) * 100}%`;
    marker.style.top = `${((stop.position[1] - minZ) / height) * 100}%`;
    markers.append(marker);
    const entry = { label: stop.label, station, item, marker };
    stops.push(entry);
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

  // ---- the played tour ----
  let playing: { index: number; expected: StationName; timer: number } | null = null;

  const visitStop = (index: number) => {
    if (!playing) return;
    const stop = stops[index];
    const at = index < stops.length ? stop.station : 'desk';
    playing.index = index;
    playing.expected = at;
    caption.textContent = stop ? `${index + 1} of ${stops.length} · ${stop.label}` : 'Back at the desk.';
    room.visit(at, () => {
      if (!playing || playing.expected !== at) return;
      if (index >= stops.length) return stopPlaying(false);
      playing.timer = window.setTimeout(() => visitStop(index + 1), HOLD_MS);
    });
  };

  function stopPlaying(clearCaption = true) {
    if (!playing) return;
    clearTimeout(playing.timer);
    playing = null;
    play.textContent = 'Play the tour';
    if (clearCaption) caption.textContent = '';
  }

  play.addEventListener('click', () => {
    if (playing) return stopPlaying();
    playing = { index: 0, expected: stops[0]?.station ?? 'desk', timer: 0 };
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
    const at = view.moving ? undefined : stops.find((s) => s.station === view.destination);
    if (at === current) return;
    current?.item.removeAttribute('aria-current');
    current?.marker.removeAttribute('data-current');
    current = at;
    at?.item.setAttribute('aria-current', 'location');
    at?.marker.setAttribute('data-current', '');
    if (at && !playing) caption.textContent = `You are here: ${at.label}.`;
  };

  const setOpen = (on: boolean) => {
    panel.hidden = !on;
    open.setAttribute('aria-expanded', String(on));
    cancelAnimationFrame(frame);
    if (on) {
      follow();
      (current ?? stops[0])?.item.focus();
    } else {
      stopPlaying();
      open.focus();
    }
  };
  open.addEventListener('click', () => setOpen(panel.hidden));
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
