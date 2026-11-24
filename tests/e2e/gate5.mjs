import { check, fakeSite, sleep } from './harness.mjs';

const CHAT = `<!doctype html><body><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button>
<script>window.__sent=[];const ta=document.getElementById('prompt-textarea');
document.querySelector('[data-testid=send-button]').addEventListener('click',()=>{window.__sent.push(ta.value);ta.value='';});
ta.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();window.__sent.push(ta.value);ta.value='';}});</script></body>`;

export default async function gate5({ browser, sw }) {
  console.log('Gate 5 — popup: toggles, hashed vault, allowlist, ledger (real UI, real Web Crypto)');
  const id = new URL(sw.url()).host;
  const popup = await browser.newPage();
  // the popup has tabs (Shield, Page, Vault, Sites); ?view= opens one directly
  const go = async (view) => { await popup.goto(`chrome-extension://${id}/src/popup/index.html?view=${view}`); await popup.waitForSelector('.cs-root'); };
  await go('vault');
  const type = async (sel, text) => { await popup.click(sel, { clickCount: 3 }); await popup.type(sel, text); };

  await type('input[placeholder^="Name"]', 'Project Bluebird');
  await popup.click('form button:not([type=button])');
  await sleep(500);
  const vault = await sw.evaluate(async () => (await chrome.storage.local.get('vault')).vault);
  check('vault stores salt + SHA-256 hex digests only', vault?.salt && vault.hashes?.length === 1 && /^[0-9a-f]{64}$/.test(vault.hashes[0]), JSON.stringify(vault));
  const raw = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  check('no plaintext keyword anywhere in chrome.storage.local', !/bluebird/i.test(raw), raw);
  check('input cleared after save (plaintext not retained in UI)', (await popup.$eval('input[placeholder^="Name"]', (e) => e.value)) === '');

  const { page } = await fakeSite(browser, 'chatgpt.com', CHAT);
  const send = async (text) => { await page.bringToFront(); await page.evaluate(() => (window.__sent.length = 0)); await page.focus('#prompt-textarea'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await sleep(900); return (await page.evaluate(() => window.__sent))[0]; };
  let s = await send('Status of project bluebird please');
  check('hashed custom keyword is redacted in a real prompt', s === 'Status of [CUSTOM_1] please', s);

  // Per-pillar toggle (Privacy is the first switch after the master switch).
  await popup.bringToFront();
  await go('shield');
  const toggles = await popup.$$('[role=switch]');
  check('master + 3 pillar switches + experimental face-swap switch rendered', toggles.length === 5, String(toggles.length));
  const fs0 = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.faceSwap ?? false);
  check('the experimental face-swap detector is OFF by default', fs0 === false, String(fs0));
  await toggles[4].click(); await sleep(400);
  const fs1 = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.faceSwap);
  check('turning the face-swap switch on persists it', fs1 === true, String(fs1));
  await toggles[4].click(); await sleep(400);
  await toggles[1].click();
  await sleep(400);
  s = await send('Status of project bluebird please');
  check('Privacy toggle off -> prompt passes through untouched', s === 'Status of project bluebird please', s);
  await popup.bringToFront();
  await toggles[1].click();
  await sleep(400);

  // Master toggle.
  await popup.bringToFront(); await toggles[0].click(); await sleep(400);
  s = await send('Mail ada@example.com');
  check('master toggle off -> nothing is redacted', s === 'Mail ada@example.com', s);
  await popup.bringToFront(); await toggles[0].click(); await sleep(400);
  s = await send('Mail ada@example.com');
  check('master toggle on again -> redacted', s === 'Mail [EMAIL_1]', s);

  // Allowlist.
  await popup.bringToFront();
  await go('sites');
  await type('input[placeholder="example.com"]', 'https://chatgpt.com/foo');
  await popup.click('[data-testid=sites-form] button');
  await sleep(400);
  const al = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.allowlist);
  check('allowlist normalises URLs to hostnames', al.includes('chatgpt.com'), JSON.stringify(al));
  s = await send('Mail ada@example.com');
  check('trusted site -> shields stand down', s === 'Mail ada@example.com', s);
  await popup.bringToFront(); await go('sites');
  await popup.waitForSelector('button[aria-label="Remove chatgpt.com"]', { timeout: 5000 });
  await popup.click('button[aria-label="Remove chatgpt.com"]'); await sleep(400);
  s = await send('Mail ada@example.com');
  check('removing the trusted site re-enables shields', s === 'Mail [EMAIL_1]', s);

  // Ledger display.
  await popup.bringToFront(); await go('shield'); await sleep(300);
  const shown = await popup.$eval('[data-testid=promptsRedacted]', (e) => Number(e.textContent));
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('ledger')).ledger.promptsRedacted);
  check('ledger in popup matches chrome.storage.local counters', shown === stored && stored >= 3, `${shown} vs ${stored}`);
  // Remove all Never-share keywords (only hashes are stored, so they cannot be removed one by one).
  await popup.bringToFront(); await go('vault'); await sleep(300);
  const clickByText = (re) => popup.evaluate((src) => [...document.querySelectorAll('button')].find((b) => new RegExp(src, 'i').test(b.textContent))?.click(), re.source);
  await clickByText(/remove all keywords/); await sleep(200);
  const stillThere = await sw.evaluate(async () => (await chrome.storage.local.get('vault')).vault);
  check('first click only asks for confirmation (keywords still stored)', stillThere?.hashes?.length === 1, JSON.stringify(stillThere));
  await clickByText(/click again to remove all keywords/); await sleep(500);
  const gone = await sw.evaluate(async () => (await chrome.storage.local.get('vault')).vault);
  check('second click removes every stored keyword hash', gone === undefined, JSON.stringify(gone));
  check('popup shows 0 protected keywords afterwards', /0 protected keywords/.test(await popup.evaluate(() => document.body.innerText)));
  s = await send('Status of project bluebird please');
  check('a removed keyword is no longer redacted', s === 'Status of project bluebird please', s);
  await page.close(); await popup.close();
}
