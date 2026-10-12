import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { formatDay } from '../format';
import type { OsApi, OsPost, OsProject } from '../types';
import { useWindowStatus } from '../wm/Window';
import { decorateLinks, linkAttributes, useContent, type ContentState } from './content';

function Prose({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) decorateLinks(ref.current);
  }, [html]);
  return <div ref={ref} className="os-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The thread drawing across the window while a page loads. */
export function ThreadLoader({ label }: { label: string }) {
  return (
    <div className="os-loading" role="status">
      <span className="os-thread-line" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

function Body<T>({ content, what }: { content: ContentState<T>; what: string }) {
  const setStatus = useWindowStatus();
  useEffect(() => {
    if (content.state === 'loading') setStatus(`Loading ${what}…`);
    else if (content.state === 'ready') setStatus(null);
    else setStatus(content.state === 'missing' ? 'Not published yet' : 'Did not load');
  }, [content.state, what, setStatus]);

  switch (content.state) {
    case 'loading':
      return <ThreadLoader label={`Loading ${what}`} />;
    case 'missing':
      return <p className="os-note">This page is not published yet.</p>;
    case 'failed':
      return (
        <p className="os-note">
          The page did not load ({content.reason}). Check the connection, then close and reopen this window.
        </p>
      );
    case 'ready':
      return <Prose html={content.entry.html} />;
  }
}

const LINK_LABELS: Record<keyof OsProject['links'], string> = {
  repo: 'Source code',
  paper: 'Paper',
  demo: 'Demo',
  page: 'Project page',
  pypi: 'PyPI package',
};

const STATUS_LABELS: Record<OsProject['status'], string> = {
  shipped: 'Shipped',
  research: 'Research',
  archived: 'Archived',
};

export function ProjectReader({ slug, os }: { slug: string; os: OsApi }) {
  const project = os.index.projects.find((p) => p.slug === slug);
  const content = useContent<OsProject>('projects', slug);
  const links = project ? (Object.entries(project.links) as [keyof OsProject['links'], string][]) : [];
  return (
    <article className="os-reader">
      {project && (
        <header className="os-reader-head">
          <h2 className="os-reader-title">{project.title}</h2>
          <p className="os-reader-lead">{project.summary}</p>
          <dl className="os-facts">
            <dt>Year</dt>
            <dd>{project.years ?? project.year}</dd>
            <dt>Status</dt>
            <dd>{STATUS_LABELS[project.status]}</dd>
            <dt>Role</dt>
            <dd>{project.role}</dd>
            <dt>Team</dt>
            <dd>{project.team}</dd>
            <dt>Stack</dt>
            <dd>{project.stack.join(', ')}</dd>
          </dl>
          {links.length > 0 && (
            <ul className="os-reader-links">
              {links.map(([kind, href]) => (
                <li key={kind}>
                  <a href={href} {...linkAttributes(href)}>
                    {LINK_LABELS[kind]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </header>
      )}
      <Body content={content} what={project?.title ?? slug} />
    </article>
  );
}

export function PostReader({ slug, os }: { slug: string; os: OsApi }) {
  const post: OsPost | undefined = os.index.posts.find((p) => p.slug === slug);
  const content = useContent<OsPost>('blog', slug);
  return (
    <article className="os-reader">
      {post && (
        <header className="os-reader-head">
          <h2 className="os-reader-title">{post.title}</h2>
          <p className="os-reader-meta">
            <time dateTime={post.date}>{formatDay(post.date)}</time>
            {post.tags.length > 0 && <span>, filed under {post.tags.join(', ')}</span>}
          </p>
        </header>
      )}
      <Body content={content} what={post?.title ?? slug} />
    </article>
  );
}

export function PageReader({ slug, os, after }: { slug: string; os: OsApi; after?: ReactNode }) {
  const page = os.index.pages.find((p) => p.slug === slug);
  const content = useContent<{ title: string; summary: string }>('pages', slug);
  return (
    <article className="os-reader">
      <header className="os-reader-head">
        <h2 className="os-reader-title">{page?.title ?? (slug === 'resume' ? 'Résumé' : 'About')}</h2>
        {page && <p className="os-reader-lead">{page.summary}</p>}
        {after}
      </header>
      <Body content={content} what={page?.title ?? slug} />
    </article>
  );
}
