// Letterboxd-style stars: 4.5 -> "★★★★½".
export function stars(rating: number): string {
  return '★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : '');
}

export function ratingLabel(rating: number): string {
  return `Rated ${rating} out of 5`;
}
