import { useEffect, useState } from 'react';
import type { FilmEntry, FilmsData } from '../../lib/films';
import { formatDay } from '../format';
import type { OsApi } from '../types';
import { useWindowStatus } from '../wm/Window';
import { renderFilmCard } from './films/cards';
import { DIARY_CARDS, windowDiary } from './films/diary';

const isFilmsData = (value: unknown): value is FilmsData =>
  typeof value === 'object' && value !== null && Array.isArray((value as FilmsData).entries);

// The live diary (/api/films.json, refreshed at most hourly on the server); the build's copy stands in when it fails.
function useFilms(saved: FilmsData): { films: FilmsData; live: boolean } {
  const [state, setState] = useState({ films: saved, live: false });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/films.json', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (isFilmsData(data) && data.entries.length > 0) setState({ films: windowDiary(data), live: true });
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return state;
}

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

export function FilmsApp({ slug, os }: { slug?: string; os: OsApi }) {
  const { films, live } = useFilms(os.index.films);
  const setStatus = useWindowStatus();
  const updated = formatDay(films.fetchedAt.slice(0, 10));

  useEffect(() => {
    setStatus(live ? `Updated ${updated} from Letterboxd` : `Saved ${updated}`);
  }, [live, films, updated, setStatus]);

  // `#films/<slug>` points at one film: bring its card into view and give it focus.
  useEffect(() => {
    if (!slug) return;
    const card = document.getElementById(`film-${slug}`);
    card?.scrollIntoView({ block: 'nearest' });
    card?.focus({ preventScroll: true });
  }, [slug, films]);

  const wall = films.posters
    .map((poster) => films.entries.find((entry) => entry.slug === poster))
    .filter((entry): entry is FilmEntry => entry !== undefined);
  const onWall = new Set(wall.map((entry) => entry.slug));
  const firstSeen = new Set<string>();

  return (
    <div className="os-films">
      {wall.length > 0 && (
        <section aria-labelledby="os-films-wall">
          <h2 className="os-films-heading" id="os-films-wall">
            On the wall
          </h2>
          <p className="os-films-note">The four films whose posters hang in the room.</p>
          <ul className="os-film-grid os-film-wall">
            {wall.map((entry) => (
              <li key={entry.slug} data-selected={entry.slug === slug || undefined}>
                <Card entry={entry} id={`film-${entry.slug}`} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="os-films-diary">
        <h2 className="os-films-heading" id="os-films-diary">
          Diary
        </h2>
        <p className="os-films-note">
          Most recent first, from{' '}
          <a href={films.profile} target="_blank" rel="noopener">
            Letterboxd
          </a>
          .
        </p>
        <ul className="os-film-grid">
          {films.entries.slice(0, DIARY_CARDS).map((entry) => {
            // The first diary card of a film not on the wall answers `#films/<slug>`.
            const anchor = !onWall.has(entry.slug) && !firstSeen.has(entry.slug);
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
