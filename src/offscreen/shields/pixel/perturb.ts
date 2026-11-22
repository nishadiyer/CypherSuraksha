/** Pure pixel math for the Pixel Shield. No DOM, no I/O, so it is unit-testable. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** strength 0..1 -> L-infinity budget in 8-bit levels (2..8). Keeps changes near the visibility floor. */
export function epsLevels(strength: number): number {
  const s = Math.min(1, Math.max(0, strength));
  return Math.round(2 + s * 6);
}

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Deterministic-fallback cloak: structured sign noise with a shared per-pixel
 * luminance component plus a small per-channel component, bounded by eps.
 * This is NOT a learned adversarial perturbation; it is the stand-in used when
 * no cloaking model is installed (see MODELS.md).
 */
export function applySignNoise(rgba: Uint8ClampedArray, eps: number, rng: () => number): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const lum = rng() < 0.5 ? -1 : 1;
    for (let c = 0; c < 3; c++) {
      const sign = rng() < 0.25 ? -lum : lum;
      rgba[i + c] = clamp8(rgba[i + c]! + sign * eps);
    }
  }
}

/**
 * Applies a model-produced perturbation `delta` (planar CHW, units of 0..1,
 * size dw x dh) to a full-resolution RGBA buffer using bilinear sampling,
 * hard-clamped to +/- eps levels so output stays visually identical.
 */
export function applyDelta(rgba: Uint8ClampedArray, w: number, h: number, delta: Float32Array, dw: number, dh: number, eps: number): void {
  const plane = dw * dh;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(dh - 1, (y + 0.5) * (dh / h) - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(dh - 1, y0 + 1);
    const ty = Math.max(0, fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = Math.min(dw - 1, (x + 0.5) * (dw / w) - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(dw - 1, x0 + 1);
      const tx = Math.max(0, fx - x0);
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const b = c * plane;
        const top = delta[b + y0 * dw + x0]! * (1 - tx) + delta[b + y0 * dw + x1]! * tx;
        const bot = delta[b + y1 * dw + x0]! * (1 - tx) + delta[b + y1 * dw + x1]! * tx;
        const d = Math.max(-eps, Math.min(eps, (top * (1 - ty) + bot * ty) * 255));
        rgba[o + c] = clamp8(rgba[o + c]! + d);
      }
    }
  }
}

/** RGBA (any size) -> float32 planar CHW in 0..1. */
export function rgbaToChw(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let i = 0, p = 0; p < plane; p++, i += 4) {
    out[p] = rgba[i]! / 255;
    out[plane + p] = rgba[i + 1]! / 255;
    out[2 * plane + p] = rgba[i + 2]! / 255;
  }
  return out;
}

/** Max absolute per-channel difference between two RGBA buffers (RGB only). */
export function maxAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let m = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a[i + c]! - b[i + c]!));
  }
  return m;
}
