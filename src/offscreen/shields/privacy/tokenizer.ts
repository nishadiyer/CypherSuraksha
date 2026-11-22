/** Minimal WordPiece tokenizer with character offsets (BERT-family NER models). */
export interface Token {
  id: number;
  start: number;
  end: number;
  /** true for the first piece of a word */
  wordStart: boolean;
}

export class WordPieceTokenizer {
  private readonly vocab = new Map<string, number>();
  private readonly unk: number;
  readonly cls: number;
  readonly sep: number;
  readonly pad: number;

  constructor(vocabText: string, private readonly lower: boolean, private readonly maxWordChars = 100) {
    vocabText.split(/\r?\n/).forEach((t, i) => {
      if (t) this.vocab.set(t, i);
    });
    this.unk = this.vocab.get('[UNK]') ?? 0;
    this.cls = this.vocab.get('[CLS]') ?? 101;
    this.sep = this.vocab.get('[SEP]') ?? 102;
    this.pad = this.vocab.get('[PAD]') ?? 0;
  }

  tokenize(text: string): Token[] {
    const out: Token[] = [];
    for (const m of text.matchAll(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)) {
      const wStart = m.index ?? 0;
      const word = this.lower ? m[0].toLowerCase() : m[0];
      if (word.length > this.maxWordChars) {
        out.push({ id: this.unk, start: wStart, end: wStart + m[0].length, wordStart: true });
        continue;
      }
      let pos = 0;
      const pieces: Token[] = [];
      let bad = false;
      while (pos < word.length) {
        let end = word.length;
        let found: number | undefined;
        while (end > pos) {
          const sub = (pos > 0 ? '##' : '') + word.slice(pos, end);
          found = this.vocab.get(sub);
          if (found !== undefined) break;
          end--;
        }
        if (found === undefined) {
          bad = true;
          break;
        }
        pieces.push({ id: found, start: wStart + pos, end: wStart + end, wordStart: pos === 0 });
        pos = end;
      }
      if (bad) out.push({ id: this.unk, start: wStart, end: wStart + m[0].length, wordStart: true });
      else out.push(...pieces);
    }
    return out;
  }
}
