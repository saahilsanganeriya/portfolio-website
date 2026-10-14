import { PixelIcon } from '../assets/PixelIcon';
import { formatDay } from '../format';
import type { OsApi, OsImage, OsProject, OsProjectCard } from '../types';

export interface Row {
  href: string;
  title: string;
  summary: string;
  meta: string;
  metaDateTime?: string;
  /** Present on rows that show a picture: the cover, or null for a project with none. */
  thumb?: OsImage | null;
  /** In place of a missing picture: the project's one number, set as type. */
  card?: OsProjectCard;
}

// The row's link text names the project, so its picture is decorative here (alt="").
function Thumb({ image, card, large }: { image: OsImage | null; card?: OsProjectCard; large: boolean }) {
  if (!image && card)
    return (
      <span className="os-thumb os-thumb-card">
        <strong>{card.figure}</strong> <span>{card.caption}</span>
      </span>
    );
  if (image)
    return (
      <span className="os-thumb">
        <img
          src={image.src}
          srcSet={image.srcset}
          sizes={large ? '128px' : '48px'}
          width={image.width}
          height={image.height}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  return (
    <span className="os-thumb os-thumb-empty">
      {large ? 'No public pictures' : <PixelIcon name="page" size={16} />}
    </span>
  );
}

// Win98's "Details" view: one row per file, a name column and a narrow column on the right. Featured projects
// use the "Thumbnails" variant: a framed picture on the left of each row.
export function DetailsList({
  heading,
  metaLabel,
  rows,
  large = false,
}: {
  heading: string;
  metaLabel: string;
  rows: Row[];
  large?: boolean;
}) {
  return (
    <section className="os-details" data-large={large || undefined}>
      <h2 className="os-details-heading">
        <span>{heading}</span>
        <span className="os-details-meta-label" aria-hidden="true">
          {metaLabel}
        </span>
      </h2>
      <ul className="os-details-rows">
        {rows.map((row) => (
          <li key={row.href}>
            <a className="os-row" href={row.href} data-thumb={row.thumb !== undefined || undefined}>
              {row.thumb !== undefined && <Thumb image={row.thumb} card={row.card} large={large} />}
              <span className="os-row-name">
                {row.thumb === undefined && <PixelIcon name="page" size={16} />}
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
  thumb: p.cover ?? null,
  card: p.card,
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
      {featured.length > 0 && (
        <DetailsList heading="Featured" metaLabel="Year" rows={featured.map(projectRow)} large />
      )}
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
