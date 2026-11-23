// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installRestorer } from '../src/content/interceptors/promptInterceptor';

const map = { '[PERSON_1]': 'Priya Venkataraman', '[EMAIL_1]': 'priya.v@example.com' };
const tick = () => new Promise((r) => setTimeout(r, 20));

afterEach(() => { document.body.innerHTML = ''; });

describe('placeholder restoration across streamed pieces', () => {
  it('restores a placeholder that is split across several text nodes (token-by-token rendering)', async () => {
    const r = installRestorer(document, map);
    const p = document.createElement('p');
    document.body.appendChild(p);
    for (const piece of ['Dear ', '[', 'PERSON', '_1', ']', ', thank you.']) {
      const s = document.createElement('span');
      s.textContent = piece;
      p.appendChild(s);
      await tick();
    }
    expect(p.textContent).toBe('Dear Priya Venkataraman, thank you.');
    r.stop();
  });
  it('restores a placeholder split inside one element when text arrives as appended text nodes', async () => {
    const r = installRestorer(document, map);
    const p = document.createElement('p');
    document.body.appendChild(p);
    for (const piece of ['Mail me at [EMA', 'IL_1', '] please']) {
      p.appendChild(document.createTextNode(piece));
      await tick();
    }
    expect(p.textContent).toBe('Mail me at priya.v@example.com please');
    r.stop();
  });
  it('handles two placeholders in one block, split and whole', async () => {
    const r = installRestorer(document, map);
    document.body.innerHTML = '<p><span>[PERSON</span><span>_1]</span> wrote from [EMAIL_1].</p>';
    r.setMap(map);
    expect(document.body.textContent).toBe('Priya Venkataraman wrote from priya.v@example.com.');
    r.stop();
  });
  it('never rewrites the user\'s own editable draft, and leaves unknown placeholders alone', async () => {
    const r = installRestorer(document, map);
    document.body.innerHTML = '<div contenteditable="true"><span>[PERSON</span><span>_1]</span></div><p>[PERSON_9] stays</p>';
    r.setMap(map);
    expect(document.querySelector('[contenteditable]')!.textContent).toBe('[PERSON_1]');
    expect(document.querySelector('p')!.textContent).toBe('[PERSON_9] stays');
    r.stop();
  });
});
