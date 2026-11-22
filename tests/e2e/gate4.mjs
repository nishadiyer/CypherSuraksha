import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { check, clickButtonInClosedShadow, DIST, fakeSite, launch, readClosedShadowText, sleep } from './harness.mjs';
import { peopleModel } from './onnxgen.mjs';

const MEET = `<!doctype html><body style="margin:0;background:#111">
<canvas id="c" width="640" height="480" style="display:none"></canvas>
<video id="v" autoplay muted playsinline style="width:640px;height:480px"></video>
<script>
  window.__bright = false;
  const c = document.getElementById('c'), g = c.getContext('2d');
  setInterval(() => { g.fillStyle = window.__bright ? '#ffffff' : '#101010'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#888'; g.fillRect(Math.random() * 600, Math.random() * 440, 20, 20); }, 50);
  v.srcObject = c.captureStream(20); v.play();
</script></body>`;

async function waitFor(fn, ms, step = 250) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); } return null; }

export default async function gate4() {
  console.log('Gate 4 — video frame sampling, throttling, rolling-confidence RED, no frame persistence (real Chrome, ORT classifier)');
  const dir = `${DIST}/models`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/people-deepfake.int8.onnx`, peopleModel());
  writeFileSync(`${dir}/people-deepfake.config.json`, JSON.stringify({ size: 224, mean: [0, 0, 0], std: [1, 1, 1], output: 'prob' }));
  const ctx = await launch();
  try {
    const { browser, sw } = ctx;
    const { page } = await fakeSite(browser, 'meet.google.com', MEET);
    const pillIs = async (word) => (await readClosedShadowText(page)).includes(word);

    check('GREEN pill appears for a normal (dark) stream', !!(await waitFor(() => pillIs('Real'), 15000)), await readClosedShadowText(page));
    check('no circuit-breaker modal while green', !(await readClosedShadowText(page)).includes('AI-generated'));

    await sleep(8000); // let the sampler leave model-load warm-up before measuring a steady baseline

    // Instrument the offscreen doc to count inference requests (rate checks).
    const off = await browser.waitForTarget((t) => t.url().includes('offscreen.html'), { timeout: 10000 });
    const cdp = await off.createCDPSession();
    const ev = (expression) => cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then((r) => r.result.value);
    await ev(`window.__n = 0; window.__lat = []; chrome.runtime.onMessage.addListener((m) => { if (m.kind === 'OFFSCREEN_INFER') window.__n++; return false; }); 0`);
    await sleep(5000);
    const base = await ev('window.__n');
    check(`baseline sampling rate stays within 0.5–2 FPS (${base} frames / 5 s)`, base >= 1 && base <= 11, String(base));

    // Heavy load on the inference path: block the offscreen document's main thread (~90% duty) so every
    // request round-trip through it takes well over the 150 ms budget. (CPU throttling the page does not
    // work here: inference runs in a Web Worker, so it never slowed the measured round trip.)
    await ev('window.__n = 0; window.__loadTimer = setInterval(() => { const e = performance.now() + 400; while (performance.now() < e); }, 450); 0');
    await sleep(10000);
    await ev('clearInterval(window.__loadTimer); 0');
    const loaded = await ev('window.__n');
    check(`under heavy load the sampler backs off to < 60% of the baseline rate (${loaded} frames / 10 s; baseline ${base} / 5 s)`, loaded < base * 2 * 0.6, `${loaded} vs ${base}`);

    // Flip the stream to a bright (synthetic-looking to the test model) one.
    await page.evaluate(() => { window.__bright = true; });
    const red = await waitFor(() => pillIs('Fake?'), 30000, 500);
    check('rolling window flips the pill to RED', !!red, await readClosedShadowText(page));
    const modal = await waitFor(async () => (await readClosedShadowText(page)).includes('may be AI-generated'), 20000, 500);
    check('circuit-breaker modal appears on sustained RED', !!modal);
    check('modal is not readable from the page (closed shadow root)', await page.evaluate(() => [...document.documentElement.children].every((e) => e.shadowRoot === null)));
    const dismissed = await clickButtonInClosedShadow(page, /I understand/);
    await sleep(600);
    check('"I understand" dismisses the modal and keeps it dismissed', dismissed && !(await readClosedShadowText(page)).includes('may be AI-generated'));
    await sleep(3000);
    check('modal stays dismissed for the rest of the call', !(await readClosedShadowText(page)).includes('may be AI-generated'));

    // Back to normal -> pill recovers (no sticky red).
    await page.evaluate(() => { window.__bright = false; });
    check('pill recovers to GREEN when the stream normalises', !!(await waitFor(() => pillIs('Real'), 30000, 500)));

    // Persistence audit: no frames anywhere.
    const stores = await sw.evaluate(async () => ({ local: JSON.stringify(await chrome.storage.local.get(null)), session: JSON.stringify(await chrome.storage.session.get(null)) }));
    check('no frame data in chrome.storage (local/session)', stores.local.length < 600 && stores.session.length < 50 && !/[A-Za-z0-9+/]{400}/.test(stores.local + stores.session), stores.local.slice(0, 200));
    const idb = await ev(`(async () => ({ idb: (await indexedDB.databases()).length, ls: localStorage.length, ss: sessionStorage.length, caches: (await caches.keys()).length }))()`);
    check('offscreen has no IndexedDB / localStorage / sessionStorage / Cache entries', idb.idb === 0 && idb.ls === 0 && idb.ss === 0 && idb.caches === 0, JSON.stringify(idb));
    const pidb = await page.evaluate(async () => ({ idb: (await indexedDB.databases()).length, ls: localStorage.length }));
    check('content script wrote nothing to the page origin storage', pidb.idb === 0 && pidb.ls === 0, JSON.stringify(pidb));
    const led = await sw.evaluate(async () => (await chrome.storage.local.get('ledger')).ledger);
    check('callsProtected counted once for the call', led?.callsProtected === 1, JSON.stringify(led));
    await page.close();
  } finally {
    await ctx.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}
