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
    Object.defineProperty(el, 'innerText', { get: () => '​' + (el.textContent ?? '').replace(/ /g, ' ​') + '​', configurable: true });
    expect(writeComposer(el, 'Hello [PERSON_1] please')).toBe(true);
    expect(lastWrite.attempts.at(-1)?.ok).toBe(true);
  });
  it('returns false when the editor refuses every edit, and records lengths only', async () => {
    const { writeComposer, lastWrite } = await import('../src/content/interceptors/promptInterceptor');
    document.body.innerHTML = '<span id="ed" contenteditable="true" role="textbox">original secret text</span>';
    const el = document.getElementById('ed')!;
    Object.defineProperty(el, 'innerText', { get: () => 'original secret text', configurable: true }); // always reverts
    expect(writeComposer(el, 'Hello [PERSON_1]')).toBe(false);
    expect(lastWrite.attempts.length).toBeGreaterThanOrEqual(4);
    expect(lastWrite.attempts.every((a) => !a.ok && a.read === 20 && a.expected === 16)).toBe(true);
    expect(JSON.stringify(lastWrite)).not.toMatch(/secret|PERSON/);
  });
});
