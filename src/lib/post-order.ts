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

export type PostGroup = 'engineering' | 'essays' | 'film';

/** The Writing list's sections in order: the engineering first, then the other essays, then the film notes. */
export const POST_GROUPS: readonly { id: PostGroup; heading: string }[] = [
  { id: 'engineering', heading: 'Engineering' },
  { id: 'essays', heading: 'Essays' },
  { id: 'film', heading: 'Film notes' },
];

export const postGroup = (tags: readonly string[]): PostGroup =>
  tags.includes('engineering') ? 'engineering' : tags.includes('reviews') ? 'film' : 'essays';

const WORDS_PER_MINUTE = 230;

/** Minutes to read a post's Markdown at an unhurried pace; code blocks and MDX imports do not count. */
export function readingMinutes(markdown: string): number {
  const prose = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/^import .*$/gm, ' ');
  const words = prose.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
