import type { Shield, ShieldRequest, ShieldResponse } from '../../types/shield';
import { setBaseUrl } from '../ort';

export type WorkerIn =
  | { type: 'init'; baseUrl: string }
  | { type: 'infer'; request: ShieldRequest }
  | { type: 'dispose' };

export type WorkerOut =
  | { type: 'result'; response: ShieldResponse }
  | { type: 'error'; requestId: string }
  | { type: 'disposed' };

/** Runs inside a dedicated worker: hosts one shield and its ONNX sessions. */
export function runShieldWorker(shield: Shield): void {
  const post = (m: WorkerOut): void => (self as unknown as Worker).postMessage(m);
  self.onmessage = (e: MessageEvent<WorkerIn>) => {
    const m = e.data;
    if (m.type === 'init') setBaseUrl(m.baseUrl);
    else if (m.type === 'infer') {
      shield.handle(m.request).then(
        (response) => post({ type: 'result', response }),
        () => post({ type: 'error', requestId: m.request.requestId }),
      );
    } else if (m.type === 'dispose') void shield.dispose().then(() => post({ type: 'disposed' }));
  };
}
