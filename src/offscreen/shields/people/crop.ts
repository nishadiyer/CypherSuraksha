import type { Face } from '../pixel/faceDetect';

/** Square crop around the face with 30% margin: what the deepfake model was measured on (MODELS.md). */
export const CROP_MARGIN = 1.3;
/** Faces smaller than this many pixels (in the frame the content script sends) are not scored. */
export const MIN_FACE_SIDE = 32;

export interface CropBox {
  x: number;
  y: number;
  side: number;
}

export function largestFace(faces: readonly Face[]): Face | null {
  let best: Face | null = null;
  let bestArea = 0;
  for (const f of faces) {
    const a = (f.x2 - f.x1) * (f.y2 - f.y1);
    if (a > bestArea && Math.max(f.x2 - f.x1, f.y2 - f.y1) >= MIN_FACE_SIDE) {
      best = f;
      bestArea = a;
    }
  }
  return best;
}

/** The box may extend past the frame edge; the crop is filled with black there. */
export function cropBox(f: Face, margin = CROP_MARGIN): CropBox {
  const side = Math.max(8, Math.round(Math.max(f.x2 - f.x1, f.y2 - f.y1) * margin));
  return { x: Math.round((f.x1 + f.x2) / 2 - side / 2), y: Math.round((f.y1 + f.y2) / 2 - side / 2), side };
}

/** True when a WebGPU adapter looks like a real GPU rather than a software renderer (CI, VMs). */
export function looksLikeRealGpu(info: { vendor?: string; architecture?: string; description?: string } | undefined): boolean {
  if (!info) return false;
  return !/swiftshader|software|llvmpipe|lavapipe|basic render|microsoft basic/i.test(`${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`);
}
