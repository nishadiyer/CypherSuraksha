import { zero } from '../../../shared/base64';
import { assetInstalled, getModel, loadAssetText, webgpuAvailable, type LoadedModel } from '../../ort';
import { fastEnough, resize, toScore } from './classifier';
import { looksLikeRealGpu } from './crop';

/**
 * Second, optional detector: GenD (CLIP ViT-L/14 fine-tuned on FaceForensics++), FP16, 609 MB, built by
 * `npm run models:gend`. It sees face-swaps the main model misses (MODELS.md: face-swap AUC 0.87 vs 0.77) and
 * is worse on fully generated faces, so the two are combined with max(). It only runs on a real GPU through
 * WebGPU (about 95 ms per frame there); without one the shield simply uses the main model alone.
 */
export const GEND_MODEL = 'people-gend.fp16.onnx';
export const GEND_CONFIG = 'people-gend.config.json';
const GEND_BUDGET_MS = 600; // self-test: if a warm inference is slower than this, do not use it

export interface GendConfig {
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
  /** GenD probability lo maps to 0, hi maps to 1 (derived from the dev split only, see MODELS.md). */
  calibration: { lo: number; hi: number };
}

/** Linear map of a raw GenD probability onto the main model's 0..1 "bimodal" scale. */
export function calibrate(p: number, lo: number, hi: number): number {
  return Math.min(1, Math.max(0, (p - lo) / (hi - lo)));
}

let cfgPromise: Promise<GendConfig | null> | null = null;
const loadConfig = (): Promise<GendConfig | null> => (cfgPromise ??= loadAssetText(GEND_CONFIG).then((t) => (t ? (JSON.parse(t) as GendConfig) : null)));

let picked: Promise<{ model: LoadedModel; cfg: GendConfig } | null> | null = null;
function pick(): Promise<{ model: LoadedModel; cfg: GendConfig } | null> {
  return (picked ??= (async () => {
    try {
      const cfg = await loadConfig();
      if (!cfg || !webgpuAvailable() || !(await assetInstalled(GEND_MODEL))) return null;
      const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu.requestAdapter();
      if (!adapter || !looksLikeRealGpu(adapter.info)) return null;
      const model = await getModel(GEND_MODEL, ['webgpu']);
      return model && (await fastEnough(model, cfg.size, GEND_BUDGET_MS)) ? { model, cfg } : null;
    } catch {
      return null;
    }
  })());
}

/** Diagnostics: wall time of the last call split into preprocessing and the model run (ms). */
export const lastGendTiming = { prep: 0, run: 0 };

export const gendAvailable = async (): Promise<boolean> => (await pick()) !== null;

/** Calibrated 0..1 face-swap score for an RGBA face crop, or null when GenD is not usable on this machine. */
export async function gendScore(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Promise<number | null> {
  const p = await pick();
  if (!p) return null;
  const t0 = performance.now();
  const { model, cfg } = p;
  const size = cfg.size;
  const px = await resize(rgba, w, h, size);
  const input = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let q = 0, i = 0; q < plane; q++, i += 4) {
    for (let c = 0; c < 3; c++) input[c * plane + q] = (px[i + c]! / 255 - cfg.mean[c]!) / cfg.std[c]!;
  }
  if (px !== rgba) zero(px);
  const { ort, session } = model;
  const tensor = new ort.Tensor('float32', input, [1, 3, size, size]);
  let outputs: Awaited<ReturnType<typeof session.run>> | undefined;
  try {
    const t1 = performance.now();
    lastGendTiming.prep = t1 - t0;
    outputs = await session.run({ [session.inputNames[0]!]: tensor });
    const prob = toScore(outputs[session.outputNames[0]!]!.data as Float32Array, 'sigmoid');
    lastGendTiming.run = performance.now() - t1;
    return calibrate(prob, cfg.calibration.lo, cfg.calibration.hi);
  } finally {
    tensor.dispose();
    if (outputs) Object.values(outputs).forEach((t) => t.dispose());
    zero(input);
  }
}
