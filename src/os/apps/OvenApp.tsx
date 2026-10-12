import { formatDay } from '../format';
import type { OsApi } from '../types';
import { linkAttributes } from './content';

// A link reads as where it goes: a path on this site, or the other site's address without the scheme.
const linkLabel = (href: string) =>
  href.startsWith('/') ? 'Read about it' : href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/** What is being built right now, from src/content/oven.json. */
export function OvenApp({ os }: { os: OsApi }) {
  const { items, updated } = os.index.oven;
  return (
    <article className="os-reader os-oven">
      <header className="os-reader-head">
        <h2 className="os-reader-title">In the oven</h2>
        <p className="os-reader-lead">What I am building right now.</p>
        <p className="os-reader-meta">
          Updated <time dateTime={updated}>{formatDay(updated)}</time>
        </p>
      </header>
      <ul className="os-oven-list">
        {items.map((item) => (
          <li key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.note}</p>
            {item.link && (
              <p className="os-reader-links">
                <a href={item.link} {...linkAttributes(item.link)}>
                  {linkLabel(item.link)}
                </a>
              </p>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}
