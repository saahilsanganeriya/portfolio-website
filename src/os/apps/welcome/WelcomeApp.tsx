import type { ReactNode } from 'react';
import { PixelIcon } from '../../assets/PixelIcon';
import type { AppId, OsApi, OsMePhoto } from '../../types';
import { APPS } from '../registry';

// The ways in, as on Henry Heffernan's showcase: big buttons under the name.
const WAYS_IN: AppId[] = ['projects', 'blog', 'films', 'story', 'photography'];

// Which paragraph each photo from src/content/me.json (use 'opening') belongs beside; a photo not named here is not shown.
const PLACES: Record<string, 'photographs' | 'distance'> = {
  'convertible-camera': 'photographs',
  sphinx: 'distance',
};

/** A small print beside a paragraph; the film tone matches the photos of him on About and in The Thread. */
function Print({ photo, side }: { photo: OsMePhoto; side: 'left' | 'right' }) {
  return (
    <figure className="os-welcome-print" data-side={side}>
      <picture>
        <source type="image/avif" srcSet={photo.avif} sizes="(max-width: 600px) 40vw, 176px" />
        <img
          src={photo.src}
          srcSet={photo.webp}
          sizes="(max-width: 600px) 40vw, 176px"
          width={photo.width}
          height={photo.height}
          alt={photo.alt}
          loading="lazy"
          decoding="async"
        />
      </picture>
      {photo.caption && <figcaption>{photo.caption}</figcaption>}
    </figure>
  );
}

/** The window SaahilOS opens first: who he is, a few lines, and the ways into the rest. */
export function WelcomeApp({ os }: { os: OsApi }) {
  const { headshot, opening } = os.index.me;
  const beside = (place: 'photographs' | 'distance', side: 'left' | 'right'): ReactNode => {
    const photo = opening.find((p) => PLACES[p.file] === place);
    return photo ? <Print photo={photo} side={side} /> : null;
  };

  return (
    <article className="os-welcome">
      <header className="os-welcome-head">
        <img
          className="os-welcome-portrait"
          src={headshot.src}
          srcSet={headshot.srcset}
          sizes="(max-width: 600px) 96px, 136px"
          width={headshot.width}
          height={headshot.height}
          alt={headshot.alt}
        />
        <div>
          <h2 className="os-welcome-name">Saahil Sanganeriya</h2>
          <p className="os-welcome-role">I write software in San Francisco. I cook up code and I cook.</p>
        </div>
      </header>

      <nav className="os-welcome-ways" aria-label="Start here">
        <ul>
          {WAYS_IN.map((id) => (
            <li key={id}>
              <a className="os-welcome-way" href={`#${id}`}>
                <PixelIcon name={APPS[id].icon} size={32} />
                <span>{APPS[id].label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="os-welcome-text">
        <p>Welcome. This computer sits on the desk in my room, and everything I make and write is on it.</p>
        {beside('photographs', 'right')}
        <p>
          I grew up in Delhi and flew to Atlanta at eighteen to study computer science at Georgia Tech. Now I live in
          San Francisco. I take photographs too, and the ones from 2019 hang in{' '}
          <a href="#photography">A Narrative in a Frame</a>.
        </p>
        {beside('distance', 'left')}
        <p>
          I love movies about making greatness happen, and I want my own work to be big enough to have been worth the
          distance.
        </p>
        <p>
          <a href="#story">The Thread</a> tells the longer story, from my father’s spinning mill to here. The little oven
          on the desktop holds <a href="#oven">what I am building right now</a>.
        </p>
      </div>
    </article>
  );
}
