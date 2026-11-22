import { zero } from '../../../shared/base64';
import { assetInstalled, getModel } from '../../ort';

/** UltraFace RFB-320 (MIT), a 1.2 MB face detector. See MODELS.md. */
export const DETECT_MODEL = 'face-detector.ultraface.onnx';
export const detectorInstalled = (): Promise<boolean> => assetInstalled(DETECT_MODEL);

export const DET_W = 320;
export const DET_H = 240;
const CENTER_VAR = 0.1;
const SIZE_VAR = 0.2;
const NMS_IOU = 0.3;

export interface Face {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

let cachedPriors: Float32Array | null = null;

/** SSD prior boxes [cx, cy, w, h] (normalised) in the exact order the model emits them. 4420 of them. */
export function priors(): Float32Array {
  if (cachedPriors) return cachedPriors;
  const fmW = [40, 20, 10, 5];
  const fmH = [30, 15, 8, 4];
  const strides = [8, 16, 32, 64];
  const mins = [[10, 16, 24], [32, 48], [64, 96], [128, 192, 256]];
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    for (let j = 0; j < fmH[k]!; j++) {
      for (let i = 0; i < fmW[k]!; i++) {
        const cx = ((i + 0.5) * strides[k]!) / DET_W;
        const cy = ((j + 0.5) * strides[k]!) / DET_H;
        for (const m of mins[k]!) out.push(cx, cy, m / DET_W, m / DET_H);
      }
    }
  }
  return (cachedPriors = Float32Array.from(out));
}

const iou = (a: Face, b: Face): number => {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = w * h;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
};

export function nms(faces: Face[], thr = NMS_IOU): Face[] {
  const order = [...faces].sort((a, b) => b.score - a.score);
  const keep: Face[] = [];
  for (const f of order) if (keep.every((k) => iou(k, f) <= thr)) keep.push(f);
  return keep;
}

/**
 * scores: [N, 2] (background, face); boxes: [N, 4] (centre-size deltas). Returns faces in the
 * coordinates of a w0 x h0 image, after non-maximum suppression.
 */
export function decode(scores: ArrayLike<number>, boxes: ArrayLike<number>, w0: number, h0: number, thr = 0.6): Face[] {
  const p = priors();
  const n = p.length / 4;
  const found: Face[] = [];
  for (let i = 0; i < n; i++) {
    const s = scores[i * 2 + 1]!;
    if (s <= thr) continue;
    const pcx = p[i * 4]!;
    const pcy = p[i * 4 + 1]!;
    const pw = p[i * 4 + 2]!;
    const ph = p[i * 4 + 3]!;
    const cx = pcx + boxes[i * 4]! * CENTER_VAR * pw;
    const cy = pcy + boxes[i * 4 + 1]! * CENTER_VAR * ph;
    const w = pw * Math.exp(boxes[i * 4 + 2]! * SIZE_VAR);
    const h = ph * Math.exp(boxes[i * 4 + 3]! * SIZE_VAR);
    found.push({ x1: (cx - w / 2) * w0, y1: (cy - h / 2) * h0, x2: (cx + w / 2) * w0, y2: (cy + h / 2) * h0, score: s });
  }
  return nms(found);
}

/** Detects faces in `bitmap`. Returns null when the detector is not installed. */
export async function detectFaces(bitmap: ImageBitmap): Promise<Face[] | null> {
  const model = await getModel(DETECT_MODEL, ['wasm']);
  if (!model) return null;
  const canvas = new OffscreenCanvas(DET_W, DET_H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, DET_W, DET_H);
  const px = ctx.getImageData(0, 0, DET_W, DET_H).data;
  canvas.width = canvas.height = 0;
  const plane = DET_W * DET_H;
  const input = new Float32Array(3 * plane);
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    input[p] = (px[i]! - 127) / 128;
    input[plane + p] = (px[i + 1]! - 127) / 128;
    input[2 * plane + p] = (px[i + 2]! - 127) / 128;
  }
  zero(px);
  const { ort, session } = model;
  const tensor = new ort.Tensor('float32', input, [1, 3, DET_H, DET_W]);
  let outputs: Awaited<ReturnType<typeof session.run>> | undefined;
  try {
    outputs = await session.run({ [session.inputNames[0]!]: tensor });
    const scores = outputs[session.outputNames[0]!]!;
    const boxes = outputs[session.outputNames[1]!]!;
    return decode(scores.data as Float32Array, boxes.data as Float32Array, bitmap.width, bitmap.height);
  } finally {
    tensor.dispose();
    if (outputs) Object.values(outputs).forEach((t) => t.dispose());
    zero(input);
  }
}
