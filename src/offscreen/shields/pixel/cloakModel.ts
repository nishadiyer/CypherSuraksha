import { zero } from '../../../shared/base64';
import { assetInstalled, getModel, loadAssetText, type Backend } from '../../ort';
import { rgbaToChw } from './perturb';

export const CLOAK_MODEL = 'pixel-cloak.fp16.onnx';
export const CLOAK_CONFIG = 'pixel-cloak.config.json';

export interface CloakConfig {
  /** "image": model returns the perturbed image; "delta": model returns the perturbation. */
  output?: 'image' | 'delta';
  /** Longest side fed to the model when its input has dynamic dimensions. */
  maxSide?: number;
}

export interface CloakResult {
  delta: Float32Array; // planar CHW in 0..1 units, size dw x dh
  dw: number;
  dh: number;
  backend: Backend;
}

export const cloakModelInstalled = (): Promise<boolean> => assetInstalled(CLOAK_MODEL);

const readConfig = async (): Promise<CloakConfig> => {
  const t = await loadAssetText(CLOAK_CONFIG);
  return t ? (JSON.parse(t) as CloakConfig) : {};
};

/**
 * Runs the learned cloak on `rgba` (already resized to dw x dh) and returns the
 * perturbation. Input tensors and the model output are disposed and zeroed here.
 */
export async function runCloakModel(rgba: Uint8ClampedArray, dw: number, dh: number): Promise<CloakResult | null> {
  const model = await getModel(CLOAK_MODEL);
  if (!model) return null;
  const cfg = await readConfig();
  const { ort, session, backend } = model;

  const input = rgbaToChw(rgba, dw, dh);
  const inTensor = new ort.Tensor('float32', input, [1, 3, dh, dw]);
  let outputs: Awaited<ReturnType<typeof session.run>> | undefined;
  try {
    outputs = await session.run({ [session.inputNames[0]!]: inTensor });
    const out = outputs[session.outputNames[0]!]!;
    const data = out.data as Float32Array;
    const delta = new Float32Array(input.length);
    if ((cfg.output ?? 'image') === 'image') for (let i = 0; i < delta.length; i++) delta[i] = data[i]! - input[i]!;
    else delta.set(data.subarray(0, delta.length));
    return { delta, dw, dh, backend };
  } finally {
    inTensor.dispose();
    if (outputs) Object.values(outputs).forEach((t) => t.dispose());
    zero(input);
  }
}

/** Target working size: fixed model dims if the graph declares them, else capped aspect-preserving. */
export async function cloakWorkingSize(w: number, h: number): Promise<{ w: number; h: number }> {
  const model = await getModel(CLOAK_MODEL);
  const maxSide = (await readConfig()).maxSide ?? 1024;
  const meta = model?.session.inputMetadata?.[0] as { shape?: ReadonlyArray<number | string> } | undefined;
  const shape = meta?.shape;
  if (shape && typeof shape[2] === 'number' && typeof shape[3] === 'number' && shape[2] > 0 && shape[3] > 0) {
    return { w: shape[3], h: shape[2] };
  }
  const s = Math.min(1, maxSide / Math.max(w, h));
  const r8 = (v: number) => Math.max(8, Math.round((v * s) / 8) * 8);
  return { w: r8(w), h: r8(h) };
}
