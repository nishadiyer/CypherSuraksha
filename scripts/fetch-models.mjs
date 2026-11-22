// Downloads the real INT8 NER model into public/models/ and verifies SHA-256.
// Dev-time only: the extension itself never touches the network.
// Sources (see MODELS.md for licences and measurements):
//  - Privacy NER: https://huggingface.co/Xenova/bert-base-NER (INT8 export of dslim/bert-base-NER), MIT.
//  - Face detector (cloak): https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB (UltraFace RFB-320), MIT.
//  - People deepfake: https://huggingface.co/buildborderless/CommunityForensics-DeepfakeDet-ViT (corrected INT8 ONNX of a ViT-Small trained on 4,803 generators), MIT.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const REV = '8e892123e8b7c2c0c2bd1dcb598b7d244c4e53aa';
const NER_BASE = `https://huggingface.co/Xenova/bert-base-NER/resolve/${REV}`;
const FD_BASE = 'https://raw.githubusercontent.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/0f9ca4a9fc80170fd505168fd1132b837141f7df';
const DF_BASE = 'https://huggingface.co/buildborderless/CommunityForensics-DeepfakeDet-ViT/resolve/ac6ee457bea904a373065754107451793b56db00';
const OUT = new URL('../public/models/', import.meta.url).pathname;
const FILES = [
  { base: NER_BASE, src: 'onnx/model_quantized.onnx', dst: 'privacy-ner.int8.onnx', sha256: 'caaee70a5518ec7f9e46e5308fcc9263a8c227703a9ce46cf61c69a552349648' },
  { base: NER_BASE, src: 'vocab.txt', dst: 'privacy-ner.vocab.txt', sha256: 'eeaa9875b23b04b4c54ef759d03db9d1ba1554838f8fb26c5d96fa551df93d02' },
  { base: DF_BASE, src: 'onnx/model.onnx', dst: 'people-deepfake.fp32.onnx', sha256: 'a42c7d740fbb345ba9a26d469b22f301d73089ce3c6da993877ed2b6965a8ba1' },
  { base: DF_BASE, src: 'onnx/model_int8.onnx', dst: 'people-deepfake.int8.onnx', sha256: '968f113f1107d58bfc73444b6e87020e2d541780ad43b7a1ac3e3b18b86c2bbd' },
  { base: FD_BASE, src: 'models/onnx/version-RFB-320.onnx', dst: 'face-detector.ultraface.onnx', sha256: '34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017' },
];
const CONFIG = { id2label: { 0: 'O', 1: 'B-MISC', 2: 'I-MISC', 3: 'B-PER', 4: 'I-PER', 5: 'B-ORG', 6: 'I-ORG', 7: 'B-LOC', 8: 'I-LOC' }, doLowerCase: false, maxLength: 512, minConfidence: 0.6 };

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const path = OUT + f.dst;
  if (existsSync(path) && sha(readFileSync(path)) === f.sha256) { console.log('ok (cached)', f.dst); continue; }
  const res = await fetch(`${f.base}/${f.src}`);
  if (!res.ok) throw new Error(`${f.src}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== f.sha256) throw new Error(`${f.dst}: checksum mismatch (got ${sha(buf)})`);
  writeFileSync(path, buf);
  console.log('downloaded', f.dst, (buf.length / 1048576).toFixed(1) + ' MB');
}
writeFileSync(OUT + 'privacy-ner.config.json', JSON.stringify(CONFIG, null, 2) + '\n');
console.log('wrote privacy-ner.config.json');
// Single logit -> sigmoid = P(fake). CLIP mean/std, 384 px input (preprocessor_config.json).
writeFileSync(OUT + 'people-deepfake.config.json', JSON.stringify({ size: 384, mean: [0.48145466, 0.4578275, 0.40821073], std: [0.26862954, 0.26130258, 0.27577711], output: 'sigmoid' }, null, 2) + '\n');
console.log('wrote people-deepfake.config.json');
