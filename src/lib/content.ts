import { getCollection, type CollectionEntry } from 'astro:content';
import { comparePosts } from './post-order';

// Draft posts build in dev, and in production only when SAMPLES=1 (tests and local previews of drafts).
const includeDrafts = import.meta.env.DEV || process.env.SAMPLES === '1';

export async function getPosts(): Promise<CollectionEntry<'blog'>[]> {
  const posts = await getCollection('blog', ({ data }) => includeDrafts || !data.draft);
  return posts.sort((a, b) => comparePosts(a.data, b.data));
}

export async function getProjects(): Promise<{
  featured: CollectionEntry<'projects'>[];
  archive: CollectionEntry<'projects'>[];
}> {
  const projects = await getCollection('projects');
  const featured = projects
    .filter((p) => p.data.featured)
    .sort((a, b) => (a.data.order ?? Infinity) - (b.data.order ?? Infinity) || b.data.year - a.data.year);
  const archive = projects
    .filter((p) => !p.data.featured)
    .sort((a, b) => b.data.year - a.data.year || a.data.title.localeCompare(b.data.title));
  return { featured, archive };
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
