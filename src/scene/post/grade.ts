// The room's finishing grade as a 3D lookup table, built in the browser: no file to download. It maps a display colour
// (what the canvas would show) to the graded display colour. The bake is already Blender's AgX render, so the table
// re-exposes it through a tone curve and then warms it in the room's palette.

export type ToneOperator = 'none' | 'agx' | 'aces';

export interface GradeSettings {
  /** The tone curve applied to the bake's light after `exposure`: 'none' only scales and clips. */
  tone: ToneOperator;
  /** Stops of exposure before the tone curve. */
  exposure: number;
  /**
   * Display brightness over which the tone curve fades in. The bake's shadows already went through Blender's AgX, and a
   * second curve's toe would crush them to black; below the first value they keep the bake's colour.
   */
  toe: [number, number];
  /**
   * 0 tones each channel on its own (bright oranges drift to yellow, as film does); 1 tones the brightest channel and
   * keeps the colour's ratios, so the oven and the lamp shade stay orange.
   */
  keepHue: number;
  /** 0 leaves the toned colour as it is, 1 applies the full warm grade. */
  strength: number;
}

export const LUT_SIZE = 32;

type Vec3 = [number, number, number];
/** Columns, as GLSL's mat3(vec3, vec3, vec3). */
type Mat3 = readonly [Vec3, Vec3, Vec3];

const mul = (m: Mat3, [x, y, z]: Vec3): Vec3 => [
  m[0][0] * x + m[1][0] * y + m[2][0] * z,
  m[0][1] * x + m[1][1] * y + m[2][1] * z,
  m[0][2] * x + m[1][2] * y + m[2][2] * z,
];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const luma = ([r, g, b]: Vec3) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// The operators below are three.js r186's (tonemapping_pars_fragment), ported line for line so the table matches what
// `renderer.toneMapping` would draw.
const ACES_IN: Mat3 = [
  [0.59719, 0.076, 0.0284],
  [0.35458, 0.90834, 0.13383],
  [0.04823, 0.01566, 0.83777],
];
const ACES_OUT: Mat3 = [
  [1.60475, -0.10208, -0.00327],
  [-0.53108, 1.10813, -0.07276],
  [-0.07367, -0.00605, 1.07602],
];
const rrtOdt = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);

function aces(color: Vec3): Vec3 {
  const fitted = mul(ACES_IN, color.map((v) => v / 0.6) as Vec3).map(rrtOdt) as Vec3;
  return mul(ACES_OUT, fitted).map(clamp01) as Vec3;
}

const REC2020_TO_SRGB: Mat3 = [
  [1.6605, -0.1246, -0.0182],
  [-0.5876, 1.1329, -0.1006],
  [-0.0728, -0.0083, 1.1187],
];
const SRGB_TO_REC2020: Mat3 = [
  [0.6274, 0.0691, 0.0164],
  [0.3293, 0.9195, 0.088],
  [0.0433, 0.0113, 0.8956],
];
const AGX_INSET: Mat3 = [
  [0.856627153315983, 0.137318972929847, 0.11189821299995],
  [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
  [0.0482516061458583, 0.101439036467562, 0.811302368396859],
];
const AGX_OUTSET: Mat3 = [
  [1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
  [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
  [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405],
];
const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;
const agxSigmoid = (x: number) => {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
};

function agx(color: Vec3): Vec3 {
  const inset = mul(AGX_INSET, mul(SRGB_TO_REC2020, color));
  const curved = inset.map((v) => agxSigmoid(clamp01((Math.log2(Math.max(v, 1e-10)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV)))) as Vec3;
  const linear = mul(AGX_OUTSET, curved).map((v) => Math.max(0, v) ** 2.2) as Vec3;
  return mul(REC2020_TO_SRGB, linear).map(clamp01) as Vec3;
}

const OPERATORS: Record<ToneOperator, (color: Vec3) => Vec3> = {
  none: (color) => color.map(clamp01) as Vec3,
  agx,
  aces,
};

// The palette's ends as tints of unit luminance: ink #14110F for the shadows, paper #EDE4D3 for the highlights.
const tint = (rgb: Vec3): Vec3 => {
  const l = luma(rgb);
  return rgb.map((v) => v / l) as Vec3;
};
const INK = tint([20, 17, 15]);
const PAPER = tint([237, 228, 211]);
const SHADOW_TINT = 0.3;
const HIGHLIGHT_TINT = 0.55;
const CONTRAST = 0.15;
const SATURATION = 0.94;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** The warm grade on a display colour: a gentle S-curve on luminance, ink in the shadows, paper in the highlights. */
export function warmGrade(color: Vec3): Vec3 {
  const l = luma(color);
  if (l <= 0) return [0, 0, 0];
  const curved = l + CONTRAST * l * (1 - l) * (2 * l - 1);
  const shadows = (1 - smoothstep(0, 0.45, curved)) * SHADOW_TINT;
  const highlights = smoothstep(0.45, 1, curved) * HIGHLIGHT_TINT;
  const scaled = color.map((v, i) => (v * curved) / l * (1 + (INK[i] - 1) * shadows + (PAPER[i] - 1) * highlights)) as Vec3;
  const graded = luma(scaled);
  return scaled.map((v) => clamp01(graded + (v - graded) * SATURATION)) as Vec3;
}

/** One table entry: display colour in, graded display colour out. */
export function gradeColor(display: Vec3, settings: GradeSettings): Vec3 {
  const gain = 2 ** settings.exposure;
  const operator = OPERATORS[settings.tone];
  const scene = display.map((v) => decode(v) * gain) as Vec3;
  const perChannel = operator(scene);
  const peak = Math.max(...scene);
  const peakToned = peak > 0 ? Math.max(...operator([peak, peak, peak])) / peak : 0;
  const curve = perChannel.map((v, i) => encode(v + (scene[i] * peakToned - v) * settings.keepHue)) as Vec3;
  const fade = smoothstep(settings.toe[0], settings.toe[1], luma(display));
  const toned = display.map((v, i) => v + (curve[i] - v) * fade) as Vec3;
  const graded = warmGrade(toned);
  return toned.map((v, i) => v + (graded[i] - v) * settings.strength) as Vec3;
}

/** The table as RGBA bytes, red fastest, for a Data3DTexture of LUT_SIZE³. */
export function buildGradeLut(settings: GradeSettings, size = LUT_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const out = gradeColor([r / (size - 1), g / (size - 1), b / (size - 1)], settings);
        data[i++] = Math.round(out[0] * 255);
        data[i++] = Math.round(out[1] * 255);
        data[i++] = Math.round(out[2] * 255);
        data[i++] = 255;
      }
  return data;
}
