import { check, fakeSite, readClosedShadowText, sleep } from './harness.mjs';

// Framework-like composer: state is only updated from `input` events (like React/ProseMirror),
// the page's own Enter handler sits in the capture phase on document, and a hidden decoy textarea exists.
const CHAT = `<!doctype html><body>
<textarea style="display:none" name="fallback"></textarea>
<div id="chat"></div>
<div id="prompt-textarea" class="ProseMirror" contenteditable="true" style="min-height:40px;border:1px solid #888"></div>
<button data-testid="send-button">Send</button>
<script>
  window.__sent = []; window.__pd = 0; let state = '';
  const ed = document.getElementById('prompt-textarea');
  ed.addEventListener('input', () => { state = ed.innerText; });
  const send = () => { if (!state.trim()) return; window.__sent.push(state); state = ''; ed.textContent = ''; const a = document.createElement('p'); a.className = 'assistant'; a.textContent = 'Hello [PERSON_1], noted [EMAIL_1].'; chat.appendChild(a); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target === ed) { e.preventDefault(); send(); } }, true);
  const btn = document.querySelector('[data-testid=send-button]');
  btn.addEventListener('click', send);
  btn.addEventListener('pointerdown', () => window.__pd++);
</script></body>`;

// The markup reported from the live chatgpt.com (Nov 2026): no #prompt-textarea id; a role=textbox labelled "Ask ChatGPT";
// plus big "Start writing" editors that are NOT the composer.
const CHAT_LIVE = `<!doctype html><body>
<div contenteditable="true" role="textbox" aria-label="Start writing" style="width:575px;height:172px"></div>
<div contenteditable="true" role="textbox" aria-label="Start writing" style="width:575px;height:146px"></div>
<form><div id="chat"></div><div contenteditable="true" role="textbox" aria-label="Ask ChatGPT" style="width:574px;min-height:26px;border:1px solid #888"></div>
<button data-testid="send-button" type="button">Send</button></form>
<script>
  window.__sent = []; let state = '';
  const ed = document.querySelector('[aria-label="Ask ChatGPT"]');
  ed.addEventListener('input', () => { state = ed.innerText; });
  // The reply streams in token by token, each token in its own span (so a placeholder is never inside one text node).
  const stream = () => { const p = document.createElement('p'); p.className = 'assistant'; document.getElementById('chat').appendChild(p);
    ['Hello ', '[', 'PERSON', '_1', ']', ', I will write to ', '[EMAIL', '_1]', '.'].forEach((t, i) => setTimeout(() => { const s = document.createElement('span'); s.textContent = t; p.appendChild(s); }, 60 * i)); };
  const send = () => { if (!state.trim()) return; window.__sent.push(state); state = ''; ed.textContent = ''; stream(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target === ed) { e.preventDefault(); send(); } }, true);
  document.querySelector('[data-testid=send-button]').addEventListener('click', send);
</script></body>`;

export default async function gate6({ browser, sw }) {
  console.log('Checkpoint 1/4 — contenteditable composer, capture-phase page handlers, toast');
  const { page } = await fakeSite(browser, 'chatgpt.com', CHAT);
  const prompt = 'Hi, my name is John Doe and my email is john.doe@example.com';
  for (const mode of ['enter', 'click']) {
    await page.evaluate(() => { window.__sent.length = 0; window.__pd = 0; });
    await page.click('#prompt-textarea');
    await page.keyboard.type(prompt);
    if (mode === 'enter') await page.keyboard.press('Enter'); else await page.click('[data-testid=send-button]');
    await sleep(1200);
    const sent = await page.evaluate(() => window.__sent);
    check(`[${mode}] exactly one submission, raw name/email never reached the page's send()`, sent.length === 1 && !/John|Doe|john\.doe@/.test(sent[0]), JSON.stringify(sent));
    check(`[${mode}] placeholders sent`, /\[PERSON_1\]/.test(sent[0] ?? '') && /\[EMAIL_1\]/.test(sent[0] ?? ''), sent[0]);
    check(`[${mode}] toast says "Redacted 2 sensitive items"`, (await readClosedShadowText(page)).includes('Redacted 2 sensitive items'), await readClosedShadowText(page));
    if (mode === 'click') check('[click] pointerdown on Send was hidden from the page', (await page.evaluate(() => window.__pd)) === 0);
    const shown = await page.evaluate(() => document.querySelector('.assistant:last-of-type')?.textContent);
    check(`[${mode}] reply restored on screen`, shown === 'Hello John Doe, noted john.doe@example.com.', shown);
    await sleep(4500);
  }
  console.log('Live ChatGPT markup (no id, "Ask ChatGPT" label, decoy "Start writing" editors)');
  const { page: live } = await fakeSite(browser, 'chatgpt.com', CHAT_LIVE);
  await live.click('[aria-label="Ask ChatGPT"]');
  await live.keyboard.type('Hi, my name is John Doe and my email is john.doe@example.com');
  await live.keyboard.press('Enter');
  await sleep(1500);
  const liveSent = await live.evaluate(() => window.__sent);
  check('[live markup] message box found, Enter intercepted, placeholders sent', liveSent.length === 1 && /\[PERSON_1\]/.test(liveSent[0]) && /\[EMAIL_1\]/.test(liveSent[0]) && !/John|Doe|john\.doe@/.test(liveSent[0]), JSON.stringify(liveSent));
  check('[live markup] toast shown', (await readClosedShadowText(live)).includes('Redacted 2 sensitive items'), await readClosedShadowText(live));
  await sleep(1200);
  const streamed = await live.evaluate(() => document.querySelector('.assistant')?.textContent);
  check('[live markup] a reply streamed token-by-token (placeholders split across pieces) is restored on screen', streamed === 'Hello John Doe, I will write to john.doe@example.com.', streamed);
  await live.close();

  // The popup's "This page" panel asks the content script what it sees (booleans only, no page content).
  const status = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    return chrome.tabs.sendMessage(tab.id, { kind: 'PAGE_STATUS' });
  });
  const prompt1 = status?.parts?.find((p) => p.part === 'prompt')?.detail;
  check('page status: the content script answers and reports the chat site', prompt1?.site === 'chatgpt.com', JSON.stringify(status));
  check('page status: message box and send button found', prompt1?.messageBox === true && prompt1?.sendButton === true, JSON.stringify(prompt1));
  check('page status carries no page content (only site name, booleans)', JSON.stringify(status).length < 200 && !/John|Doe|example\.com\//.test(JSON.stringify(status)), JSON.stringify(status));
  // The real popup panel, pointed at that tab.
  const info = await sw.evaluate(async () => ({ id: chrome.runtime.id, tab: (await chrome.tabs.query({ url: 'https://chatgpt.com/*' }))[0].id }));
  const pop = await browser.newPage();
  await pop.goto(`chrome-extension://${info.id}/src/popup/index.html?tabId=${info.tab}`);
  await pop.waitForSelector('[data-testid=page-active], [data-testid=page-inactive]', { timeout: 8000 }).catch(() => null);
  const txt = await pop.evaluate(() => document.body.innerText);
  check('popup "This page" says AI Shield is running and found the message box', /AI chat detected \(chatgpt\.com\)/.test(txt) && /Message box: found/.test(txt) && /Send button: found/.test(txt), txt.slice(0, 300));
  // The popup's "Show a test notification" button: the toast appears on the page, in the browser's top layer.
  await pop.evaluate(() => [...document.querySelectorAll('button')].find((b) => /test notification/i.test(b.textContent))?.click());
  await sleep(700);
  check('test notification: the toast appears on the page', (await readClosedShadowText(page)).includes('AI Shield test'), await readClosedShadowText(page));
  check('toast host is in the top layer (above any page stacking)', await page.evaluate(() => [...document.documentElement.children].some((e) => e.matches(':popover-open'))));
  await pop.close();
  await page.close();

  // A site whose message box no longer matches the selector: the panel must say so and show what it did see.
  const { page: odd } = await fakeSite(browser, 'claude.ai', '<!doctype html><body><div id="new-editor" contenteditable="true" style="width:600px;height:50px;border:1px solid #888"></div></body>');
  await sleep(1500); // let the new page's content script register
  const oddInfo = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    return { tab: tab.id, status: await chrome.tabs.sendMessage(tab.id, { kind: 'PAGE_STATUS' }) };
  });
  const d = oddInfo.status?.parts?.find((p) => p.part === 'prompt')?.detail;
  check('page status: a message box the selector misses is reported as not found, with candidates', d?.messageBox === false && /div#new-editor/.test(String(d?.candidates)), JSON.stringify(d));
  const pop2 = await browser.newPage();
  await pop2.goto(`chrome-extension://${info.id}/src/popup/index.html?tabId=${oddInfo.tab}`);
  await pop2.waitForSelector('[data-testid=candidates]', { timeout: 8000 }).catch(() => null);
  const txt2 = await pop2.evaluate(() => document.body.innerText);
  check('popup shows "NOT found" and lists the text box it saw', /Message box: NOT found/.test(txt2) && /div#new-editor/.test(txt2), txt2.slice(0, 400));
  await pop2.close();
  await odd.close();
}
