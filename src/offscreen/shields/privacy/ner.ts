import { zero } from '../../../shared/base64';
import type { EntityType } from '../../../types/shield';
import { assetInstalled, getModel, loadAssetText, type Backend } from '../../ort';
import { PRIORITY, type Span } from './spans';
import { WordPieceTokenizer } from './tokenizer';

export const NER_MODEL = 'privacy-ner.int8.onnx';
export const NER_VOCAB = 'privacy-ner.vocab.txt';
export const NER_CONFIG = 'privacy-ner.config.json';

export interface NerConfig {
  id2label: Record<string, string>;
  doLowerCase?: boolean;
  maxLength?: number;
  minConfidence?: number;
}

const LABEL_MAP: Record<string, EntityType | null> = {
  PER: 'PERSON', PERSON: 'PERSON', ORG: 'ORG', LOC: 'LOC', GPE: 'LOC', ID: 'ID', SECRET: 'SECRET', MISC: null,
};

interface Ready {
  tok: WordPieceTokenizer;
  cfg: NerConfig;
}
let ready: Promise<Ready | null> | null = null;

async function init(): Promise<Ready | null> {
  if (!(await assetInstalled(NER_MODEL))) return null;
  const [vocab, cfgText] = await Promise.all([loadAssetText(NER_VOCAB), loadAssetText(NER_CONFIG)]);
  if (!vocab || !cfgText) return null; // vocab + config are required next to the model
  const cfg = JSON.parse(cfgText) as NerConfig;
  return { tok: new WordPieceTokenizer(vocab, cfg.doLowerCase ?? false), cfg };
}

export function nerAvailable(): Promise<boolean> {
  ready ??= init();
  return ready.then((r) => r !== null);
}

export function softmax(logits: ArrayLike<number>, offset: number, n: number): number[] {
  let max = -Infinity;
  for (let i = 0; i < n; i++) max = Math.max(max, logits[offset + i]!);
  const ex = new Array<number>(n);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (ex[i] = Math.exp(logits[offset + i]! - max));
  return ex.map((v) => v / sum);
}

export interface TokenPrediction {
  start: number;
  end: number;
  label: string; // e.g. "B-PER"
  prob: number;
  wordStart: boolean;
}

/** BIO decoding at word level (first sub-word decides the label). Exported for tests. */
export function decodeBio(preds: TokenPrediction[], minConfidence: number): Span[] {
  const spans: Span[] = [];
  let cur: { type: EntityType; start: number; end: number; probs: number[] } | null = null;
  const flush = (): void => {
    if (cur) {
      spans.push({
        start: cur.start, end: cur.end, type: cur.type, priority: PRIORITY.MODEL,
        confidence: cur.probs.reduce((a, b) => a + b, 0) / cur.probs.length,
      });
    }
    cur = null;
  };
  for (const p of preds) {
    if (!p.wordStart) {
      if (cur) cur.end = p.end; // extend through sub-word pieces
      continue;
    }
    const [prefix, tag] = p.label.includes('-') ? (p.label.split('-', 2) as [string, string]) : ['O', ''];
    const type = LABEL_MAP[tag] ?? null;
    if (prefix === 'O' || !type || p.prob < minConfidence) {
      flush();
      continue;
    }
    if (prefix === 'B' || !cur || cur.type !== type) {
      flush();
      cur = { type, start: p.start, end: p.end, probs: [p.prob] };
    } else {
      cur.end = p.end;
      cur.probs.push(p.prob);
    }
  }
  flush();
  return spans;
}

/** Runs token classification. Returns null when no model is installed (caller falls back). */
export async function runNer(text: string): Promise<{ spans: Span[]; backend: Backend } | null> {
  ready ??= init();
  const r = await ready;
  if (!r) return null;
  const model = await getModel(NER_MODEL, ['wasm']); // INT8 graph: WebGPU gives wrong output (see ort.ts)
  if (!model) return null;
  const { ort, session, backend } = model;
  const maxLen = (r.cfg.maxLength ?? 512) - 2;
  const tokens = r.tok.tokenize(text);
  const preds: TokenPrediction[] = [];

  for (let off = 0; off < tokens.length; off += maxLen) {
    const chunk = tokens.slice(off, off + maxLen);
    const L = chunk.length + 2;
    const ids = new BigInt64Array(L);
    const mask = new BigInt64Array(L).fill(1n);
    const types = new BigInt64Array(L);
    ids[0] = BigInt(r.tok.cls);
    chunk.forEach((t, i) => (ids[i + 1] = BigInt(t.id)));
    ids[L - 1] = BigInt(r.tok.sep);

    const feeds: Record<string, import('onnxruntime-web').Tensor> = {
      input_ids: new ort.Tensor('int64', ids, [1, L]),
      attention_mask: new ort.Tensor('int64', mask, [1, L]),
    };
    if (session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', types, [1, L]);

    let outputs: Awaited<ReturnType<typeof session.run>> | undefined;
    try {
      outputs = await session.run(feeds);
      const out = outputs[session.outputNames[0]!]!;
      const logits = out.data as Float32Array;
      const nLabels = out.dims[2]!;
      chunk.forEach((t, i) => {
        const probs = softmax(logits, (i + 1) * nLabels, nLabels);
        let best = 0;
        probs.forEach((p, k) => {
          if (p > probs[best]!) best = k;
        });
        preds.push({ start: t.start, end: t.end, label: r.cfg.id2label[String(best)] ?? 'O', prob: probs[best]!, wordStart: t.wordStart });
      });
    } finally {
      // Release tensors and zero the backing buffers immediately after inference.
      Object.values(feeds).forEach((t) => t.dispose());
      if (outputs) Object.values(outputs).forEach((t) => t.dispose());
      zero(ids); zero(mask); zero(types);
    }
  }
  return { spans: decodeBio(preds, r.cfg.minConfidence ?? 0.6), backend };
}
