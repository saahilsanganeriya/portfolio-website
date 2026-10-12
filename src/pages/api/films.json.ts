import type { APIRoute } from 'astro';
import fallback from '../../content/films.json';
import { createFilmsSource, privateNamesFrom } from '../../lib/films/live.ts';
import type { FilmsData } from '../../lib/films/merge.ts';

// The site's only server route: the archive with the live Letterboxd feed merged over it. Rendered on demand and
// cached by Vercel ISR for at most an hour (astro.config.mjs); `npm run dev` reads the feed the same way.
export const prerender = false;

const films = createFilmsSource(fallback as FilmsData, {
  privateNames: privateNamesFrom(process.env.FILMS_PRIVATE_NAMES),
});

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await films()), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
