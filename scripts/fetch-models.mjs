// Downloads the real INT8 NER model into public/models/ and verifies SHA-256.
// Dev-time only: the extension itself never touches the network.
// Source: https://huggingface.co/Xenova/bert-base-NER (ONNX INT8 export of dslim/bert-base-NER), MIT licence.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const REV = '8e892123e8b7c2c0c2bd1dcb598b7d244c4e53aa';
const BASE = `https://huggingface.co/Xenova/bert-base-NER/resolve/${REV}`;
const OUT = new URL('../public/models/', import.meta.url).pathname;
const FILES = [
  { src: 'onnx/model_quantized.onnx', dst: 'privacy-ner.int8.onnx', sha256: 'caaee70a5518ec7f9e46e5308fcc9263a8c227703a9ce46cf61c69a552349648' },
  { src: 'vocab.txt', dst: 'privacy-ner.vocab.txt', sha256: 'eeaa9875b23b04b4c54ef759d03db9d1ba1554838f8fb26c5d96fa551df93d02' },
];
const CONFIG = { id2label: { 0: 'O', 1: 'B-MISC', 2: 'I-MISC', 3: 'B-PER', 4: 'I-PER', 5: 'B-ORG', 6: 'I-ORG', 7: 'B-LOC', 8: 'I-LOC' }, doLowerCase: false, maxLength: 512, minConfidence: 0.6 };

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const path = OUT + f.dst;
  if (existsSync(path) && sha(readFileSync(path)) === f.sha256) { console.log('ok (cached)', f.dst); continue; }
  const res = await fetch(`${BASE}/${f.src}`);
  if (!res.ok) throw new Error(`${f.src}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== f.sha256) throw new Error(`${f.dst}: checksum mismatch (got ${sha(buf)})`);
  writeFileSync(path, buf);
  console.log('downloaded', f.dst, (buf.length / 1048576).toFixed(1) + ' MB');
}
writeFileSync(OUT + 'privacy-ner.config.json', JSON.stringify(CONFIG, null, 2) + '\n');
console.log('wrote privacy-ner.config.json');
