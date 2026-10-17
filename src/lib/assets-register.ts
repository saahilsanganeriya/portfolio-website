import register from '../../blender/ASSETS.md?raw';

export interface AssetRow {
  asset: string;
  usedFor: string;
  sourceUrl: string | null;
  author: string;
  licence: string;
  changes: string;
}

export interface AssetSection {
  title: string;
  rows: AssetRow[];
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));

// Reads the `## Section` tables of blender/ASSETS.md (columns: Asset | Used for | Source URL | Author | Licence | Changes).
export function parseAssetsRegister(markdown: string = register): AssetSection[] {
  const sections: AssetSection[] = [];
  let current: AssetSection | null = null;
  let seenHeaderRow = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), rows: [] };
      sections.push(current);
      seenHeaderRow = false;
    } else if (current && line.trim().startsWith('|')) {
      if (!seenHeaderRow) {
        seenHeaderRow = true;
        continue;
      }
      if (/^\|[\s:|-]+\|$/.test(line.trim())) continue;
      const [asset = '', usedFor = '', source = '', author = '', licence = '', changes = ''] = splitRow(line);
      current.rows.push({
        asset,
        usedFor,
        sourceUrl: source.match(/https?:\/\/[^\s)>\]]+/)?.[0] ?? null,
        author,
        licence,
        changes,
      });
    }
  }
  return sections;
}

// A row whose use says the asset is not on the site (a prop kept in the Blender library, a review-render light)
// stays in the register for the record and is left out of Credits.
const NOT_SHIPPED = /\b(prop library only|not shipped)\b/i;

/** The register as Credits shows it: only rows for assets the site ships, in sections that still have any. */
export function creditSections(markdown: string = register): AssetSection[] {
  return parseAssetsRegister(markdown)
    .map((section) => ({ ...section, rows: section.rows.filter((row) => !NOT_SHIPPED.test(row.usedFor)) }))
    .filter((section) => section.rows.length > 0);
}
