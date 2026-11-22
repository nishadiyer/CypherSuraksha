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
}
