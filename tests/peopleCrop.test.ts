import { describe, expect, it } from 'vitest';
import { CROP_MARGIN, cropBox, largestFace, looksLikeRealGpu, MIN_FACE_SIDE } from '../src/offscreen/shields/people/crop';

const face = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, score: 0.99 });

describe('face crop geometry', () => {
  it('is a square centred on the face with the documented margin', () => {
    const b = cropBox(face(200, 100, 300, 220)); // 100 x 120 face, centre (250, 160)
    expect(b.side).toBe(Math.round(120 * CROP_MARGIN));
    expect(b.x + b.side / 2).toBeCloseTo(250, 0);
    expect(b.y + b.side / 2).toBeCloseTo(160, 0);
  });
  it('may extend past the frame edge (filled black by the caller)', () => {
    const b = cropBox(face(0, 0, 80, 80));
    expect(b.x).toBeLessThan(0);
    expect(b.y).toBeLessThan(0);
  });
  it('picks the largest face and ignores tiny ones', () => {
    const big = face(100, 100, 260, 280);
    expect(largestFace([face(0, 0, 60, 70), big, face(300, 300, 400, 410)])).toBe(big);
    expect(largestFace([face(0, 0, MIN_FACE_SIDE - 1, MIN_FACE_SIDE - 1)])).toBeNull();
    expect(largestFace([])).toBeNull();
  });
});

describe('GPU detection', () => {
  it('accepts real GPUs', () => {
    expect(looksLikeRealGpu({ vendor: 'apple', architecture: 'metal-3', description: '' })).toBe(true);
    expect(looksLikeRealGpu({ vendor: 'nvidia', architecture: 'ampere' })).toBe(true);
  });
  it('rejects software renderers and missing info', () => {
    expect(looksLikeRealGpu({ vendor: 'google', architecture: 'swiftshader' })).toBe(false);
    expect(looksLikeRealGpu({ description: 'Microsoft Basic Render Driver' })).toBe(false);
    expect(looksLikeRealGpu({ vendor: 'mesa', description: 'llvmpipe (LLVM 15)' })).toBe(false);
    expect(looksLikeRealGpu(undefined)).toBe(false);
  });
});

describe('GenD calibration', () => {
  it('maps lo to 0 and hi to 1 and clamps outside', async () => {
    const { calibrate } = await import('../src/offscreen/shields/people/gend');
    expect(calibrate(0.41, 0.41, 0.95)).toBe(0);
    expect(calibrate(0.95, 0.41, 0.95)).toBe(1);
    expect(calibrate(0.68, 0.41, 0.95)).toBeCloseTo(0.5, 5);
    expect(calibrate(0.1, 0.41, 0.95)).toBe(0);
    expect(calibrate(0.999, 0.41, 0.95)).toBe(1);
  });
});
