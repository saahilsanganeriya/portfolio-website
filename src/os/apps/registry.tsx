import type { ReactNode } from 'react';
import type { IconName } from '../assets/icons';
import { formatDay } from '../format';
import { windowHref } from '../routes';
import type { AppId, OsApi, OsIndex, Route } from '../types';
import { FilmsApp } from './FilmsApp';
import { GameApp } from './game/GameApp';
import { BlogApp, ProjectsApp } from './Lists';
import { OvenApp } from './OvenApp';
import { PhotographyApp } from './photography/PhotographyApp';
import { PageReader, PostReader, ProjectReader } from './Reader';
import { CreditsApp, ResumeApp, StoryApp } from './SmallApps';
import { TerminalApp } from './TerminalApp';
import { WelcomeApp } from './welcome/WelcomeApp';

/** Desktop order: the welcome, the work (finished, then in progress), the pictures and the story, then the machine. */
export const APPS: Record<AppId, { label: string; icon: IconName }> = {
  welcome: { label: 'Welcome', icon: 'card' },
  projects: { label: 'Projects', icon: 'projects' },
  oven: { label: 'In the oven', icon: 'oven' },
  blog: { label: 'Writing', icon: 'page' },
  photography: { label: 'A Narrative in a Frame', icon: 'camera' },
  films: { label: 'Films', icon: 'films' },
  story: { label: 'The Thread', icon: 'story' },
  game: { label: 'Daily word', icon: 'tiles' },
  terminal: { label: 'Terminal', icon: 'terminal' },
  about: { label: 'About', icon: 'about' },
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
    welcome: '',
    photography: plural(index.photography.length, 'photograph'),
    game: 'A new word every day',
    projects: plural(index.projects.length, 'project'),
    oven: `${plural(index.oven.items.length, 'thing')} in the oven`,
    blog: plural(index.posts.length, 'post'),
    films: 'Films from the Letterboxd diary',
    story: `${plural(index.story.length, 'chapter')}, playing by itself`,
    terminal: 'Type help for the commands',
    about: '',
    resume: '',
    credits: 'Every file is used under the licence shown',
  };
  return { title: app.label, icon: app.icon, defaultStatus: defaultStatus[route.app], shareHref, sourceHref: null };
}

export function AppBody({ route, os }: { route: Route; os: OsApi }): ReactNode {
  switch (route.app) {
    case 'welcome':
      return <WelcomeApp os={os} />;
    case 'photography':
      return <PhotographyApp slug={route.slug} os={os} />;
    case 'game':
      return <GameApp />;
    case 'projects':
      return route.slug ? <ProjectReader slug={route.slug} os={os} /> : <ProjectsApp os={os} />;
    case 'oven':
      return <OvenApp os={os} />;
    case 'blog':
      return route.slug ? <PostReader slug={route.slug} os={os} /> : <BlogApp os={os} />;
    case 'films':
      return <FilmsApp slug={route.slug} os={os} />;
    case 'story':
      return <StoryApp />;
    case 'terminal':
      return <TerminalApp os={os} />;
    case 'about':
      return <PageReader slug="about" os={os} />;
    case 'resume':
      return <ResumeApp os={os} />;
    case 'credits':
      return <CreditsApp os={os} />;
  }
}
