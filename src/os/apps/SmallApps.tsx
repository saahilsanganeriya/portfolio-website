import type { OsApi } from '../types';
import { linkAttributes } from './content';
import { PageReader } from './Reader';

// The reel always autoplays in a window (it pauses with its own control); /story itself is scroll-driven.
export function StoryApp() {
  return <iframe className="os-story-frame" src="/story?embed=1#autoplay" title="A Narrative in a Frame, the story reel" />;
}

export const RESUME_PDF = '/resume/saahil-sanganeriya-resume.pdf';

export function ResumeApp({ os }: { os: OsApi }) {
  return (
    <PageReader
      slug="resume"
      os={os}
      after={
        <p className="os-reader-links">
          <a href={RESUME_PDF} {...linkAttributes(RESUME_PDF)}>
            Download the PDF
          </a>
        </p>
      }
    />
  );
}

export function CreditsApp({ os }: { os: OsApi }) {
  const henry = 'https://github.com/henryjeff/portfolio-inner-site';
  const alana = 'https://github.com/alanagoyal/alanagoyal';
  return (
    <article className="os-reader os-credits">
      <header className="os-reader-head">
        <h2 className="os-reader-title">Credits</h2>
        <p className="os-reader-lead">
          <a href={henry} {...linkAttributes(henry)}>
            Based on Henry Heffernan's portfolio, heavily edited.
          </a>{' '}
          Window addresses and the phone layout follow ideas from{' '}
          <a href={alana} {...linkAttributes(alana)}>
            Alana Goyal's site
          </a>{' '}
          (MIT).
        </p>
      </header>
      {os.index.credits.map((section) => (
        <section key={section.title} className="os-credits-section">
          <h3>{section.title}</h3>
          <dl>
            {section.rows.map((row) => (
              <div key={`${row.asset}-${row.usedFor}`} className="os-credits-row">
                <dt>{row.usedFor}</dt>
                <dd>
                  {row.sourceUrl ? (
                    <a href={row.sourceUrl} {...linkAttributes(row.sourceUrl)}>
                      {row.asset}
                    </a>
                  ) : (
                    row.asset
                  )}
                  <span className="os-credits-licence">
                    {row.author}, {row.licence}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </article>
  );
}
