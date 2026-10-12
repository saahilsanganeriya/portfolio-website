import { PixelIcon } from '../assets/PixelIcon';
import { formatDay } from '../format';
import type { OsApi, OsProject } from '../types';

interface Row {
  href: string;
  title: string;
  summary: string;
  meta: string;
  metaDateTime?: string;
}

// Win98's "Details" view: one row per file, a name column and a narrow column on the right.
function DetailsList({ heading, metaLabel, rows }: { heading: string; metaLabel: string; rows: Row[] }) {
  return (
    <section className="os-details">
      <h2 className="os-details-heading">
        <span>{heading}</span>
        <span className="os-details-meta-label" aria-hidden="true">
          {metaLabel}
        </span>
      </h2>
      <ul className="os-details-rows">
        {rows.map((row) => (
          <li key={row.href}>
            <a className="os-row" href={row.href}>
              <span className="os-row-name">
                <PixelIcon name="page" size={16} />
                <span>{row.title}</span>
              </span>
              <span className="os-row-meta">
                {row.metaDateTime ? <time dateTime={row.metaDateTime}>{row.meta}</time> : row.meta}
              </span>
              <span className="os-row-summary">{row.summary}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const projectRow = (p: OsProject): Row => ({
  href: `#projects/${p.slug}`,
  title: p.title,
  summary: p.summary,
  meta: p.years ?? String(p.year),
});

export function ProjectsApp({ os }: { os: OsApi }) {
  const featured = os.index.projects.filter((p) => p.featured);
  const archiveYears = new Map<number, OsProject[]>();
  for (const project of os.index.projects.filter((p) => !p.featured)) {
    archiveYears.set(project.year, [...(archiveYears.get(project.year) ?? []), project]);
  }
  if (os.index.projects.length === 0) return <p className="os-note">No project write-ups are published yet.</p>;
  return (
    <div className="os-list">
      {featured.length > 0 && <DetailsList heading="Featured" metaLabel="Year" rows={featured.map(projectRow)} />}
      {[...archiveYears].map(([year, projects]) => (
        <DetailsList key={year} heading={`Archive, ${year}`} metaLabel="Year" rows={projects.map(projectRow)} />
      ))}
    </div>
  );
}

export function BlogApp({ os }: { os: OsApi }) {
  if (os.index.posts.length === 0) return <p className="os-note">No posts are published yet.</p>;
  return (
    <div className="os-list">
      <DetailsList
        heading="Posts, newest first"
        metaLabel="Date"
        rows={os.index.posts.map((post) => ({
          href: `#blog/${post.slug}`,
          title: post.title,
          summary: post.summary,
          meta: formatDay(post.date, 'short'),
          metaDateTime: post.date,
        }))}
      />
    </div>
  );
}
