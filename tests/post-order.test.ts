import { describe, expect, it } from 'vitest';
import { comparePosts, readingMinutes } from '../src/lib/post-order.ts';

const post = (title: string, date: string, tags: string[]) => ({ title, date: new Date(`${date}T00:00:00Z`), tags });

describe('post order', () => {
  // Catches the writing index opening on a short review when essays and reviews share a publish day, and a
  // tag rank that overrides the newest-first order across days.
  it('sorts newest first, then essays before reviews on the same day, then by title', () => {
    const posts = [
      post('Babylon', '2026-10-12', ['film', 'reviews']),
      post('Old essay', '2026-10-11', ['essays']),
      post('Redaction is not enough', '2026-10-12', ['data', 'essays']),
      post('Curiosity, not selfishness', '2026-10-12', ['physics', 'essays']),
      post('Newer review', '2026-10-13', ['film', 'reviews']),
    ];
    expect(posts.sort(comparePosts).map((p) => p.title)).toEqual([
      'Newer review',
      'Curiosity, not selfishness',
      'Redaction is not enough',
      'Babylon',
      'Old essay',
    ]);
  });
});

describe('reading time', () => {
  // Catches a diagram or an MDX import counted as reading: the Writing list would show a short post as a long one.
  it('counts the prose only, not code blocks or imports', () => {
    const prose = Array.from({ length: 460 }, () => 'word').join(' ');
    const diagram = '```text\n' + Array.from({ length: 2000 }, () => 'box').join(' ') + '\n```';
    expect(readingMinutes(`import Figure from './Figure.astro';\n\n${prose}\n\n${diagram}\n`)).toBe(2);
  });
});
