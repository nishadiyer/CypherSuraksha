// Cloaks every WORKDIR/in/g*.png through the REAL extension and writes WORKDIR/out/*.png.
// Used with scripts/cloak/eval_extension.py to measure recogniser accuracy on the extension's actual output.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DIST, launch } from './harness.mjs';

const work = process.argv[2];
if (!work || !existsSync(`${work}/in`)) { console.error('usage: node tests/e2e/cloakBench.mjs WORKDIR   (run eval_extension.py dump first)'); process.exit(2); }
const MODELS = new URL('../../public/models/', import.meta.url).pathname;
const FILES = ['face-detector.ultraface.onnx', 'cloak-facenet-vggface2.onnx', 'cloak-facenet-casia.onnx'];
const dir = `${DIST}/models`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (const f of FILES) copyFileSync(MODELS + f, `${dir}/${f}`);
mkdirSync(`${work}/out`, { recursive: true });
const ctx = await launch({ protocolTimeout: 600000 });
try {
  const files = readdirSync(`${work}/in`).filter((f) => /^g\d+\.png$/.test(f)).sort();
  const stats = { modes: {}, faces: 0, ms: [] };
  for (const f of files) {
    const t0 = Date.now();
    const r = await ctx.sw.evaluate(async (b64) => {
      if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
        await chrome.offscreen.createDocument({ url: 'src/offscreen/offscreen.html', reasons: ['WORKERS'], justification: 'bench' });
        await new Promise((r) => setTimeout(r, 500));
      }
      return chrome.runtime.sendMessage({ kind: 'OFFSCREEN_INFER', target: 'offscreen', request: { requestId: 'b', shield: 'PIXELS', tabId: 1, domain: 'x', payload: { b64, mime: 'image/png', name: 'a.png', strength: 0.5 } } });
    }, readFileSync(`${work}/in/${f}`).toString('base64'));
    writeFileSync(`${work}/out/${f}`, Buffer.from(r.data.b64, 'base64'));
    stats.modes[r.data.mode] = (stats.modes[r.data.mode] ?? 0) + 1;
    stats.faces += r.data.faces ?? 0;
    stats.ms.push(Date.now() - t0);
    process.stdout.write(`${f} ${r.data.mode} faces=${r.data.faces} ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }
  stats.ms.sort((a, b) => a - b);
  console.log(`done: ${files.length} photos, modes ${JSON.stringify(stats.modes)}, faces ${stats.faces}, median ${(stats.ms[stats.ms.length >> 1] / 1000).toFixed(1)} s/photo`);
} finally {
  await ctx.cleanup();
  rmSync(dir, { recursive: true, force: true });
}
