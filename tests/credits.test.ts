import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { creditSections, parseAssetsRegister } from '../src/lib/assets-register';

const REGISTER = `
## 3D models

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| Lamp | the desk lamp | https://example.com/lamp | A | CC0 1.0 | — |
| Projector | prop \`projector\`; prop library only, not in the set | https://example.com/projector | B | CC0 1.0 | — |

## Textures and HDRIs

| Asset | Used for | Source URL | Author | Licence | Changes |
|---|---|---|---|---|---|
| Studio HDRI | lighting of the review renders only; not shipped, not in the bake | https://example.com/hdri | C | CC0 1.0 | — |
`;

/**
 * Catches Credits listing assets the site does not ship (a prop kept only in the Blender library, a light for review
 * renders, the projector, Delhi's night) or keeping a section with nothing left in it, a register whose wording no
 * longer matches the filter, and planning labels ("round eight", "v4", task ids) on the public list.
 */
test('Credits lists only what ships, without planning labels; the register keeps every row', () => {
  expect(creditSections(REGISTER)).toEqual([{ title: '3D models', rows: [expect.objectContaining({ asset: 'Lamp' })] }]);
  expect(parseAssetsRegister(REGISTER).flatMap((s) => s.rows)).toHaveLength(3);

  const real = readFileSync(new URL('../blender/ASSETS.md', import.meta.url), 'utf8');
  const shown = creditSections(real).flatMap((s) => s.rows);
  const kept = parseAssetsRegister(real).flatMap((s) => s.rows);
  expect(shown.length).toBeLessThan(kept.length);
  expect(shown.filter((row) => /prop library|not shipped/i.test(row.usedFor))).toEqual([]);
  const visible = shown.map((row) => [row.asset, row.usedFor, row.author, row.licence].join(' | '));
  expect(visible.filter((text) => /\bround (one|two|three|four|five|six|seven|eight)\b|\bv4\b|\bT\d{2}\b|projector|delhi-night/i.test(text))).toEqual([]);
});
