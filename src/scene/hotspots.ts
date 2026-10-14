// PLAN 3.7, 11.1, 12.1 and round 7 §3: every clickable thing in the room, what it does there, and the SaahilOS window
// that holds the same thing as real HTML. A hotspot with `fly` first takes the camera to that framing; a click there (or
// on a hotspot without one) runs its room `action`, or zooms into the monitor and opens `target`. The click's sound is
// the audio layer's, by proxy (src/scene/audio/RoomAudio.ts).
import favorites from '../content/favorites.json';
import type { StationName } from './Application/RoomModel';

/**
 * What a prop does in the room itself; World carries these out. An action World does not handle yet falls back to the
 * hotspot's `fly`, then its `target`, so the room and the world can land in either order.
 */
export type WorldAction = 'album' | 'dial' | 'lava' | 'espresso' | 'oven' | 'projector' | 'print' | 'window';

export interface Hotspot {
  /** Proxy boxes in room.glb (PLAN 3.6) that open this hotspot; World names the poster and print proxies by slot. */
  proxies: readonly string[];
  /** What it is in the room. */
  prop: string;
  /** The hover label: short and calm. */
  label: string;
  /** SaahilOS window (`<app>[/<slug>]`) with the same content as HTML; null: only zoom into the monitor, or nothing to read. */
  target: string | null;
  /** The framing the camera flies to on the first click. */
  fly?: StationName;
  action?: WorldAction;
  /** Only the hover label: a click does nothing. */
  labelOnly?: true;
  /** The address that opens `target` on the monitor. */
  href: string;
}

export const POSTER_SLOTS = 4;
/** The Instax board's prints (instax_slot_0..19), or the framed prints of a room without the board. */
export const PRINT_SLOTS = 20;

/** The posters hang in profile order: slot 0 is the first of the four favourites on Letterboxd. */
const posters: Hotspot[] = favorites.films.slice(0, POSTER_SLOTS).map((film, slot) => ({
  proxies: [`hit_poster_${slot}`],
  prop: `The ${film.title} poster`,
  label: film.title,
  target: `films/${film.slug}`,
  href: `/films#${film.slug}`,
}));

/** The board's prints; World swaps in each photograph's caption and window once it knows which hangs where. */
const prints: Hotspot[] = Array.from({ length: PRINT_SLOTS }, (_, slot) => ({
  proxies: [`hit_photo_print_${slot}`],
  prop: 'An Instax print',
  label: 'Photographs',
  target: 'photography',
  fly: 'photos',
  action: 'print',
  href: '/#photography',
}));

export const HOTSPOTS: readonly Hotspot[] = [
  // On the desktop the monitor is its live iframe; phones have no live screen, so the room may make hit_monitor there.
  { proxies: ['hit_monitor'], prop: 'The monitor', label: 'SaahilOS', target: null, href: '/os' },
  { proxies: ['hit_mango'], prop: 'The mango plant', label: 'About', target: 'about', href: '/about' },
  // The window's label shows the time in both cities (World); there is nothing in it to read, so it opens nothing.
  { proxies: ['hit_window'], prop: 'The window', label: 'San Francisco · Delhi', target: null, fly: 'window', action: 'window', href: '/about' },
  { proxies: ['hit_nas'], prop: 'The NAS', label: 'Terminal', target: 'terminal', href: '/#terminal' },
  { proxies: ['hit_books'], prop: 'The bookshelf', label: 'Books', target: 'books', fly: 'shelf', href: '/#books' },
  { proxies: ['hit_print_japanese_lit'], prop: 'The Japanese literature print', label: 'Books', target: 'books', href: '/#books' },
  { proxies: ['hit_voyager'], prop: 'The Voyager Golden Record', label: 'Voyager Golden Record', target: 'voyager', href: '/#voyager' },
  { proxies: ['hit_pale_blue_dot'], prop: 'The Pale Blue Dot print', label: 'Pale Blue Dot', target: 'blog/pale-blue-dot', href: '/blog/pale-blue-dot' },
  { proxies: ['hit_pennant_gatech'], prop: 'The Georgia Tech pennant', label: 'Georgia Tech', target: null, labelOnly: true, href: '/about' },
  { proxies: ['hit_espresso'], prop: 'The espresso machine', label: 'Espresso machine', target: null, fly: 'espresso', action: 'espresso', href: '/' },
  { proxies: ['hit_oven'], prop: 'The countertop oven', label: 'Oven', target: 'recipes', fly: 'oven', action: 'oven', href: '/#recipes' },
  { proxies: ['hit_croissant'], prop: 'The croissant in the oven', label: 'Kitchen', target: 'recipes', href: '/#recipes' },
  { proxies: ['hit_lava_lamp'], prop: 'The lava lamp', label: 'Lava lamp', target: null, action: 'lava', href: '/' },
  { proxies: ['hit_projector'], prop: 'The projector', label: 'Projector', target: null, fly: 'projector', action: 'projector', href: '/' },
  // The dial turns between his story and his photographs; its label names the next program (World).
  { proxies: ['hit_projector_dial'], prop: 'The projector’s program dial', label: 'Next program', target: null, fly: 'projector', action: 'dial', href: '/' },
  ...posters,
  { proxies: ['hit_plaque'], prop: 'The plaque under the posters', label: 'Four favourites', target: 'films/favourites', href: '/films#favourites' },
  { proxies: ['hit_photo_wall'], prop: 'The print wall', label: 'Photographs', target: 'photography', fly: 'photos', href: '/#photography' },
  ...prints,
  { proxies: ['hit_album'], prop: 'The photo album', label: 'The photo album', target: 'photography', fly: 'desk', action: 'album', href: '/#photography' },
];

const byProxy = new Map(HOTSPOTS.flatMap((hotspot) => hotspot.proxies.map((proxy) => [proxy, hotspot] as const)));

export const hotspotForProxy = (proxyName: string) => byProxy.get(proxyName);
