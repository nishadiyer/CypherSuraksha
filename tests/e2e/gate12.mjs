import { check, fakeSite, offscreenEval, sleep } from './harness.mjs';

const CHAT = `<!doctype html><body>
<div id="chat"></div>
<textarea id="prompt-textarea"></textarea>
<button data-testid="send-button">Send</button>
<script>
  window.__sent = [];
  const ta = document.getElementById('prompt-textarea');
  const send = () => {
    const text = ta.value; if (!text.trim()) return;
    window.__sent.push(text);                       // what would go over the network
    ta.value = '';
    const u = document.createElement('p'); u.className = 'user'; u.textContent = text; chat.appendChild(u);
    setTimeout(() => { const a = document.createElement('p'); a.className = 'assistant'; a.textContent = 'Sure [PERSON_1], I will email [EMAIL_1].'; chat.appendChild(a); }, 30);
  };
  document.querySelector('[data-testid=send-button]').addEventListener('click', send);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
</script></body>`;

const PROMPT = 'My name is Ada Lovelace, reach me at ada@example.com or +1 (415) 555-2671. SSN 123-45-6789.';

export default async function gate12({ browser, sw }) {
  console.log('Gate 1 — singleton offscreen under concurrent tabs; CSP blocks all fetch');
  const sites = await Promise.all(Array.from({ length: 6 }, () => fakeSite(browser, 'chatgpt.com', CHAT)));
  await Promise.all(sites.map(async ({ page }) => {
    await page.focus('#prompt-textarea');
    await page.keyboard.type('Hi, my email is ada@example.com');
    await page.keyboard.press('Enter');
  }));
  await sleep(1500);
  const n = await sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length);
  check('exactly one offscreen document after 6 simultaneous tabs', n === 1, String(n));
  const sent = await Promise.all(sites.map(({ page }) => page.evaluate(() => window.__sent)));
  check('all 6 tabs submitted exactly once, with redaction', sent.every((s) => s.length === 1 && !s[0].includes('ada@example.com') && s[0].includes('[EMAIL_1]')), JSON.stringify(sent));

  const net = await offscreenEval(browser, `(async () => {
    const v = []; document.addEventListener('securitypolicyviolation', (e) => v.push(e.violatedDirective + ' ' + e.blockedURI));
    const r = {};
    try { await fetch('https://example.com/'); r.fetch = 'allowed'; } catch { r.fetch = 'blocked'; }
    try { await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', 'https://example.com/'); x.onload = res; x.onerror = () => rej(new Error('x')); x.send(); }); r.xhr = 'allowed'; } catch { r.xhr = 'blocked'; }
    try { const ws = new WebSocket('wss://example.com/'); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); }); r.ws = 'allowed'; } catch { r.ws = 'blocked'; }
    try { navigator.sendBeacon('https://example.com/b', 'x'); } catch {}
    await new Promise((res) => setTimeout(res, 300));
    r.violations = v; return r;
  })()`);
  check('offscreen fetch/XHR/WebSocket/beacon all blocked by CSP connect-src (violation events fired)',
    net.fetch === 'blocked' && net.xhr === 'blocked' && net.ws === 'blocked' && net.violations.length >= 3 && net.violations.every((x) => x.startsWith('connect-src')), JSON.stringify(net));
  await Promise.all(sites.slice(1).map(({ page }) => page.close()));

  console.log('Gate 2 — prompt interception, restoration, purge (real Chrome, content script + offscreen NER pipeline)');
  const { page } = sites[0];
  await page.evaluate(() => { window.__sent.length = 0; document.getElementById('chat').innerHTML = ''; });
  await page.focus('#prompt-textarea');
  await page.keyboard.type(PROMPT);
  await page.keyboard.press('Enter');
  await sleep(1200);
  const sent2 = await page.evaluate(() => window.__sent);
  check('exactly one submission reached the "network"', sent2.length === 1, JSON.stringify(sent2));
  const s = sent2[0] ?? '';
  check('sensitive strings replaced before submission', !/Ada|Lovelace|ada@example|555-2671|123-45-6789/.test(s), s);
  check('placeholders present', /\[PERSON_1\]/.test(s) && /\[EMAIL_1\]/.test(s) && /\[PHONE_1\]/.test(s) && /\[ID_1\]/.test(s), s);
  const shown = await page.evaluate(() => ({ user: document.querySelector('.user')?.textContent, assistant: document.querySelector('.assistant')?.textContent }));
  check('assistant reply restored to real entities on screen', shown.assistant === 'Sure Ada Lovelace, I will email ada@example.com.', JSON.stringify(shown));
  check('user bubble also shows real text on screen', shown.user?.includes('Ada Lovelace'), JSON.stringify(shown));

  const keys = () => sw.evaluate(async () => Object.keys(await chrome.storage.session.get(null)));
  const before = await keys();
  check('entity map held in storage.session keyed by tab', before.length === 1 && /^entities:\d+$/.test(before[0]), JSON.stringify(before));
  const local = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  check('no plaintext PII in storage.local', !/Ada|Lovelace|ada@example|555-2671|123-45-6789/.test(local), local);
  const ledger = await sw.evaluate(async () => (await chrome.storage.local.get('ledger')).ledger);
  check('ledger counts redacted prompts (counter only)', ledger?.promptsRedacted >= 7, JSON.stringify(ledger));

  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await sleep(300);
  check('map purged on navigation/reload', (await keys()).length === 0, JSON.stringify(await keys()));

  await page.focus('#prompt-textarea');
  await page.keyboard.type('I am Grace Hopper');
  await page.keyboard.press('Enter');
  await sleep(800);
  check('map recreated for new page life', (await keys()).length === 1);
  await page.close();
  await sleep(400);
  check('map purged when tab closes', !(await keys()).some((k) => k.startsWith('entities:')), JSON.stringify(await keys()));
  await Promise.all(sites.slice(1).map(({ page: p }) => p.close().catch(() => undefined)));
}
