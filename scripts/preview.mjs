// Serves the Vercel build output locally, because `astro preview` does not support the Vercel adapter once the site
// has an on-demand route: files from .vercel/output/static, then the routes in .vercel/output/config.json, whose
// function routes (/api/films.json) run the built function itself. No ISR cache: every request reaches the function.
// Usage: npm run build && node scripts/preview.mjs [--host 127.0.0.1] [--port 4321]
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const { values } = parseArgs({ options: { host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '4321' } } });
const OUT = new URL('../.vercel/output/', import.meta.url).pathname;
const STATIC = join(OUT, 'static');
const { routes } = JSON.parse(await readFile(join(OUT, 'config.json'), 'utf8'));
const { default: fn } = await import(join(OUT, 'functions/_render.func/.vercel/output/server/entry.mjs'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.pdf': 'application/pdf',
  '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
};

async function staticFile(pathname) {
  const path = normalize(join(STATIC, decodeURIComponent(pathname)));
  if (!path.startsWith(STATIC + sep) && path !== STATIC) return null;
  for (const candidate of [path, join(path, 'index.html'), `${path}.html`]) {
    const info = await stat(candidate).catch(() => null);
    if (info?.isFile()) return candidate;
  }
  return null;
}

// Compressed like Vercel's edge, so page-weight measurements (Lighthouse) see the bytes a visitor downloads.
function reply(req, res, status, headers, body) {
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && body.length > 1024;
  res.writeHead(status, { ...headers, ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
  res.end(gzip ? gzipSync(body) : body);
}
const send = async (req, res, status, file) =>
  reply(req, res, status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }, await readFile(file));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const file = await staticFile(url.pathname);
  if (file) return send(req, res, 200, file);
  const afterFilesystem = routes.slice(routes.findIndex((route) => route.handle === 'filesystem') + 1);
  for (const route of afterFilesystem) {
    const match = route.src && url.pathname.match(new RegExp(route.src));
    if (!match || !route.dest) continue;
    const dest = route.dest.replace(/\$(\d)/g, (_, i) => match[Number(i)] ?? '');
    if (/^\/?_(isr|render)\b/.test(dest)) {
      const response = await fn.fetch(new Request(new URL(dest.replace(/^\/?/, '/'), url), { headers: req.headers }));
      return reply(req, res, response.status, Object.fromEntries(response.headers), Buffer.from(await response.arrayBuffer()));
    }
    const target = await staticFile(dest);
    if (target) return send(req, res, route.status ?? 200, target);
  }
  res.writeHead(404).end('Not found');
}).listen(Number(values.port), values.host, () => console.log(`preview: http://${values.host}:${values.port}/`));
