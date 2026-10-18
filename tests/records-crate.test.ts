import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseAssetsRegister } from '../src/lib/assets-register';
import { CRATE, NOW_PLAYING, sleeveSvg } from '../src/scene/audio/crate';

const MAX_BYTES = 2_500_000;
const register = () => parseAssetsRegister(readFileSync(new URL('../blender/ASSETS.md', import.meta.url), 'utf8'));
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

// The four hosted records as main had them on 2026-10-18 (the owner keeps them exactly as they are): sha-256 of each
// crate entry as JSON, its sleeve's SVG and its two files.
const HOSTED: Record<string, { entry: string; sleeve: string; webm: string; m4a: string }> = {
  'washed-up': { entry: '1a537d100b4593a2745aef1a96810204370a94bc93bff7e9f5d9ca4fdf6db19e', sleeve: '6254dbd006850819b35e9da434b17b15b6e2a109004e539e04e2c788a36ad062', webm: '3a29ecc134c5e1ee85fb6846f8b697ca44c89bb033e4e265d5a7a806578e9e9a', m4a: '30774049ca6c969e0aaf854473cf1e1e52dbc2eb5f7dd26dce0c5bbae01eec87' },
  'night-in-venice': { entry: '5580993d57fca1dab542ccd9b8ef64e74f785e3fc33719677f88d92c8832ebe5', sleeve: '6dc6f2bdf246e9b57d31d6d83d1c5c724327d2cb4908dea4ca3b6c544e3e8dab', webm: 'd806f2e73189c29a9573d61bb2264733ee0853d8f9a05b95789384fe56f3f790', m4a: 'd961644eacd20e9a311ce1695e22fbb7d55d4d253d25a7894fddd5b61343a781' },
  'cylinder-five': { entry: '6da98a0b53c57ffe271002cfe6b234eb4677311e16210767e4cb1953cf1851af', sleeve: 'aba74733cd1714fef1f12918a9889d34fddf494bfd04fdc6715ee696d0e48761', webm: '590b0fae818fd89521e3a461d08d2455643e05a2a05d6620c6618da58e63d856', m4a: 'a5fec44068572589f4b13e6c373eb99f06ae5a0c18de8f4e6084ccc9d6b8fe02' },
  'raga-kiravani': { entry: 'b514470060775659729571da80cb3f5f3e247a5e47f66ab4d1ca1170018c9ccb', sleeve: '6ec6393b1ff47628a0021d94d60f51cc4d3a8661a33f72d20a581a249eb1e9e2', webm: '609f96b0383ef3afa81524da0688fbf9f6946c2e83f82388eb6dd0a0961234d2', m4a: 'af3b7491e931ed46a83463259f8d77a8c3027e6a805a20e9db4e245c136b5b67' },
};

describe('the record crate', () => {
  /**
   * Catches a record that cannot ship: a missing file in one of the two formats, a rebuild over the 2.5 MB stream cap,
   * or a record (or its turntable sounds) with no credit row and licence in blender/ASSETS.md, which Credits shows.
   */
  test('every record ships both formats under the cap and is credited with its licence', () => {
    const rows = register().find((section) => section.title === 'Records')?.rows ?? [];
    for (const record of CRATE) {
      for (const ext of ['webm', 'm4a']) {
        expect(statSync(new URL(`../public/audio/records/${record.id}.${ext}`, import.meta.url)).size).toBeLessThanOrEqual(MAX_BYTES);
      }
      const row = rows.find((r) => r.asset.includes(`records/${record.id}`));
      expect(row?.licence, record.id).toContain(record.licence);
      expect(row?.sourceUrl, record.id).toBe(record.sourceUrl);
    }
    for (const sound of ['needle-drop', 'needle-lift', 'crackle']) {
      expect(rows.some((r) => r.asset.includes(`records/${sound}`) && r.licence.startsWith('CC0')), sound).toBe(true);
    }
  });

  /** Catches any change to a hosted record (its title, order, credit, sleeve or files), or one added or taken away. */
  test('the four hosted records are unchanged, in their order', () => {
    expect(CRATE.map((record) => record.id)).toEqual(Object.keys(HOSTED));
    for (const record of CRATE) {
      const file = (ext: string) => readFileSync(new URL(`../public/audio/records/${record.id}.${ext}`, import.meta.url));
      expect({ entry: sha(JSON.stringify(record)), sleeve: sha(sleeveSvg(record.id)), webm: sha(file('webm')), m4a: sha(file('m4a')) }, record.id).toEqual(
        HOSTED[record.id],
      );
    }
  });

  /**
   * Catches the streamed record pointing anywhere but Spotify's official player for its track, a copy of the recording
   * shipped with the site, or Credits not naming where it comes from.
   */
  test('Max Richter is Spotify’s official player, credited, and never a file of ours', () => {
    const track = NOW_PLAYING.sourceUrl.match(/^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})$/)?.[1];
    expect(track).toBe('5DFUsGW4Cmltv8Spd0u1aV');
    expect(NOW_PLAYING.embedUrl).toBe(`https://open.spotify.com/embed/track/${track}`);
    const row = register()
      .find((section) => section.title === 'Records')
      ?.rows.find((r) => r.asset.includes('On the Nature of Daylight'));
    expect(row?.sourceUrl).toBe(NOW_PLAYING.sourceUrl);
    expect(row?.author).toContain('Max Richter');
    const shipped = readdirSync(new URL('../public/', import.meta.url), { recursive: true }).map(String);
    expect(shipped.filter((path) => /richter|daylight|blue.?notebooks/i.test(path))).toEqual([]);
  });
});
