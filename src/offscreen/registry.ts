import type { Shield, ShieldKind, ShieldRequest, ShieldResponse } from '../types/shield';
import type { WorkerIn, WorkerOut } from './workers/workerHost';

const shields = new Map<ShieldKind, Shield>();

/**
 * Registers a shield that runs in its own dedicated Web Worker. The worker is
 * created on first use, so an idle shield costs nothing, and is terminated on dispose.
 */
export function registerWorkerShield(kind: ShieldKind, create: () => Worker): void {
  let worker: Worker | null = null;
  const pending = new Map<string, { resolve: (r: ShieldResponse) => void; reject: (e: Error) => void }>();

  const drop = (err: Error): void => {
    worker?.terminate();
    worker = null;
    pending.forEach((p) => p.reject(err));
    pending.clear();
  };

  const ensure = (): Worker => {
    if (worker) return worker;
    const w = (worker = create());
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'result') {
        pending.get(m.response.requestId)?.resolve(m.response);
        pending.delete(m.response.requestId);
      } else if (m.type === 'error') {
        pending.get(m.requestId)?.reject(new Error('shield failed'));
        pending.delete(m.requestId);
      }
    };
    w.onerror = () => drop(new Error('worker crashed'));
    w.postMessage({ type: 'init', baseUrl: chrome.runtime.getURL('') } satisfies WorkerIn);
    return w;
  };

  shields.set(kind, {
    kind,
    handle: (request: ShieldRequest) =>
      new Promise<ShieldResponse>((resolve, reject) => {
        pending.set(request.requestId, { resolve, reject });
        ensure().postMessage({ type: 'infer', request } satisfies WorkerIn);
      }),
    async dispose() {
      if (!worker) return;
      const w = worker;
      await new Promise<void>((done) => {
        const t = setTimeout(done, 2000);
        w.addEventListener('message', (e: MessageEvent<WorkerOut>) => {
          if (e.data.type === 'disposed') {
            clearTimeout(t);
            done();
          }
        });
        w.postMessage({ type: 'dispose' } satisfies WorkerIn);
      });
      drop(new Error('disposed'));
    },
  });
}

export async function dispatch(req: ShieldRequest): Promise<ShieldResponse> {
  const started = performance.now();
  const shield = shields.get(req.shield);
  if (!shield) return { requestId: req.requestId, action: 'ALLOW', confidence: 0, latencyMs: performance.now() - started };
  return shield.handle(req);
}

export async function disposeAll(): Promise<void> {
  await Promise.all([...shields.values()].map((s) => s.dispose()));
}
