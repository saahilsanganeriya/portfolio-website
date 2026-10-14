import { readFileSync, statSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseAssetsRegister } from '../src/lib/assets-register';
import { CRATE } from '../src/scene/audio/crate';

const MAX_BYTES = 2_500_000;

describe('the record crate', () => {
  /**
   * Catches a record that cannot ship: a missing file in one of the two formats, a rebuild over the 2.5 MB stream cap,
   * or a record (or its turntable sounds) with no credit row and licence in blender/ASSETS.md, which Credits shows.
   */
  test('every record ships both formats under the cap and is credited with its licence', () => {
    const register = parseAssetsRegister(readFileSync(new URL('../blender/ASSETS.md', import.meta.url), 'utf8'));
    const rows = register.find((section) => section.title === 'Records')?.rows ?? [];
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
});
