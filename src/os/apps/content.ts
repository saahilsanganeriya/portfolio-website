import { useEffect, useState } from 'react';
import { classifyLink } from '../routes';

export interface ContentEntry<T> {
  data: T;
  html: string;
}

export type ContentState<T> =
  | { state: 'loading' }
  | { state: 'ready'; entry: ContentEntry<T> }
  | { state: 'missing' }
  | { state: 'failed'; reason: string };

class MissingContent extends Error {}

// One request per entry for the life of the page; the cache holds at most one item per published page.
const requests = new Map<string, Promise<ContentEntry<unknown>>>();

export function loadContent<T>(collection: string, slug: string): Promise<ContentEntry<T>> {
  const key = `${collection}/${slug}`;
  let request = requests.get(key);
  if (!request) {
    request = fetch(`/content/${key}.json`).then(async (response) => {
      if (response.status === 404) throw new MissingContent(key);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as ContentEntry<unknown>;
    });
    request.catch(() => requests.delete(key));
    requests.set(key, request);
  }
  return request as Promise<ContentEntry<T>>;
}

/** Window bodies come from the static `/content/<collection>/<slug>.json` files the build writes. */
export function useContent<T>(collection: string, slug: string): ContentState<T> {
  const [result, setResult] = useState<ContentState<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    setResult({ state: 'loading' });
    loadContent<T>(collection, slug).then(
      (entry) => live && setResult({ state: 'ready', entry }),
      (error: unknown) =>
        live &&
        setResult(error instanceof MissingContent ? { state: 'missing' } : { state: 'failed', reason: String(error) }),
    );
    return () => {
      live = false;
    };
  }, [collection, slug]);
  return result;
}

/** Link attributes for an href inside the OS: other sites open in a new tab, plain pages replace the whole tab. */
export function linkAttributes(href: string): { target?: string; rel?: string } {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const kind = classifyLink(href, origin).kind;
  if (kind === 'external') return { target: '_blank', rel: 'noopener' };
  if (kind === 'top') return { target: '_top' };
  return {};
}

// Rendered Markdown links get the same treatment as the OS's own links.
export function decorateLinks(root: HTMLElement): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const { target, rel } = linkAttributes(anchor.getAttribute('href')!);
    if (target) anchor.target = target;
    if (rel) anchor.rel = rel;
  }
}
