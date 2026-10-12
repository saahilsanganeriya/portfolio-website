import films from '../../content/films.json';
import type { FilmsData } from './merge.ts';

export { ratingLabel, stars } from './format.ts';
export type { FilmEntry, FilmsData } from './merge.ts';

// The build-time copy (archive + feed at build); /api/films.json serves the live merge.
export const filmsData = films as FilmsData;
