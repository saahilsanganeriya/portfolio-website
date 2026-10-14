import type { ReactNode } from 'react';
import type { IconName } from '../assets/icons';
import { formatDay } from '../format';
import { windowHref } from '../routes';
import type { AppId, OsApi, OsIndex, Route } from '../types';
import { AboutApp } from './AboutApp';
import { FilmsApp } from './FilmsApp';
import { BlogApp, ProjectsApp } from './Lists';
import { OvenApp } from './OvenApp';
import { PhotographyApp } from './photography/PhotographyApp';
import { PostReader, ProjectReader } from './Reader';
import { BooksApp, RecipesApp, VoyagerApp } from './ShelfApps';
import { CreditsApp, ResumeApp } from './SmallApps';
import { TerminalApp } from './TerminalApp';

/** Desktop order: About, the work (finished, then in progress), the pictures, then the machine. */
export const APPS: Record<AppId, { label: string; icon: IconName }> = {
  about: { label: 'About', icon: 'about' },
  projects: { label: 'Projects', icon: 'projects' },
  oven: { label: 'In the oven', icon: 'oven' },
  blog: { label: 'Writing', icon: 'page' },
  photography: { label: 'A Narrative in a Frame', icon: 'camera' },
  films: { label: 'Films', icon: 'films' },
  books: { label: 'Books', icon: 'books' },
  recipes: { label: 'Recipes', icon: 'recipes' },
  voyager: { label: 'Voyager Golden Record', icon: 'voyager' },
  terminal: { label: 'Terminal', icon: 'terminal' },
  resume: { label: 'Résumé', icon: 'resume' },
  credits: { label: 'Credits', icon: 'credits' },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface WindowDescription {
  title: string;
  icon: IconName;
  defaultStatus: string;
  shareHref: string | null;
  /** The project's repository, for the window's "View source" button. */
  sourceHref: string | null;
}

export function describeWindow(route: Route, index: OsIndex): WindowDescription {
  const shareHref = windowHref(route);
  const app = APPS[route.app];
  if (route.app === 'projects' && route.slug) {
    const project = index.projects.find((p) => p.slug === route.slug);
    return {
      title: project?.title ?? route.slug,
      icon: 'page',
      defaultStatus: project?.stack.join(', ') ?? '',
      shareHref,
      sourceHref: project?.links.repo ?? null,
    };
  }
  if (route.app === 'blog' && route.slug) {
    const post = index.posts.find((p) => p.slug === route.slug);
    return {
      title: post?.title ?? route.slug,
      icon: 'page',
      defaultStatus: post ? formatDay(post.date) : '',
      shareHref,
      sourceHref: null,
    };
  }
  const defaultStatus: Record<AppId, string> = {
    photography: plural(index.photography.length, 'photograph'),
    projects: plural(index.projects.length, 'project'),
    oven: `${plural(index.oven.items.length, 'thing')} in the oven`,
    blog: plural(index.posts.length, 'post'),
    films: 'Films from the Letterboxd diary',
    books: '',
    recipes: '',
    voyager: '',
    terminal: 'Type help for the commands',
    about: '',
    resume: '',
    credits: 'Every file is used under the licence shown',
  };
  return { title: app.label, icon: app.icon, defaultStatus: defaultStatus[route.app], shareHref, sourceHref: null };
}

export function AppBody({ route, os }: { route: Route; os: OsApi }): ReactNode {
  switch (route.app) {
    case 'photography':
      return <PhotographyApp slug={route.slug} os={os} />;
    case 'projects':
      return route.slug ? <ProjectReader slug={route.slug} os={os} /> : <ProjectsApp os={os} />;
    case 'oven':
      return <OvenApp os={os} />;
    case 'blog':
      return route.slug ? <PostReader slug={route.slug} os={os} /> : <BlogApp os={os} />;
    case 'films':
      return <FilmsApp slug={route.slug} os={os} />;
    case 'books':
      return <BooksApp />;
    case 'recipes':
      return <RecipesApp slug={route.slug} />;
    case 'voyager':
      return <VoyagerApp />;
    case 'terminal':
      return <TerminalApp os={os} />;
    case 'about':
      return <AboutApp os={os} />;
    case 'resume':
      return <ResumeApp os={os} />;
    case 'credits':
      return <CreditsApp os={os} />;
  }
}
