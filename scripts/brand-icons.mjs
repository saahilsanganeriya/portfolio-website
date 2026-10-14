// Draws the site's icon (the room's CRT computer) and the link-preview card from the hand-drawn pixel grids below.
// Run: node scripts/brand-icons.mjs  (writes the favicons, touch icons, web manifest and public/og/default.png)
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium } from 'playwright';

// Same letters as the SaahilOS icons (src/os/assets/icons.ts), plus 'a' for the warm centre of the lit screen.
const PALETTE = {
  k: '#14110f', // ink
  w: '#3b2a1e', // walnut
  h: '#fbf7ef', // highlight cream
  p: '#ede4d3', // paper
  d: '#a89f91', // dust
  t: '#b4442c', // thread: the power light
  o: '#c9a66b', // brass
  n: '#9c7a45', // brass shade
  a: '#f4cf86', // lit screen
};
const INK = PALETTE.k;

// 16 x 16: the favicon at 1x and the SVG favicon, so it stays crisp at 16 and 32 device pixels.
const GRID_16 = [
  '..kkkkkkkkkkkk..',
  '.khhhhhhhhhhhhk.',
  '.khkooooooookdk.',
  '.khoaaaaaaaaodk.',
  '.khoawaaaaaaodk.',
  '.khoaawaaaaaodk.',
  '.khoawawwaaaodk.',
  '.khkooooooookdk.',
  '.khpppppppptpdk.',
  '..kkkkkkkkkkkk..',
  '....kddddddk....',
  '..kkkkkkkkkkkk..',
  '.khhhhhhhhhhhhk.',
  '.kpdpdppwwwwtpk.',
  '..kkkkkkkkkkkk..',
  '................',
];

// 32 x 32: every larger size, scaled by whole numbers only.
const GRID_32 = [
  '................................',
  '................................',
  '....kkkkkkkkkkkkkkkkkkkkkkkk....',
  '...kkhhhhhhhhhhhhhhhhhhhhhhkk...',
  '...khppkkkkkkkkkkkkkkkkkkppdk...',
  '...khpkwoooooooooooooooowkpdk...',
  '...khpkoahhaaaaaaaaaaaaaokpdk...',
  '...khpkoahaaaaaaaaaaaaaaokpdk...',
  '...khpkoaaaaaaaaaaaaaaaaokpdk...',
  '...khpkoaawaaaaaaaaaaaaaokpdk...',
  '...khpkoaaawaaaaaaaaaaaaokpdk...',
  '...khpkoaaaawaaaaaaaaaaaokpdk...',
  '...khpkoaaawaawwwaaaaaaaokpdk...',
  '...khpkoaawaaawwwaaaaaaaokpdk...',
  '...khpkoaaaaaaaaaaaaaaaaokpdk...',
  '...khpkoaaaaaaaaaaaaaaaaokpdk...',
  '...khpkwoooooooooooooooowkpdk...',
  '...khppkkkkkkkkkkkkkkkkkkppdk...',
  '...khpppdpdpdpppppppppppttpdk...',
  '...khpppdpdpdppppppppppppppdk...',
  '...kkddddddddddddddddddddddkk...',
  '....kkkkkkkkkkkkkkkkkkkkkkkk....',
  '..........kwwwwwwwwwwk..........',
  '..........kddddddddddk..........',
  '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
  '.kkhhhhhhhhhhhhhhhhhhhhhhhhhhkk.',
  '.kppdpdpdpdppppppkkkkkkkkkkptpk.',
  '.kppdpdpdpdpppppppppppppppppppk.',
  '.kkddddddddddddddddddddddddddkk.',
  '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
  '................................',
  '................................',
];

for (const grid of [GRID_16, GRID_32]) {
  const bad = grid.findIndex((row) => row.length !== grid.length || [...row].some((c) => c !== '.' && !PALETTE[c]));
  if (bad !== -1) throw new Error(`grid ${grid.length}: row ${bad} is not ${grid.length} known letters`);
}

const hexToRgba = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255);

/** RGBA pixels of a grid scaled by a whole number, centred on a square canvas of `size` filled with `background`. */
function rasterize(grid, scale, size, background = null) {
  const pixels = Buffer.alloc(size * size * 4);
  if (background) for (let i = 0; i < size * size; i++) pixels.set(hexToRgba(background), i * 4);
  const offset = (size - grid.length * scale) / 2;
  if (!Number.isInteger(offset)) throw new Error(`grid ${grid.length} x ${scale} does not centre on ${size}`);
  grid.forEach((row, y) =>
    [...row].forEach((letter, x) => {
      if (letter === '.') return;
      const rgba = hexToRgba(PALETTE[letter]);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++)
          pixels.set(rgba, ((offset + y * scale + dy) * size + offset + x * scale + dx) * 4);
    }),
  );
  return pixels;
}

function encodePng(pixels, size) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An .ico holding PNG images, which every current browser reads. */
function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

/** SVG rects, one per horizontal run of a colour. */
function gridToSvgRects(grid) {
  const rects = [];
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const letter = row[x];
      let end = x;
      while (row[end + 1] === letter) end++;
      if (letter !== '.') rects.push(`<rect x="${x}" y="${y}" width="${end - x + 1}" height="1" fill="${PALETTE[letter]}"/>`);
      x = end + 1;
    }
  });
  return rects.join('');
}

const svgIcon = (grid, attributes = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid.length} ${grid.length}" shape-rendering="crispEdges"${attributes}>${gridToSvgRects(grid)}</svg>`;

const outputs = {
  'public/favicon.svg': svgIcon(GRID_16) + '\n',
  'public/favicon.ico': encodeIco([
    { size: 16, png: encodePng(rasterize(GRID_16, 1, 16), 16) },
    { size: 32, png: encodePng(rasterize(GRID_32, 1, 32), 32) },
  ]),
  'public/favicon-16.png': encodePng(rasterize(GRID_16, 1, 16), 16),
  'public/favicon-32.png': encodePng(rasterize(GRID_32, 1, 32), 32),
  // The large icons sit on an ink square: iOS rounds its corners, and the cream case needs a dark ground.
  'public/apple-touch-icon.png': encodePng(rasterize(GRID_32, 5, 180, INK), 180),
  'public/icon-192.png': encodePng(rasterize(GRID_32, 5, 192, INK), 192),
  'public/icon-512.png': encodePng(rasterize(GRID_32, 14, 512, INK), 512),
  'public/site.webmanifest':
    JSON.stringify(
      {
        name: 'Saahil Sanganeriya',
        short_name: 'Saahil',
        start_url: '/',
        display: 'browser',
        background_color: INK,
        theme_color: INK,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      null,
      2,
    ) + '\n',
};
for (const [path, data] of Object.entries(outputs)) writeFileSync(path, data);

// The link-preview card: the same CRT at 10x on its desk, beside the name and the role line from About.
const fontFace = (family, file, weight = 400) =>
  `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format('woff2')}`;
const card = `<!doctype html><html><head><style>
${fontFace('Newsreader', 'node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2', '200 800')}
${fontFace('IBM Plex Sans', 'node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2')}
${fontFace('IBM Plex Mono', 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2')}
html,body{margin:0;width:1200px;height:630px;background:${INK};overflow:hidden}
.crt{position:absolute;left:104px;top:132px;width:320px;height:320px}
.desk{position:absolute;left:84px;top:432px;width:360px;height:10px;background:${PALETTE.w}}
.text{position:absolute;left:500px;top:0;height:630px;display:flex;flex-direction:column;justify-content:center}
h1{margin:0;font:400 78px/1.05 'Newsreader';color:${PALETTE.p};letter-spacing:-0.5px}
.role{margin:26px 0 0;font:400 30px/1.3 'IBM Plex Sans';color:${PALETTE.d}}
.url{margin:18px 0 0;font:400 24px/1.3 'IBM Plex Mono';color:${PALETTE.o}}
</style></head><body>
${svgIcon(GRID_32, ' class="crt"')}<div class="desk"></div>
<div class="text"><h1>Saahil<br>Sanganeriya</h1><p class="role">Software Engineer, Applied AI at Mercor</p><p class="url">saahilsanganeriya.com</p></div>
</body></html>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(card, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'public/og/default.png', type: 'png' });
} finally {
  await browser.close();
}
console.log(`wrote ${Object.keys(outputs).length + 1} files`);
