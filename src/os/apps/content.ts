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

/** A JSON file the build writes, as a window sees it while it loads. */
export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'missing' }
  | { state: 'failed'; reason: string };

class MissingContent extends Error {}

// One request per file for the life of the page; the cache holds at most one item per published file.
const requests = new Map<string, Promise<unknown>>();

export function loadJson<T>(url: string): Promise<T> {
  let request = requests.get(url);
  if (!request) {
    request = fetch(url).then(async (response) => {
      if (response.status === 404) throw new MissingContent(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    request.catch(() => requests.delete(url));
    requests.set(url, request);
  }
  return request as Promise<T>;
}

export const loadContent = <T>(collection: string, slug: string): Promise<ContentEntry<T>> =>
  loadJson<ContentEntry<T>>(`/content/${collection}/${slug}.json`);

/** Loads a JSON file the build writes; a 404 means "not published yet", anything else a failure to show. */
export function useJson<T>(url: string): Loaded<T> {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    setResult({ state: 'loading' });
    loadJson<T>(url).then(
      (value) => live && setResult({ state: 'ready', value }),
      (error: unknown) =>
        live &&
        setResult(error instanceof MissingContent ? { state: 'missing' } : { state: 'failed', reason: String(error) }),
    );
    return () => {
      live = false;
    };
  }, [url]);
  return result;
}

/** Window bodies come from the static `/content/<collection>/<slug>.json` files the build writes. */
export function useContent<T>(collection: string, slug: string): ContentState<T> {
  const result = useJson<ContentEntry<T>>(`/content/${collection}/${slug}.json`);
  return result.state === 'ready' ? { state: 'ready', entry: result.value } : result;
}

/** Link attributes for an href inside the OS: links with a window get none (SaahilOS opens it); other sites a new tab. */
export function linkAttributes(href: string): { target?: string; rel?: string } {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  return classifyLink(href, origin).kind === 'external' ? { target: '_blank', rel: 'noopener' } : {};
}

// Rendered Markdown links get the same treatment as the OS's own links.
export function decorateLinks(root: HTMLElement): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const { target, rel } = linkAttributes(anchor.getAttribute('href')!);
    if (target) anchor.target = target;
    if (rel) anchor.rel = rel;
  }
}

// Native lazy loading measures distance to the frame's viewport, so every picture in a window's scroll area loads at
// once. Window HTML keeps its pictures' addresses aside (data-src, data-srcset) until they come near the window's view.
export function deferPictures(html: string): string {
  return html.replace(/<(?:img|source)\b[^>]*>/g, (tag) => tag.replace(/\s(src|srcset)=/g, ' data-$1='));
}

/** Loads each deferred picture under `root` as it nears the visible part of its window; returns a cleanup. */
export function revealPicturesNearView(root: HTMLElement): () => void {
  const reveal = (img: HTMLImageElement) => {
    for (const source of img.parentElement?.matches('picture') ? img.parentElement.querySelectorAll('source') : []) {
      if (source.dataset.srcset) source.srcset = source.dataset.srcset;
    }
    if (img.dataset.srcset) img.srcset = img.dataset.srcset;
    if (img.dataset.src) img.src = img.dataset.src;
  };
  const pending = [...root.querySelectorAll<HTMLImageElement>('img[data-src], img[data-srcset]')];
  if (typeof IntersectionObserver === 'undefined') {
    pending.forEach(reveal);
    return () => {};
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target as HTMLImageElement);
        observer.unobserve(entry.target);
      }
    },
    { root: root.closest('.os-well, .os-phone-body'), rootMargin: '400px 0px' },
  );
  pending.forEach((img) => observer.observe(img));
  return () => observer.disconnect();
}
