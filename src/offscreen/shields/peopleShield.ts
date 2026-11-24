import { b64ToBytes, zero } from '../../shared/base64';
import type { PeoplePayload, PeopleResult, Shield, ShieldRequest, ShieldResponse } from '../../types/shield';
import { disposeModels } from '../ort';
import { detectFaces, detectorInstalled } from './pixel/faceDetect';
import { classifyFrame } from './people/classifier';
import { cropBox, largestFace } from './people/crop';
import { gendScore, lastGendTiming } from './people/gend';
import { TemporalSmoother } from './people/smoother';

const sessions = new Map<string, TemporalSmoother>();
const IDLE_MS = 60_000;

function sweep(): void {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastSeen > IDLE_MS) sessions.delete(id);
}

/** Detects the largest face and returns a square RGBA crop around it (black where it leaves the frame), or null. */
async function cropToFace(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Promise<{ rgba: Uint8ClampedArray<ArrayBuffer>; side: number; ms: number } | null> {
  const t0 = performance.now();
  const bitmap = await createImageBitmap(new ImageData(rgba, w, h));
  let canvas: OffscreenCanvas | undefined;
  try {
    const face = largestFace((await detectFaces(bitmap)) ?? []);
    if (!face) return null;
    const box = cropBox(face);
    canvas = new OffscreenCanvas(box.side, box.side);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, box.side, box.side);
    ctx.drawImage(bitmap, -box.x, -box.y);
    return { rgba: ctx.getImageData(0, 0, box.side, box.side).data, side: box.side, ms: performance.now() - t0 };
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

export const peopleShield: Shield = {
  kind: 'PEOPLE',
  async handle(req: ShieldRequest): Promise<ShieldResponse> {
    const t0 = performance.now();
    const p = req.payload as PeoplePayload;
    const key = `${req.tabId}:${p.sessionId}`;
    sweep();
    let rgba: Uint8ClampedArray<ArrayBuffer> | undefined = new Uint8ClampedArray(b64ToBytes(p.b64).buffer);
    let frame: { score: number; backend: string; gend?: number; main?: number } | null = null;
    let noFace = false;
    const timing: NonNullable<PeopleResult['timingMs']> = { detect: 0, main: 0 };
    try {
      if (await detectorInstalled()) {
        // Whole frame in, face crop out: the model is at chance on a full video tile (MODELS.md).
        const crop = await cropToFace(rgba, p.width, p.height);
        if (crop) {
          zero(rgba);
          rgba = undefined;
          timing.detect = crop.ms;
          try {
            const tm = performance.now();
            frame = await classifyFrame(crop.rgba, crop.side, crop.side);
            timing.main = performance.now() - tm;
            // Optional second detector (face-swaps). The frame score is the larger of the two.
            const tg = performance.now();
            const g = frame ? await gendScore(crop.rgba, crop.side, crop.side) : null;
            if (g !== null) {
              timing.gend = performance.now() - tg;
              timing.gendPrep = lastGendTiming.prep;
              timing.gendRun = lastGendTiming.run;
            }
            if (frame) frame = { ...frame, main: frame.score };
            if (frame && g !== null) frame = { ...frame, score: Math.max(frame.score, g), gend: g };
          } finally {
            zero(crop.rgba);
          }
        } else noFace = true;
      } else {
        frame = await classifyFrame(rgba, p.width, p.height); // no detector installed: legacy whole-frame path
        if (frame) frame = { ...frame, main: frame.score };
      }
    } finally {
      if (rgba) zero(rgba); // video frame never outlives this call
    }

    if (noFace) {
      const result: PeopleResult = { frameScore: 0.5, smoothed: 0.5, level: 'YELLOW', sustainedRed: false, backend: 'no-face', status: 'no-face' };
      return { requestId: req.requestId, action: 'ALLOW', data: result, confidence: 0, latencyMs: performance.now() - t0 };
    }

    let smoother = sessions.get(key);
    if (!smoother) sessions.set(key, (smoother = new TemporalSmoother()));

    // No detector installed: we cannot vouch for the caller, so report an explicit
    // "unverified" YELLOW rather than a reassuring GREEN, and never RED.
    const unavailable = frame === null;
    const s = unavailable ? { smoothed: 0.5, level: 'YELLOW' as const, sustainedRed: false } : smoother.push(frame!.score);
    const result: PeopleResult = {
      frameScore: frame?.score ?? 0.5,
      smoothed: s.smoothed,
      level: s.level,
      sustainedRed: s.sustainedRed,
      backend: frame?.backend ?? 'unavailable',
      gend: frame?.gend,
      main: frame?.main,
      timingMs: timing,
    };
    return {
      requestId: req.requestId,
      action: s.sustainedRed ? 'BLOCK' : s.level === 'GREEN' ? 'ALLOW' : 'WARN',
      data: result,
      confidence: s.smoothed,
      latencyMs: performance.now() - t0,
    };
  },
  async dispose() {
    sessions.clear();
    await disposeModels();
  },
};
