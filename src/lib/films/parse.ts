import { slugFor, type FilmEntry } from './merge.ts';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
  });
}

// Feed boilerplate that is not the member's words: the watch line Letterboxd writes when there is no review,
// and the spoiler notice.
const BOILERPLATE = [/^Watched on \w+ \w+ \d{1,2}, \d{4}\.?$/, /^This review may contain spoilers\.?$/];

/** Review HTML (feed description or export cell) to plain text, or null when no words of the member remain. */
export function cleanReview(html: string): string | null {
  const text = decodeEntities(
    html
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|blockquote|h\d)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  );
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim())
    .filter((p) => p && !BOILERPLATE.some((pattern) => pattern.test(p)));
  return paragraphs.length > 0 ? paragraphs.join('\n\n') : null;
}

// ---- the live feed ----

const field = (item: string, tag: string) => {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : null;
};
const cdata = (value: string) => value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1');

/**
 * Diary entries of the member's RSS feed. Items without a watched date are list posts and are skipped (their
 * titles are list names, which can name people); `skipped` counts them.
 */
export function parseFeed(xml: string): { entries: FilmEntry[]; skipped: number } {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const entries: FilmEntry[] = [];
  for (const item of items) {
    const watchedDate = field(item, 'letterboxd:watchedDate');
    const title = field(item, 'letterboxd:filmTitle');
    const year = Number(field(item, 'letterboxd:filmYear'));
    const url = field(item, 'link');
    if (!watchedDate || !title || !year || !url) continue;
    const rating = field(item, 'letterboxd:memberRating');
    const description = field(item, 'description');
    entries.push({
      title: decodeEntities(title),
      year,
      rating: rating ? Number(rating) : null,
      rewatch: field(item, 'letterboxd:rewatch') === 'Yes',
      liked: field(item, 'letterboxd:memberLike') === 'Yes',
      watchedDate,
      review: description ? cleanReview(cdata(description)) : null,
      url,
      slug: url.match(/\/film\/([^/]+)\//)?.[1] ?? slugFor(title, year),
    });
  }
  return { entries, skipped: items.length - entries.length };
}

// ---- the export archive ----

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

function records(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((name, i) => [name, r[i] ?? ''])));
}

/**
 * Diary entries of the export: diary.csv, with each entry's review text from reviews.csv (matched by film and
 * watched date). Newest watch first, then newest logged.
 */
export function parseArchive({ diary, reviews }: { diary: string; reviews: string }): FilmEntry[] {
  const key = (row: Record<string, string>) => `${row.Name}|${row.Year}|${row['Watched Date']}`;
  const reviewRows = records(reviews).filter((row) => row['Watched Date']);
  const reviewText = new Map(reviewRows.map((row) => [key(row), cleanReview(row.Review)]));
  const diaryRows = records(diary);
  const logged = new Set(diaryRows.map(key));
  const rows = [...diaryRows, ...reviewRows.filter((row) => !logged.has(key(row)))];
  return rows
    .map((row) => {
      const year = Number(row.Year);
      return {
        logged: row.Date,
        entry: {
          title: row.Name,
          year,
          rating: row.Rating ? Number(row.Rating) : null,
          rewatch: row.Rewatch === 'Yes',
          liked: false,
          watchedDate: row['Watched Date'],
          review: reviewText.get(key(row)) ?? null,
          url: row['Letterboxd URI'],
          slug: slugFor(row.Name, year),
        } satisfies FilmEntry,
      };
    })
    .sort((a, b) => b.entry.watchedDate.localeCompare(a.entry.watchedDate) || b.logged.localeCompare(a.logged))
    .map(({ entry }) => entry);
}
