import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { check, DIST, launch } from './harness.mjs';

const MODELS = new URL('../../public/models/', import.meta.url).pathname;
const FIX = new URL('../fixtures/deepfake/', import.meta.url).pathname;
const FILES = ['people-deepfake.int8.onnx', 'people-deepfake.config.json'];
const MIN_ACCURACY = 0.65; // better than chance with p < 0.01 for n = 80 (binomial)

/** Rank-based AUC: probability that a random fake scores above a random real. */
function auc(rows) {
  const pos = rows.filter((r) => r.label === 'fake'), neg = rows.filter((r) => r.label === 'real');
  let w = 0;
  for (const p of pos) for (const n of neg) w += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
  return w / (pos.length * neg.length);
}

export default async function gatePeople() {
  console.log('Real deepfake classifier — labelled face fixture (OpenRL/DeepFakeFace sample), per-frame score via the PEOPLE shield, real onnxruntime-web, offline');
  const manifestPath = `${FIX}manifest.json`;
  if (!FILES.every((f) => existsSync(MODELS + f)) || !existsSync(manifestPath)) {
    check('model + fixture present (run: node scripts/fetch-models.mjs && python3 -I scripts/fetch-deepfake-fixture.py)', false);
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dir = `${DIST}/models`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) copyFileSync(MODELS + f, `${dir}/${f}`);
  const ctx = await launch();
  try {
    const rows = [];
    const t0all = Date.now();
    for (const [i, it] of manifest.items.entries()) {
      const b64 = readFileSync(FIX + it.file).toString('base64');
      const r = await ctx.sw.evaluate(async (b64, i) => {
        // Same framing as the content script's grabFrame: squash the frame into 224x224, RGBA.
        const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' });
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(224, 224);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0, 224, 224);
        bmp.close();
        const px = new Uint8Array(g.getImageData(0, 0, 224, 224).data.buffer);
        let s = ''; for (let k = 0; k < px.length; k += 0x8000) s += String.fromCharCode(...px.subarray(k, k + 0x8000));
        if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
          await chrome.offscreen.createDocument({ url: 'src/offscreen/offscreen.html', reasons: ['WORKERS'], justification: 'test' });
          await new Promise((r) => setTimeout(r, 500));
        }
        return chrome.runtime.sendMessage({ kind: 'OFFSCREEN_INFER', target: 'offscreen', request: { requestId: `p${i}`, shield: 'PEOPLE', tabId: 1, domain: 'x', payload: { b64: btoa(s), width: 224, height: 224, sessionId: `s${i}` } } });
      }, b64, i);
      rows.push({ ...it, score: r.data.frameScore, backend: r.data.backend, ms: r.latencyMs });
    }
    const n = rows.length;
    const correct = rows.filter((r) => (r.score >= 0.5) === (r.label === 'fake'));
    const byGen = {};
    for (const r of rows) { const g = (byGen[r.generator] ??= [0, 0]); g[1]++; if ((r.score >= 0.5) === (r.label === 'fake')) g[0]++; }
    const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
    const acc = correct.length / n;
    const A = auc(rows);
    const backends = [...new Set(rows.map((r) => r.backend))];
    console.log(`  info  n=${n} (${rows.filter((r) => r.label === 'real').length} real, ${rows.filter((r) => r.label === 'fake').length} fake); backend ${backends}; median ${ms[n >> 1].toFixed(0)} ms/frame; ${((Date.now() - t0all) / 1000).toFixed(0)} s total`);
    console.log(`  info  accuracy @0.5: ${(acc * 100).toFixed(1)}% (${correct.length}/${n}); AUC ${A.toFixed(3)}`);
    console.log(`  info  correct per source: ${Object.entries(byGen).map(([g, [h, t]]) => `${g} ${h}/${t}`).join(', ')}`);
    const meanOf = (l) => rows.filter((r) => r.label === l).reduce((a, r) => a + r.score, 0) / rows.filter((r) => r.label === l).length;
    console.log(`  info  mean fake-score: real ${meanOf('real').toFixed(2)}, fake ${meanOf('fake').toFixed(2)}`);
    check('real model ran (no "unavailable" backend)', backends.every((b) => b === 'wasm' || b === 'webgpu'), backends.join());
    check(`accuracy on the labelled fixture is better than chance (>= ${MIN_ACCURACY})`, acc >= MIN_ACCURACY, `${(acc * 100).toFixed(1)}%`);
  } finally {
    await ctx.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}
