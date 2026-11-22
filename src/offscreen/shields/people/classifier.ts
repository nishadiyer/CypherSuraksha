import { zero } from '../../../shared/base64';
import { assetInstalled, getModel, loadAssetText, type Backend } from '../../ort';

export const PEOPLE_MODEL = 'people-deepfake.int8.onnx';
export const PEOPLE_CONFIG = 'people-deepfake.config.json';

export interface PeopleConfig {
  size?: number; // square input side, default 224
  mean?: [number, number, number];
  std?: [number, number, number];
  /** "sigmoid": single logit; "prob": already 0..1; "softmax2": [real, fake] logits */
  output?: 'sigmoid' | 'prob' | 'softmax2';
}

let cfgPromise: Promise<PeopleConfig> | null = null;
export const loadPeopleConfig = (): Promise<PeopleConfig> =>
  (cfgPromise ??= loadAssetText(PEOPLE_CONFIG).then((t) => (t ? (JSON.parse(t) as PeopleConfig) : {})));

export const peopleModelInstalled = (): Promise<boolean> => assetInstalled(PEOPLE_MODEL);

/** Resize RGBA to size x size via the GPU/Skia path; returns pixel data owned by the caller. */
async function resize(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number, size: number): Promise<Uint8ClampedArray> {
  if (w === size && h === size) return rgba;
  const bmp = await createImageBitmap(new ImageData(rgba, w, h), { resizeWidth: size, resizeHeight: size, resizeQuality: 'medium' });
  try {
    const c = new OffscreenCanvas(size, size);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, size, size).data;
    c.width = c.height = 0;
    return d;
  } finally {
    bmp.close();
  }
}

export function toScore(raw: Float32Array, mode: NonNullable<PeopleConfig['output']>): number {
  if (mode === 'softmax2' && raw.length >= 2) {
    const m = Math.max(raw[0]!, raw[1]!);
    const a = Math.exp(raw[0]! - m);
    const b = Math.exp(raw[1]! - m);
    return b / (a + b);
  }
  const v = raw[0] ?? 0;
  return mode === 'prob' ? v : 1 / (1 + Math.exp(-v));
}

/** Probability that the frame is synthetic, or null when no model is installed. */
export async function classifyFrame(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Promise<{ score: number; backend: Backend } | null> {
  const model = await getModel(PEOPLE_MODEL);
  if (!model) return null;
  const cfg = await loadPeopleConfig();
  const size = cfg.size ?? 224;
  const mean = cfg.mean ?? [0.485, 0.456, 0.406];
  const std = cfg.std ?? [0.229, 0.224, 0.225];
  const px = await resize(rgba, w, h, size);
  const input = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    for (let c = 0; c < 3; c++) input[c * plane + p] = (px[i + c]! / 255 - mean[c]!) / std[c]!;
  }
  if (px !== rgba) zero(px);
  const { ort, session, backend } = model;
  const tensor = new ort.Tensor('float32', input, [1, 3, size, size]);
  let outputs: Awaited<ReturnType<typeof session.run>> | undefined;
  try {
    outputs = await session.run({ [session.inputNames[0]!]: tensor });
    const raw = outputs[session.outputNames[0]!]!.data as Float32Array;
    return { score: toScore(raw, cfg.output ?? 'sigmoid'), backend };
  } finally {
    tensor.dispose(); // release the input tensor, then zero its backing buffer
    if (outputs) Object.values(outputs).forEach((t) => t.dispose());
    zero(input);
  }
}
