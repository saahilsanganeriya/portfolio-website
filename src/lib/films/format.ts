// Letterboxd-style stars: 4.5 -> "★★★★½".
export function stars(rating: number): string {
  return '★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : '');
}

export function ratingLabel(rating: number): string {
  return `Rated ${rating} out of 5`;
}

/** One diary row per film and watched day; the page and its client refresh match rows by it. */
export const diaryKey = (film: { slug: string; watchedDate: string }) => `${film.slug}|${film.watchedDate}`;
