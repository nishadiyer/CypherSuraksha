import type { EntityType } from '../../../types/shield';

export interface Span {
  start: number;
  end: number;
  type: EntityType;
  priority: number;
  confidence: number;
}

export const PRIORITY = { CUSTOM: 100, SECRET: 90, ID: 80, EMAIL: 70, PHONE: 60, MODEL: 50, HEURISTIC: 40 } as const;

/** Greedy non-overlapping selection: higher priority, then longer, then earlier wins. */
export function resolveOverlaps(spans: Span[]): Span[] {
  const sorted = [...spans].sort(
    (a, b) => b.priority - a.priority || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const kept: Span[] = [];
  for (const s of sorted) {
    if (s.end <= s.start) continue;
    if (kept.every((k) => s.end <= k.start || s.start >= k.end)) kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}
