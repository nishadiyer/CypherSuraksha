import { describe, expect, it } from 'vitest';
import { applyRegionDelta, newApplied, CROP, GRID, optimizeDelta, type Embedder, type Region } from '../src/offscreen/shields/pixel/cloakPgd';
import { decode, nms, priors } from '../src/offscreen/shields/pixel/faceDetect';
import { mulberry32 } from '../src/offscreen/shields/pixel/perturb';
import { makeTaps, resample, resampleAdjoint } from '../src/offscreen/shields/pixel/resample';

const dot = (a: Float32Array, b: Float32Array): number => a.reduce((s, v, i) => s + v * b[i]!, 0);
const rand = (n: number, seed: number): Float32Array => {
  const r = mulberry32(seed);
  return Float32Array.from({ length: n }, () => r() * 2 - 1);
};

describe('resample / adjoint', () => {
  it('adjoint is the exact transpose: <A x, y> == <x, A^T y>', () => {
    const sw = 30, sh = 20, dw = 12, dh = 8;
    const tx = makeTaps(dw, 3.2, 17.5, sw);
    const ty = makeTaps(dh, -2.7, 14.1, sh); // starts off the image: edges replicate
    const x = rand(3 * sw * sh, 1);
    const y = rand(3 * dw * dh, 2);
    const ax = new Float32Array(3 * dw * dh);
    resample(x, sw, sh, tx, ty, ax);
    const aty = new Float32Array(3 * sw * sh);
    resampleAdjoint(y, sw, sh, tx, ty, aty);
    expect(dot(ax, y)).toBeCloseTo(dot(x, aty), 3);
  });
  it('identity taps reproduce the image', () => {
    const x = rand(3 * 9 * 9, 3);
    const out = new Float32Array(x.length);
    resample(x, 9, 9, makeTaps(9, 0, 9, 9), makeTaps(9, 0, 9, 9), out);
    out.forEach((v, i) => expect(v).toBeCloseTo(x[i]!, 5));
  });
});

describe('face detector decoding', () => {
  it('has the 4420 UltraFace RFB-320 priors', () => expect(priors().length / 4).toBe(4420));
  it('decodes a zero-delta prior to its own box and suppresses overlaps', () => {
    const n = 4420;
    const scores = new Float32Array(n * 2);
    const boxes = new Float32Array(n * 4);
    const p = priors();
    const i = 100;
    scores[i * 2 + 1] = 0.95;
    scores[(i + 1) * 2 + 1] = 0.9; // neighbouring prior, heavily overlapping -> removed by NMS
    const faces = decode(scores, boxes, 640, 480);
    expect(faces.length).toBeGreaterThanOrEqual(1);
    const f = faces[0]!;
    expect(f.score).toBeCloseTo(0.95, 5);
    expect((f.x1 + f.x2) / 2).toBeCloseTo(p[i * 4]! * 640, 3);
    expect(f.x2 - f.x1).toBeCloseTo(p[i * 4 + 2]! * 640, 3);
  });
  it('nms keeps the higher score of overlapping boxes', () => {
    const kept = nms([
      { x1: 0, y1: 0, x2: 10, y2: 10, score: 0.7 },
      { x1: 1, y1: 1, x2: 11, y2: 11, score: 0.9 },
      { x1: 50, y1: 50, x2: 60, y2: 60, score: 0.8 },
    ]);
    expect(kept.map((k) => k.score)).toEqual([0.9, 0.8]);
  });
});

/** A fake embedder with a fixed gradient pattern: PGD should push the image against it. */
const pattern = rand(3 * CROP * CROP, 9);
const fake: Embedder = {
  async run() {
    return { grad: pattern.slice(), emb: Float32Array.from({ length: 512 }, () => 1 / Math.sqrt(512)) };
  },
};
const region = (): Region => ({ grid: Float32Array.from({ length: 3 * GRID * GRID }, (_, i) => 0.2 + 0.6 * ((i * 7919) % 100) / 100), fcx: GRID / 2, fcy: GRID / 2, base: GRID / CTX_FOR_TEST });
const CTX_FOR_TEST = 1.6;

describe('PGD loop safety', () => {
  it('stays within +/- eps and keeps the image in [0, 1]', async () => {
    const r = region();
    const eps = 8 / 255;
    const d = await optimizeDelta(r, [fake], { eps, steps: 6, deadline: performance.now() + 60_000, rng: mulberry32(1) });
    let max = 0;
    for (let i = 0; i < d.length; i++) {
      max = Math.max(max, Math.abs(d[i]!));
      expect(r.grid[i]! + d[i]!).toBeGreaterThanOrEqual(-1e-6);
      expect(r.grid[i]! + d[i]!).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(max).toBeLessThanOrEqual(eps + 1e-6);
    expect(max).toBeGreaterThan(eps * 0.5); // it actually moved
  });
  it('descends the similarity: the perturbation anti-correlates with the (resampled) gradient', async () => {
    const r = region();
    const d = await optimizeDelta(r, [fake], { eps: 8 / 255, steps: 8, deadline: performance.now() + 60_000, rng: mulberry32(2) });
    const g = new Float32Array(3 * GRID * GRID);
    resampleAdjoint(pattern, GRID, GRID, makeTaps(CROP, GRID / 2 - r.base / 2, r.base, GRID), makeTaps(CROP, GRID / 2 - r.base / 2, r.base, GRID), g);
    expect(dot(d, g)).toBeLessThan(0);
  });
  it('honours the time budget: an expired deadline returns a zero perturbation', async () => {
    const d = await optimizeDelta(region(), [fake], { eps: 8 / 255, steps: 30, deadline: performance.now() - 1, rng: mulberry32(3) });
    expect(d.every((v) => v === 0)).toBe(true);
  });
});

describe('applyRegionDelta', () => {
  it('changes only the region, within eps, even when the region hangs off the image', () => {
    const w = 64, h = 48;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(128);
    const orig = rgba.slice();
    const delta = new Float32Array(3 * GRID * GRID).fill(1); // maximal request: must be clamped to eps
    applyRegionDelta(rgba, w, h, delta, -20, 10, 60, 8, newApplied(0, 10, 40, 48));
    let changed = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const inside = x < 40 && y >= 10 && y < 70;
        for (let c = 0; c < 3; c++) {
          const d = rgba[o + c]! - orig[o + c]!;
          if (inside) { expect(d).toBe(8); changed++; } else expect(d).toBe(0);
        }
        expect(rgba[o + 3]).toBe(orig[o + 3]);
      }
    }
    expect(changed).toBeGreaterThan(0);
  });
  it('overlapping regions share ONE budget (two faces never add up to 2 x eps)', () => {
    const w = 80, h = 60;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(100);
    const delta = new Float32Array(3 * GRID * GRID).fill(1);
    const applied = newApplied(0, 0, w, h);
    applyRegionDelta(rgba, w, h, delta, 5, 5, 50, 8, applied);
    applyRegionDelta(rgba, w, h, delta, 25, 10, 50, 8, applied); // overlaps the first
    let max = 0;
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(rgba[i * 4 + c]! - 100));
    expect(max).toBe(8);
  });
  it('stays within eps even when a pixel saturates at 255 and a later face pushes the other way', () => {
    const w = 40, h = 40;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(250); // 5 below white
    const applied = newApplied(0, 0, w, h);
    applyRegionDelta(rgba, w, h, new Float32Array(3 * GRID * GRID).fill(1), 0, 0, 40, 8, applied); // wants +8, saturates at 255 (real +5)
    applyRegionDelta(rgba, w, h, new Float32Array(3 * GRID * GRID).fill(-1), 0, 0, 40, 8, applied); // wants -255
    let max = 0;
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(rgba[i * 4 + c]! - 250));
    expect(max).toBeLessThanOrEqual(8);
  });
});
