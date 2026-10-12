// Hand-drawn pixel icons: one character per pixel, '.' is transparent. Drawn for this site; no Win98 art.
const PALETTE: Record<string, string> = {
  k: '#14110f', // ink
  w: '#3b2a1e', // walnut
  l: '#6b4a33', // light walnut
  h: '#fbf7ef', // highlight cream
  p: '#ede4d3', // paper
  d: '#a89f91', // dust
  t: '#b4442c', // thread
  b: '#9db4c0', // projector light, CRT glass only
  o: '#c9a66b', // brass
  n: '#9c7a45', // brass shade
  r: '#9a5b3c', // terracotta
  g: '#7d8a4e', // mango leaf
  v: '#525c33', // leaf shade
};

const GRIDS = {
  projects: [
    '................',
    '.kkkkk..........',
    'knnnnnk.........',
    'knnnnnnkkkkkkkk.',
    'knnhhhhhhhhhhnk.',
    'knnhddddddddhnk.',
    'kkkkkkkkkkkkkkkk',
    'kooooooooooooook',
    'kooooooooooooook',
    'kooooooooooooook',
    'kooooooooooooook',
    'kooooooooooooook',
    'knnnnnnnnnnnnnnk',
    'kkkkkkkkkkkkkkkk',
    '................',
    '................',
  ],
  page: [
    '................',
    '..kkkkkkkkk.....',
    '..khhhhhhhkk....',
    '..khhhhhhhkdk...',
    '..khhhhhhhkkkk..',
    '..khhhhhhhhhhk..',
    '..khddddddddhk..',
    '..khhhhhhhhhhk..',
    '..khddddddddhk..',
    '..khhhhhhhhhhk..',
    '..khddddddhhhk..',
    '..khhhhhhhhhhk..',
    '..khtttthhhhhk..',
    '..khhhhhhhhhhk..',
    '..kkkkkkkkkkkk..',
    '................',
  ],
  films: [
    '................',
    '.....kkkkkk.....',
    '...kkhhddddkk...',
    '..khdddwwddddk..',
    '.khddddwwdddddk.',
    '.kddddddddddddk.',
    'kddddddddddddddk',
    'kddwwddkkddwwddk',
    'kddwwddkkddwwddk',
    'kddddddddddddddk',
    '.kddddddddddddk.',
    '.kdddddwwdddddk.',
    '..kddddwwddddk..',
    '...kkddddddkk...',
    '.....kkkkkk.....',
    '................',
  ],
  story: [
    '..kkkkkkkkkkkk..',
    '..khwwwwwwwwhk..',
    '..kwkkkkkkkkwk..',
    '..khkbbbbbbkhk..',
    '..kwkbbbhhbkwk..',
    '..khkbbbhhbkhk..',
    '..kwkddddddkwk..',
    '..khkkkkkkkkhk..',
    '..kwwwwwwwwwwk..',
    '..khkkkkkkkkhk..',
    '..kwkooooookwk..',
    '..khkoogoookhk..',
    '..kwkogggookwk..',
    '..khkoorrookhk..',
    '..kwkkkkkkkkwk..',
    '..kkkkkkkkkkkk..',
  ],
  terminal: [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.khhhhhhhhhhhpk.',
    '.khkkkkkkkkkkpk.',
    '.khkbkkkkkkkkpk.',
    '.khkkbkkkkkkkpk.',
    '.khkbkbbbkkkkpk.',
    '.khkkkkkkkkkkpk.',
    '.khkkkkkkkkkkpk.',
    '.khpppppppppppk.',
    '.khppppppppptpk.',
    '.kkkkkkkkkkkkkk.',
    '.....kdddddk....',
    '...kkkkkkkkkk...',
    '................',
    '................',
  ],
  about: [
    '................',
    '.......kk.......',
    '......kggk......',
    '..kk..kgvk..kk..',
    '.kggk.kgvk.kggk.',
    '.kgvvkkgvkkvvgk.',
    '..kgvgkwkkgvgk..',
    '...kkvkwkvkk....',
    '.....kkwkk......',
    '......kwk.......',
    '...kkkkkkkkkk...',
    '...krrrrrrrrk...',
    '...kkkkkkkkkk...',
    '....krrrrrrk....',
    '....krrrrrrk....',
    '.....kkkkkk.....',
  ],
  resume: [
    '................',
    '..kkkkkkkkkkkk..',
    '..khhhhhhhhhhk..',
    '..khwwhddddhhk..',
    '..khwwhddhhhhk..',
    '..khhhhhhhhhhk..',
    '..khtttttttthk..',
    '..khhhhhhhhhhk..',
    '..khddddddddhk..',
    '..khhhhhhhhhhk..',
    '..khddddddhhhk..',
    '..khhhhhhhhhhk..',
    '..khddddddddhk..',
    '..khhhhhhhhhhk..',
    '..kkkkkkkkkkkk..',
    '................',
  ],
  credits: [
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.khhkkhhkkhhkkk.',
    '.kkhhkkhhkkhhkk.',
    '.kkkkkkkkkkkkkk.',
    '.kwwwwwwwwwwwwk.',
    '.kwhhhhwhhhhwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwhhhwwwhhhhwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwhhhhhhwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ],
  spool: [
    '................',
    '................',
    '...kkkkkkkkkk...',
    '...kllllllllk...',
    '...kkkkkkkkkk...',
    '....kttttttk....',
    '....kthttttk....',
    '....kttttttktt..',
    '....kttthttk..t.',
    '....kttttttk..t.',
    '...kkkkkkkkkk.t.',
    '...kllllllllk.t.',
    '...kkkkkkkkkk..t',
    '................',
    '................',
    '................',
  ],
  power: [
    '................',
    '.......kk.......',
    '....k..kk..k....',
    '...kk..kk..kk...',
    '..kk...kk...kk..',
    '..k....kk....k..',
    '.kk....kk....kk.',
    '.kk..........kk.',
    '.kk..........kk.',
    '.kk..........kk.',
    '..k..........k..',
    '..kk........kk..',
    '...kk......kk...',
    '....kkkkkkkk....',
    '................',
    '................',
  ],
  minimize: ['........', '........', '........', '........', '........', '.kkkkkk.', '.kkkkkk.'],
  maximize: ['kkkkkkkk', 'kkkkkkkk', 'k......k', 'k......k', 'k......k', 'k......k', 'kkkkkkkk'],
  restore: ['..kkkkkk', '..kkkkkk', '..k....k', 'kkkkkk.k', 'kkkkkkkk', 'k....k..', 'kkkkkk..'],
  close: ['kk....kk', '.kk..kk.', '..kkkk..', '...kk...', '..kkkk..', '.kk..kk.', 'kk....kk'],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof GRIDS;

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  fill: string;
}

export interface PixelArt {
  width: number;
  height: number;
  rects: PixelRect[];
}

// Each row becomes runs of same-coloured pixels, so a 16x16 icon is a few dozen rects, not 256.
function toArt(name: string, rows: string[]): PixelArt {
  const width = rows[0].length;
  const rects: PixelRect[] = [];
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`icon ${name}: row ${y} is ${row.length} wide, expected ${width}`);
    let x = 0;
    while (x < width) {
      const ch = row[x];
      let end = x + 1;
      while (end < width && row[end] === ch) end++;
      if (ch !== '.') {
        const fill = PALETTE[ch];
        if (!fill) throw new Error(`icon ${name}: unknown colour '${ch}' in row ${y}`);
        rects.push({ x, y, width: end - x, fill });
      }
      x = end;
    }
  });
  return { width, height: rows.length, rects };
}

export const ICONS = Object.fromEntries(
  Object.entries(GRIDS).map(([name, rows]) => [name, toArt(name, rows)]),
) as Record<IconName, PixelArt>;

export function iconSvgMarkup(name: IconName): string {
  const { width, height, rects } = ICONS[name];
  const body = rects
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="1" fill="${r.fill}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${body}</svg>`;
}

// For CSS masks (the selected-icon dither): the icon's silhouette as a data URL.
export function iconMaskUrl(name: IconName): string {
  return `url("data:image/svg+xml,${encodeURIComponent(iconSvgMarkup(name))}")`;
}
