// Rebuilds src/content/favorites.json from a Letterboxd account export (Settings → Data → Export your data):
//   npm run favorites -- <unzipped export folder | profile.csv>
// Reads the Favorite Films column, resolves each boxd.it link (two paced requests per film, so about 16 s for four)
// and points `poster` at the hand-drawn runtime art when public/room/posters/<slug>.avif exists. Any failure
// leaves favorites.json as it was and exits 1. Node strips the TypeScript types of the shared modules.
import { existsSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildFavorites, parseFavoriteLinks, resolveFavorite } from '../src/lib/favorites.ts';

const root = new URL('../', import.meta.url);
const OUT = new URL('src/content/favorites.json', root);

const input = process.argv[2];
if (!input) {
  console.error('usage: npm run favorites -- <unzipped Letterboxd export folder | profile.csv>');
  process.exit(2);
}

try {
  const profilePath = statSync(input).isDirectory() ? join(input, 'profile.csv') : input;
  const links = parseFavoriteLinks(await readFile(profilePath, 'utf8'));
  const films = [];
  for (const link of links) {
    const film = await resolveFavorite(link);
    const art = `room/posters/${film.slug}.avif`;
    const poster = existsSync(new URL(`public/${art}`, root)) ? `/${art}` : null;
    films.push({ ...film, poster });
    console.log(`favorites: ${link} → ${film.title} (${film.year}), ${film.director}${poster ? '' : ' [drawn at runtime]'}`);
  }
  const previous = await readFile(OUT, 'utf8').then(JSON.parse, () => null);
  const next = buildFavorites(films, previous, new Date());
  if (next === previous) {
    console.log(`favorites: kept (unchanged) src/content/favorites.json: ${films.length} films`);
  } else {
    await writeFile(OUT, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`favorites: wrote src/content/favorites.json: ${films.length} films`);
  }
} catch (error) {
  console.error(`favorites: ${error instanceof Error ? error.message : error}; favorites.json left as it was`);
  process.exit(1);
}
