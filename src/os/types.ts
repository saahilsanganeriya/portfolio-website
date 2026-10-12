import type { AssetSection } from '../lib/assets-register';
import type { FilmsData } from '../lib/films';

/** A picture made by astro:assets at build time: WebP at several widths, and its intrinsic size. */
export interface OsImage {
  src: string;
  srcset: string;
  width: number;
  height: number;
  alt: string;
}

export interface OsFigure extends OsImage {
  caption: string;
  /** Where the picture comes from, with its licence; the text links to the source. */
  credit: { text: string; url: string };
}

export interface OsProject {
  slug: string;
  title: string;
  summary: string;
  year: number;
  years?: string;
  status: 'shipped' | 'research' | 'archived';
  role: string;
  team: string;
  stack: string[];
  featured: boolean;
  links: { repo?: string; paper?: string; demo?: string; page?: string; pypi?: string };
  cover?: OsImage;
  /** Further pictures shown after the write-up, each with its source in the caption. */
  figures: OsFigure[];
}

export interface OsPost {
  slug: string;
  title: string;
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  summary: string;
  tags: string[];
}

export interface OsPage {
  slug: string;
  title: string;
  summary: string;
}

export interface OsStoryChapter {
  slug: string;
  n: number;
  title: string;
  intertitle: string;
}

/** One of the four favourite films on Letterboxd, whose posters hang in the room. */
export interface OsFavourite {
  slug: string;
  title: string;
  year: number;
  director: string;
  /** Poster art designed for the room, when it exists; otherwise the Films app draws a typographic card. */
  poster: string | null;
}

export interface OvenItem {
  title: string;
  note: string;
  link?: string;
}

/** What is being built right now (src/content/oven.json). */
export interface OvenList {
  items: OvenItem[];
  /** Calendar day, YYYY-MM-DD. */
  updated: string;
}

export interface OsWallpaper {
  avif: string;
  webp: string;
  src: string;
}

/** Everything the desktop lists, built at build time by src/pages/os.astro. Window bodies load lazily. */
export interface OsIndex {
  projects: OsProject[];
  posts: OsPost[];
  pages: OsPage[];
  story: OsStoryChapter[];
  films: FilmsData;
  favourites: OsFavourite[];
  oven: OvenList;
  credits: AssetSection[];
  wallpaper: OsWallpaper;
}

export const APP_IDS = ['projects', 'oven', 'blog', 'films', 'story', 'terminal', 'about', 'resume', 'credits'] as const;
export type AppId = (typeof APP_IDS)[number];

/** A window address, written `<app>` or `<app>/<slug>` in the hash and in `open` messages. */
export interface Route {
  app: AppId;
  slug?: string;
}

export interface OsApi {
  index: OsIndex;
  embedded: boolean;
  phone: boolean;
  open: (target: string) => void;
}
