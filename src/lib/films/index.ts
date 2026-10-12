import films from '../../content/films.json';
import type { FilmsData } from './merge.ts';

export type { FilmEntry, FilmsData } from './merge.ts';

// The build-time copy (archive + feed at build); /api/films.json serves the live merge.
export const filmsData = films as FilmsData;

// Letterboxd-style stars: 4.5 -> "★★★★½".
export function stars(rating: number): string {
  return '★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : '');
}

export function ratingLabel(rating: number): string {
  return `Rated ${rating} out of 5`;
}
