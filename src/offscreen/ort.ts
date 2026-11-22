import type * as OrtTypes from 'onnxruntime-web';

export type Ort = typeof OrtTypes;
export type Backend = 'webgpu' | 'wasm';

export interface LoadedModel {
  ort: Ort;
  session: OrtTypes.InferenceSession;
  backend: Backend;
}

let ortPromise: Promise<Ort> | null = null;
const sessions = new Map<string, Promise<LoadedModel | null>>();
const installed = new Map<string, Promise<boolean>>();

/**
 * Model files live in the extension package (public/models -> models/).
 * `connect-src 'none'` blocks every network request but still allows an
 * extension page to read its *own* packaged files (verified by tests/e2e), so
 * no weights ever need to be fetched from anywhere else.
 */
/** Workers have no chrome.* APIs; the offscreen document passes the package base URL in. */
let baseUrl: string | null = null;
export function setBaseUrl(url: string): void {
  baseUrl = url;
}

async function readPackaged(name: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const r = await fetch(`${baseUrl ?? chrome.runtime.getURL('')}models/${name}`);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null; // file not installed
  }
}

export function assetInstalled(name: string): Promise<boolean> {
  let p = installed.get(name);
  if (!p) installed.set(name, (p = readPackaged(name).then((bytes) => bytes !== null)));
  return p;
}

export async function loadAssetText(name: string): Promise<string | null> {
  const bytes = await readPackaged(name);
  if (!bytes) return null;
  const text = new TextDecoder().decode(bytes);
  bytes.fill(0);
  return text;
}

export function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function loadOrt(): Promise<Ort> {
  ortPromise ??= (async () => {
    // Dynamic import keeps ORT out of the path entirely when no model is installed.
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1; // offscreen documents are not cross-origin isolated
    ort.env.wasm.proxy = false;
    return ort;
  })();
  return ortPromise;
}

/**
 * Loads (once) an InferenceSession for a packaged .onnx. Prefers WebGPU and
 * falls back to WASM SIMD. Resolves null when the model is not installed,
 * which callers treat as "use the deterministic fallback".
 */
export function getModel(file: string): Promise<LoadedModel | null> {
  let p = sessions.get(file);
  if (!p) {
    p = (async () => {
      const bytes = await readPackaged(file);
      if (!bytes) return null;
      const ort = await loadOrt();
      const order: Backend[][] = webgpuAvailable() ? [['webgpu'], ['wasm']] : [['wasm']];
      let lastErr: unknown;
      try {
        for (const eps of order) {
          try {
            const session = await ort.InferenceSession.create(bytes, { executionProviders: eps, graphOptimizationLevel: 'all' });
            return { ort, session, backend: eps[0]! } satisfies LoadedModel;
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      } finally {
        bytes.fill(0); // session keeps its own copy of the weights
      }
    })().catch(() => null); // a broken model degrades to the fallback instead of breaking the shield
    sessions.set(file, p);
  }
  return p;
}

export async function disposeModels(): Promise<void> {
  const all = [...sessions.values()];
  sessions.clear();
  for (const p of all) {
    const m = await p;
    await m?.session.release();
  }
}
