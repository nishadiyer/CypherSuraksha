import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { check, DIST, launch, makePng } from './harness.mjs';

const MODELS = new URL('../../public/models/', import.meta.url).pathname;
const FIX = new URL('../fixtures/deepfake/', import.meta.url).pathname;
const FILES = ['face-detector.ultraface.onnx', 'cloak-facenet-vggface2.onnx', 'cloak-facenet-casia.onnx'];
const EPS = 8;

export default async function gateCloak() {
  console.log('Pixel cloak (PGD, real onnxruntime-web, offline) — face detector + FaceNet ensemble, in the real offscreen worker');
  const face = existsSync(FIX) ? readdirSync(FIX).find((f) => f.startsWith('real-wiki-') && f.endsWith('.jpg')) : undefined;
  if (!FILES.every((f) => existsSync(MODELS + f)) || !face) {
    check('cloak models + a face fixture present (run: npm run models:cloak && npm run fixtures)', false);
    return;
  }
  const dir = `${DIST}/models`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) copyFileSync(MODELS + f, `${dir}/${f}`);
  const ctx = await launch({ protocolTimeout: 240000 });
  try {
    const infer = (id, b64, mime) => ctx.sw.evaluate(async (id, b64, mime) => {
      if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
        await chrome.offscreen.createDocument({ url: 'src/offscreen/offscreen.html', reasons: ['WORKERS'], justification: 'test' });
        await new Promise((r) => setTimeout(r, 500));
      }
      return chrome.runtime.sendMessage({ kind: 'OFFSCREEN_INFER', target: 'offscreen', request: { requestId: id, shield: 'PIXELS', tabId: 1, domain: 'x', payload: { b64, mime, name: 'a', strength: 0.5 } } });
    }, id, b64, mime);
    const page = await ctx.browser.newPage();
    const decode = (b64, mime) => page.evaluate(async (b64, mime) => {
      const bm = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime }));
      const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0);
      return { w: bm.width, h: bm.height, px: Array.from(g.getImageData(0, 0, bm.width, bm.height).data) };
    }, b64, mime);

    const png = readFileSync(FIX + face).toString('base64');
    const t0 = Date.now();
    const r = await infer('c1', png, 'image/jpeg');
    const first = Date.now() - t0;
    const d = r.data ?? {};
    console.log(`  info  first photo (includes loading ~215 MB of models): ${(first / 1000).toFixed(1)} s, mode ${d.mode}, faces ${d.faces}`);
    check('face detected and cloaked by the PGD path (mode pgd-wasm*)', /^pgd-wasm/.test(d.mode ?? '') && d.faces >= 1, JSON.stringify({ ...d, b64: undefined }));

    check('JPEG in, JPEG out (format kept)', d.mime === 'image/jpeg');
    // Bound the perturbation on a lossless copy: re-encoding a JPEG adds its own (much larger) codec error.
    const asPng = await page.evaluate(async (b64) => {
      const bm = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
      const c = new OffscreenCanvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0);
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    }, png);
    const rp = await infer('c1p', asPng, 'image/png');
    check('lossless photo cloaked too (mode pgd-wasm*)', /^pgd-wasm/.test(rp.data?.mode ?? '') && rp.data?.faces >= 1, JSON.stringify({ ...rp.data, b64: undefined }));
    const a = await decode(asPng, 'image/png');
    const b = await decode(rp.data?.b64, rp.data?.mime);
    check('dimensions identical', a.w === b.w && a.h === b.h, `${a.w}x${a.h} vs ${b.w}x${b.h}`);
    let max = 0, changed = 0;
    const N = a.px.length / 4;
    for (let i = 0; i < N; i++) {
      let diff = false;
      for (let c = 0; c < 3; c++) { const dd = Math.abs(a.px[i * 4 + c] - b.px[i * 4 + c]); if (dd > max) max = dd; if (dd) diff = true; }
      if (diff) changed++;
    }
    check(`per-channel change is exactly bounded by the budget (<= ${EPS}/255)`, max <= EPS && max >= EPS - 2, `max ${max}`);
    check('pixels actually changed, but not the whole photo (face region only)', changed > 500 && changed < N * 0.95, `${changed} of ${N} px`);
    check('two runs on the same photo differ (random crop jitter)', rp.data?.b64 !== (await infer('c1q', asPng, 'image/png')).data?.b64);

    // Image without a face: left alone (re-encoded, metadata stripped) and reported honestly.
    const noface = makePng(256, 192).toString('base64');
    const nf = await infer('c2', noface, 'image/png');
    const o = await decode(noface, 'image/png'); const n = await decode(nf.data?.b64, nf.data?.mime);
    check('no face found -> mode "no-face", faces 0', nf.data?.mode === 'no-face' && nf.data?.faces === 0, JSON.stringify({ ...nf.data, b64: undefined }));
    check('no-face image pixels are untouched (lossless PNG)', o.px.length === n.px.length && o.px.every((v, i) => v === n.px[i]));

    // Two photos at once are queued, both succeed.
    const [q1, q2] = await Promise.all([infer('q1', asPng, 'image/png'), infer('q2', noface, 'image/png')]);
    check('concurrent photos are processed one at a time and both succeed', /^pgd-wasm/.test(q1.data?.mode ?? '') && q2.data?.mode === 'no-face');

    // Timing and persistence.
    const t1 = Date.now(); await infer('t1', asPng, 'image/png'); const warm = Date.now() - t1;
    console.log(`  info  warm photo: ${(warm / 1000).toFixed(1)} s`);
    check('warm photo finishes within the 20 s budget plus encode overhead', warm < 26000, `${warm} ms`);
    const stores = await ctx.sw.evaluate(async () => JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)]));
    check('no image data in chrome.storage', stores.length < 800 && !/[A-Za-z0-9+/]{400}/.test(stores), stores.slice(0, 120));
    await page.close();
  } finally {
    await ctx.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}
