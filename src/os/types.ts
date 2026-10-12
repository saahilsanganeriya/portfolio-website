import type { AssetSection } from '../lib/assets-register';
import type { FilmsData } from '../lib/films';

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

/** Everything the desktop lists, built at build time by src/pages/os.astro. Window bodies load lazily. */
export interface OsIndex {
  projects: OsProject[];
  posts: OsPost[];
  pages: OsPage[];
  story: OsStoryChapter[];
  films: FilmsData;
  credits: AssetSection[];
}

export const APP_IDS = ['projects', 'blog', 'films', 'story', 'terminal', 'about', 'resume', 'credits'] as const;
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
