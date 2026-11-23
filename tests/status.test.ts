// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { editableCandidates } from '../src/content/status';

/** jsdom has no layout, so give elements a size. */
function sized<T extends Element>(el: T, w: number, h: number): T {
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) });
  Object.defineProperty(el, 'getClientRects', { value: () => (w && h ? [{}] : []) });
  return el;
}

describe('message-box diagnostics', () => {
  it('lists the largest visible editable elements, including ones in shadow DOM, attributes only', () => {
    document.body.innerHTML = '';
    const big = sized(document.createElement('div'), 700, 56);
    big.setAttribute('contenteditable', 'true');
    big.setAttribute('role', 'textbox');
    big.id = 'composer-x';
    big.textContent = 'TYPED-SECRET-TEXT';
    const ta = sized(document.createElement('textarea'), 400, 30);
    ta.value = 'ANOTHER-SECRET';
    ta.placeholder = 'PLACEHOLDER-TEXT';
    const tiny = sized(document.createElement('input'), 10, 10);
    const hidden = sized(document.createElement('textarea'), 0, 0);
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const inner = sized(document.createElement('div'), 500, 40);
    inner.setAttribute('contenteditable', 'true');
    root.appendChild(inner);
    document.body.append(big, ta, tiny, hidden, host);

    const c = editableCandidates(document);
    expect(c.map((x) => x.el)).toEqual(['div#composer-x', 'div', 'textarea']); // by size, tiny and hidden excluded
    expect(c[0]).toMatchObject({ role: 'textbox', editable: 'true', inShadow: false, w: 700, h: 56 });
    expect(c[1]).toMatchObject({ inShadow: true });
    const dump = JSON.stringify(c);
    expect(dump).not.toMatch(/TYPED-SECRET|ANOTHER-SECRET|PLACEHOLDER-TEXT/);
  });
  it('returns an empty list when nothing looks like a text box', () => {
    document.body.innerHTML = '<p>hello</p>';
    expect(editableCandidates(document)).toEqual([]);
  });
});
