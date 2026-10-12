// Small easing toolkit for the camera glides (replaces Henry's tween.js + bezier-easing dependencies).

export type Easing = (t: number) => number;

export const easeInOutQuint: Easing = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2);

export const easeOutExpo: Easing = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

/** CSS-style cubic-bezier(x1, y1, x2, y2): solve x(s) = t by Newton steps with a bisection fallback, return y(s). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const bezier = (s: number, p1: number, p2: number) => 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s ** 2 * p2 + s ** 3;
  const slope = (s: number, p1: number, p2: number) => 3 * (1 - s) ** 2 * p1 + 6 * (1 - s) * s * (p2 - p1) + 3 * s ** 2 * (1 - p2);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 6; i++) {
      const dx = slope(s, x1, x2);
      if (Math.abs(dx) < 1e-6) break;
      s -= (bezier(s, x1, x2) - t) / dx;
    }
    if (s < 0 || s > 1 || Math.abs(bezier(s, x1, x2) - t) > 1e-4) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        s = (lo + hi) / 2;
        if (bezier(s, x1, x2) < t) lo = s;
        else hi = s;
      }
    }
    return bezier(s, y1, y2);
  };
}

/** Henry's glide into the monitor: fast start, long settle. */
export const easeIntoMonitor = cubicBezier(0.13, 0.99, 0, 1);

/** Frame-rate independent exponential approach: the fraction of the remaining gap to close this frame. */
export const damp = (lambda: number, dtSeconds: number) => 1 - Math.exp(-lambda * dtSeconds);
