// The banding metric (scripts/measure-banding.mjs, tests/banding.test.ts): how posterised a dark, smooth gradient
// looks in a captured frame. Banding is a smooth ramp drawn as flat 8-bit steps with hard edges between them; a
// dithered ramp breaks every step into fine noise that the eye averages back into the ramp.
//
//   run     the mean width of a flat step: along every row and column of a channel, the runs of identical 8-bit
//           values, weighted by the pixels in them (Σ len² / Σ len), in CSS pixels, averaged over R, G and B.
//           A banded dark gradient has steps tens of pixels wide; a dithered one, or a textured surface, 1–3.
//   ripple  the staircase the eye still sees: the frame blurred at the eye's scale (σ 1 CSS px) minus its smooth
//           trend (σ 8 CSS px), RMS in 8-bit levels, averaged over R, G and B. Dither noise that the eye averages
//           away does not count; steps that survive the blur do. On the same frame, a drop is less visible banding.
//
// Steps that are in the texture itself (an 8-bit atlas holding the same value over many texels) stay flat whatever
// the output does, so both numbers also show banding that only the atlases can remove.

export const EYE_SIGMA_CSS = 1;
export const TREND_SIGMA_CSS = 8;

/** One channel (0 = R, 1 = G, 2 = B) of an RGB buffer's rectangle, as 8-bit values. */
export function channel(rgb, frameWidth, rect, c) {
  const out = new Uint8Array(rect.width * rect.height);
  for (let r = 0; r < rect.height; r++) {
    for (let x = 0; x < rect.width; x++) out[r * rect.width + x] = rgb[((rect.top + r) * frameWidth + rect.left + x) * 3 + c];
  }
  return out;
}

/** Luma 0–255 (Rec. 709 weights) of a whole RGB frame. */
export function luma(rgb, width, height) {
  const y = new Float32Array(width * height);
  for (let i = 0; i < y.length; i++) y[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  return y;
}

/** Pixel-weighted mean length of the runs of identical values along rows and columns (device pixels). */
export function meanRun(values, width, height) {
  let squares = 0;
  let pixels = 0;
  const flush = (length) => {
    squares += length * length;
    pixels += length;
  };
  for (let r = 0; r < height; r++) {
    let length = 1;
    for (let x = 1; x < width; x++) {
      if (values[r * width + x] === values[r * width + x - 1]) length++;
      else (flush(length), (length = 1));
    }
    flush(length);
  }
  for (let x = 0; x < width; x++) {
    let length = 1;
    for (let r = 1; r < height; r++) {
      if (values[r * width + x] === values[(r - 1) * width + x]) length++;
      else (flush(length), (length = 1));
    }
    flush(length);
  }
  return squares / pixels;
}

/** Separable Gaussian blur, edges clamped. */
export function blur(values, width, height, sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) total += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
  const across = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += kernel[k + radius] * values[r * width + Math.min(width - 1, Math.max(0, x + k))];
      across[r * width + x] = sum;
    }
  }
  for (let r = 0; r < height; r++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += kernel[k + radius] * across[Math.min(height - 1, Math.max(0, r + k)) * width + x];
      out[r * width + x] = sum;
    }
  }
  return out;
}

/**
 * RMS of (eye blur − trend) over `rect`. The blurs run on the rectangle grown by the trend's reach on each side
 * (clamped to the frame), so the rectangle's own border is not smeared by the clamp.
 */
export function ripple(rgb, frameWidth, frameHeight, rect, c, dpr) {
  const reach = Math.ceil(TREND_SIGMA_CSS * dpr * 3);
  const left = Math.max(0, rect.left - reach);
  const top = Math.max(0, rect.top - reach);
  const grown = { left, top, width: Math.min(frameWidth, rect.left + rect.width + reach) - left, height: Math.min(frameHeight, rect.top + rect.height + reach) - top };
  const values = channel(rgb, frameWidth, grown, c);
  const eye = blur(values, grown.width, grown.height, EYE_SIGMA_CSS * dpr);
  const trend = blur(values, grown.width, grown.height, TREND_SIGMA_CSS * dpr);
  let sum = 0;
  for (let r = 0; r < rect.height; r++) {
    for (let x = 0; x < rect.width; x++) {
      const i = (rect.top - top + r) * grown.width + rect.left - left + x;
      sum += (eye[i] - trend[i]) ** 2;
    }
  }
  return Math.sqrt(sum / (rect.width * rect.height));
}

/** `run` (CSS px) and `ripple` (levels) for one rectangle of a frame, each the mean over R, G and B. */
export function bandingOf(rgb, frameWidth, frameHeight, rect, dpr) {
  let run = 0;
  let rip = 0;
  for (let c = 0; c < 3; c++) {
    run += meanRun(channel(rgb, frameWidth, rect, c), rect.width, rect.height) / dpr / 3;
    rip += ripple(rgb, frameWidth, frameHeight, rect, c, dpr) / 3;
  }
  return { run: Number(run.toFixed(2)), ripple: Number(rip.toFixed(3)) };
}

/**
 * The darkest smooth gradients of a frame: windows of `size` CSS px (stepped by a sixth of it) whose mean luma is in
 * `dark` (below 5, steps do not show on a screen), with no edge or texture in them (the steepest 1% of the σ 2 CSS px
 * blur's gradient under `maxSlope` levels per CSS px) and a real gradient across them (the trend spans at least
 * `minSpan` levels inside the window's middle, where no edge outside it can reach). The `count` darkest that do not
 * overlap each other or `avoid` (rectangles in device px, e.g. the monitor's OS).
 */
export function findDarkGradients(rgb, width, height, dpr, { count = 4, size = [192, 120], dark = [5, 48], maxSlope = 0.6, minSpan = 2, avoid = [] } = {}) {
  const y = luma(rgb, width, height);
  const smooth = blur(y, width, height, 2 * dpr);
  const trend = blur(y, width, height, TREND_SIGMA_CSS * dpr);
  const slope = new Float32Array(width * height);
  for (let r = 1; r < height - 1; r++) {
    for (let x = 1; x < width - 1; x++) {
      const i = r * width + x;
      slope[i] = (Math.hypot(smooth[i + 1] - smooth[i - 1], smooth[i + width] - smooth[i - width]) / 2) * dpr;
    }
  }
  const w = Math.round(size[0] * dpr);
  const h = Math.round(size[1] * dpr);
  const step = Math.round(Math.min(w, h) / 6);
  const inset = Math.round(2 * TREND_SIGMA_CSS * dpr);
  const overlaps = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  const candidates = [];
  for (let top = 0; top + h <= height; top += step) {
    for (let left = 0; left + w <= width; left += step) {
      const rect = { left, top, width: w, height: h };
      if (avoid.some((a) => overlaps(rect, a))) continue;
      let mean = 0;
      let lo = Infinity;
      let hi = -Infinity;
      const slopes = [];
      // Every second pixel is plenty to rank a window.
      for (let r = top; r < top + h; r += 2) {
        for (let x = left; x < left + w; x += 2) {
          const i = r * width + x;
          mean += y[i];
          slopes.push(slope[i]);
          if (r < top + inset || r >= top + h - inset || x < left + inset || x >= left + w - inset) continue;
          lo = Math.min(lo, trend[i]);
          hi = Math.max(hi, trend[i]);
        }
      }
      mean /= slopes.length;
      if (mean < dark[0] || mean > dark[1] || hi - lo < minSpan) continue;
      slopes.sort((a, b) => b - a);
      const steep = slopes.slice(0, Math.ceil(slopes.length * 0.01));
      if (steep.reduce((s, v) => s + v, 0) / steep.length > maxSlope) continue;
      candidates.push({ rect, mean, span: hi - lo });
    }
  }
  candidates.sort((a, b) => a.mean - b.mean || b.span - a.span);
  const chosen = [];
  for (const c of candidates) {
    if (chosen.length === count) break;
    if (chosen.every((o) => !overlaps(o.rect, c.rect))) chosen.push(c);
  }
  return chosen.map(({ rect, mean, span }) => ({ ...rect, luma: Number(mean.toFixed(1)), span: Number(span.toFixed(1)) }));
}
