import { zero } from '../../../shared/base64';
import { assetInstalled, getModel, loadAssetText } from '../../ort';
import { detectFaces, detectorInstalled, type Face } from './faceDetect';
import { mulberry32 } from './perturb';
import { makeTaps, resample, resampleAdjoint } from './resample';

/**
 * Per-image adversarial face cloak: projected gradient descent (momentum, expectation over
 * random crop scale/shift) against an ensemble of pretrained face embedders. Each embedder is
 * a pure ONNX graph that returns d(cosine(embed(x), target))/dx, exported once from PyTorch
 * (scripts/cloak/export_gradient_onnx.py). No training happens anywhere.
 *
 * Measured behaviour and its limits are in MODELS.md: it disrupts FaceNet-family recognisers;
 * it transfers only weakly to a different family (ArcFace) at invisible budgets.
 */

/** Embedders in the ensemble; any subset that is installed is used. */
export const EMBEDDER_FILES = ['cloak-facenet-vggface2.onnx', 'cloak-facenet-casia.onnx'] as const;
export const PGD_CONFIG = 'cloak-pgd.config.json';

export interface PgdConfig {
  /** L-infinity budget in 8-bit levels (default 8). */
  eps?: number;
  steps?: number;
  /** Wall-clock budget for the whole photo; optimisation stops early and keeps what it has. */
  budgetMs?: number;
  maxFaces?: number;
  /** Faces with a shorter side (pixels) are ignored. */
  minFaceSide?: number;
}
export const DEFAULTS = { eps: 8, steps: 30, budgetMs: 20_000, maxFaces: 3, minFaceSide: 40 } as const;

export const GRID = 224; // delta lives on a GRID x GRID raster covering CTX x the face box
export const CTX = 1.6;
export const CROP = 160; // embedder input side
const MOMENTUM = 0.9;
const SCALE_LO = 0.8;
const SCALE_HI = 1.3;
const SHIFT = 0.1;
const STEP_FACTOR = 2.5;

/** One embedder: returns the gradient of <embedding, target> w.r.t. the input, and the embedding. */
export interface Embedder {
  run(x160: Float32Array, target: Float32Array): Promise<{ grad: Float32Array; emb: Float32Array }>;
}

export interface Region {
  /** planar CHW 0..1, GRID x GRID */
  grid: Float32Array;
  /** face centre and face-box side on the grid */
  fcx: number;
  fcy: number;
  base: number;
}

const l1 = (a: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]!);
  return s + 1e-12;
};

/**
 * PGD on one face region. Returns the perturbation (planar CHW, 0..1 units, GRID x GRID),
 * always within +/- eps and keeping grid+delta inside [0, 1].
 */
export async function optimizeDelta(
  region: Region,
  embedders: Embedder[],
  opt: { eps: number; steps: number; deadline: number; rng: () => number },
): Promise<Float32Array> {
  const n3 = 3 * GRID * GRID;
  const c3 = 3 * CROP * CROP;
  const delta = new Float32Array(n3);
  const mom = new Float32Array(n3);
  const xa = new Float32Array(n3);
  const x160 = new Float32Array(c3);
  const gsum = new Float32Array(c3);
  const gg = new Float32Array(n3);
  const zeros = new Float32Array(512);
  const alpha = (STEP_FACTOR * opt.eps) / opt.steps;
  const { grid, fcx, fcy, base } = region;
  const taps = (scale: number, dx: number, dy: number) => {
    const side = base * scale;
    return { tx: makeTaps(CROP, fcx + dx - side / 2, side, GRID), ty: makeTaps(CROP, fcy + dy - side / 2, side, GRID) };
  };
  const targets: Float32Array[] = [];
  try {
    // Targets: the clean embeddings of the unjittered crop.
    const t0 = taps(1, 0, 0);
    resample(grid, GRID, GRID, t0.tx, t0.ty, x160);
    for (const e of embedders) targets.push((await e.run(x160, zeros)).emb);

    for (let s = 0; s < opt.steps && performance.now() < opt.deadline; s++) {
      const scale = SCALE_LO + opt.rng() * (SCALE_HI - SCALE_LO);
      const dx = (opt.rng() * 2 - 1) * SHIFT * base;
      const dy = (opt.rng() * 2 - 1) * SHIFT * base;
      const { tx, ty } = taps(scale, dx, dy);
      for (let i = 0; i < n3; i++) xa[i] = Math.min(1, Math.max(0, grid[i]! + delta[i]!));
      resample(xa, GRID, GRID, tx, ty, x160);

      gsum.fill(0);
      for (let k = 0; k < embedders.length; k++) {
        const { grad } = await embedders[k]!.run(x160, targets[k]!);
        const n = l1(grad);
        for (let i = 0; i < c3; i++) gsum[i] = gsum[i]! + grad[i]! / n;
        zero(grad);
      }
      gg.fill(0);
      resampleAdjoint(gsum, GRID, GRID, tx, ty, gg); // exact adjoint of crop + resize
      const gn = l1(gg);
      for (let i = 0; i < n3; i++) {
        mom[i] = MOMENTUM * mom[i]! + gg[i]! / gn;
        const d = Math.min(opt.eps, Math.max(-opt.eps, delta[i]! - alpha * Math.sign(mom[i]!)));
        delta[i] = Math.min(1, Math.max(0, grid[i]! + d)) - grid[i]!; // keep the image valid
      }
    }
    return delta;
  } finally {
    zero(mom);
    zero(xa);
    zero(x160);
    zero(gsum);
    zero(gg);
    targets.forEach((t) => zero(t));
  }
}

/* ---------------- ONNX adapter ---------------- */

async function loadEmbedders(): Promise<Embedder[]> {
  const out: Embedder[] = [];
  for (const file of EMBEDDER_FILES) {
    const model = await getModel(file, ['wasm']); // fp32 conv graph; WASM is the supported path
    if (!model) continue;
    const { ort, session } = model;
    out.push({
      async run(x160, target) {
        const xt = new ort.Tensor('float32', x160, [1, 3, CROP, CROP]);
        const tt = new ort.Tensor('float32', target, [1, 512]);
        let outputs: Awaited<ReturnType<typeof session.run>> | undefined;
        try {
          outputs = await session.run({ x: xt, target: tt });
          return { grad: (outputs.grad!.data as Float32Array).slice(), emb: (outputs.emb!.data as Float32Array).slice() };
        } finally {
          xt.dispose();
          tt.dispose();
          if (outputs) Object.values(outputs).forEach((t) => t.dispose());
        }
      },
    });
  }
  return out;
}

export async function pgdAvailable(): Promise<boolean> {
  if (!(await detectorInstalled())) return false;
  for (const f of EMBEDDER_FILES) if (await assetInstalled(f)) return true;
  return false;
}

async function readConfig(): Promise<PgdConfig> {
  const t = await loadAssetText(PGD_CONFIG);
  return t ? (JSON.parse(t) as PgdConfig) : {};
}

/* ---------------- raster helpers ---------------- */

/** Bilinear sample of interleaved RGBA into planar CHW 0..1 using precomputed taps. */
function sampleRgba(rgba: Uint8ClampedArray, sw: number, tx: ReturnType<typeof makeTaps>, ty: ReturnType<typeof makeTaps>, dst: Float32Array): void {
  const dw = tx.i0.length;
  const dh = ty.i0.length;
  const dp = dw * dh;
  for (let j = 0; j < dh; j++) {
    const ra = ty.i0[j]! * sw;
    const rb = ty.i1[j]! * sw;
    const wy = ty.w1[j]!;
    for (let i = 0; i < dw; i++) {
      const xa = tx.i0[i]!;
      const xb = tx.i1[i]!;
      const wx = tx.w1[i]!;
      const pa = (ra + xa) * 4;
      const pb = (ra + xb) * 4;
      const pc = (rb + xa) * 4;
      const pd = (rb + xb) * 4;
      for (let c = 0; c < 3; c++) {
        const top = rgba[pa + c]! * (1 - wx) + rgba[pb + c]! * wx;
        const bot = rgba[pc + c]! * (1 - wx) + rgba[pd + c]! * wx;
        dst[c * dp + j * dw + i] = (top * (1 - wy) + bot * wy) / 255;
      }
    }
  }
}

/** Perturbation actually applied (realised change vs the original), per channel, over a bounding box. Keeps overlapping faces within one budget. */
export interface Applied {
  buf: Int8Array; // 3 x bh x bw
  x0: number;
  y0: number;
  bw: number;
  bh: number;
}

export function newApplied(x0: number, y0: number, x1: number, y1: number): Applied {
  const bw = Math.max(0, x1 - x0);
  const bh = Math.max(0, y1 - y0);
  return { buf: new Int8Array(3 * bw * bh), x0, y0, bw, bh };
}

/**
 * Adds the GRID x GRID delta, bilinearly resampled to the L x L native region. The *total* change to
 * any pixel (this and every earlier face) is clamped to +/- epsLevels, so overlapping regions never
 * exceed the budget. `applied` must cover the region (it is the union box of all faces).
 */
export function applyRegionDelta(rgba: Uint8ClampedArray, w: number, h: number, delta: Float32Array, rx0: number, ry0: number, L: number, epsLevels: number, applied: Applied): void {
  const plane = GRID * GRID;
  const y0 = Math.max(0, ry0);
  const y1 = Math.min(h, ry0 + L);
  const x0 = Math.max(0, rx0);
  const x1 = Math.min(w, rx0 + L);
  const k = GRID / L;
  const ap = applied.bw * applied.bh;
  for (let y = y0; y < y1; y++) {
    const fy = Math.min(GRID - 1, Math.max(0, (y - ry0 + 0.5) * k - 0.5));
    const ya = Math.floor(fy);
    const yb = Math.min(GRID - 1, ya + 1);
    const ty = fy - ya;
    for (let x = x0; x < x1; x++) {
      const fx = Math.min(GRID - 1, Math.max(0, (x - rx0 + 0.5) * k - 0.5));
      const xa = Math.floor(fx);
      const xb = Math.min(GRID - 1, xa + 1);
      const tx = fx - xa;
      const o = (y * w + x) * 4;
      const ai = (y - applied.y0) * applied.bw + (x - applied.x0);
      for (let c = 0; c < 3; c++) {
        const b = c * plane;
        const top = delta[b + ya * GRID + xa]! * (1 - tx) + delta[b + ya * GRID + xb]! * tx;
        const bot = delta[b + yb * GRID + xa]! * (1 - tx) + delta[b + yb * GRID + xb]! * tx;
        const want = Math.round((top * (1 - ty) + bot * ty) * 255);
        const prev = applied.buf[c * ap + ai]!;
        const total = Math.max(-epsLevels, Math.min(epsLevels, prev + want));
        const cur = rgba[o + c]!;
        const moved = cur + (total - prev);
        const v = moved < 0 ? 0 : moved > 255 ? 255 : moved;
        // Record the change that actually happened (saturation at 0/255 can make it smaller than asked),
        // so a later face can never push the pixel more than eps away from the original.
        applied.buf[c * ap + ai] = prev + (v - cur);
        rgba[o + c] = v;
      }
    }
  }
}

export interface PgdOutcome {
  found: number;
  cloaked: number;
  /** true when the time budget ended optimisation before all steps finished on at least one face */
  truncated: boolean;
}

/**
 * Detects faces and cloaks them in place in `img` (native-resolution RGBA).
 * Returns null when the detector or every embedder is missing (caller falls back).
 */
export async function cloakFaces(bitmap: ImageBitmap, img: ImageData): Promise<PgdOutcome | null> {
  if (!(await pgdAvailable())) return null;
  const cfg = { ...DEFAULTS, ...(await readConfig()) };
  const embedders = await loadEmbedders();
  if (embedders.length === 0) return null;
  const faces = await detectFaces(bitmap);
  if (!faces) return null;

  const { width: w, height: h } = img;
  const chosen: Face[] = faces
    .filter((f) => Math.max(f.x2 - f.x1, f.y2 - f.y1) >= cfg.minFaceSide)
    .sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1))
    .slice(0, cfg.maxFaces);

  const regions = chosen.map((f) => {
    const sd = Math.max(f.x2 - f.x1, f.y2 - f.y1);
    const L = Math.max(8, Math.round(sd * CTX));
    const cx = (f.x1 + f.x2) / 2;
    const cy = (f.y1 + f.y2) / 2;
    return { sd, L, cx, cy, rx0: Math.round(cx - L / 2), ry0: Math.round(cy - L / 2) };
  });
  const applied = newApplied(
    Math.max(0, Math.min(...regions.map((r) => r.rx0))),
    Math.max(0, Math.min(...regions.map((r) => r.ry0))),
    Math.min(w, Math.max(...regions.map((r) => r.rx0 + r.L))),
    Math.min(h, Math.max(...regions.map((r) => r.ry0 + r.L))),
  );
  const t0 = performance.now();
  const rng = mulberry32(crypto.getRandomValues(new Uint32Array(1))[0]!);
  const work = new Map<number, { rgba: Uint8ClampedArray; w: number; h: number; canvas?: OffscreenCanvas }>();
  let cloaked = 0;
  let truncated = false;
  try {
    for (const [idx, { sd, L, cx, cy, rx0, ry0 }] of regions.entries()) {
      // Very large faces are sampled from a downscaled copy so the 224-px grid is not aliased.
      const sc = Math.min(1, (GRID * 1.25) / L);
      let src = work.get(sc);
      if (!src) {
        if (sc === 1) src = { rgba: img.data, w, h };
        else {
          const ww = Math.max(1, Math.round(w * sc));
          const hh = Math.max(1, Math.round(h * sc));
          const canvas = new OffscreenCanvas(ww, hh);
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bitmap, 0, 0, ww, hh);
          src = { rgba: ctx.getImageData(0, 0, ww, hh).data, w: ww, h: hh, canvas };
        }
        work.set(sc, src);
      }
      const grid = new Float32Array(3 * GRID * GRID);
      sampleRgba(src.rgba, src.w, makeTaps(GRID, rx0 * sc, L * sc, src.w), makeTaps(GRID, ry0 * sc, L * sc, src.h), grid);
      const region: Region = { grid, fcx: ((cx - rx0) / L) * GRID, fcy: ((cy - ry0) / L) * GRID, base: (sd / L) * GRID };

      const left = chosen.length - idx;
      const deadline = performance.now() + Math.max(0, cfg.budgetMs - (performance.now() - t0)) / left;
      let delta: Float32Array | undefined;
      try {
        delta = await optimizeDelta(region, embedders, { eps: cfg.eps / 255, steps: cfg.steps, deadline, rng });
        if (performance.now() >= deadline) truncated = true;
        applyRegionDelta(img.data, w, h, delta, rx0, ry0, L, cfg.eps, applied);
        cloaked++;
      } finally {
        zero(grid);
        zero(delta);
      }
    }
  } finally {
    zero(applied.buf);
    for (const s of work.values()) {
      if (s.canvas) {
        zero(s.rgba);
        s.canvas.width = s.canvas.height = 0;
      }
    }
  }
  return { found: faces.length, cloaked, truncated };
}
