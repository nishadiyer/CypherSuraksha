// End-to-end check of the live demo page with the DEMO build (npm run build:demo, npm run demo:prepare).
// Not part of the default suite (needs dist-demo + demo/media). Run: node tests/e2e/demo.mjs
// With E2E_REAL_GPU=1 it also runs the face-swap scenario (experimental detector on, real GPU, optional model).
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { check, failureCount, launch, readClosedShadowText, sleep } from './harness.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const DEMO = `${ROOT}demo/`;
const DIST_DEMO = `${ROOT}dist-demo`;
if (!existsSync(`${DIST_DEMO}/manifest.json`) || !existsSync(`${DEMO}media/ai.jpg`)) {
  console.error('needs: npm run build:demo && npm run fixtures && npm run demo:prepare');
  process.exit(2);
}
const types = { '.html': 'text/html', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html');
  const f = DEMO + path.replace(/^\//, '');
  if (!f.startsWith(DEMO) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const waitFor = async (fn, ms, step = 500) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(step); } return false; };

console.log(`Demo page (${process.env.E2E_REAL_GPU ? 'real GPU' : 'software GPU'}) with the DEMO build`);
const ctx = await launch({ dist: DIST_DEMO, protocolTimeout: 120000 });
try {
  const open = async (mode) => {
    const page = await ctx.browser.newPage();
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    if (mode !== 'real') await page.click(`button[data-mode=${mode}]`);
    return page;
  };
  const text = (p) => readClosedShadowText(p);

  const real = await open('real');
  check('REAL face: pill turns green "No fake found"', await waitFor(async () => (await text(real)).includes('No fake found'), 90000), await text(real));
  await sleep(8000);
  check('REAL face: never goes red or shows the warning', !/Fake\?|AI-generated/.test(await text(real)), await text(real));
  await real.close();

  const ai = await open('ai');
  check('AI-GENERATED face: pill turns red "Fake?"', await waitFor(async () => (await text(ai)).includes('Fake?'), 150000), await text(ai));
  check('AI-GENERATED face: the "may be AI-generated" warning appears', await waitFor(async () => (await text(ai)).includes('may be AI-generated'), 90000), await text(ai));
  await ai.close();

  const swap = await open('swap');
  await waitFor(async () => /No fake found|Unsure|Fake\?/.test(await text(swap)), 90000);
  await sleep(15000);
  check('SWAPPED face with the detector OFF (default): not red (the main model cannot see swaps)', !/Fake\?|AI-generated/.test(await text(swap)), await text(swap));
  await swap.close();

  if (process.env.E2E_REAL_GPU && existsSync(`${DIST_DEMO}/models/people-gend.fp16.onnx`)) {
    await ctx.sw.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...(settings ?? {}), faceSwap: true } }); });
    const sw2 = await open('swap');
    check('SWAPPED face with the experimental detector ON: pill turns amber "Unsure"', await waitFor(async () => (await text(sw2)).includes('Unsure'), 120000), await text(sw2));
    await sleep(10000);
    check('SWAPPED face with the detector ON: still never red', !/Fake\?|AI-generated/.test(await text(sw2)), await text(sw2));
    await sw2.close();
  }
} finally {
  await ctx.cleanup();
  server.close();
}
console.log(failureCount() ? `\n${failureCount()} check(s) FAILED` : '\nAll demo checks passed');
process.exit(failureCount() ? 1 : 0);
