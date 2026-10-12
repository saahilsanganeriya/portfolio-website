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
