import { b64ToBytes, zero } from '../../shared/base64';
import type { PeoplePayload, PeopleResult, Shield, ShieldRequest, ShieldResponse } from '../../types/shield';
import { disposeModels } from '../ort';
import { classifyFrame } from './people/classifier';
import { TemporalSmoother } from './people/smoother';

const sessions = new Map<string, TemporalSmoother>();
const IDLE_MS = 60_000;

function sweep(): void {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastSeen > IDLE_MS) sessions.delete(id);
}

export const peopleShield: Shield = {
  kind: 'PEOPLE',
  async handle(req: ShieldRequest): Promise<ShieldResponse> {
    const t0 = performance.now();
    const p = req.payload as PeoplePayload;
    const key = `${req.tabId}:${p.sessionId}`;
    sweep();
    const rgba = new Uint8ClampedArray(b64ToBytes(p.b64).buffer);
    let frame: { score: number; backend: string } | null = null;
    try {
      frame = await classifyFrame(rgba, p.width, p.height);
    } finally {
      zero(rgba); // video frame never outlives this call
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
