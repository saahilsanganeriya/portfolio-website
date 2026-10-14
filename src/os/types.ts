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

/** A picture with AVIF and WebP source sets built from sizes ingested ahead of time (photographs, photos of the owner). */
export interface OsPicture {
  avif: string;
  webp: string;
  src: string;
  width: number;
  height: number;
}

/** One of the owner's photographs (src/content/photography). */
export interface OsPhotograph {
  slug: string;
  title: string;
  year: number;
  place?: string;
  series: string;
  /** One line in his voice; also the picture's alt text. */
  caption: string;
  /** Calendar day, YYYY-MM-DD, when known. */
  date?: string;
  /** His own Instagram caption for the photograph, as posted. */
  igCaption?: string;
  featured: boolean;
  /** Small sizes for the browse view; the full set loads only when a photograph is opened. */
  thumb: OsPicture;
  full: OsPicture;
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

/** One of the books on the shelf (src/content/books.json, served at /content/books.json). */
export interface OsBook {
  title: string;
  author: string;
  year: number;
  /** One line in his voice. */
  line: string;
}

/** A plain ingredient line, or a group of them under a heading ("For the dough"). */
export type OsIngredient = string | { group: string; items: string[] };

/** A recipe's header and ingredients (/content/recipes.json); its method and notes are the body. */
export interface OsRecipe {
  slug: string;
  title: string;
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  summary: string;
  yield: string;
  time: string;
  ingredients: OsIngredient[];
  photo: OsImage | null;
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
  films: FilmsData;
  favourites: OsFavourite[];
  oven: OvenList;
  credits: AssetSection[];
  wallpaper: OsWallpaper;
  /** The About window's portrait (his professional headshot); the photos beside its text come with the page body. */
  me: { portrait: OsImage };
  /** Ordered: featured first, then by series and `order`. */
  photography: OsPhotograph[];
}

export const APP_IDS = [
  'about',
  'projects',
  'code',
  'oven',
  'blog',
  'photography',
  'films',
  'books',
  'recipes',
  'voyager',
  'personal',
  'terminal',
  'resume',
  'credits',
  'browser',
] as const;
export type AppId = (typeof APP_IDS)[number];

/** The desktop and the phone's home screen: the work first, the personal windows in one folder, then the machine. */
export const DESKTOP_APPS: readonly AppId[] = ['about', 'projects', 'blog', 'code', 'resume', 'oven', 'personal', 'terminal', 'credits'];
/** What the Personal folder holds; the room's props open each of these directly too. */
export const PERSONAL_APPS: readonly AppId[] = ['films', 'photography', 'books', 'recipes', 'voyager'];

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
