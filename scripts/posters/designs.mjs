// The four room posters, drawn as one set: a 600 x 900 sheet (2:3), one graphic idea per film in the top
// two thirds, and the same title and credit baselines on every sheet so they read as a set on the wall.
import { setLine } from './type.mjs';

export const W = 600;
export const H = 900;
const M = 40;
const TITLE_SIZE = 150;
const TITLE_BASE = 702;
const TITLE_LEAD = 122;
const CREDIT_BASE = 866;
const CREDIT_SIZE = 19;

const PAPER = '#EDE4D3';
const INK = '#14110F';
const THREAD = '#B4442C';
const DUST = '#A89F91';

const n = (v) => Math.round(v * 100) / 100;
const circle = (cx, cy, r, clockwise = true) =>
  `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 ${clockwise ? 1 : 0} ${n(cx - r)} ${n(cy)}` +
  `A${n(r)} ${n(r)} 0 1 ${clockwise ? 1 : 0} ${n(cx + r)} ${n(cy)}Z`;
const poly = (points) => `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;

function hexToRgb(hex) {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function mix(a, b, t) {
  const [ra, ga, ba] = hexToRgb(a);
  const [rb, gb, bb] = hexToRgb(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(ra, rb)}${c(ga, gb)}${c(ba, bb)}`;
}

// Letterpress: one warp field roughens every printed edge and one speckle field lets the sheet show through
// the ink at the same pits on every layer, as it does on a hand-inked press.
const DEFS = `
<filter id="press" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="warp"/>
  <feDisplacementMap in="SourceGraphic" in2="warp" scale="2" xChannelSelector="R" yChannelSelector="G" result="rough"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="11" result="speck"/>
  <feColorMatrix in="speck" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -9 0 0 0 6.1" result="mask"/>
  <feComposite in="rough" in2="mask" operator="arithmetic" k1="0.3" k2="0.7"/>
</filter>
<filter id="stamp" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="23" result="warp"/>
  <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="3" seed="5" result="speck"/>
  <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -6 0 0 0 3.7" result="mask"/>
  <feComposite in="rough" in2="mask" operator="in"/>
</filter>
<filter id="fibre" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.6 0.9" numOctaves="3" seed="3" stitchTiles="stitch"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.36  0 0 0 0 0.3  0 0 0 -1.6 1.05"/>
</filter>`;

function frame({ id, label, ground, titleLines, titleInk, creditInk, director, year, art, overlay = '' }) {
  const title = titleLines
    .map((line, i) => setLine('gothic', line, { x: M - 2, y: TITLE_BASE + i * TITLE_LEAD, size: TITLE_SIZE, tracking: 8 }).d)
    .join('');
  const byline = setLine('serifItalic', 'a film by', { x: M, y: CREDIT_BASE, size: CREDIT_SIZE });
  const name = setLine('serif', director, { x: M + byline.width + 7, y: CREDIT_BASE, size: CREDIT_SIZE });
  const yearLine = setLine('serif', String(year), { x: W - M, y: CREDIT_BASE, size: CREDIT_SIZE, anchor: 'end', features: ['onum'] });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-poster="${id}">
<title>${label}</title>
<defs>${DEFS}</defs>
<rect width="${W}" height="${H}" fill="${PAPER}"/>
<g filter="url(#press)">
<rect width="${W}" height="${H}" fill="${ground}"/>
${art}
<path fill="${titleInk}" d="${title}"/>
<path fill="${creditInk}" d="${byline.d}${name.d}${yearLine.d}"/>
</g>
${overlay}
<rect width="${W}" height="${H}" filter="url(#fibre)" opacity="0.5" style="mix-blend-mode:multiply"/>
</svg>
`;
}

// The Odyssey: the trial of the bow. Twelve axes stand in a trench in a line, and one arrow passes through
// the hole in every blade. Drawn in true perspective so the arrow visibly threads each one.
function lookAt(eye, target, focal, centre) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => a.map((v) => v / Math.hypot(...a));
  const forward = unit(sub(target, eye));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return (point) => {
    const d = sub(point, eye);
    const depth = dot(d, forward);
    return [centre[0] + (focal * dot(d, right)) / depth, centre[1] - (focal * dot(d, up)) / depth, depth];
  };
}

function bezier([p0, p1, p2, p3], steps = 18) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  });
}

function odyssey() {
  const ground = '#21141A';
  const bronze = '#B4864F';
  const bronzeEdge = '#DDBB84';
  const haftWood = '#5C3D27';
  const gap = 0.74;
  const holeY = 0.97;
  const holeZ = 0.27;
  const project = lookAt([-0.55, 0.42, 2.3], [3.3, 1.22, 0.05], 540, [352, 300]);
  const toScreen = (points) => points.map((p) => project(p));
  const flat = (points) => `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;

  // Blade outline in its own plane (z across the row, y up), root against the haft.
  const edge = [[0.5, 1.3], [0.67, 1.15], [0.67, 0.79], [0.5, 0.64]];
  const blade = [
    ...bezier([[0.02, 1.1], [0.2, 1.12], [0.38, 1.18], [0.5, 1.3]]),
    ...bezier(edge).slice(1),
    ...bezier([[0.5, 0.64], [0.38, 0.76], [0.2, 0.82], [0.02, 0.84]]).slice(1),
  ];
  const keen = [...bezier(edge), ...bezier([[0.5, 0.64], [0.58, 0.78], [0.58, 1.16], [0.5, 1.3]]).slice(1)];
  const hole = Array.from({ length: 44 }, (_, i) => {
    const a = (-i / 44) * Math.PI * 2;
    return [holeZ + Math.cos(a) * 0.072, holeY + Math.sin(a) * 0.072];
  });
  const inPlane = (x, outline) => toScreen(outline.map(([z, y]) => [x, y, z]));

  const axe = (x) =>
    `<path fill="${haftWood}" d="${flat(inPlane(x, [[-0.026, 0], [0.026, 0], [0.026, 1.2], [-0.026, 1.2]]))}"/>` +
    `<path fill="${bronze}" fill-rule="evenodd" d="${flat(inPlane(x, blade))}${flat(inPlane(x, hole))}"/>` +
    `<path fill="${bronzeEdge}" d="${flat(inPlane(x, keen))}"/>`;

  // The arrow's flight as a thin rod through the holes, its head past the last axe; each piece is drawn
  // between the two axes it lies between, so it shows in every gap and through every hole.
  const rod = (x0, x1, radius = 0.013) => {
    const [a0, b0] = [project([x0, holeY + radius, holeZ]), project([x0, holeY - radius, holeZ])];
    const [a1, b1] = [project([x1, holeY + radius, holeZ]), project([x1, holeY - radius, holeZ])];
    return `<path fill="${PAPER}" d="${flat([a0, a1, b1, b0])}"/>`;
  };
  const nockX = -1.2;
  const tipX = 11 * gap + 0.42;
  const head = `<path fill="${PAPER}" d="${flat(toScreen([[tipX, holeY + 0.03, holeZ], [tipX + 0.16, holeY, holeZ], [tipX, holeY - 0.03, holeZ]]))}"/>`;
  // The hall floor, a shade lighter than the dark beyond it, so the hafts stand on something.
  const floor = `<path fill="#36221F" d="${flat(toScreen([[-0.45, 0, 2.26], [90, 0, 2.26], [90, 0, -60], [-0.45, 0, -60]]))}"/>`;
  const layers = [floor, head, rod(11 * gap, tipX)];
  for (let i = 11; i >= 0; i -= 1) {
    layers.push(axe(i * gap));
    layers.push(rod(i === 0 ? nockX : (i - 1) * gap, i * gap));
  }

  return frame({
    id: 'the-odyssey-2026',
    label: 'The Odyssey (2026), directed by Christopher Nolan: an arrow’s flight through the holes of twelve axe heads',
    ground,
    titleLines: ['THE', 'ODYSSEY'],
    titleInk: PAPER,
    creditInk: mix(PAPER, DUST, 0.45),
    director: 'Christopher Nolan',
    year: 2026,
    art: layers.join(''),
  });
}

// La La Land: magic hour on the hill above the city, one street lamp, and the city's lights under the stars.
function laLaLand() {
  const bands = [
    [0, '#151D27'],
    [168, '#202C39'],
    [282, '#33475A'],
    [378, '#536C80'],
    [452, '#8199A8'],
    [506, '#B9AFA2'],
    [532, '#D3B595'],
  ];
  const horizon = 548;
  const sky = bands
    .map(([y, colour], i) => {
      const next = i + 1 < bands.length ? bands[i + 1][0] : horizon;
      return `<rect x="0" y="${y}" width="${W}" height="${next - y}" fill="${colour}"/>`;
    })
    .join('');

  // Deterministic scatter so a re-run draws the same sky.
  let seed = 1916;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const stars = Array.from({ length: 34 }, () => {
    const x = 18 + rand() * (W - 36);
    const y = 26 + rand() ** 1.4 * 250;
    const r = 0.7 + rand() ** 3 * 1.9;
    return circle(x, y, r);
  }).join('');

  const valley = `<rect x="0" y="${horizon}" width="${W}" height="70" fill="#1A222C"/>`;
  const cityLights = [];
  for (let row = 0; row < 5; row += 1) {
    const y = horizon + 6 + row * (4 + row * 1.6);
    const step = 9 + row * 3.5;
    for (let x = 4 + (row % 2) * step * 0.5; x < W; x += step) {
      if (rand() < 0.62) cityLights.push(circle(x + rand() * 3, y, 1 + row * 0.22));
    }
  }

  const lampX = 432;
  const crest = (x) => 590 - 80 * (x / W) ** 1.7;
  const hillPoints = [];
  for (let x = 0; x <= W; x += 20) hillPoints.push([x, crest(x)]);
  const hill = `M0 ${H}L${hillPoints.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}L${W} ${H}Z`;
  const base = crest(lampX);
  const globeY = 318;
  const post =
    poly([[lampX - 3.2, base], [lampX - 3.2, globeY + 34], [lampX + 3.2, globeY + 34], [lampX + 3.2, base]]) +
    poly([[lampX - 8, base + 2], [lampX - 5, base - 26], [lampX + 5, base - 26], [lampX + 8, base + 2]]) +
    poly([[lampX - 6, globeY + 36], [lampX - 4, globeY + 22], [lampX + 4, globeY + 22], [lampX + 6, globeY + 36]]) +
    poly([[lampX - 9, globeY - 17], [lampX, globeY - 30], [lampX + 9, globeY - 17]]) +
    circle(lampX, globeY - 32, 2.4);
  const glow = [
    [64, mix('#33475A', '#D3B595', 0.14)],
    [34, mix('#33475A', '#D3B595', 0.34)],
  ]
    .map(([r, colour]) => `<path fill="${colour}" d="${circle(lampX, globeY, r)}"/>`)
    .join('');
  const globe = `<ellipse cx="${lampX}" cy="${globeY}" rx="11" ry="16" fill="${PAPER}"/>`;

  return frame({
    id: 'la-la-land',
    label: 'La La Land (2016), directed by Damien Chazelle: a street lamp on the hill at magic hour',
    ground: bands[0][1],
    titleLines: ['LA LA', 'LAND'],
    titleInk: PAPER,
    creditInk: mix(PAPER, DUST, 0.45),
    director: 'Damien Chazelle',
    year: 2016,
    art:
      sky +
      `<path fill="${mix(PAPER, '#D3B595', 0.2)}" d="${stars}"/>` +
      valley +
      `<path fill="#E6C389" d="${cityLights.join('')}"/>` +
      glow +
      `<path fill="${INK}" d="${hill}"/><path fill="${INK}" d="${post}"/>` +
      globe,
  });
}

// Chungking Express: a tin of pineapple with the expiry date stamped on it, 1 May.
function chungkingExpress() {
  const cx = 300;
  const halfW = 122;
  const top = 168;
  const bottom = 508;
  const ry = 26;
  const left = cx - halfW;
  const right = cx + halfW;
  const tin = '#B9B2A5';
  const tinShade = '#8D8579';
  const label = '#D4A848';
  const labelShade = '#B88A33';
  const labelTop = top + 30;
  const labelBottom = bottom - 32;

  const body = `M${left} ${top}V${bottom}A${halfW} ${ry} 0 0 0 ${right} ${bottom}V${top}Z`;
  const lid = `<ellipse cx="${cx}" cy="${top}" rx="${halfW}" ry="${ry}" fill="${tin}"/>` +
    `<ellipse cx="${cx}" cy="${top + 1}" rx="${halfW - 9}" ry="${ry - 5}" fill="${tinShade}"/>` +
    `<ellipse cx="${cx}" cy="${top + 2}" rx="${halfW - 14}" ry="${ry - 8}" fill="${tin}"/>` +
    [0.78, 0.56, 0.34]
      .map((t) => `<ellipse cx="${cx}" cy="${top + 2}" rx="${(halfW - 14) * t}" ry="${(ry - 8) * t}" fill="none" stroke="${tinShade}" stroke-width="1.6"/>`)
      .join('');
  const band = (y0, y1) => `M${left} ${y0}A${halfW} ${ry} 0 0 0 ${right} ${y0}V${y1}A${halfW} ${ry} 0 0 1 ${left} ${y1}Z`;
  const ridges = [top + 10, top + 18, bottom - 12, bottom - 20]
    .map((y) => `M${left} ${y}A${halfW} ${ry} 0 0 0 ${right} ${y}`)
    .join('');
  const labelBand = band(labelTop, labelBottom);
  const shadeStrip = `M${right - 46} ${labelTop + 22}V${labelBottom + 22}A${halfW} ${ry} 0 0 0 ${right} ${labelBottom}V${labelTop}A${halfW} ${ry} 0 0 1 ${right - 46} ${labelTop + 22}Z`;
  const pinstripes = [labelTop + 9, labelBottom - 9]
    .map((y) => `M${left} ${y}A${halfW} ${ry} 0 0 0 ${right} ${y}`)
    .join('');

  // A pineapple ring on the label, foreshortened a little by the curve of the tin.
  const ringY = 340;
  const ring =
    `<ellipse cx="${cx}" cy="${ringY}" rx="70" ry="66" fill="#F0D98A"/>` +
    `<ellipse cx="${cx}" cy="${ringY}" rx="70" ry="66" fill="none" stroke="${INK}" stroke-width="2.4"/>` +
    `<ellipse cx="${cx}" cy="${ringY}" rx="58" ry="55" fill="none" stroke="#C99A3A" stroke-width="1.4"/>` +
    Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      return `<line x1="${n(cx + Math.cos(a) * 26)}" y1="${n(ringY + Math.sin(a) * 25)}" x2="${n(cx + Math.cos(a) * 54)}" y2="${n(ringY + Math.sin(a) * 51)}" stroke="#C99A3A" stroke-width="1.1"/>`;
    }).join('') +
    `<ellipse cx="${cx}" cy="${ringY}" rx="21" ry="20" fill="${label}" stroke="${INK}" stroke-width="2.4"/>`;
  const labelWord = setLine('gothic', 'PINEAPPLE SLICES', { x: cx, y: labelTop + 62, size: 30, anchor: 'middle', tracking: 60 });

  const highlight = `M${left + 22} ${top + 30}V${bottom - 8}H${left + 30}V${top + 30}Z M${left + 38} ${top + 30}V${bottom - 6}H${left + 41}V${top + 30}Z`;

  // The stamp is pressed on after printing, so it sits over the tin at its own angle with its own ink.
  const stampW = 196;
  const stampH = 84;
  const stampX = 292;
  const stampY = 404;
  const stampWord = setLine('mono', 'EXP', { x: stampX + 16, y: stampY + 30, size: 17, tracking: 40 });
  const stampDate = setLine('mono', '01 MAY 94', { x: stampX + stampW / 2, y: stampY + 68, size: 32, anchor: 'middle', tracking: 20 });
  const stamp = `<g transform="rotate(-9 ${stampX + stampW / 2} ${stampY + stampH / 2})" filter="url(#stamp)" style="mix-blend-mode:multiply">
<rect x="${stampX}" y="${stampY}" width="${stampW}" height="${stampH}" rx="5" fill="none" stroke="${THREAD}" stroke-width="4"/>
<rect x="${stampX + 6}" y="${stampY + 6}" width="${stampW - 12}" height="${stampH - 12}" rx="2" fill="none" stroke="${THREAD}" stroke-width="1.5"/>
<path fill="${THREAD}" d="${stampWord.d}${stampDate.d}"/>
</g>`;

  return frame({
    id: 'chungking-express',
    label: 'Chungking Express (1994), directed by Wong Kar-wai: a tin of pineapple stamped with its expiry date, 1 May',
    ground: PAPER,
    titleLines: ['CHUNGKING', 'EXPRESS'],
    titleInk: INK,
    creditInk: INK,
    director: 'Wong Kar-wai',
    year: 1994,
    art:
      `<ellipse cx="${cx + 34}" cy="${bottom + 6}" rx="${halfW + 10}" ry="16" fill="${mix(PAPER, INK, 0.12)}"/>` +
      `<path fill="${tin}" d="${body}"/>` +
      `<path fill="${label}" d="${labelBand}"/><path fill="${labelShade}" d="${shadeStrip}"/>` +
      `<path fill="none" stroke="${THREAD}" stroke-width="2.2" d="${pinstripes}"/>` +
      `<path fill="none" stroke="${tinShade}" stroke-width="1.6" d="${ridges}"/>` +
      `<path fill="${mix(PAPER, '#FFFFFF', 0.4)}" opacity="0.55" d="${highlight}"/>` +
      ring +
      `<path fill="${INK}" d="${labelWord.d}"/>` +
      lid,
    overlay: stamp,
  });
}

// Marty Supreme: a 1950s hardbat, pimpled rubber on wood, the ball just off it, the net and the table below.
function martySupreme() {
  const table = '#16201C';
  const face = { x: 352, y: 268 };
  const tilt = -32;
  const bladeR = 176;
  const rubberR = 166;
  const rubber = THREAD;
  const pimple = '#8F3121';
  const wood = '#7A5534';
  const woodDark = '#4E3420';

  const pimples = [];
  const pitch = 12.5;
  for (let row = -15; row <= 15; row += 1) {
    for (let col = -15; col <= 15; col += 1) {
      const x = col * pitch + (row % 2 ? pitch / 2 : 0);
      const y = row * pitch * 0.866;
      if (Math.hypot(x, y) < rubberR - 7) pimples.push(circle(face.x + x, face.y + y, 3.1));
    }
  }
  const handle = `<g transform="rotate(${tilt} ${face.x} ${face.y})">` +
    `<path fill="${wood}" d="M${face.x - 26} ${face.y + bladeR - 24}C${face.x - 24} ${face.y + bladeR + 30} ${face.x - 30} ${face.y + bladeR + 70} ${face.x - 22} ${face.y + bladeR + 128}` +
    `Q${face.x} ${face.y + bladeR + 142} ${face.x + 22} ${face.y + bladeR + 128}C${face.x + 30} ${face.y + bladeR + 70} ${face.x + 24} ${face.y + bladeR + 30} ${face.x + 26} ${face.y + bladeR - 24}Z"/>` +
    `<path fill="none" stroke="${woodDark}" stroke-width="1.6" d="M${face.x - 8} ${face.y + bladeR + 6}C${face.x - 10} ${face.y + bladeR + 50} ${face.x - 6} ${face.y + bladeR + 90} ${face.x - 9} ${face.y + bladeR + 124}` +
    `M${face.x + 9} ${face.y + bladeR + 2}C${face.x + 7} ${face.y + bladeR + 44} ${face.x + 12} ${face.y + bladeR + 92} ${face.x + 8} ${face.y + bladeR + 126}"/>` +
    `<path fill="none" stroke="${INK}" stroke-width="2.2" d="M${face.x - 26} ${face.y + bladeR + 26}H${face.x + 26}M${face.x - 26} ${face.y + bladeR + 33}H${face.x + 26}"/>` +
    '</g>';
  const blade =
    `<path fill="${wood}" d="${circle(face.x, face.y, bladeR)}"/>` +
    `<path fill="${rubber}" d="${circle(face.x, face.y, rubberR)}"/>` +
    `<path fill="${pimple}" d="${pimples.join('')}"/>`;

  // The ball has just left the rubber; its earlier positions trail back toward the bat.
  const ball = { x: 112, y: 158 };
  const trail = [0.22, 0.38, 0.52, 0.64, 0.74]
    .map((t, i) => {
      const x = ball.x + (face.x - rubberR * 0.75 - ball.x) * (1 - t) * 0.95;
      const y = ball.y + (face.y - rubberR * 0.55 - ball.y) * (1 - t) * 0.95 + Math.sin(t * Math.PI) * 10;
      return circle(x, y, 2.2 + i * 0.5);
    })
    .join('');
  const ballMark = `<path fill="${INK}" d="${trail}"/>` +
    `<path fill="#F7F1E3" stroke="${INK}" stroke-width="2.4" d="${circle(ball.x, ball.y, 21)}"/>`;

  const netTop = 492;
  const netBottom = 536;
  const mesh = [];
  for (let x = 0; x <= W; x += 7) mesh.push(`M${x} ${netTop}V${netBottom}`);
  for (let y = netTop + 7; y < netBottom; y += 7) mesh.push(`M0 ${y}H${W}`);
  const net =
    `<path fill="none" stroke="${INK}" stroke-width="1.1" opacity="0.85" d="${mesh.join('')}"/>` +
    `<rect x="0" y="${netTop - 7}" width="${W}" height="8" fill="#F7F1E3"/>` +
    `<path fill="none" stroke="${INK}" stroke-width="1.6" d="M0 ${netTop - 7}H${W}M0 ${netTop + 1}H${W}"/>`;
  const tableTop = `<rect x="0" y="${netBottom}" width="${W}" height="${H - netBottom}" fill="${table}"/>` +
    `<rect x="0" y="${netBottom + 12}" width="${W}" height="4" fill="#F7F1E3"/>`;

  return frame({
    id: 'marty-supreme',
    label: 'Marty Supreme (2025), directed by Josh Safdie: a hardbat table tennis paddle, the ball and the net',
    ground: PAPER,
    titleLines: ['MARTY', 'SUPREME'],
    titleInk: PAPER,
    creditInk: mix(PAPER, DUST, 0.45),
    director: 'Josh Safdie',
    year: 2025,
    art: tableTop + net + handle + blade + ballMark,
  });
}

export const POSTERS = [odyssey, laLaLand, chungkingExpress, martySupreme];
