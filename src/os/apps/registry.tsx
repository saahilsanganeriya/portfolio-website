import type { ReactNode } from 'react';
import type { IconName } from '../assets/icons';
import { formatDay } from '../format';
import { plainHref } from '../routes';
import type { AppId, OsApi, OsIndex, Route } from '../types';
import { FilmsApp } from './FilmsApp';
import { BlogApp, ProjectsApp } from './Lists';
import { PageReader, PostReader, ProjectReader } from './Reader';
import { CreditsApp, ResumeApp, StoryApp } from './SmallApps';
import { TerminalApp } from './TerminalApp';

/** Desktop order: the work first, then the story, then the machine itself. */
export const APPS: Record<AppId, { label: string; icon: IconName }> = {
  projects: { label: 'Projects', icon: 'projects' },
  blog: { label: 'Blog', icon: 'page' },
  films: { label: 'Films', icon: 'films' },
  story: { label: 'A Narrative in a Frame', icon: 'story' },
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
  pageHref: string | null;
}

export function describeWindow(route: Route, index: OsIndex): WindowDescription {
  const pageHref = plainHref(route);
  const app = APPS[route.app];
  if (route.app === 'projects' && route.slug) {
    const project = index.projects.find((p) => p.slug === route.slug);
    return {
      title: project?.title ?? route.slug,
      icon: 'page',
      defaultStatus: project?.stack.join(', ') ?? '',
      pageHref,
    };
  }
  if (route.app === 'blog' && route.slug) {
    const post = index.posts.find((p) => p.slug === route.slug);
    return {
      title: post?.title ?? route.slug,
      icon: 'page',
      defaultStatus: post ? formatDay(post.date) : '',
      pageHref,
    };
  }
  const defaultStatus: Record<AppId, string> = {
    projects: plural(index.projects.length, 'project'),
    blog: plural(index.posts.length, 'post'),
    films: plural(index.films.entries.length, 'film'),
    story: 'Plays by itself; pause it at any time',
    terminal: 'Type help for the commands',
    about: '',
    resume: '',
    credits: 'Every file is used under the licence shown',
  };
  return { title: app.label, icon: app.icon, defaultStatus: defaultStatus[route.app], pageHref };
}

export function AppBody({ route, os }: { route: Route; os: OsApi }): ReactNode {
  switch (route.app) {
    case 'projects':
      return route.slug ? <ProjectReader slug={route.slug} os={os} /> : <ProjectsApp os={os} />;
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
