import { lazy, Suspense, type ReactNode } from 'react';
import type { IconName } from '../assets/icons';
import { formatDay } from '../format';
import { windowHref } from '../routes';
import { PERSONAL_APPS, type AppId, type OsApi, type OsIndex, type Route } from '../types';
import { AboutApp } from './AboutApp';
import { FolderApp } from './FolderApp';
import { parseCodeSlug } from './code/model';
import { BlogApp, ProjectsApp } from './Lists';
import { OvenApp } from './OvenApp';
import { PostReader, ProjectReader, ThreadLoader } from './Reader';
import { ResumeApp } from './SmallApps';

/** Every window's name and icon; the desktop shows DESKTOP_APPS (types.ts), the Start menu all but the browser. */
export const APPS: Record<AppId, { label: string; icon: IconName }> = {
  about: { label: 'About', icon: 'about' },
  projects: { label: 'Projects', icon: 'projects' },
  code: { label: 'Code', icon: 'code' },
  oven: { label: 'In the oven', icon: 'oven' },
  blog: { label: 'Writing', icon: 'page' },
  photography: { label: 'A Narrative in a Frame', icon: 'camera' },
  films: { label: 'Films', icon: 'films' },
  books: { label: 'Books', icon: 'books' },
  recipes: { label: 'Recipes', icon: 'recipes' },
  voyager: { label: 'Voyager Golden Record', icon: 'voyager' },
  personal: { label: 'Personal', icon: 'folder' },
  terminal: { label: 'Terminal', icon: 'terminal' },
  resume: { label: 'Résumé', icon: 'resume' },
  credits: { label: 'Credits', icon: 'credits' },
  browser: { label: 'Browser', icon: 'browser' },
};

// Windows a visit does not open at boot load when first opened, so the OS's first load holds About and the desktop.
const CodeApp = lazy(() => import('./code/CodeApp'));
const FilmsApp = lazy(() => import('./FilmsApp').then((m) => ({ default: m.FilmsApp })));
const PhotographyApp = lazy(() => import('./photography/PhotographyApp').then((m) => ({ default: m.PhotographyApp })));
const TerminalApp = lazy(() => import('./TerminalApp').then((m) => ({ default: m.TerminalApp })));
const BrowserApp = lazy(() => import('./BrowserApp').then((m) => ({ default: m.BrowserApp })));
const CreditsApp = lazy(() => import('./CreditsApp').then((m) => ({ default: m.CreditsApp })));
const BooksApp = lazy(() => import('./ShelfApps').then((m) => ({ default: m.BooksApp })));
const RecipesApp = lazy(() => import('./ShelfApps').then((m) => ({ default: m.RecipesApp })));
const VoyagerApp = lazy(() => import('./ShelfApps').then((m) => ({ default: m.VoyagerApp })));

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
  if (route.app === 'code' && route.slug) {
    const code = parseCodeSlug(route.slug);
    return { title: code?.repo ?? 'Code', icon: 'code', defaultStatus: '', shareHref, sourceHref: null };
  }
  if (route.app === 'browser') {
    let host = 'Browser';
    try {
      host = route.slug ? new URL(route.slug).hostname : host;
    } catch {
      // not a URL: the window says so
    }
    return { title: host, icon: 'browser', defaultStatus: route.slug ?? '', shareHref: null, sourceHref: null };
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
    code: '',
    oven: `${plural(index.oven.items.length, 'thing')} in the oven`,
    blog: plural(index.posts.length, 'post'),
    films: 'Films from the Letterboxd diary',
    books: '',
    recipes: '',
    voyager: '',
    personal: `${PERSONAL_APPS.length} items`,
    terminal: 'Type help for the commands',
    about: '',
    resume: '',
    credits: 'Every file is used under the licence shown',
    browser: '',
  };
  return { title: app.label, icon: app.icon, defaultStatus: defaultStatus[route.app], shareHref, sourceHref: null };
}

export function AppBody({ route, os }: { route: Route; os: OsApi }): ReactNode {
  return (
    <Suspense fallback={<ThreadLoader label={`Loading ${APPS[route.app].label}`} />}>
      <AppContent route={route} os={os} />
    </Suspense>
  );
}

function AppContent({ route, os }: { route: Route; os: OsApi }): ReactNode {
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
      return <CreditsApp />;
    case 'code':
      return <CodeApp slug={route.slug} />;
    case 'browser':
      return <BrowserApp url={route.slug} />;
    case 'personal':
      return <FolderApp apps={PERSONAL_APPS} label="Personal" />;
  }
}
