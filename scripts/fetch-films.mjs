// Writes src/content/films.json, the static fallback for /films and /api/films.json: the Letterboxd export archive
// (src/data/letterboxd/) and the previous films.json, with the live RSS merged over them. When the feed cannot be
// read it keeps what it had (archive + cached copy), prints one line and exits 0, so a build never fails on it.
// Node strips the TypeScript types of the shared modules (Node >= 22.18).
import { readFile, writeFile } from 'node:fs/promises';
import { collectFilms, privateNamesFrom } from '../src/lib/films/live.ts';
import { buildFilmsData, mergeEntries } from '../src/lib/films/merge.ts';
import { parseArchive } from '../src/lib/films/parse.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const OUT = 'src/content/films.json';

const archive = parseArchive({
  diary: await read('src/data/letterboxd/diary.csv'),
  reviews: await read('src/data/letterboxd/reviews.csv'),
});
const cached = await read(OUT).then(JSON.parse, () => null);
const base = buildFilmsData(mergeEntries(archive, cached?.entries ?? []), cached?.fetchedAt ?? new Date().toISOString());

const { data, failure } = await collectFilms(base, { privateNames: privateNamesFrom(process.env.FILMS_PRIVATE_NAMES) });
if (failure) console.warn(`films: using cached films.json (${failure})`);
// Written only when the diary changed, so a build without a new watch leaves the committed file as it is (worker
// branches would otherwise each commit a new fetchedAt and collide).
const changed = JSON.stringify(data.entries) !== JSON.stringify(cached?.entries);
if (changed) await writeFile(new URL(OUT, root), `${JSON.stringify(data, null, 2)}\n`);

const reviewed = data.entries.filter((entry) => entry.review).length;
console.log(
  `films: ${changed ? 'wrote' : 'kept (diary unchanged)'} ${OUT}: ${data.entries.length} entries ` +
    `(${archive.length} from the archive), newest ${data.entries[0]?.watchedDate}, ${reviewed} with reviews` +
    (failure ? ' [feed not read]' : ' [feed merged]'),
);
