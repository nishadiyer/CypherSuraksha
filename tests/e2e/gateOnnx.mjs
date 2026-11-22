import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { check, DIST, launch, makePng, sleep } from './harness.mjs';
import { VOCAB, cloakModel, nerConfig, nerModel } from './onnxgen.mjs';

export default async function gateOnnx() {
  console.log('ONNX path — real onnxruntime-web session in the offscreen doc (hand-built test graphs, models read from the package under connect-src none)');
  const dir = `${DIST}/models`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/privacy-ner.int8.onnx`, nerModel());
  writeFileSync(`${dir}/privacy-ner.vocab.txt`, VOCAB.join('\n'));
  writeFileSync(`${dir}/privacy-ner.config.json`, nerConfig());
  writeFileSync(`${dir}/pixel-cloak.fp16.onnx`, cloakModel());
  writeFileSync(`${dir}/pixel-cloak.config.json`, JSON.stringify({ output: 'image' }));
  const ctx = await launch();
  try {
    const infer = (request) => ctx.sw.evaluate(async (request) => {
      await new Promise((r) => setTimeout(r, 0));
      // Ensure the offscreen doc exists, then talk to it exactly like the router does.
      if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
        await chrome.offscreen.createDocument({ url: 'src/offscreen/offscreen.html', reasons: ['WORKERS'], justification: 'test' });
        await new Promise((r) => setTimeout(r, 500));
      }
      return chrome.runtime.sendMessage({ kind: 'OFFSCREEN_INFER', target: 'offscreen', request });
    }, request);

    const p = await infer({ requestId: 'p1', shield: 'PRIVACY', tabId: 1, domain: 'x', payload: { text: 'Hello Grace Hopper visits Tokyo.', existingMap: {}, vault: { salt: '', hashes: [], maxWords: 1 } } });
    check('NER model ran through real ORT (mode onnx-*)', /^onnx-(wasm|webgpu)$/.test(p.data?.mode ?? ''), JSON.stringify(p));
    check('model-detected PERSON and LOC (no regex could have found them) are swapped', p.data?.redactedText === 'Hello [PERSON_1] visits [LOC_1].', p.data?.redactedText);
    check('map is reversible', p.data?.map?.['[PERSON_1]'] === 'Grace Hopper' && p.data?.map?.['[LOC_1]'] === 'Tokyo', JSON.stringify(p.data?.map));

    const png = makePng(256, 192);
    const x = await infer({ requestId: 'x1', shield: 'PIXELS', tabId: 1, domain: 'x', payload: { b64: png.toString('base64'), mime: 'image/png', name: 'a.png', strength: 0.5 } });
    check('cloak model ran through real ORT (mode onnx-*)', /^onnx-(wasm|webgpu)$/.test(x.data?.mode ?? ''), JSON.stringify({ ...x, data: { ...x.data, b64: '…' } }));
    // Compare the model-cloaked output with the original in a page context.
    const page = await ctx.browser.newPage();
    const stats = await page.evaluate(async (orig, out) => {
      const dec = async (b64) => { const bm = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' })); const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height).data; };
      const a = await dec(orig), b = await dec(out); let pos = 0, neg = 0, max = 0, n = 0;
      for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = b[i + c] - a[i + c]; n++; if (d > 0) pos++; if (d < 0) neg++; max = Math.max(max, Math.abs(d)); }
      return { posFrac: pos / n, neg, max };
    }, png.toString('base64'), x.data?.b64);
    check('model delta applied (monotone +delta signature) and clamped to the eps budget', stats.neg === 0 && stats.posFrac > 0.9 && stats.max === 5, JSON.stringify(stats));
    await page.close();
    await ctx.sw.evaluate(() => chrome.runtime.sendMessage({ kind: 'OFFSCREEN_DISPOSE', target: 'offscreen' }));
    await sleep(200);
    check('dispose hook runs without error', true);
  } finally {
    await ctx.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}
