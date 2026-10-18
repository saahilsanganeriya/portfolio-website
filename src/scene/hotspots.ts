// PLAN 3.7, 11.1, 12.1 and round 7 §3: every clickable thing in the room, what it does there, and the SaahilOS window
// that holds the same thing as real HTML. A hotspot with a `card` (round 9 §10.2) first takes the camera to the object
// itself (its `fly` framing, or one fitted to it) and shows a small card beside it; Learn more, or a second click,
// zooms into the monitor and opens `target`. Without a card, a hotspot with `fly` first takes the camera there; a click
// there (or on a hotspot without one) runs its room `action`, or zooms into the monitor and opens `target`. The click's
// sound is the audio layer's, by proxy (src/scene/audio/RoomAudio.ts).
import favorites from '../content/favorites.json';
import type { StationName } from './Application/RoomModel';
import { STICKY_NOTES } from './World/stickyContent';

/**
 * What a prop does in the room itself; World carries these out. An action World does not handle yet falls back to the
 * hotspot's `fly`, then its `target`, so the room and the world can land in either order.
 */
export type WorldAction = 'lava' | 'espresso' | 'oven' | 'print' | 'window' | 'records';

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
  /** The card shown beside the object once the camera is there: its title (else the label) and one plain line (else the prop). */
  card?: { title?: string; line?: string };
}

export const POSTER_SLOTS = 4;
/** The darkroom line's prints (Darkroom names their boxes `hit_darkroom_print_<n>`, 0 on the hero clip). */
export const PRINT_SLOTS = 24;

/** The posters hang in profile order: slot 0 is the first of the four favourites on Letterboxd. */
const posters: Hotspot[] = favorites.films.slice(0, POSTER_SLOTS).map((film, slot) => ({
  proxies: [`hit_poster_${slot}`],
  prop: `The ${film.title} poster`,
  label: film.title,
  target: `films/${film.slug}`,
  href: `/films#${film.slug}`,
  card: { line: `${film.director}, ${film.year}. One of the four favourites on my Letterboxd profile.` },
}));

/** The darkroom's prints; World swaps in each photograph's marker line and window once it knows which hangs where. */
const prints: Hotspot[] = Array.from({ length: PRINT_SLOTS }, (_, slot) => ({
  proxies: [`hit_darkroom_print_${slot}`],
  prop: 'A print',
  label: 'Photographs',
  target: 'photography',
  fly: 'photos',
  action: 'print',
  href: '/#photography',
  // Darkroom names each print once it hangs: its caption is the title, "A print of …" the line.
  card: {},
}));

/** The sticky notes: under the pointer each lifts a little and its label reads the note out; a click does nothing. */
const notes: Hotspot[] = STICKY_NOTES.map(({ slot, label }) => ({
  proxies: [`hit_sticky_note_${slot}`],
  prop: 'A sticky note',
  label,
  target: null,
  labelOnly: true,
  href: '/',
}));

export const HOTSPOTS: readonly Hotspot[] = [
  // On the desktop the monitor is its live iframe; phones have no live screen, so the room may make hit_monitor there.
  { proxies: ['hit_monitor'], prop: 'The monitor', label: 'SaahilOS', target: null, href: '/os' },
  {
    proxies: ['hit_mango'],
    prop: 'The mango plant',
    label: 'About',
    target: 'about',
    href: '/about',
    card: { title: 'The mango plant', line: 'For the mango seed my mother and I planted in Delhi when I was in kindergarten.' },
  },
  // The window's label shows the time in both cities (World); there is nothing in it to read, so it opens nothing.
  {
    proxies: ['hit_window'],
    prop: 'The window',
    label: 'San Francisco · Delhi',
    target: null,
    fly: 'window',
    action: 'window',
    href: '/about',
    card: { line: 'Where I live, and where I grew up.' },
  },
  // The NAS runs projectionist (his home film library's pipeline): it opens that project.
  {
    proxies: ['hit_nas'],
    prop: 'The NAS',
    label: 'The NAS',
    target: 'projects/projectionist',
    href: '/projects/projectionist',
    card: { line: 'It runs projectionist, the Go service behind my home film library.' },
  },
  // The badge on the CRT's bezel: his family name and a thread spool, for his father's mill in the About story.
  {
    proxies: ['hit_crt_badge'],
    prop: 'The badge on the monitor',
    label: 'My family name and a thread spool, for my father’s spinning mill',
    target: 'about',
    href: '/about',
    card: { title: 'The badge', line: 'My family name and a thread spool, for the spinning mill my father built in Delhi.' },
  },
  {
    proxies: ['hit_books'],
    prop: 'The bookshelf',
    label: 'Books',
    target: 'books',
    fly: 'shelf',
    href: '/#books',
    card: { line: 'My favourites: Murakami, Yoshimoto, Vuong and Greene.' },
  },
  {
    proxies: ['hit_print_japanese_lit'],
    prop: 'The Japanese literature print',
    label: 'Books',
    target: 'books',
    href: '/#books',
    card: { title: 'Japanese literature print', line: 'For the Murakami and Yoshimoto on the shelf below it.' },
  },
  {
    proxies: ['hit_voyager'],
    prop: 'The Voyager Golden Record',
    label: 'Voyager Golden Record',
    target: 'voyager',
    href: '/#voyager',
    card: { title: 'The Voyager Golden Record', line: 'A copy of the gold record NASA sent out on both Voyager spacecraft in 1977.' },
  },
  {
    proxies: ['hit_pale_blue_dot'],
    prop: 'The Pale Blue Dot print',
    label: 'Pale Blue Dot',
    target: 'blog/pale-blue-dot',
    href: '/blog/pale-blue-dot',
    card: { line: 'Voyager 1’s photograph of Earth from six billion kilometres away.' },
  },
  // hit_pennant in the corner set; the first room's pennant has a box derived from its mesh.
  {
    proxies: ['hit_pennant', 'hit_pennant_gatech'],
    prop: 'The Georgia Tech pennant',
    label: 'Georgia Tech',
    target: 'about',
    href: '/about',
    card: { line: 'Where I studied computer science, and stayed on for a master’s.' },
  },
  {
    proxies: ['hit_espresso'],
    prop: 'The espresso machine',
    label: 'Espresso machine',
    target: null,
    fly: 'espresso',
    action: 'espresso',
    href: '/',
    card: { line: 'It pulls a shot each time you click it.' },
  },
  {
    proxies: ['hit_oven'],
    prop: 'The countertop oven',
    label: 'Oven',
    target: 'recipes',
    fly: 'oven',
    action: 'oven',
    href: '/#recipes',
    card: { line: 'The door opens on my recipes.' },
  },
  {
    proxies: ['hit_croissant'],
    prop: 'The croissant in the oven',
    label: 'Kitchen',
    target: 'recipes',
    fly: 'oven',
    href: '/#recipes',
    card: { title: 'Croissant', line: 'The recipe is with the others: croissants, bagels, cinnamon rolls, ratatouille.' },
  },
  { proxies: ['hit_lava_lamp'], prop: 'The lava lamp', label: 'Lava lamp', target: null, action: 'lava', href: '/' },
  { proxies: ['hit_record_player'], prop: 'The record player', label: 'Records', target: null, fly: 'record_player', action: 'records', href: '/' },
  ...posters,
  {
    proxies: ['hit_plaque'],
    prop: 'The plaque under the posters',
    label: 'Four favourites',
    target: 'films/favourites',
    href: '/films#favourites',
    card: { line: 'The four favourites at the top of my Letterboxd profile.' },
  },
  {
    proxies: ['hit_darkroom'],
    prop: 'The darkroom line',
    label: 'Photographs',
    target: 'photography',
    fly: 'photos',
    href: '/#photography',
    card: { line: 'Prints from my film and digital cameras.' },
  },
  ...prints,
  ...notes,
];

const byProxy = new Map(HOTSPOTS.flatMap((hotspot) => hotspot.proxies.map((proxy) => [proxy, hotspot] as const)));

export const hotspotForProxy = (proxyName: string) => byProxy.get(proxyName);
