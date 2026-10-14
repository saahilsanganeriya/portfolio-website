import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ingestFolder } from '../scripts/photos-ingest.mjs';

const XMP = `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Test User</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`;

let root: string;
let folder: string;

/** A JPEG carrying everything a phone writes: EXIF with a capture date and GPS, XMP, an ICC profile, a rotation. */
async function phoneJpeg(path: string, width: number, height: number) {
  await sharp({ create: { width, height, channels: 3, background: '#c84' } })
    .withIccProfile('srgb')
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'TestCam' },
      IFD2: { DateTimeOriginal: '2018:05:23 11:31:27' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 3230/100', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 4366/100' },
    })
    .withXmp(XMP)
    .jpeg()
    .toFile(path);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'photos-ingest-'));
  folder = join(root, 'incoming', 'photos');
  await mkdir(folder, { recursive: true });
  await phoneJpeg(join(folder, 'Test Photo.JPG'), 1200, 600);
  await phoneJpeg(join(folder, 'tiny.jpg'), 300, 200);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('photos:ingest', () => {
  /** Catches a size that keeps EXIF (and its GPS), XMP or ICC, and a photo published sideways because the rotation
   *  tag was stripped without being applied first. */
  test('strips every metadata block from every size, after applying the EXIF rotation', async () => {
    const input = await sharp(join(folder, 'Test Photo.JPG')).metadata();
    expect([Boolean(input.exif), Boolean(input.xmp), Boolean(input.icc), input.orientation]).toEqual([true, true, true, 6]);

    await ingestFolder({ folder, root });

    const outDir = join(root, 'src/assets/photography/test-photo');
    const outputs = (await readdir(outDir)).sort();
    expect(outputs).toEqual(['1200.avif', '1200.webp', '480.avif', '480.webp', '960.avif', '960.webp']);
    for (const name of outputs) {
      const meta = await sharp(join(outDir, name)).metadata();
      expect({ name, exif: meta.exif, xmp: meta.xmp, iptc: meta.iptc, icc: meta.icc }).toEqual({ name });
      expect(meta.orientation).toBeUndefined();
      expect(meta.height).toBeGreaterThan(meta.width!);
    }
  });

  /** Catches entries that do not build (a `file` naming a size never written), wrong defaults, and a largest copy
   *  smaller than the original (full resolution is served on demand). */
  test('writes one editable entry per photo, pointing at its largest size', async () => {
    await ingestFolder({ folder, root });

    const entry = await readFile(join(root, 'src/content/photography/test-photo.yaml'), 'utf8');
    expect(entry).toBe(
      [
        'file: "../../assets/photography/test-photo/1200.webp"',
        'title: "Test photo"',
        'year: 2018',
        'series: "2018"',
        'caption: ""',
        'featured: false',
        'onWall: false',
        '',
      ].join('\n'),
    );
    expect(await readdir(join(root, 'src/assets/photography/tiny'))).toEqual(['300.avif', '300.webp']);
  });

  /** Catches --series and --year being ignored, which would file a whole folder under the wrong series. */
  test('--series and --year set the defaults of new entries', async () => {
    await ingestFolder({ folder, root, series: '2019', year: 2019 });

    const entry = await readFile(join(root, 'src/content/photography/tiny.yaml'), 'utf8');
    expect(entry).toContain('year: 2019\nseries: "2019"\n');
  });

  /** Catches a re-run that overwrites the owner's edits or re-encodes photos already ingested. */
  test('is idempotent: a second run keeps edited entries and existing images', async () => {
    await ingestFolder({ folder, root });
    const entryPath = join(root, 'src/content/photography/test-photo.yaml');
    const edited = (await readFile(entryPath, 'utf8')).replace('caption: ""', 'caption: "Edited by hand."');
    await writeFile(entryPath, edited);
    const imagePath = join(root, 'src/assets/photography/test-photo/1200.webp');
    const before = (await stat(imagePath)).mtimeMs;

    const { results } = await ingestFolder({ folder, root });

    expect(results.map((r: { action: string }) => r.action)).toEqual(['kept', 'kept']);
    expect(await readFile(entryPath, 'utf8')).toBe(edited);
    expect((await stat(imagePath)).mtimeMs).toBe(before);
  });

  /** Catches photos of the owner leaking into the photography collection, or duplicate rows on a re-run. */
  test('--me writes into src/assets/me and appends to me.json once', async () => {
    await ingestFolder({ folder, root, me: true });
    await ingestFolder({ folder, root, me: true });

    const me = JSON.parse(await readFile(join(root, 'src/content/me.json'), 'utf8'));
    expect(me).toEqual([
      { file: 'test-photo', alt: '', use: 'about' },
      { file: 'tiny', alt: '', use: 'about' },
    ]);
    expect(await readdir(join(root, 'src/assets/me/test-photo'))).toContain('960.webp');
    await expect(stat(join(root, 'src/content/photography'))).rejects.toThrow(/ENOENT/);
  });

  /** Catches two source files that would silently share one entry. */
  test('refuses two files that become the same name', async () => {
    await phoneJpeg(join(folder, 'test_photo.jpg'), 600, 400);
    await expect(ingestFolder({ folder, root })).rejects.toThrow(/both become "test-photo"/);
  });
});
