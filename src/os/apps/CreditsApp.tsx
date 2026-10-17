import type { AssetSection } from '../../lib/assets-register';
import { linkAttributes, useJson } from './content';
import { ThreadLoader } from './Reader';

/** blender/ASSETS.md writes file and node names in backticks: they show as code, never as raw marks. */
function Marked({ text }: { text: string }) {
  return <>{text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>;
}

// A row's use reads as a sentence, unless it starts with a file or node name, which keeps its own case.
const sentence = (text: string) => (text.startsWith('`') ? text : text.charAt(0).toUpperCase() + text.slice(1));

/** Every third-party file on the site with its source and licence (blender/ASSETS.md), and the two sites it builds on. */
export function CreditsApp() {
  const credits = useJson<{ sections: AssetSection[] }>('/content/credits.json');
  const henry = 'https://github.com/henryjeff/portfolio-inner-site';
  const steam = 'https://github.com/henryjeff/portfolio-website/blob/master/src/Application/World/CoffeeSteam.ts';
  const wind = 'https://github.com/brunosimon/folio-2025';
  const alana = 'https://github.com/alanagoyal/alanagoyal';
  const webb = 'https://esawebb.org/images/weic2216b/';
  const ccBy = 'https://creativecommons.org/licenses/by/4.0/';
  return (
    <article className="os-reader os-credits">
      <header className="os-reader-head">
        <h2 className="os-reader-title">Credits</h2>
        <p className="os-reader-lead">
          <a href={henry} {...linkAttributes(henry)}>
            Based on Henry Heffernan's portfolio, heavily edited.
          </a>{' '}
          The steam over the coffee follows his{' '}
          <a href={steam} {...linkAttributes(steam)}>
            CoffeeSteam
          </a>{' '}
          (MIT). The breeze in the room's plants follows{' '}
          <a href={wind} {...linkAttributes(wind)}>
            Bruno Simon's wind in folio-2025
          </a>{' '}
          (MIT). Window addresses and the phone layout follow ideas from{' '}
          <a href={alana} {...linkAttributes(alana)}>
            Alana Goyal's site
          </a>{' '}
          (MIT).
        </p>
        {/* ESA/Webb's terms: the full credit line, unaltered, visible and linked. */}
        <p className="os-reader-meta">
          Wallpaper:{' '}
          <a href={webb} {...linkAttributes(webb)}>
            Pillars of Creation, James Webb Space Telescope
          </a>
          . NASA, ESA, CSA, STScI; J. DePasquale, A. Koekemoer, A. Pagan (STScI).{' '}
          <a href={ccBy} {...linkAttributes(ccBy)}>
            CC BY 4.0
          </a>
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
                  <dt>
                    <Marked text={sentence(row.usedFor)} />
                  </dt>
                  <dd>
                    {row.sourceUrl ? (
                      <a href={row.sourceUrl} {...linkAttributes(row.sourceUrl)}>
                        <Marked text={row.asset} />
                      </a>
                    ) : (
                      <Marked text={row.asset} />
                    )}
                    <span className="os-credits-licence">
                      <Marked text={`${row.author}, ${row.licence}`} />
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
