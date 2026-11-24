import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { check, DIST, launch } from './harness.mjs';

const MODELS = new URL('../../public/models/', import.meta.url).pathname;
const FIX = new URL('../fixtures/deepfake/', import.meta.url).pathname;
const FILES = ['people-deepfake.int8.onnx', 'people-deepfake.fp32.onnx', 'people-deepfake.config.json', 'face-detector.ultraface.onnx'];
// Optional second detector (face-swaps): npm run models:gend. Only used on a real GPU.
const GEND = ['people-gend.fp16.onnx', 'people-gend.config.json'];
const HAVE_GEND = GEND.every((f) => existsSync(MODELS + f));
const MIN_AUC_PLAIN = 0.8; // Python reference with the same crop: 0.85 on this set
const MIN_AUC_TILE = 0.65; // Python reference: 0.74 (the pre-crop pipeline scored 0.52, chance)
const REAL_GPU = !!process.env.E2E_REAL_GPU;

/** Rank-based AUC: probability that a random fake scores above a random real. */
function auc(rows) {
  const pos = rows.filter((r) => r.label === 'fake'), neg = rows.filter((r) => r.label === 'real');
  let w = 0;
  for (const p of pos) for (const n of neg) w += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
  return w / (pos.length * neg.length);
}

export default async function gatePeople() {
  console.log(`Real deepfake classifier — labelled faces through the PEOPLE shield (whole frame in, face crop inside), ${REAL_GPU ? 'REAL GPU' : 'software GPU'}, real onnxruntime-web, offline`);
  const manifestPath = `${FIX}manifest.json`;
  if (!FILES.every((f) => existsSync(MODELS + f)) || !existsSync(manifestPath)) {
    check('models + fixture present (run: npm run models && npm run fixtures)', false);
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dir = `${DIST}/models`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of [...FILES, ...(HAVE_GEND ? GEND : [])]) copyFileSync(MODELS + f, `${dir}/${f}`);
  const ctx = await launch({ protocolTimeout: 120000 });
  try {
    // Sends a frame exactly as the content script now does: whole frame, aspect kept, longest side <= 640.
    const send = (jpegB64, mode, id, faceSwapOn = HAVE_GEND) => ctx.sw.evaluate(async (jpegB64, mode, id, faceSwapOn) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(jpegB64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
      let frame;
      if (mode === 'tile') { // the face pasted small into a 16:9 call tile
        frame = new OffscreenCanvas(640, 360);
        const g = frame.getContext('2d', { willReadFrequently: true });
        g.fillStyle = 'rgb(60,62,66)'; g.fillRect(0, 0, 640, 360); g.drawImage(bmp, 300, 120, 160, 160);
      } else if (mode === 'blank') {
        frame = new OffscreenCanvas(640, 360);
        const g = frame.getContext('2d', { willReadFrequently: true }); g.fillStyle = 'rgb(60,62,66)'; g.fillRect(0, 0, 640, 360);
      } else {
        const s = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
        frame = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
        frame.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, frame.width, frame.height);
      }
      bmp.close();
      const px = new Uint8Array(frame.getContext('2d').getImageData(0, 0, frame.width, frame.height).data.buffer);
      let s = ''; for (let k = 0; k < px.length; k += 0x8000) s += String.fromCharCode(...px.subarray(k, k + 0x8000));
      if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
        await chrome.offscreen.createDocument({ url: 'src/offscreen/offscreen.html', reasons: ['WORKERS'], justification: 'test' });
        await new Promise((r) => setTimeout(r, 500));
      }
      return chrome.runtime.sendMessage({ kind: 'OFFSCREEN_INFER', target: 'offscreen', request: { requestId: id, shield: 'PEOPLE', tabId: 1, domain: 'x', payload: { b64: btoa(s), width: frame.width, height: frame.height, sessionId: id, faceSwap: faceSwapOn } } });
    }, jpegB64, mode, id, faceSwapOn);

    const plain = [], tile = [];
    const t0all = Date.now();
    for (const [i, it] of manifest.items.entries()) {
      const b64 = readFileSync(FIX + it.file).toString('base64');
      for (const [mode, out] of [['plain', plain], ['tile', tile]]) {
        const r = await send(b64, mode, `${mode}${i}`);
        out.push({ ...it, score: r.data.status === 'no-face' ? null : r.data.frameScore, backend: r.data.backend, ms: r.latencyMs, gend: r.data.gend, main: r.data.main, t: r.data.timingMs });
      }
    }
    const scored = (rows) => rows.filter((r) => r.score !== null);
    // E2E_DUMP_SCORES=path: write per-image main / face-swap-detector scores (used to choose demo examples)
    if (process.env.E2E_DUMP_SCORES) (await import('node:fs')).writeFileSync(process.env.E2E_DUMP_SCORES, JSON.stringify(plain.map((r) => ({ file: r.file, label: r.label, generator: r.generator, main: r.main ?? null, gend: r.gend ?? null, score: r.score })), null, 1));
    const rate = (rows) => scored(rows).length / rows.length;
    const lat = scored(plain).map((r) => r.ms).sort((a, b) => a - b);
    const backends = [...new Set(scored(plain).map((r) => r.backend))];
    const aucPlain = auc(scored(plain)), aucTile = auc(scored(tile));
    const correct = scored(plain).filter((r) => (r.score >= 0.5) === (r.label === 'fake'));
    const byGen = {};
    for (const r of scored(plain)) { const g = (byGen[r.generator] ??= [0, 0]); g[1]++; if ((r.score >= 0.5) === (r.label === 'fake')) g[0]++; }
    console.log(`  info  n=${plain.length}; backend ${backends}; median ${lat[lat.length >> 1].toFixed(0)} ms/frame (detect + crop + classify); ${((Date.now() - t0all) / 1000).toFixed(0)} s total`);
    const med = (xs) => { const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[v.length >> 1].toFixed(0) : '-'; };
    const th = (rows) => rows.map((r) => r.t);
    console.log(`  info  median stage ms: detect+crop ${med(th(scored(plain)).map((t) => t?.detect))}, main model ${med(th(scored(plain)).map((t) => t?.main))}, GenD ${med(th(scored(plain)).map((t) => t?.gend))} (run ${med(th(scored(plain)).map((t) => t?.gendRun))}); first 10 frames total ${med(scored(plain).slice(0, 10).map((r) => r.ms))}, last 10 ${med(scored(plain).slice(-10).map((r) => r.ms))}`);
    console.log(`  info  face found: plain ${(rate(plain) * 100).toFixed(0)}%, tile ${(rate(tile) * 100).toFixed(0)}%`);
    console.log(`  info  AUC plain ${aucPlain.toFixed(3)}, call-tile ${aucTile.toFixed(3)}; accuracy @0.5 (plain) ${(correct.length / scored(plain).length * 100).toFixed(1)}%`);
    console.log(`  info  correct per source @0.5: ${Object.entries(byGen).map(([g, [h, t]]) => `${g} ${h}/${t}`).join(', ')}`);
    check('real model ran (no "unavailable" backend)', backends.length > 0 && backends.every((b) => b === 'wasm' || b === 'webgpu'), backends.join());
    check('a face is found in >= 95% of fixture frames', rate(plain) >= 0.95, `${(rate(plain) * 100).toFixed(0)}%`);
    check(`AUC on whole frames >= ${MIN_AUC_PLAIN}`, aucPlain >= MIN_AUC_PLAIN, aucPlain.toFixed(3));
    check(`AUC on small faces in a call tile >= ${MIN_AUC_TILE} (the old squash-the-frame pipeline scored 0.52)`, aucTile >= MIN_AUC_TILE, aucTile.toFixed(3));

    const blank = await send(readFileSync(FIX + manifest.items[0].file).toString('base64'), 'blank', 'blank');
    check('a frame with no face reports "no face" instead of guessing', blank.data?.status === 'no-face' && blank.data?.level === 'YELLOW' && !blank.data?.sustainedRed, JSON.stringify(blank.data));
    if (REAL_GPU) {
      check('real GPU: FP32 model on WebGPU is selected', backends.length === 1 && backends[0] === 'webgpu', backends.join());
      if (HAVE_GEND) {
        const used = scored(plain).filter((r) => typeof r.gend === 'number').length;
        const swap = byGen.insight ?? [0, 1];
        console.log(`  info  second detector (GenD) ran on ${used}/${scored(plain).length} frames; face-swaps caught @0.5: ${swap[0]}/${swap[1]} (main model alone: 1/13)`);
        check('real GPU: the second detector (GenD) runs on every scored frame', used === scored(plain).length, `${used}/${scored(plain).length}`);
        check('real GPU: face-swap recall with both detectors >= 4/13 (main model alone: 1/13)', swap[0] >= 4, `${swap[0]}/${swap[1]}`);
        check('the face-swap detector can lift the frame score only up to the cap (0.65): alone it can never reach red', scored(plain).every((r) => r.score <= Math.max(r.main ?? 0, 0.65) + 1e-6), JSON.stringify(scored(plain).filter((r) => r.score > Math.max(r.main ?? 0, 0.65) + 1e-6).slice(0, 2).map((r) => [r.score, r.main])));
        const off = await send(readFileSync(FIX + manifest.items[0].file).toString('base64'), 'plain', 'offcheck', false);
        check('with the setting off (the default) the face-swap detector does not run', off.data?.gend === undefined && typeof off.data?.main === 'number', JSON.stringify(off.data));
        check('real GPU: both detectors + detection stay usable (< 1500 ms per frame, median; machine-load dependent, see MODELS.md)', lat[lat.length >> 1] < 1500, `${lat[lat.length >> 1].toFixed(0)} ms`);
      } else {
        check('real GPU: detect + crop + classify under the 150 ms budget (median)', lat[lat.length >> 1] < 150, `${lat[lat.length >> 1].toFixed(0)} ms`);
      }
    } else {
      check('software GPU: falls back to INT8 on WASM (second detector not used)', backends.length === 1 && backends[0] === 'wasm' && scored(plain).every((r) => r.gend === undefined), backends.join());
    }
  } finally {
    await ctx.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}
