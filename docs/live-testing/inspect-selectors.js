// Paste this whole file into the DevTools Console (F12 -> Console) on a chat site, with the message box visible.
// It reports how the extension's selectors match the page. It reads ATTRIBUTES ONLY, never any text you typed,
// so the output is safe to paste back. The result is also copied to your clipboard.
(() => {
  const SITES = [
    [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, { composer: '#prompt-textarea', send: 'button[data-testid="send-button"]' }],
    [/(^|\.)claude\.ai$/, { composer: 'div[contenteditable="true"].ProseMirror', send: 'button[aria-label^="Send"]' }],
    [/(^|\.)gemini\.google\.com$/, { composer: 'rich-textarea .ql-editor, div.ql-editor[contenteditable="true"]', send: 'button.send-button, button[aria-label*="Send"]' }],
    [/(^|\.)copilot\.microsoft\.com$|(^|\.)copilot\.com$/, { composer: '#m365-chat-editor-target-element, [contenteditable="true"][role="textbox"][aria-label^="Message"], textarea#userInput, textarea[data-testid="composer-input"], textarea', send: 'button[data-testid="submit-button"], button[aria-label*="Submit"], button[aria-label*="Send"]' }],
  ];
  const site = SITES.find(([re]) => re.test(location.hostname));
  const attrs = (el) => {
    const o = { tag: el.tagName.toLowerCase() };
    for (const a of el.attributes) {
      if (/^(value|placeholder|title|alt)$/.test(a.name)) continue; // can hold typed text
      o[a.name] = a.value.length > 90 ? a.value.slice(0, 90) + '…' : a.value;
    }
    o.visible = !!(el.offsetWidth || el.offsetHeight);
    o.disabled = !!el.disabled || el.getAttribute('aria-disabled') === 'true';
    return o;
  };
  const out = { host: location.hostname, url: location.origin + location.pathname.replace(/[0-9a-f-]{16,}/gi, ':id'), ua: navigator.userAgent.replace(/\(.*?\)/, '').trim(), extension: null, composer: null, send: null, nearbyButtons: [] };
  if (!site) { out.note = 'no adapter for this host'; console.log(out); return; }
  const [, sel] = site;
  const q = (s) => [...document.querySelectorAll(s)];
  const comp = q(sel.composer), send = q(sel.send);
  out.composer = { selector: sel.composer, matches: comp.length, elements: comp.slice(0, 3).map(attrs) };
  out.send = { selector: sel.send, matches: send.length, elements: send.slice(0, 3).map(attrs) };
  const root = (comp[0] || document.body).closest('form, [role="form"], main, section') || document.body;
  out.nearbyButtons = [...root.querySelectorAll('button, [role="button"]')].slice(0, 14).map(attrs);
  // Is the CypherSuraksha content script present? Its toast/pill live in closed shadow roots, so look for its host elements.
  out.extension = { hostElementsInBody: [...document.documentElement.children].filter((e) => e.tagName.includes('-') || e.id?.startsWith?.('ai-shield')).length };
  const text = JSON.stringify(out, null, 2);
  try { copy(text); } catch (e) { /* copy() only exists in DevTools */ }
  console.log(text);
})();
