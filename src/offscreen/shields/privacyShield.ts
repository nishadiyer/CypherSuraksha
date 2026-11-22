import { matchVault } from '../../shared/vault';
import type { PrivacyPayload, PrivacyResult, Shield, ShieldRequest, ShieldResponse } from '../../types/shield';
import { disposeModels } from '../ort';
import { detectDeterministic } from './privacy/detectors';
import { runNer } from './privacy/ner';
import { PRIORITY, resolveOverlaps, type Span } from './privacy/spans';
import { swapEntities } from './privacy/swapper';

const MAX_CHARS = 50_000;

export async function redact(payload: PrivacyPayload): Promise<{ result: PrivacyResult; confidence: number; mode: string }> {
  const text = payload.text.slice(0, MAX_CHARS);
  const spans: Span[] = detectDeterministic(text);

  for (const m of await matchVault(text, payload.vault)) {
    spans.push({ ...m, type: 'CUSTOM', priority: PRIORITY.CUSTOM, confidence: 1 });
  }

  let mode = 'deterministic';
  try {
    const ner = await runNer(text);
    if (ner) {
      spans.push(...ner.spans);
      mode = `onnx-${ner.backend}`;
    }
  } catch {
    // Model failure degrades to deterministic detectors only.
  }

  const kept = resolveOverlaps(spans);
  const swapped = swapEntities(payload.text, kept, payload.existingMap);
  const confidence = kept.length ? kept.reduce((a, s) => a + s.confidence, 0) / kept.length : 0;
  return { result: { redactedText: swapped.redactedText, map: swapped.map, count: swapped.count }, confidence, mode };
}

export const privacyShield: Shield = {
  kind: 'PRIVACY',
  async handle(req: ShieldRequest): Promise<ShieldResponse> {
    const t0 = performance.now();
    const { result, confidence, mode } = await redact(req.payload as PrivacyPayload);
    return {
      requestId: req.requestId,
      action: result.count > 0 ? 'MODIFY' : 'ALLOW',
      data: result.count > 0 ? { ...result, mode } : undefined,
      confidence,
      latencyMs: performance.now() - t0,
    };
  },
  dispose: disposeModels,
};
