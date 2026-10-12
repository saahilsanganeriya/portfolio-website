import films from '../content/films.json';

export interface FilmEntry {
  title: string;
  year: number;
  rating: number | null;
  rewatch: boolean;
  liked: boolean;
  watchedDate: string;
  review: string | null;
  url: string;
  slug: string;
}

export interface FilmsData {
  fetchedAt: string;
  profile: string;
  entries: FilmEntry[];
  posters: string[];
}

export const filmsData = films as FilmsData;

// Letterboxd-style stars: 4.5 -> "★★★★½".
export function stars(rating: number): string {
  return '★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : '');
}

export function ratingLabel(rating: number): string {
  return `Rated ${rating} out of 5`;
}
