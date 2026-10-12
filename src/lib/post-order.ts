export interface PostOrderKey {
  date: Date;
  tags: readonly string[];
  title: string;
}

const kindRank = (tags: readonly string[]) => (tags.includes('essays') ? 0 : tags.includes('reviews') ? 2 : 1);

// Newest first; posts published the same day put essays before reviews, then go by title, so the index never
// opens on a short review.
export function comparePosts(a: PostOrderKey, b: PostOrderKey): number {
  return b.date.valueOf() - a.date.valueOf() || kindRank(a.tags) - kindRank(b.tags) || a.title.localeCompare(b.title);
}
