// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPromptInterceptor, installRestorer, type InterceptorDeps } from '../src/content/interceptors/promptInterceptor';

const adapter = { composer: 'textarea', send: 'button#send' };

function setup(deps: Partial<InterceptorDeps> = {}) {
  document.body.innerHTML = '<textarea></textarea><button id="send">Send</button><div id="chat"></div>';
  const ta = document.querySelector('textarea')!;
  const btn = document.querySelector<HTMLButtonElement>('#send')!;
  const submitted: string[] = [];
  // The "site": records whatever text is in the composer when the real click reaches it.
  btn.addEventListener('click', () => submitted.push(ta.value));
  const all: InterceptorDeps = {
    redact: async (t) => ({ redactedText: t.replace('Ada', '[PERSON_1]'), map: { '[PERSON_1]': 'Ada' }, count: 1 }),
    onRedacted: vi.fn(),
    onError: vi.fn(),
    ...deps,
  };
  const off = installPromptInterceptor(window, adapter, all, { sendWaitMs: 50 });
  return { ta, btn, submitted, all, off };
}
// the interceptor re-verifies the composer 200 ms after an edit before sending, so wait longer than that
const tick = (ms = 450) => new Promise((r) => setTimeout(r, ms));
afterEach(() => (document.body.innerHTML = ''));

describe('prompt interception (Gate 2)', () => {
  it('replaces sensitive text before the site receives Enter', async () => {
    const { ta, submitted, all, off } = setup();
    ta.value = 'Hi, I am Ada';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(submitted).toEqual([]); // blocked synchronously
    await tick();
    expect(submitted).toEqual(['Hi, I am [PERSON_1]']); // site saw only redacted text
    expect(all.onRedacted).toHaveBeenCalledWith(1, { '[PERSON_1]': 'Ada' });
    off();
  });

  it('intercepts the send button click too, and does not loop', async () => {
    const { ta, btn, submitted, off } = setup();
    ta.value = 'Ada here';
    btn.click();
    await tick();
    expect(submitted).toEqual(['[PERSON_1] here']);
    off();
  });

  it('fails safe: blocks once on shield error, allows explicit retry', async () => {
    const { ta, btn, submitted, all, off } = setup({ redact: async () => { throw new Error('down'); } });
    ta.value = 'Ada';
    btn.click();
    await tick();
    expect(submitted).toEqual([]);
    expect(all.onError).toHaveBeenCalled();
    btn.click();
    expect(submitted).toEqual(['Ada']);
    off();
  });

  it('never sends when the editor quietly undoes the redaction after the first check', async () => {
    const { ta, btn, submitted, all, off } = setup();
    // A controlled editor: accepts the edit, then restores its own state a moment later.
    const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
    ta.value = 'Ada here';
    const original = ta.value;
    ta.addEventListener('input', () => setTimeout(() => proto.set!.call(ta, original), 60));
    btn.click();
    await tick();
    expect(submitted).toEqual([]); // the original text was NOT sent
    expect(all.onError).toHaveBeenCalled();
    off();
  });

  it('ignores Shift+Enter and IME composition', async () => {
    const { ta, submitted, off } = setup();
    ta.value = 'Ada';
    const e = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    ta.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(submitted).toEqual([]);
    off();
  });
});

describe('response restoration', () => {
  it('restores placeholders in streamed assistant text but not in the composer', async () => {
    document.body.innerHTML = '<textarea>[PERSON_1] draft</textarea><div id="chat"></div>';
    const r = installRestorer(document, { '[PERSON_1]': 'Ada Lovelace' });  // (see also: split-placeholder tests below)
    const p = document.createElement('p');
    p.textContent = 'Hello [PERSON_1]!';
    document.querySelector('#chat')!.appendChild(p);
    await tick(20);
    expect(p.textContent).toBe('Hello Ada Lovelace!');
    expect(document.querySelector('textarea')!.value).toBe('[PERSON_1] draft');
    p.firstChild!.nodeValue = 'Bye [PERSON_1]'; // later streaming update
    await tick(20);
    expect(p.textContent).toBe('Bye Ada Lovelace');
    r.stop();
  });
});
