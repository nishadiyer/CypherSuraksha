import type { EntityMap } from '../../types/shield';

export interface SiteAdapter {
  /** CSS selector for the prompt composer element(s) */
  composer: string;
  /** CSS selector for the submit button */
  send: string;
}

const ADAPTERS: Array<[RegExp, SiteAdapter]> = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, {
    // ChatGPT's message box lost its #prompt-textarea id; it is now a role=textbox labelled "Ask ..." / "Message ...".
    // (Its big "Start writing" editors are NOT the composer and are deliberately not matched.)
    composer: '#prompt-textarea, div[contenteditable="true"][role="textbox"][aria-label^="Ask"], div[contenteditable="true"][role="textbox"][aria-label^="Message"]',
    send: 'button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[aria-label^="Send"]',
  }],
  [/(^|\.)claude\.ai$/, { composer: 'div[contenteditable="true"].ProseMirror', send: 'button[aria-label^="Send"]' }],
  [/(^|\.)gemini\.google\.com$/, { composer: 'rich-textarea .ql-editor, div.ql-editor[contenteditable="true"]', send: 'button.send-button, button[aria-label*="Send"]' }],
  [/(^|\.)copilot\.microsoft\.com$|(^|\.)copilot\.com$/, { composer: '#m365-chat-editor-target-element, [contenteditable="true"][role="textbox"][aria-label^="Message"], textarea#userInput, textarea[data-testid="composer-input"], textarea', send: 'button[data-testid="submit-button"], button[aria-label*="Submit"], button[aria-label*="Send"]' }],
];

export function adapterFor(hostname: string): SiteAdapter | null {
  return ADAPTERS.find(([re]) => re.test(hostname))?.[1] ?? null;
}

export interface RedactOutcome {
  /** undefined when nothing needed redacting */
  redactedText?: string;
  map: EntityMap;
  count: number;
}

export interface InterceptorDeps {
  redact(text: string): Promise<RedactOutcome>;
  onRedacted(count: number, map: EntityMap): void;
  onError(message: string): void;
}

const isTextarea = (el: Element): el is HTMLTextAreaElement => el.tagName === 'TEXTAREA';

export function readComposer(el: HTMLElement): string {
  return isTextarea(el) ? el.value : el.innerText ?? el.textContent ?? '';
}

const norm = (t: string): string => t.replace(/\s+/g, ' ').trim();

function selectAll(el: HTMLElement): void {
  el.focus();
  try {
    el.ownerDocument.execCommand('selectAll', false);
  } catch {
    /* ignore */
  }
}

/**
 * Replaces the composer text and returns true only if the editor now holds it.
 * Strategies, in order: native setter (textarea), execCommand insertText (goes
 * through ProseMirror/Lexical/Quill beforeinput handling), a synthetic paste,
 * then textContent plus a synthetic InputEvent so frameworks re-read the DOM.
 */
export function writeComposer(el: HTMLElement, text: string): boolean {
  const doc = el.ownerDocument;
  const ok = (): boolean => norm(readComposer(el)) === norm(text);
  el.focus();
  if (isTextarea(el)) {
    // Native setter so React-controlled inputs notice the change.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return ok();
  }
  try {
    selectAll(el);
    doc.execCommand('insertText', false, text);
  } catch {
    /* fall through */
  }
  if (ok()) return true;
  try {
    selectAll(el);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  } catch {
    /* DataTransfer unavailable */
  }
  if (ok()) return true;
  el.textContent = text;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return ok();
}

/** Real chat apps keep a hidden fallback textarea beside the visible editor: pick the live one. */
export function findComposer(doc: Document, selector: string): HTMLElement | null {
  const all = [...doc.querySelectorAll<HTMLElement>(selector)];
  const visible = all.filter((el) => el.getClientRects().length > 0 || el.isContentEditable);
  const pool = visible.length ? visible : all;
  const active = doc.activeElement;
  return (
    pool.find((el) => active && el.contains(active)) ??
    pool.find((el) => readComposer(el).trim()) ??
    pool[0] ??
    null
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForEnabledSend(doc: Document, selector: string, timeoutMs: number): Promise<HTMLElement | null> {
  const end = Date.now() + timeoutMs;
  do {
    const btn = doc.querySelector<HTMLElement>(selector);
    if (btn && !(btn as HTMLButtonElement).disabled && btn.getAttribute('aria-disabled') !== 'true') return btn;
    await sleep(25);
  } while (Date.now() < end);
  return null;
}

/**
 * Intercepts Enter and Send-button clicks in capture phase *before* the page
 * sees them, swaps in the redacted prompt, then re-fires the submission.
 * If the shield fails, the first attempt is blocked and a second explicit send
 * within 15s is let through, so a broken shield never silently leaks and never locks the user out.
 */
export function installPromptInterceptor(win: Window, adapter: SiteAdapter, deps: InterceptorDeps, opts = { sendWaitMs: 600 }): () => void {
  const doc = win.document;
  let passthrough = false;
  let busy = false;
  let overrideUntil = 0;

  const composerOf = (t: EventTarget | null): HTMLElement | null =>
    t instanceof Element ? (t.closest(adapter.composer) as HTMLElement | null) : null;

  async function run(composer: HTMLElement): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const original = readComposer(composer);
      if (original.trim()) {
        try {
          const out = await deps.redact(original);
          if (out.redactedText !== undefined && out.count > 0) {
            if (!writeComposer(composer, out.redactedText)) {
              // The editor refused the swap: never send the original.
              deps.onError('AI Shield could not edit this prompt box, so nothing was sent. Remove the sensitive text and try again.');
              return;
            }
            deps.onRedacted(out.count, out.map);
          }
        } catch {
          overrideUntil = Date.now() + 15_000;
          deps.onError('AI Shield could not check this prompt, so it was not sent. Press send again to send it unprotected.');
          return;
        }
      }
      const btn = await waitForEnabledSend(doc, adapter.send, opts.sendWaitMs);
      passthrough = true;
      try {
        if (btn) btn.click();
        else composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      } finally {
        passthrough = false;
      }
    } finally {
      busy = false;
    }
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (passthrough || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const composer = composerOf(e.target);
    if (!composer) return;
    if (Date.now() < overrideUntil) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    void run(composer);
  };

  const onClick = (e: MouseEvent): void => {
    if (passthrough) return;
    const t = e.target;
    if (!(t instanceof Element) || !t.closest(adapter.send)) return;
    const composer = findComposer(doc, adapter.composer);
    if (!composer) return;
    if (Date.now() < overrideUntil) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    void run(composer);
  };

  /** Some apps submit on pointerdown/mousedown; hide those from the page and let the click path do the work. */
  const onPointer = (e: Event): void => {
    if (passthrough || Date.now() < overrideUntil) return;
    const t = e.target;
    if (!(t instanceof Element) || !t.closest(adapter.send)) return;
    const composer = findComposer(doc, adapter.composer);
    if (!composer || !readComposer(composer).trim()) return;
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const opts2 = { capture: true } as const;
  win.addEventListener('keydown', onKeydown, opts2);
  win.addEventListener('click', onClick, opts2);
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'pointerup'] as const) win.addEventListener(t, onPointer, opts2);
  return () => {
    win.removeEventListener('keydown', onKeydown, opts2);
    win.removeEventListener('click', onClick, opts2);
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'pointerup'] as const) win.removeEventListener(t, onPointer, opts2);
  };
}

/* ---------- visual restoration of real entities ---------- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Restorer {
  setMap(map: EntityMap): void;
  /** how many placeholders this tab currently remembers */
  size(): number;
  stop(): void;
}

/**
 * Replaces placeholders such as [PERSON_1] with the real value in rendered
 * text nodes (display only; the page's network payloads keep the placeholders).
 * Skips editable regions so the user's own draft is never rewritten.
 */
export function installRestorer(doc: Document, initial: EntityMap = {}): Restorer {
  let map: EntityMap = { ...initial };
  let re: RegExp | null = null;
  const rebuild = (): void => {
    const keys = Object.keys(map);
    re = keys.length ? new RegExp(keys.sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'g') : null;
  };
  rebuild();

  const inEditable = (n: Node): boolean => {
    const el = n.parentElement;
    return !!el && (el.isContentEditable || !!el.closest('textarea, [contenteditable="true"], script, style'));
  };

  /** The block of text a placeholder can be split across (streaming UIs wrap tokens in many small nodes). */
  const scopeOf = (n: Node): Element | null => n.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, dd, dt') ?? n.parentElement;

  /** Restores every placeholder in `scope`, including ones split across adjacent text nodes. */
  const restoreScope = (scope: Element): void => {
    if (!re) return;
    const nodes: Text[] = [];
    const w = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (!inEditable(n)) nodes.push(n as Text);
    const full = nodes.map((n) => n.nodeValue ?? '').join('');
    if (!full.includes('[')) return;
    re.lastIndex = 0;
    const found = [...full.matchAll(re)];
    if (!found.length) return;
    // offsets of each node in `full`
    const starts: number[] = [];
    let acc = 0;
    for (const n of nodes) {
      starts.push(acc);
      acc += (n.nodeValue ?? '').length;
    }
    const nodeAt = (pos: number): number => {
      let i = starts.length - 1;
      while (i > 0 && starts[i]! > pos) i--;
      return i;
    };
    for (const m of found.reverse()) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const value = map[m[0]] ?? m[0];
      const si = nodeAt(start);
      const ei = nodeAt(end - 1);
      const first = nodes[si]!;
      const last = nodes[ei]!;
      const head = (first.nodeValue ?? '').slice(0, start - starts[si]!);
      const tail = (last.nodeValue ?? '').slice(end - starts[ei]!);
      if (si === ei) first.nodeValue = head + value + tail;
      else {
        first.nodeValue = head + value;
        for (let i = si + 1; i < ei; i++) nodes[i]!.nodeValue = '';
        last.nodeValue = tail;
      }
    }
  };

  const fix = (node: Node): void => {
    if (!re) return;
    const scopes = new Set<Element>();
    const consider = (t: Node): void => {
      const v = t.nodeValue ?? '';
      // a split placeholder leaves "[" or "]" or a fragment in a node: look at the whole block when any bracket is present
      if ((v.includes('[') || v.includes(']') || /(PERSON|EMAIL|PHONE|ORG|LOC|ID|SECRET|CUSTOM|_\d)/.test(v)) && !inEditable(t)) {
        const sc = scopeOf(t);
        if (sc) scopes.add(sc);
      }
    };
    if (node.nodeType === Node.TEXT_NODE) consider(node);
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const w = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) consider(n);
    }
    scopes.forEach(restoreScope);
  };

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') fix(m.target);
      else m.addedNodes.forEach(fix);
    }
  });
  const start = (): void => {
    if (doc.body) mo.observe(doc.body, { childList: true, subtree: true, characterData: true });
  };
  if (doc.body) start();
  else doc.addEventListener('DOMContentLoaded', start, { once: true });

  return {
    size: () => Object.keys(map).length,
    setMap(next) {
      map = { ...map, ...next };
      rebuild();
      if (doc.body) fix(doc.body);
    },
    stop: () => mo.disconnect(),
  };
}

/**
 * Diagnostics for the popup: how many placeholders are on the page right now, split into ones AI Shield can restore and
 * ones inside editable areas (which it deliberately never rewrites: editing a page's own editor text would make the
 * site think you typed the real value and could save it). Counts only; no text leaves this function.
 */
export function countPlaceholders(doc: Document): { restorable: number; inEditable: number } {
  const re = /\[(?:PERSON|ORG|LOC|ID|SECRET|EMAIL|PHONE|CUSTOM)_\d+\]/g;
  const scopes = new Map<Element, { text: string; editable: boolean }>();
  const w = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest('script, style, noscript')) continue;
    const scope = el.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, dd, dt') ?? el;
    const entry = scopes.get(scope) ?? { text: '', editable: false };
    entry.text += n.nodeValue ?? '';
    if (el.isContentEditable || el.closest('textarea, [contenteditable="true"]')) entry.editable = true;
    scopes.set(scope, entry);
  }
  let restorable = 0;
  let inEditable = 0;
  for (const { text, editable } of scopes.values()) {
    if (!text.includes('[')) continue;
    const found = text.match(re)?.length ?? 0;
    if (editable) inEditable += found;
    else restorable += found;
  }
  return { restorable, inEditable };
}
