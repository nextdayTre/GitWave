/**
 * spline.ts — monotone cubic Hermite (Fritsch–Butland interior weights, zero
 * end tangents), the same curve contract as the sister instrument.
 *
 * The curve may not overshoot the values it is drawn from: the level is 0–15,
 * and the curve must never imply a level the slot does not hold.
 */

export interface Spline {
  xs: number[];
  ys: number[];
  m: number[];
  h: number[];
  n: number;
}

export function buildSpline(xs: number[], ys: number[]): Spline | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const h = new Array<number>(n - 1);
  const d = new Array<number>(n - 1);
  const m = new Array<number>(n);
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = h[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / h[i];
  }
  m[0] = 0;
  m[n - 1] = 0;
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return { xs: xs.slice(0, n), ys: ys.slice(0, n), m, h, n };
}

export function evalSpline(sp: Spline, x: number): number {
  const { xs, ys, m, h, n } = sp;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  if (!(h[i] > 0)) return ys[i];
  const t = (x - xs[i]) / h[i];
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * ys[i] +
    (t3 - 2 * t2 + t) * h[i] * m[i] +
    (-2 * t3 + 3 * t2) * ys[i + 1] +
    (t3 - t2) * h[i] * m[i + 1]
  );
}
