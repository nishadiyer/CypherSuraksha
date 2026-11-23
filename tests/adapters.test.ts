// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { adapterFor, findComposer } from '../src/content/interceptors/promptInterceptor';
import { buttonCandidates } from '../src/content/status';

const chatgpt = adapterFor('chatgpt.com')!;

describe('ChatGPT adapter', () => {
  it('finds the message box on the live markup (no id) and ignores the "Start writing" editors', () => {
    // Structure reported from a real chatgpt.com page: four large "Start writing" editors plus the small "Ask ChatGPT" box.
    document.body.innerHTML = `
      <div contenteditable="true" role="textbox" aria-label="Start writing"></div>
      <div contenteditable="false" role="textbox" aria-label="Start writing"></div>
      <div contenteditable="true" role="textbox" aria-label="Start writing"></div>
      <form><div contenteditable="true" role="textbox" aria-label="Ask ChatGPT"></div><button aria-label="Attach"></button></form>`;
    const el = findComposer(document, chatgpt.composer);
    expect(el?.getAttribute('aria-label')).toBe('Ask ChatGPT');
  });
  it('still finds the older #prompt-textarea markup, and the "Message ..." label', () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div>';
    expect(findComposer(document, chatgpt.composer)?.id).toBe('prompt-textarea');
    document.body.innerHTML = '<div contenteditable="true" role="textbox" aria-label="Message ChatGPT"></div>';
    expect(findComposer(document, chatgpt.composer)).not.toBeNull();
  });
  it('does not match unrelated text boxes', () => {
    document.body.innerHTML = '<div contenteditable="true" role="textbox" aria-label="Start writing"></div><input type="text" aria-label="Search chats">';
    expect(findComposer(document, chatgpt.composer)).toBeNull();
  });
  it('matches the send button variants', () => {
    document.body.innerHTML = '<button data-testid="send-button"></button>';
    expect(document.querySelector(chatgpt.send)).not.toBeNull();
    document.body.innerHTML = '<button aria-label="Send prompt"></button>';
    expect(document.querySelector(chatgpt.send)).not.toBeNull();
  });
});

describe('button diagnostics', () => {
  it('lists the buttons around the message box, attributes only', () => {
    document.body.innerHTML = '<form><div id="box" contenteditable="true"></div><button data-testid="x" aria-label="Voice" disabled>SECRET LABEL</button><button type="submit" aria-label="Go"></button></form>';
    const list = buttonCandidates(document.getElementById('box')!);
    expect(list).toEqual([{ testid: 'x', aria: 'Voice', type: undefined, disabled: true }, { testid: undefined, aria: 'Go', type: 'submit', disabled: false }]);
    expect(JSON.stringify(list)).not.toMatch(/SECRET/);
  });
});

describe('Copilot adapter', () => {
  const copilot = adapterFor('copilot.com')!;
  it('is selected for copilot.com and the older host', () => {
    expect(adapterFor('copilot.com')).not.toBeNull();
    expect(adapterFor('www.copilot.com')).not.toBeNull();
    expect(adapterFor('copilot.microsoft.com')).not.toBeNull();
  });
  it('finds the live message box (a role=textbox span labelled "Message Copilot")', () => {
    document.body.innerHTML = '<span id="m365-chat-editor-target-element" contenteditable="true" role="textbox" aria-label="Message Copilot"></span><input type="search" aria-label="Search">';
    expect(findComposer(document, copilot.composer)?.id).toBe('m365-chat-editor-target-element');
  });
  it('also matches a role=textbox without the id, and ignores other boxes', () => {
    document.body.innerHTML = '<div contenteditable="true" role="textbox" aria-label="Message Copilot"></div>';
    expect(findComposer(document, copilot.composer)).not.toBeNull();
    document.body.innerHTML = '<div contenteditable="true" role="textbox" aria-label="Start writing"></div>';
    expect(findComposer(document, copilot.composer)).toBeNull();
  });
});

describe('writeComposer robustness', () => {
  it('accepts an edit when the editor pads its text with zero-width characters (rich-text editors do)', async () => {
    const { writeComposer, lastWrite } = await import('../src/content/interceptors/promptInterceptor');
    document.body.innerHTML = '<span id="ed" contenteditable="true" role="textbox"></span>';
    const el = document.getElementById('ed')!;
    Object.defineProperty(el, 'innerText', { get: () => '\u200b' + (el.textContent ?? '').replace(/ /g, ' \u200b') + '\u200b', configurable: true });
    expect(await writeComposer(el, 'Hello [PERSON_1] please')).toBe(true);
    expect(lastWrite.attempts.at(-1)?.ok).toBe(true);
  });

  /**
   * A "controlled" editor shaped like the one live diagnostics showed on Copilot: it ignores replacing a selection, inserts
   * only at a plain (collapsed) caret, loses about one backspace in 13 when they come fast, and will not backspace the very
   * first character (forward-delete from the start can).
   */
  function controlledEditor(initial: string, opts: { deleteWorks?: boolean } = {}) {
    document.body.innerHTML = '<span id="ed" contenteditable="true" role="textbox"></span>';
    const el = document.getElementById('ed')!;
    let model = initial;
    let calls = 0;
    const render = () => { el.textContent = model; };
    render();
    // a controlled editor re-renders from its own state, undoing any direct DOM change (as live Copilot did)
    new MutationObserver(() => { if (el.textContent !== model) setTimeout(render, 0); }).observe(el, { childList: true, characterData: true, subtree: true });
    const collapsed = () => document.getSelection()?.isCollapsed !== false;
    (document as unknown as { execCommand: (c: string, ui?: boolean, v?: string) => boolean }).execCommand = (cmd, _ui, value) => {
      if (cmd === 'selectAll') { const r = document.createRange(); r.selectNodeContents(el); const s = document.getSelection()!; s.removeAllRanges(); s.addRange(r); return true; }
      if (cmd === 'insertText') { if (!collapsed()) return false; model += value ?? ''; render(); return true; }
      if (cmd === 'delete') {
        if (!collapsed() || opts.deleteWorks === false) return false;
        calls++;
        if (calls % 13 === 0 || model.length <= 1) return true; // a lost keystroke; and the first character is never backspaced
        model = model.slice(0, -1); render(); return true;
      }
      if (cmd === 'forwardDelete') { if (!collapsed() || opts.deleteWorks === false) return false; model = model.slice(1); render(); return true; }
      return false;
    };
    return { el, get: () => model };
  }

  it('edits a controlled editor that only accepts caret typing and flaky backspace (the live Copilot behaviour)', async () => {
    const { writeComposer, lastWrite } = await import('../src/content/interceptors/promptInterceptor');
    const original = 'My name is Priya Venkataraman and my email is priya.v@example.com. My phone is +91 98765 43210. Thanks';
    const { el, get } = controlledEditor(original);
    expect(await writeComposer(el, 'My name is [PERSON_1] and my email is [EMAIL_1].', original)).toBe(true);
    expect(get()).toBe('My name is [PERSON_1] and my email is [EMAIL_1].');
    expect(lastWrite.attempts.at(-1)?.ok).toBe(true);
  });

  it('leaves the user\'s own text intact when no strategy can edit the box (never a half-deleted draft)', async () => {
    const { writeComposer } = await import('../src/content/interceptors/promptInterceptor');
    const original = 'Please keep this draft exactly as it is';
    const { el, get } = controlledEditor(original, { deleteWorks: false });
    expect(await writeComposer(el, 'Hello [PERSON_1]', original)).toBe(false);
    expect(get()).toBe(original);
  });

  it('restores the original text if the box ends up emptied but the redacted text cannot be inserted', async () => {
    const { writeComposer } = await import('../src/content/interceptors/promptInterceptor');
    const original = 'Draft to restore';
    document.body.innerHTML = '<span id="ed" contenteditable="true" role="textbox"></span>';
    const el = document.getElementById('ed')!;
    let model = original;
    let blockRedacted = true;
    const render = () => { el.textContent = model; };
    render();
    new MutationObserver(() => { if (el.textContent !== model) setTimeout(render, 0); }).observe(el, { childList: true, characterData: true, subtree: true });
    (document as unknown as { execCommand: (c: string, ui?: boolean, v?: string) => boolean }).execCommand = (cmd, _ui, value) => {
      if (cmd === 'selectAll') { const r = document.createRange(); r.selectNodeContents(el); const s = document.getSelection()!; s.removeAllRanges(); s.addRange(r); return true; }
      if (cmd === 'delete') { model = ''; render(); return true; }               // can empty the box
      if (cmd === 'insertText') { if (value?.includes('[PERSON')) return blockRedacted ? false : true; model += value ?? ''; render(); return true; } // refuses the redacted text only
      return false;
    };
    expect(await writeComposer(el, 'Hello [PERSON_1]', original)).toBe(false);
    expect(model).toBe(original);
    void blockRedacted;
  });

  it('returns false when the editor refuses every edit, and records lengths only', async () => {
    const { writeComposer, lastWrite } = await import('../src/content/interceptors/promptInterceptor');
    document.body.innerHTML = '<span id="ed" contenteditable="true" role="textbox">original secret text</span>';
    const el = document.getElementById('ed')!;
    (document as unknown as { execCommand?: unknown }).execCommand = undefined;
    Object.defineProperty(el, 'innerText', { get: () => 'original secret text', configurable: true }); // always reverts
    expect(await writeComposer(el, 'Hello [PERSON_1]')).toBe(false);
    expect(lastWrite.attempts.length).toBeGreaterThanOrEqual(6);
    expect(lastWrite.attempts.every((a) => !a.ok && a.read === 20 && (a.expected === 16 || a.expected === 0))).toBe(true); // 0 = "is it empty?" checks
    expect(JSON.stringify(lastWrite)).not.toMatch(/secret|PERSON/);
  });
});
