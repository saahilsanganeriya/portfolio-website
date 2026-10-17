import { useEffect, useRef } from 'react';
import { formatDay } from '../../format';
import type { OsApi, OsPhotograph, OsPicture } from '../../types';
import { useWindowStatus } from '../../wm/Window';

function Picture({ picture, alt, sizes, eager = false }: { picture: OsPicture; alt: string; sizes: string; eager?: boolean }) {
  return (
    <picture>
      <source type="image/avif" srcSet={picture.avif} sizes={sizes} />
      <img
        src={picture.src}
        srcSet={picture.webp}
        sizes={sizes}
        width={picture.width}
        height={picture.height}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </picture>
  );
}

const placeAndYear = (photo: OsPhotograph) => (photo.place ? `${photo.place}, ${photo.year}` : String(photo.year));

function Prints({ photos, large = false }: { photos: OsPhotograph[]; large?: boolean }) {
  return (
    <ul className="os-prints" data-large={large || undefined}>
      {photos.map((photo) => (
        <li key={photo.slug}>
          <a className="os-print" href={`#photography/${photo.slug}`}>
            <span className="os-print-paper">
              <Picture picture={photo.thumb} alt="" sizes={large ? '260px' : '180px'} />
            </span>
            <span className="os-print-title">{photo.title}</span>
            <span className="os-print-year">{placeAndYear(photo)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// The exhibit: the whole set in its one order, the same as the prints on the darkroom line in the room.
function Browse({ photos }: { photos: OsPhotograph[] }) {
  if (photos.length === 0) return <p className="os-note">No photographs are published yet.</p>;
  return (
    <div className="os-darkroom">
      <p className="os-darkroom-intro">Photographs I have taken. Open one to see it large, with its title and a line about it.</p>
      <Prints photos={photos} large />
    </div>
  );
}

function Photograph({ photo, photos }: { photo: OsPhotograph; photos: OsPhotograph[] }) {
  const setStatus = useWindowStatus();
  const articleRef = useRef<HTMLElement>(null);
  const at = photos.indexOf(photo);
  const previous = photos[(at - 1 + photos.length) % photos.length];
  const next = photos[(at + 1) % photos.length];

  useEffect(() => {
    setStatus(`${at + 1} of ${photos.length}`);
    return () => setStatus(null);
  }, [at, photos.length, setStatus]);

  // A new photograph starts at the top of the window, wherever the last one was scrolled to.
  useEffect(() => {
    articleRef.current?.closest('.os-well, .os-phone-body')?.scrollTo(0, 0);
  }, [photo.slug]);

  return (
    <article className="os-darkroom os-photo" ref={articleRef}>
      <figure className="os-photo-figure">
        <Picture picture={photo.full} alt={photo.caption} sizes="(max-width: 900px) 100vw, 820px" eager />
      </figure>
      <div className="os-photo-text">
        <h2 className="os-photo-title">{photo.title}</h2>
        <p className="os-photo-meta">
          {photo.date ? (
            <>
              {photo.place ? `${photo.place}, ` : ''}
              <time dateTime={photo.date}>{formatDay(photo.date)}</time>
            </>
          ) : (
            placeAndYear(photo)
          )}
        </p>
        <p className="os-photo-caption">{photo.caption}</p>
        {photo.igCaption && (
          <blockquote className="os-photo-ig">
            <p>{photo.igCaption}</p>
            <footer>My caption on Instagram</footer>
          </blockquote>
        )}
      </div>
      <nav className="os-photo-nav" aria-label="Photographs">
        <a className="os-tool" href={`#photography/${previous.slug}`}>
          ‹ Previous
        </a>
        <a className="os-tool" href={`#photography/${next.slug}`}>
          Next ›
        </a>
        <a className="os-tool" href="#photography">
          All photographs
        </a>
      </nav>
    </article>
  );
}

/** 'A Narrative in a Frame': his photographs in the set's order; `#photography/<slug>` opens one. */
export function PhotographyApp({ slug, os }: { slug?: string; os: OsApi }) {
  const photos = os.index.photography;
  const photo = slug ? photos.find((p) => p.slug === slug) : undefined;
  return photo ? <Photograph photo={photo} photos={photos} /> : <Browse photos={photos} />;
}
