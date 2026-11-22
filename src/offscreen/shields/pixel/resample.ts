/**
 * Separable bilinear resampling over planar CHW float32 images, plus its exact adjoint.
 * The adjoint is what lets a gradient computed on a resized crop be pulled back onto the
 * source image (the "expectation over transformations" step of the PGD cloak).
 * Pure math: no DOM, no I/O.
 */

export interface Taps {
  /** first source index per output sample (clamped, so edges replicate) */
  i0: Int32Array;
  /** second source index per output sample (clamped) */
  i1: Int32Array;
  /** weight of i1; weight of i0 is 1 - w1 */
  w1: Float32Array;
}

/** Output sample j reads the source at `start + (j + 0.5) * span / nOut - 0.5` (pixel-centre convention). */
export function makeTaps(nOut: number, start: number, span: number, nIn: number): Taps {
  const i0 = new Int32Array(nOut);
  const i1 = new Int32Array(nOut);
  const w1 = new Float32Array(nOut);
  const hi = nIn - 1;
  for (let j = 0; j < nOut; j++) {
    const pos = start + ((j + 0.5) * span) / nOut - 0.5;
    const lo = Math.floor(pos);
    w1[j] = pos - lo;
    i0[j] = Math.min(hi, Math.max(0, lo));
    i1[j] = Math.min(hi, Math.max(0, lo + 1));
  }
  return { i0, i1, w1 };
}

/** dst[c][j][i] = bilinear sample of src[c] (sw x sh). dst is dw x dh where dw = tx.i0.length, dh = ty.i0.length. */
export function resample(src: Float32Array, sw: number, sh: number, tx: Taps, ty: Taps, dst: Float32Array): void {
  const dw = tx.i0.length;
  const dh = ty.i0.length;
  const sp = sw * sh;
  const dp = dw * dh;
  for (let c = 0; c < 3; c++) {
    const sb = c * sp;
    const db = c * dp;
    for (let j = 0; j < dh; j++) {
      const ra = sb + ty.i0[j]! * sw;
      const rb = sb + ty.i1[j]! * sw;
      const wy = ty.w1[j]!;
      for (let i = 0; i < dw; i++) {
        const xa = tx.i0[i]!;
        const xb = tx.i1[i]!;
        const wx = tx.w1[i]!;
        const top = src[ra + xa]! * (1 - wx) + src[ra + xb]! * wx;
        const bot = src[rb + xa]! * (1 - wx) + src[rb + xb]! * wx;
        dst[db + j * dw + i] = top * (1 - wy) + bot * wy;
      }
    }
  }
}

/** Transpose of `resample`: scatters dg (3 x dh x dw) into acc (3 x sh x sw), adding. */
export function resampleAdjoint(dg: Float32Array, sw: number, sh: number, tx: Taps, ty: Taps, acc: Float32Array): void {
  const dw = tx.i0.length;
  const dh = ty.i0.length;
  const sp = sw * sh;
  const dp = dw * dh;
  for (let c = 0; c < 3; c++) {
    const sb = c * sp;
    const db = c * dp;
    for (let j = 0; j < dh; j++) {
      const ra = sb + ty.i0[j]! * sw;
      const rb = sb + ty.i1[j]! * sw;
      const wy = ty.w1[j]!;
      for (let i = 0; i < dw; i++) {
        const xa = tx.i0[i]!;
        const xb = tx.i1[i]!;
        const wx = tx.w1[i]!;
        const g = dg[db + j * dw + i]!;
        const gt = g * (1 - wy);
        const gb = g * wy;
        acc[ra + xa] = acc[ra + xa]! + gt * (1 - wx);
        acc[ra + xb] = acc[ra + xb]! + gt * wx;
        acc[rb + xa] = acc[rb + xa]! + gb * (1 - wx);
        acc[rb + xb] = acc[rb + xb]! + gb * wx;
      }
    }
  }
}
