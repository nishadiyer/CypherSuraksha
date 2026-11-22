// Hand-assembled ONNX (protobuf) test graphs. These are NOT real models: they exist
// only to exercise the full ORT load/run/dispose path in the real extension.
const varint = (n) => { const o = []; n = BigInt(n); do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
const tag = (f, w) => varint((f << 3) | w);
const len = (f, buf) => Buffer.concat([tag(f, 2), varint(buf.length), buf]);
const str = (f, s) => len(f, Buffer.from(s));
const vint = (f, n) => Buffer.concat([tag(f, 0), varint(n)]);
const cat = (...b) => Buffer.concat(b);

const dim = (d) => len(1, typeof d === 'number' ? vint(1, d) : str(2, d));
const valueInfo = (name, elem, dims) => cat(str(1, name), len(2, len(1, cat(vint(1, elem), len(2, cat(...dims.map(dim)))))));
const tensor = (name, dims, f32) => cat(...dims.map((d) => vint(1, d)), vint(2, 1), str(8, name), len(9, Buffer.from(new Float32Array(f32).buffer)));
const node = (op, inputs, outputs) => cat(...inputs.map((i) => str(1, i)), ...outputs.map((o) => str(2, o)), str(4, op));
const model = (graph) => cat(vint(1, 8), str(2, 'aishield-test'), len(7, graph), len(8, cat(str(1, ''), vint(2, 17))));

export const VOCAB = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'hello', 'grace', 'hopper', 'visits', 'tokyo', '.'];
export const LABELS = ['O', 'B-PER', 'I-PER', 'B-ORG', 'I-ORG', 'B-LOC', 'I-LOC', 'B-MISC', 'I-MISC'];

/** logits = Gather(table[vocab, labels], input_ids) -> [1, seq, 9]; table hard-wires grace/hopper/tokyo. */
export function nerModel() {
  const table = new Array(VOCAB.length * LABELS.length).fill(0);
  const set = (word, label) => { table[VOCAB.indexOf(word) * LABELS.length + LABELS.indexOf(label)] = 12; };
  VOCAB.forEach((_, i) => (table[i * LABELS.length] = 6)); // default: O
  set('grace', 'B-PER'); set('hopper', 'I-PER'); set('tokyo', 'B-LOC');
  const g = cat(
    len(1, node('Gather', ['table', 'input_ids'], ['logits'])), str(2, 'ner'),
    len(5, tensor('table', [VOCAB.length, LABELS.length], table)),
    len(11, valueInfo('input_ids', 7, ['b', 's'])), len(11, valueInfo('attention_mask', 7, ['b', 's'])), len(11, valueInfo('token_type_ids', 7, ['b', 's'])),
    len(12, valueInfo('logits', 1, ['b', 's', LABELS.length])),
  );
  return model(g);
}
export const nerConfig = () => JSON.stringify({ id2label: Object.fromEntries(LABELS.map((l, i) => [String(i), l])), doLowerCase: true, maxLength: 512, minConfidence: 0.6 });

/** out = image + 0.02  (delta of ~5.1 levels, which the shield clamps to its eps budget). */
export function cloakModel() {
  const g = cat(
    len(1, node('Add', ['image', 'k'], ['out'])), str(2, 'cloak'),
    len(5, tensor('k', [], [0.02])),
    len(11, valueInfo('image', 1, [1, 3, 'h', 'w'])), len(12, valueInfo('out', 1, [1, 3, 'h', 'w'])),
  );
  return model(g);
}

/** score = sigmoid((mean(pixels) - 0.5) * 20): dark frames -> ~0, bright frames -> ~1. */
export function peopleModel() {
  const g = cat(
    len(1, node('ReduceMean', ['x'], ['m'])),
    len(1, node('Sub', ['m', 'half'], ['d'])),
    len(1, node('Mul', ['d', 'gain'], ['z'])),
    len(1, node('Sigmoid', ['z'], ['y'])),
    str(2, 'people'),
    len(5, tensor('half', [], [0.5])), len(5, tensor('gain', [], [20])),
    len(11, valueInfo('x', 1, [1, 3, 224, 224])), len(12, valueInfo('y', 1, [1, 1, 1, 1])),
  );
  return model(g);
}
