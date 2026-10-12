import { useEffect, useState } from 'react';
import type { FilmEntry, FilmsData } from '../../lib/films';
import { formatDay } from '../format';
import type { OsApi, OsFavourite } from '../types';
import { useWindowStatus } from '../wm/Window';
import { renderFilmCard } from './films/cards';
import { DIARY_CARDS, latestEntry, windowDiary } from './films/diary';

const isFilmsData = (value: unknown): value is FilmsData =>
  typeof value === 'object' && value !== null && Array.isArray((value as FilmsData).entries);

type Source = 'loading' | 'live' | 'saved';

// The live diary (/api/films.json, refreshed at most hourly on the server); the build's copy stands in when it fails.
function useFilms(saved: FilmsData, favourites: OsFavourite[]): { films: FilmsData; source: Source } {
  const [state, setState] = useState<{ films: FilmsData; source: Source }>({ films: saved, source: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/films.json', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (isFilmsData(data) && data.entries.length > 0)
          setState({ films: windowDiary(data, favourites), source: 'live' });
        else setState((s) => ({ ...s, source: 'saved' }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, source: 'saved' }));
      });
    return () => controller.abort();
  }, [favourites]);
  return state;
}

// The visitor's own clock, in the day-month-year order the rest of SaahilOS uses.
const fetchedTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

function Card({ entry, id }: { entry: FilmEntry; id?: string }) {
  return (
    <a
      id={id}
      className="os-film-card"
      href={entry.url}
      target="_blank"
      rel="noopener"
      dangerouslySetInnerHTML={{ __html: renderFilmCard(entry) }}
    />
  );
}

// A favourite hangs as its poster when the room has art for it, else as a typographic card with its latest rating.
function Favourite({ film, entry }: { film: OsFavourite; entry?: FilmEntry }) {
  const url = entry?.url ?? `https://letterboxd.com/film/${film.slug}/`;
  return (
    <>
      {film.poster ? (
        <a id={`film-${film.slug}`} className="os-film-card" href={url} target="_blank" rel="noopener">
          <img
            src={film.poster}
            alt={`${film.title}, ${film.year}: the poster designed for the room`}
            width={200}
            height={300}
            loading="lazy"
            decoding="async"
          />
        </a>
      ) : (
        <Card
          id={`film-${film.slug}`}
          entry={{
            title: film.title,
            year: film.year,
            rating: entry?.rating ?? null,
            rewatch: false,
            liked: entry?.liked ?? false,
            watchedDate: entry?.watchedDate ?? '',
            review: null,
            url,
            slug: film.slug,
          }}
        />
      )}
      <p className="os-film-caption">{film.director}</p>
    </>
  );
}

export function FilmsApp({ slug, os }: { slug?: string; os: OsApi }) {
  const { favourites } = os.index;
  const { films, source } = useFilms(os.index.films, favourites);
  const setStatus = useWindowStatus();
  const updatedDay = formatDay(films.fetchedAt.slice(0, 10));

  useEffect(() => {
    setStatus(source === 'live' ? `Updated ${updatedDay} from Letterboxd` : `Saved ${updatedDay}`);
  }, [source, updatedDay, setStatus]);

  // `#films/<slug>` points at one film and `#films/favourites` at the four: bring it into view and focus it.
  useEffect(() => {
    if (!slug) return;
    const target = document.getElementById(`film-${slug}`);
    target?.scrollIntoView({ block: 'nearest' });
    target?.focus({ preventScroll: true });
  }, [slug, films]);

  const favouriteSlugs = new Set(favourites.map((film) => film.slug));
  const favouriteEntries = favourites.map((film) => latestEntry(films.entries, film));
  const pinned = new Set(favouriteEntries.map((entry) => entry?.slug));
  const firstSeen = new Set<string>();

  return (
    <div className="os-films">
      <blockquote className="os-films-epigraph">
        <p>I love movies about making greatness happen.</p>
      </blockquote>

      <section
        id="film-favourites"
        className="os-films-favourites"
        aria-labelledby="os-films-favourites"
        tabIndex={-1}
        data-selected={slug === 'favourites' || undefined}
      >
        <h2 className="os-films-heading" id="os-films-favourites">
          {favourites.length === 4 ? 'My four favourites' : 'My favourites'}
        </h2>
        <p className="os-films-note">
          The favourites on my Letterboxd profile. Their posters hang on the wall of the room.
        </p>
        <ul className="os-film-grid os-film-wall">
          {favourites.map((film, i) => (
            <li key={film.slug} data-selected={film.slug === slug || undefined}>
              <Favourite film={film} entry={favouriteEntries[i]} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="os-films-diary">
        <h2 className="os-films-heading" id="os-films-diary">
          Diary <span className="os-films-heading-aside">— from Letterboxd, updates every hour</span>
        </h2>
        <p className="os-films-note">
          Every film I log, most recent first. The stars are my rating out of five, and ½ is half a star; a card with
          no stars has no rating.
        </p>
        <p className="os-films-note os-films-updated">
          Last updated <time dateTime={films.fetchedAt}>{fetchedTime.format(new Date(films.fetchedAt))}</time>
          {source === 'saved' && '. The live diary did not load, so this is the copy saved with the site.'}
        </p>
        <ul className="os-film-grid">
          {films.entries.slice(0, DIARY_CARDS).map((entry) => {
            // The first diary card of a film that is not a favourite answers `#films/<slug>`.
            const anchor = !favouriteSlugs.has(entry.slug) && !pinned.has(entry.slug) && !firstSeen.has(entry.slug);
            firstSeen.add(entry.slug);
            return (
              <li
                key={`${entry.slug}-${entry.watchedDate}`}
                data-selected={(anchor && entry.slug === slug) || undefined}
              >
                <Card entry={entry} id={anchor ? `film-${entry.slug}` : undefined} />
                {entry.review && <p className="os-film-review">{entry.review}</p>}
              </li>
            );
          })}
        </ul>
        <p className="os-films-note os-films-more">
          Older entries are on the{' '}
          <a href="/films" target="_top">
            Films page
          </a>
          .
        </p>
      </section>
    </div>
  );
}
