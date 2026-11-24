import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import puppeteer from 'puppeteer-core';

export const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const DIST = new URL('../../dist', import.meta.url).pathname;

let failures = 0;
export function check(name, cond, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}
export const failureCount = () => failures;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(opts = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'ai-shield-e2e-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, userDataDir, protocolTimeout: opts.protocolTimeout ?? 30000, enableExtensions: [opts.dist ?? DIST],
    // Default: a software GPU so runs are the same on every machine. E2E_REAL_GPU=1 uses the real one (e.g. Apple Metal).
    args: process.env.E2E_REAL_GPU ? ['--enable-unsafe-webgpu'] : ['--enable-unsafe-webgpu', '--use-angle=swiftshader'],
  });
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker-loader'));
  const sw = await swTarget.worker();
  return { browser, sw, cleanup: async () => { await browser.close(); rmSync(userDataDir, { recursive: true, force: true }); } };
}

/** Serve `html` for https://host/ without touching the network; abort everything else. */
export async function fakeSite(browser, host, html) {
  const page = await browser.newPage();
  const outbound = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.protocol === 'https:' && u.hostname === host && u.pathname === '/') return req.respond({ status: 200, contentType: 'text/html', body: html });
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return req.continue(); // chrome-extension:, data:, blob:
    outbound.push(req.url());
    return req.abort();
  });
  await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded' });
  return { page, outbound };
}

export async function offscreenEval(browser, expression) {
  const t = await browser.waitForTarget((x) => x.url().includes('offscreen.html'), { timeout: 15000 });
  const s = await t.createCDPSession();
  const r = await s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  await s.detach();
  return r.result.value;
}

/** Minimal valid RGB PNG with a smooth gradient + texture. */
export function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = ((x ^ y) & 63) * 3;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Click a <button> inside a *closed* shadow root by walking the CDP DOM tree (pierce: true). */
export async function clickButtonInClosedShadow(page, textRe) {
  const cdp = await page.createCDPSession();
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const walk = function* (n) {
      yield n;
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) yield* walk(c);
    };
    const text = (n) => (n.nodeType === 3 ? n.nodeValue : (n.children ?? []).map(text).join(''));
    for (const n of walk(root)) {
      if (n.nodeName === 'BUTTON' && textRe.test(text(n))) {
        const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: n.backendNodeId });
        const [x1, y1, , , x3, y3] = model.content;
        await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
        return true;
      }
    }
    return false;
  } finally {
    await cdp.detach();
  }
}

/** All text inside closed shadow roots on the page (pill label, modal copy). */
export async function readClosedShadowText(page) {
  const cdp = await page.createCDPSession();
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const text = (n) => (n.nodeType === 3 ? n.nodeValue : [...(n.children ?? []), ...(n.shadowRoots ?? [])].map(text).join(' '));
    const out = [];
    const walk = (n) => { (n.shadowRoots ?? []).forEach((r) => out.push(text(r))); (n.children ?? []).forEach(walk); (n.shadowRoots ?? []).forEach(walk); };
    walk(root);
    return out.join(' | ').replace(/\s+/g, ' ');
  } finally { await cdp.detach(); }
}
