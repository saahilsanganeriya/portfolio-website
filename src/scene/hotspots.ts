// PLAN 3.7, 11.1 and 12.1: every clickable thing in the room, what it does there, and the SaahilOS window that holds
// the same thing as real HTML. A hotspot with `fly` first takes the camera to that framing; a click there (or on a
// hotspot without one) runs its room `action`, or zooms into the monitor and opens `target`. The click's sound is
// the audio layer's, by proxy (src/scene/audio/RoomAudio.ts).
import favorites from '../content/favorites.json';
import type { StationName } from './Application/RoomModel';

/** What a prop does in the room itself; World carries these out. */
export type WorldAction = 'album' | 'dial' | 'lava' | 'fan' | 'espresso' | 'print' | 'window';

export interface Hotspot {
  /** Proxy boxes in room.glb (PLAN 3.6) that open this hotspot; World names the poster and print proxies by slot. */
  proxies: readonly string[];
  /** What it is in the room. */
  prop: string;
  /** The hover label. */
  label: string;
  /** SaahilOS window (`<app>[/<slug>]`) with the same content as HTML; null: only zoom into the monitor, or nothing to read. */
  target: string | null;
  /** The framing the camera flies to on the first click. */
  fly?: StationName;
  action?: WorldAction;
  /** The address that opens `target` on the monitor. */
  href: string;
}

export const POSTER_SLOTS = 4;
export const PRINT_SLOTS = 5;

/** The posters hang in profile order: slot 0 is the first of the four favourites on Letterboxd. */
const posters: Hotspot[] = favorites.films.slice(0, POSTER_SLOTS).map((film, slot) => ({
  proxies: [`hit_poster_${slot}`],
  prop: `The ${film.title} poster`,
  label: film.title,
  target: `films/${film.slug}`,
 
  href: `/films#${film.slug}`,
}));

/** The wall's prints; World swaps in each photograph's title and window once it knows which hangs where. */
const prints: Hotspot[] = Array.from({ length: PRINT_SLOTS }, (_, slot) => ({
  proxies: [`hit_photo_print_${slot}`],
  prop: 'A framed print',
  label: 'Photographs',
  target: 'photography',
  fly: 'photos',
  action: 'print',
 
  href: '/#photography',
}));

export const HOTSPOTS: readonly Hotspot[] = [
  // On the desktop the monitor is its live iframe; phones have no live screen, so the room may make hit_monitor there.
  { proxies: ['hit_monitor'], prop: 'The monitor', label: 'SaahilOS', target: null, href: '/os' },
  {
    proxies: ['hit_fujifilm_a', 'hit_fujifilm_b', 'hit_fujifilm_c'],
    prop: 'The Fujifilm cameras',
    label: 'A Narrative in a Frame',
    target: 'photography',
   
    href: '/#photography',
  },
  { proxies: ['hit_super8'], prop: 'The Super 8 camera', label: 'The Thread', target: 'story', href: '/story' },
  { proxies: ['hit_projector'], prop: 'The projector', label: 'Films', target: 'films', fly: 'projector', href: '/films' },
  // The screen's target follows the program on it (World): Films for the reel, the photograph for Photographs.
  { proxies: ['hit_projector_screen'], prop: 'The projector screen', label: 'The Reel', target: 'films', fly: 'projector', href: '/films' },
  { proxies: ['hit_projector_dial'], prop: 'The projector’s program dial', label: 'Next program', target: 'films', action: 'dial', href: '/films' },
  ...posters,
  { proxies: ['hit_plaque'], prop: 'The plaque under the posters', label: 'Four favourites', target: 'films/favourites', href: '/films#favourites' },
  { proxies: ['hit_photo_wall'], prop: 'The print wall', label: 'Photographs', target: 'photography', fly: 'photos', href: '/#photography' },
  ...prints,
  { proxies: ['hit_album'], prop: 'The photo album', label: 'The photo album', target: 'photography', fly: 'desk', action: 'album', href: '/#photography' },
  // The window's label shows the time in both cities (World); there is nothing in it to read, so it opens nothing.
  { proxies: ['hit_window'], prop: 'The window', label: 'San Francisco · Delhi', target: null, fly: 'window', action: 'window', href: '/about' },
  { proxies: ['hit_lava_lamp'], prop: 'The lava lamp', label: 'Lava lamp — change the mood', target: null, action: 'lava', href: '/' },
  { proxies: ['hit_fan'], prop: 'The ceiling fan', label: 'Ceiling fan — pull the chain', target: null, action: 'fan', href: '/' },
  { proxies: ['hit_espresso'], prop: 'The espresso machine', label: 'Espresso — pull a shot', target: null, action: 'espresso', href: '/' },
  { proxies: ['hit_oven'], prop: 'The countertop oven', label: 'In the oven', target: 'oven', href: '/#oven' },
  { proxies: ['hit_nas'], prop: 'The NAS', label: 'Terminal', target: 'terminal', href: '/#terminal' },
  { proxies: ['hit_mango'], prop: 'The mango plant', label: 'About', target: 'about', href: '/about' },
];

const byProxy = new Map(HOTSPOTS.flatMap((hotspot) => hotspot.proxies.map((proxy) => [proxy, hotspot] as const)));

export const hotspotForProxy = (proxyName: string) => byProxy.get(proxyName);
