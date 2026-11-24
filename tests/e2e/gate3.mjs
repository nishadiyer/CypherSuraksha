import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, clickButtonInClosedShadow, fakeSite, makePng, sleep } from './harness.mjs';

const SITE = `<!doctype html><body>
<input type="file" id="f" accept="image/*">
<div id="drop" style="width:300px;height:200px;border:1px solid #888">drop here</div>
<script>
  window.__files = [];
  f.addEventListener('change', () => window.__files.push(...f.files));
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('drop', (e) => { e.preventDefault(); window.__files.push(...e.dataTransfer.files); });
</script></body>`;

const analyse = `async (origB64, file) => {
  const dec = async (blob) => { const b = await createImageBitmap(blob); const c = new OffscreenCanvas(b.width, b.height); const x = c.getContext('2d'); x.drawImage(b, 0, 0); return x.getImageData(0, 0, b.width, b.height); };
  const orig = await dec(new Blob([Uint8Array.from(atob(origB64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
  const got = await dec(file);
  const gotBytes = new Uint8Array(await file.arrayBuffer());
  let max = 0, changed = 0, n = orig.width * orig.height;
  for (let i = 0; i < orig.data.length; i += 4) { let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(orig.data[i + c] - got.data[i + c])); max = Math.max(max, d); if (d) changed++; }
  return { w: got.width, h: got.height, ow: orig.width, oh: orig.height, max, changedFrac: changed / n, type: file.type, name: file.name, sameBytes: gotBytes.length === atob(origB64).length && gotBytes.every((v, i) => v === atob(origB64).charCodeAt(i)) };
}`;

export default async function gate3({ browser, sw }) {
  console.log('Gate 3 — image upload interception → OffscreenCanvas cloak → DataTransfer re-injection');
  const png = makePng(256, 192);
  const dir = mkdtempSync(join(tmpdir(), 'aishield-img-'));
  const path = join(dir, 'photo.png');
  writeFileSync(path, png);
  const b64 = png.toString('base64');

  const { page } = await fakeSite(browser, 'www.instagram.com', SITE);
  const input = await page.$('#f');
  await input.uploadFile(path);
  await sleep(1500);
  let files = await page.evaluate(() => window.__files.length);
  check('page received exactly one file via <input> change', files === 1, String(files));
  let r = await page.evaluate(`(${analyse})(${JSON.stringify(b64)}, window.__files[0])`);
  check('file name and type preserved', r.name === 'photo.png' && r.type === 'image/png', JSON.stringify(r));
  check('dimensions identical', r.w === r.ow && r.h === r.oh, JSON.stringify(r));
  check('pixels were actually perturbed (>50% of pixels changed)', r.changedFrac > 0.5, JSON.stringify(r));
  check('perturbation bounded: max per-channel change <= 5/255 (imperceptible budget)', r.max > 0 && r.max <= 5, JSON.stringify(r));
  check('file the page got is not the original bytes', !r.sameBytes);

  const badge = await page.evaluate(() => [...document.documentElement.children].filter((e) => e.style.zIndex === '2147483647').map((e) => ({ closed: e.shadowRoot === null, pe: e.style.pointerEvents })));
  check('badge host injected with CLOSED shadow root (page cannot read it)', badge.length >= 1 && badge.every((b) => b.closed), JSON.stringify(badge));

  await page.evaluate(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    document.getElementById('drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 40, clientY: 40 }));
  })()`);
  await sleep(1500);
  files = await page.evaluate(() => window.__files.length);
  check('drop path delivers exactly one more file', files === 2, String(files));
  r = await page.evaluate(`(${analyse})(${JSON.stringify(b64)}, window.__files[1])`);
  check('dropped image is cloaked too', r.name === 'dropped.png' && r.max > 0 && r.max <= 5 && !r.sameBytes, JSON.stringify(r));

  const stores = await sw.evaluate(async () => ({ local: JSON.stringify(await chrome.storage.local.get(null)), session: JSON.stringify(await chrome.storage.session.get(null)) }));
  check('no image data in chrome.storage (local/session)', stores.local.length < 400 && !/iVBOR/.test(stores.local + stores.session), stores.local.slice(0, 200));
  const led = await sw.evaluate(async () => (await chrome.storage.local.get('ledger')).ledger);
  check('ledger counts cloaked photos', led.photosCloaked === 2, JSON.stringify(led));

  // One-click bypass from the badge (pierces the closed shadow root through CDP).
  await page.evaluate(() => { window.__files.length = 0; });
  await input.uploadFile(path);
  await sleep(1200);
  const clicked = await clickButtonInClosedShadow(page, /Bypass on this site/);
  check('badge shows a clickable "Bypass on this site" button (inside closed shadow root)', clicked);
  await sleep(500);
  const allow = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.allowlist);
  check('bypass adds the site to the allowlist', allow?.includes('www.instagram.com'), JSON.stringify(allow));
  await page.evaluate(() => { window.__files.length = 0; });
  await page.evaluate(() => { document.getElementById('f').value = ''; });
  await input.uploadFile(path);
  await sleep(1000);
  r = await page.evaluate(`(${analyse})(${JSON.stringify(b64)}, window.__files[0])`);
  check('after bypass the original passes through untouched', r.sameBytes, JSON.stringify(r));
  await page.close();

  // ---- Reddit-style page: the file input and the drop zone live INSIDE an open web component, and the page's own handlers
  // sit inside it too. `change` does not leave a shadow root, so a window-level listener alone would never see it and the
  // page would receive the ORIGINAL photo.
  console.log('Web-component page (open shadow root): input + drop zone inside, page handlers inside');
  const WC = `<!doctype html><body><x-uploader></x-uploader><script>
    window.__got = [];
    customElements.define('x-uploader', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<input type="file" id="in" accept="image/*"><div id="zone" style="width:300px;height:200px;border:1px solid #888">drop</div>';
        r.getElementById('in').addEventListener('change', (e) => window.__got.push(...e.target.files));
        const z = r.getElementById('zone');
        z.addEventListener('dragover', (e) => e.preventDefault());
        z.addEventListener('drop', (e) => { e.preventDefault(); window.__got.push(...e.dataTransfer.files); });
      }
    });
  </script></body>`;
  const { page: wc } = await fakeSite(browser, 'www.reddit.com', WC);
  // The content script loads asynchronously after the page: wait until it reports itself before selecting a file.
  for (let i = 0; i < 50; i++) {
    const alive = await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.reddit.com/*' });
      try { return !!(await chrome.tabs.sendMessage(tab.id, { kind: 'PAGE_STATUS' }))?.parts?.length; } catch { return false; }
    });
    if (alive) break;
    await sleep(200);
  }
  const wcInput = (await wc.evaluateHandle(() => document.querySelector('x-uploader').shadowRoot.getElementById('in'))).asElement();
  await wcInput.uploadFile(path);
  await sleep(1800);
  let got = await wc.evaluate(() => window.__got.length);
  check('[web component] the page inside the component received exactly one file via <input> change', got === 1, String(got));
  r = await wc.evaluate(`(${analyse})(${JSON.stringify(b64)}, window.__got[0])`);
  check('[web component] that file is the CLOAKED one, never the original', !r.sameBytes && r.max > 0 && r.max <= 5 && r.w === r.ow, JSON.stringify(r));
  await wc.evaluate(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'dropped2.png', { type: 'image/png' }));
    document.querySelector('x-uploader').shadowRoot.getElementById('zone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: 40, clientY: 40 }));
  })()`);
  await sleep(1800);
  got = await wc.evaluate(() => window.__got.length);
  check('[web component] a drop onto the zone inside the component delivers exactly one more file', got === 2, String(got));
  r = await wc.evaluate(`(${analyse})(${JSON.stringify(b64)}, window.__got[1])`);
  check('[web component] the dropped file is cloaked too', r.name === 'dropped2.png' && !r.sameBytes && r.max > 0 && r.max <= 5, JSON.stringify(r));
  const st = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.reddit.com/*' });
    return chrome.tabs.sendMessage(tab.id, { kind: 'PAGE_STATUS' });
  });
  const up = st?.parts?.find((p) => p.part === 'upload')?.detail;
  check('[web component] page status sees the hidden file field, the component and both selections', up?.fileInputs === 1 && up?.components >= 1 && up?.selectionsSeen === 2, JSON.stringify(up));
  await wc.close();
}
