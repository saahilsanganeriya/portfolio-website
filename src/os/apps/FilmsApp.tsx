import { useEffect, useState } from 'react';
import type { FilmEntry, FilmsData } from '../../lib/films';
import { formatDay } from '../format';
import type { OsApi, OsFavourite } from '../types';
import { useWindowStatus } from '../wm/Window';
import { renderFilmCard } from './films/cards';
import { DIARY_CARDS, latestEntry } from './films/diary';

const isFilmsData = (value: unknown): value is FilmsData =>
  typeof value === 'object' && value !== null && Array.isArray((value as FilmsData).entries);

type Source = 'loading' | 'live' | 'saved';

// The live diary (/api/films.json, refreshed at most hourly on the server) carries the whole archive; the build's
// copy (the latest entries plus the favourites) stands in while it loads and when it fails.
function useFilms(saved: FilmsData): { films: FilmsData; source: Source } {
  const [state, setState] = useState<{ films: FilmsData; source: Source }>({ films: saved, source: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/films.json', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (isFilmsData(data) && data.entries.length > 0) setState({ films: data, source: 'live' });
        else setState((s) => ({ ...s, source: 'saved' }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, source: 'saved' }));
      });
    return () => controller.abort();
  }, []);
  return state;
}

// The visitor's own clock, in the day-month-year order the rest of SaahilOS uses.
const fetchedTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
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
  const { films, source } = useFilms(os.index.films);
  const [shown, setShown] = useState(DIARY_CARDS);
  const setStatus = useWindowStatus();

  // The build's copy ends with the favourites' older entries, which belong on the wall, not in the diary.
  const diary = source === 'live' ? films.entries : films.entries.slice(0, DIARY_CARDS);
  const visible = diary.slice(0, shown);

  useEffect(() => {
    setStatus(source === 'live' ? `${visible.length} of ${diary.length} diary entries` : null);
  }, [source, visible.length, diary.length, setStatus]);

  // `#films/<slug>` points at one film and `#films/favourites` at the four: bring it into view and focus it.
  useEffect(() => {
    if (!slug) return;
    const target = document.getElementById(`film-${slug}`);
    target?.scrollIntoView({ block: 'nearest' });
    target?.focus({ preventScroll: true });
  }, [slug, films]);

  const favouriteSlugs = new Set(favourites.map((film) => film.slug));
  const firstSeen = new Set<string>();
  const updated = <time dateTime={films.fetchedAt}>{fetchedTime.format(new Date(films.fetchedAt))}</time>;

  return (
    <div className="os-films">
      <section
        id="film-favourites"
        className="os-films-favourites"
        aria-labelledby="os-films-favourites"
        tabIndex={-1}
        data-selected={slug === 'favourites' || undefined}
      >
        <h2 className="os-films-heading" id="os-films-favourites">
          {favourites.length === 4 ? 'Four favourites' : 'Favourites'}{' '}
          <span className="os-films-heading-aside">— from Letterboxd</span>
        </h2>
        <p className="os-films-note">
          Three films and a series, pinned on my Letterboxd profile. Their posters hang in the room.
        </p>
        <ul className="os-film-grid os-film-wall">
          {favourites.map((film) => (
            <li key={film.slug} data-selected={film.slug === slug || undefined}>
              <Favourite film={film} entry={latestEntry(films.entries, film)} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="os-films-diary">
        <h2 className="os-films-heading" id="os-films-diary">
          Diary <span className="os-films-heading-aside">— from Letterboxd, updates every hour</span>
        </h2>
        <p className="os-films-note">
          Every film I log, newest first, with my rating out of five stars. No stars means I did not rate it.
        </p>
        <p className="os-films-note os-films-updated">
          {source === 'saved' ? (
            <>Letterboxd did not answer. This is the copy saved on {formatDay(films.fetchedAt.slice(0, 10))}.</>
          ) : (
            <>Last updated {updated}, from Letterboxd.</>
          )}
        </p>
        <ul className="os-film-grid">
          {visible.map((entry) => {
            // The first diary card of a film that is not a favourite answers `#films/<slug>`.
            const anchor = !favouriteSlugs.has(entry.slug) && !firstSeen.has(entry.slug);
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
        {visible.length < diary.length && (
          <p className="os-films-more">
            <button type="button" className="os-tool" onClick={() => setShown((n) => n + DIARY_CARDS)}>
              Show older entries
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
