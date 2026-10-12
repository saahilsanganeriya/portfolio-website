// PLAN 3.7: every clickable thing in the room, its SaahilOS target, and the plain page it mirrors.
// The room zooms into the monitor and opens `target` there; the home page lists the same entries as real links.

export interface Hotspot {
  /** Proxy boxes in room.glb (PLAN 3.6) that open this hotspot. The monitor has none: it is the iframe itself. */
  proxies: readonly string[];
  /** What it is in the room. */
  prop: string;
  /** What it opens. */
  label: string;
  /** SaahilOS window to open (`<app>[/<slug>]`), or null to only zoom into the monitor. */
  target: string | null;
  href: string;
}

const POSTERS = [
  { id: 'the-odyssey-2026', title: 'The Odyssey' },
  { id: 'la-la-land', title: 'La La Land' },
  { id: 'chungking-express', title: 'Chungking Express' },
  { id: 'marty-supreme', title: 'Marty Supreme' },
] as const;

export const HOTSPOTS: readonly Hotspot[] = [
  { proxies: [], prop: 'The monitor', label: 'SaahilOS', target: null, href: '/os' },
  {
    proxies: ['hit_fujifilm_a', 'hit_fujifilm_b', 'hit_fujifilm_c'],
    prop: 'The Fujifilm cameras',
    label: 'A Narrative in a Frame',
    target: 'story',
    href: '/story',
  },
  { proxies: ['hit_super8'], prop: 'The Super 8 camera', label: 'Play the story reel', target: 'story', href: '/story' },
  // The screen's proxy is made at runtime (RoomModel's SCREEN_PROXY): the reel playing on it opens Films too.
  { proxies: ['hit_projector', 'hit_projector_screen'], prop: 'The projector', label: 'Films', target: 'films', href: '/films' },
  ...POSTERS.map(({ id, title }) => ({
    proxies: [`hit_poster_${id}`],
    prop: `The ${title} poster`,
    label: title,
    target: `films/${id}`,
    href: `/films#${id}`,
  })),
  { proxies: ['hit_nas'], prop: 'The NAS', label: 'Terminal', target: 'terminal', href: '/os#terminal' },
  { proxies: ['hit_mango'], prop: 'The mango plant', label: 'About', target: 'about', href: '/about' },
];

const byProxy = new Map(HOTSPOTS.flatMap((hotspot) => hotspot.proxies.map((proxy) => [proxy, hotspot] as const)));

export const hotspotForProxy = (proxyName: string) => byProxy.get(proxyName);
