import { b64ToBytes, bytesToB64, zero } from '../../shared/base64';
import type { PixelsPayload, PixelsResult, Shield, ShieldRequest, ShieldResponse } from '../../types/shield';
import { disposeModels } from '../ort';
import { cloakModelInstalled, cloakWorkingSize, runCloakModel } from './pixel/cloakModel';
import { applyDelta, applySignNoise, epsLevels, mulberry32 } from './pixel/perturb';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 48_000_000;
const ENCODABLE = new Set(['image/png', 'image/jpeg', 'image/webp']);

const done = (req: ShieldRequest, t0: number, p: Partial<ShieldResponse>): ShieldResponse => ({
  requestId: req.requestId,
  action: 'ALLOW',
  confidence: 0,
  latencyMs: performance.now() - t0,
  ...p,
});

/**
 * Decode -> perturb -> re-encode entirely in memory (ImageBitmap + OffscreenCanvas).
 * Nothing touches disk or web storage; every buffer is closed/zeroed in `finally`.
 * Re-encoding also strips EXIF/GPS metadata.
 */
export async function cloakImage(payload: PixelsPayload): Promise<{ result: PixelsResult; mode: string } | { skipped: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(payload.mime)) return { skipped: `unsupported type ${payload.mime}` };
  const src = b64ToBytes(payload.b64);
  if (src.length > MAX_BYTES) return { skipped: 'file too large' };

  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  let img: ImageData | undefined;
  let outBytes: Uint8Array | undefined;
  try {
    try {
      bitmap = await createImageBitmap(new Blob([src], { type: payload.mime }));
    } catch {
      return { skipped: 'could not decode image' };
    }
    const { width: w, height: h } = bitmap;
    if (w * h > MAX_PIXELS) return { skipped: 'image too large' };

    canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { skipped: 'no 2d context' };
    ctx.drawImage(bitmap, 0, 0);
    img = ctx.getImageData(0, 0, w, h);
    const eps = epsLevels(payload.strength);

    let mode = 'deterministic-noise';
    if (await cloakModelInstalled()) {
      try {
        const size = await cloakWorkingSize(w, h);
        const small = new OffscreenCanvas(size.w, size.h);
        const sctx = small.getContext('2d', { willReadFrequently: true })!;
        sctx.drawImage(bitmap, 0, 0, size.w, size.h);
        const smallData = sctx.getImageData(0, 0, size.w, size.h);
        const r = await runCloakModel(smallData.data, size.w, size.h);
        zero(smallData.data);
        small.width = small.height = 0;
        if (r) {
          applyDelta(img.data, w, h, r.delta, r.dw, r.dh, eps);
          zero(r.delta);
          mode = `onnx-${r.backend}`;
        }
      } catch {
        mode = 'deterministic-noise';
      }
    }
    if (mode === 'deterministic-noise') {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
      applySignNoise(img.data, eps, mulberry32(seed));
    }

    ctx.putImageData(img, 0, 0);
    const outMime = ENCODABLE.has(payload.mime) ? payload.mime : 'image/png';
    const blob = await canvas.convertToBlob({ type: outMime, quality: 0.95 });
    outBytes = new Uint8Array(await blob.arrayBuffer());
    return { result: { b64: bytesToB64(outBytes), mime: outMime }, mode };
  } finally {
    bitmap?.close();
    if (img) zero(img.data);
    if (canvas) canvas.width = canvas.height = 0;
    zero(src);
    zero(outBytes);
  }
}

export const pixelShield: Shield = {
  kind: 'PIXELS',
  async handle(req: ShieldRequest): Promise<ShieldResponse> {
    const t0 = performance.now();
    const out = await cloakImage(req.payload as PixelsPayload);
    if ('skipped' in out) return done(req, t0, { action: 'WARN', data: { reason: out.skipped } });
    return done(req, t0, { action: 'MODIFY', data: { ...out.result, mode: out.mode }, confidence: out.mode === 'deterministic-noise' ? 0.3 : 0.9 });
  },
  dispose: disposeModels,
};
