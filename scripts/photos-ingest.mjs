// One-step photo ingest. For each image in a folder: apply its EXIF rotation, strip every metadata block (EXIF with
// GPS, XMP, IPTC, ICC), write AVIF and WebP copies at a few long-edge sizes, and add an entry the owner can edit.
// Re-running is safe: photos already ingested are skipped, and an existing entry is never overwritten.
// Usage: npm run photos:ingest -- <folder> [--year <yyyy>]   (photography)
//        npm run photos:ingest -- <folder> --me              (photos of the owner, src/content/me.json)
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const LONG_EDGES = [480, 960, 1600, 2400];
const INPUT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff']);
const AVIF = { quality: 55, effort: 4 };
const WEBP = { quality: 78, effort: 4 };
// A shared machine: libvips gets four threads, and photos are encoded one at a time.
sharp.concurrency(4);

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function slugify(fileName) {
  return basename(fileName, extname(fileName))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function titleFromSlug(slug) {
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Long edges to write: the standard sizes below the original, then the original itself (capped at the largest). */
export function edgesFor(originalLongEdge) {
  const largest = Math.min(originalLongEdge, LONG_EDGES.at(-1));
  return [...LONG_EDGES.filter((edge) => edge < largest), largest];
}

/** The earliest year among the EXIF date stamps (capture time is never later than an edit time), else null. */
export function exifYear(exif) {
  if (!exif) return null;
  const years = [...exif.toString('latin1').matchAll(/\b((?:19|20)\d{2}):[01]\d:[0-3]\d [0-2]\d:[0-5]\d:[0-5]\d/g)].map(
    (match) => Number(match[1]),
  );
  return years.length > 0 ? Math.min(...years) : null;
}

export function parseArgs(argv) {
  const options = { folder: null, year: null, me: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--me') options.me = true;
    else if (arg === '--year') options.year = Number(argv[++i]);
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else if (options.folder === null) options.folder = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (!options.folder) throw new Error('usage: npm run photos:ingest -- <folder> [--year <yyyy>] [--me]');
  if (options.year !== null && !(Number.isInteger(options.year) && options.year >= 1900 && options.year <= 2100)) {
    throw new Error('--year needs a four-digit year');
  }
  return options;
}

const hasMetadata = (meta) => Boolean(meta.exif || meta.xmp || meta.iptc || meta.icc || meta.tifftagPhotoshop);

async function writeSizes(inputPath, outDir) {
  const { width, height } = await sharp(inputPath).metadata();
  const edges = edgesFor(Math.max(width, height));
  const source = sharp(inputPath, { failOn: 'error' }).autoOrient();
  await mkdir(outDir, { recursive: true });
  for (const edge of edges) {
    const resized = source.clone().resize(edge, edge, { fit: 'inside' });
    for (const [format, options] of [
      ['avif', AVIF],
      ['webp', WEBP],
    ]) {
      const path = join(outDir, `${edge}.${format}`);
      await resized.clone()[format](options).toFile(path);
      // sharp drops metadata unless asked to keep it; this check fails the run if that ever stops being true.
      if (hasMetadata(await sharp(path).metadata())) throw new Error(`metadata left in ${path}`);
    }
  }
  return edges;
}

const yamlEntry = (fields) =>
  Object.entries(fields)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? JSON.stringify(value) : value}`)
    .join('\n') + '\n';

/**
 * Ingests every supported image in `folder` under `root` (the repo by default); returns what it did per file.
 * @param {{ folder: string, year?: number | null, me?: boolean, root?: string }} options
 */
export async function ingestFolder({ folder, year = null, me = false, root = ROOT }) {
  const files = (await readdir(folder, { withFileTypes: true }))
    .filter((dirent) => dirent.isFile() && !dirent.name.startsWith('.'))
    .map((dirent) => dirent.name)
    .sort();
  const inputs = files.filter((name) => INPUT_EXTENSIONS.has(extname(name).toLowerCase()));
  const skipped = files.filter((name) => !inputs.includes(name));

  const slugs = new Map();
  for (const name of inputs) {
    const slug = slugify(name);
    if (!slug) throw new Error(`cannot make a name from ${name}`);
    if (slugs.has(slug)) throw new Error(`${slugs.get(slug)} and ${name} both become "${slug}"; rename one`);
    slugs.set(slug, name);
  }

  const assetsDir = join(root, 'src/assets', me ? 'me' : 'photography');
  const entriesDir = join(root, 'src/content/photography');
  const meJsonPath = join(root, 'src/content/me.json');
  const meEntries = me && existsSync(meJsonPath) ? JSON.parse(await readFile(meJsonPath, 'utf8')) : [];

  const results = [];
  for (const [slug, name] of slugs) {
    const inputPath = join(folder, name);
    const outDir = join(assetsDir, slug);
    const entryPath = join(entriesDir, `${slug}.yaml`);
    const hasEntry = me ? meEntries.some((entry) => entry.file === slug) : existsSync(entryPath);
    const existingEdges = existsSync(outDir)
      ? (await readdir(outDir)).filter((f) => f.endsWith('.webp')).map((f) => Number(f.split('.')[0]))
      : [];
    const hasImages = existingEdges.length > 0;

    if (hasEntry && hasImages) {
      results.push({ file: name, slug, action: 'kept' });
      continue;
    }

    const edges = hasImages ? existingEdges : await writeSizes(inputPath, outDir);

    if (!hasEntry) {
      if (me) {
        meEntries.push({ file: slug, alt: '', use: 'about' });
      } else {
        const inputMeta = await sharp(inputPath).metadata();
        const entryYear = year ?? exifYear(inputMeta.exif) ?? new Date().getUTCFullYear();
        await mkdir(entriesDir, { recursive: true });
        await writeFile(
          entryPath,
          yamlEntry({
            file: `../../assets/photography/${slug}/${Math.max(...edges)}.webp`,
            title: titleFromSlug(slug),
            year: entryYear,
            caption: '',
            // The camera line from his post is the evidence a photo belongs here; the build refuses an empty one.
            camera: '',
          }),
        );
      }
    }
    results.push({ file: name, slug, action: hasImages ? 'entry added' : 'ingested', edges });
  }

  if (me) {
    await mkdir(join(root, 'src/content'), { recursive: true });
    await writeFile(meJsonPath, JSON.stringify(meEntries, null, 2) + '\n');
  }
  return { results, skipped };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { results, skipped } = await ingestFolder(options);
  for (const { file, slug, action, edges } of results) {
    console.log(`${action.padEnd(12)} ${file} → ${slug}${edges ? ` (${edges.join(', ')} px)` : ''}`);
  }
  for (const name of skipped) console.log(`not an image  ${name} (JPEG, PNG, WebP, AVIF or TIFF; export HEIC as JPEG first)`);
  const added = results.filter((r) => r.action !== 'kept').length;
  console.log(
    options.me
      ? `${added} added. Write each new photo's alt text (and use) in src/content/me.json before building.`
      : `${added} added. Write each one's camera (and film), caption and order in src/content/photography/<name>.yaml before building.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`photos:ingest: ${error.message}`);
    process.exit(1);
  });
}
