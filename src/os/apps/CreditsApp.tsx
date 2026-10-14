import type { AssetSection } from '../../lib/assets-register';
import { linkAttributes, useJson } from './content';
import { ThreadLoader } from './Reader';

/** Every third-party file on the site with its source and licence (blender/ASSETS.md), and the two sites it builds on. */
export function CreditsApp() {
  const credits = useJson<{ sections: AssetSection[] }>('/content/credits.json');
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
      {credits.state === 'loading' && <ThreadLoader label="Loading the credits" />}
      {(credits.state === 'failed' || credits.state === 'missing') && (
        <p className="os-note">The list did not load. Close and reopen this window.</p>
      )}
      {credits.state === 'ready' &&
        credits.value.sections.map((section) => (
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
