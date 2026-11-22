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

export default async function gate6({ browser }) {
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
  await page.close();
}
