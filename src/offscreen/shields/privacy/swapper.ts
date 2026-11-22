import type { EntityMap, EntityType } from '../../../types/shield';
import type { Span } from './spans';

const PLACEHOLDER = /^\[([A-Z]+)_(\d+)\]$/;

/**
 * Reversible entity swapper. The same real value always maps to the same
 * placeholder across prompts in a tab (existing map is reused), and counters
 * continue from the highest existing index so placeholders never collide.
 */
export function swapEntities(text: string, spans: Span[], existing: EntityMap): { redactedText: string; map: EntityMap; count: number } {
  const map: EntityMap = { ...existing };
  const byValue = new Map<string, string>();
  const counters = new Map<EntityType | string, number>();
  for (const [ph, value] of Object.entries(map)) {
    byValue.set(value, ph);
    const m = PLACEHOLDER.exec(ph);
    if (m) counters.set(m[1]!, Math.max(counters.get(m[1]!) ?? 0, Number(m[2])));
  }

  let out = '';
  let cursor = 0;
  let count = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < cursor) continue;
    const value = text.slice(s.start, s.end);
    let ph = byValue.get(value);
    if (!ph) {
      const n = (counters.get(s.type) ?? 0) + 1;
      counters.set(s.type, n);
      ph = `[${s.type}_${n}]`;
      byValue.set(value, ph);
      map[ph] = value;
    }
    out += text.slice(cursor, s.start) + ph;
    cursor = s.end;
    count++;
  }
  out += text.slice(cursor);
  return { redactedText: out, map, count };
}

/** Inverse of swapEntities for a full string (used for visual restoration). */
export function restorePlaceholders(text: string, map: EntityMap): string {
  const keys = Object.keys(map);
  if (!keys.length) return text;
  const re = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return text.replace(re, (k) => map[k] ?? k);
}
