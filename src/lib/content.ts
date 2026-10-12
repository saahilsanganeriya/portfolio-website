import { getCollection, type CollectionEntry } from 'astro:content';

// Draft posts build in dev, and in production only when SAMPLES=1 (tests and local previews of the samples).
const includeDrafts = import.meta.env.DEV || process.env.SAMPLES === '1';

export async function getPosts(): Promise<CollectionEntry<'blog'>[]> {
  const posts = await getCollection('blog', ({ data }) => includeDrafts || !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
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

export function groupByYear<T>(items: readonly T[], yearOf: (item: T) => number): [number, T[]][] {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const year = yearOf(item);
    const group = groups.get(year);
    if (group) group.push(item);
    else groups.set(year, [item]);
  }
  return [...groups.entries()];
}

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Frontmatter dates are calendar days parsed as UTC midnight, so format them in UTC to keep the day.
export function formatDate(date: Date, style: 'long' | 'short' = 'long'): string {
  return (style === 'long' ? longDate : shortDate).format(date);
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
