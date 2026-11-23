import type { PageStatus } from '../shared/messages';

/**
 * Lets the popup ask "is AI Shield running on this tab, and what does it see?". Only the extension's own pages
 * can ask (the page itself cannot), and the answer carries no page content: only booleans and counts.
 *
 * Several content scripts can run in one tab (for example upload + video on WhatsApp Web) and share one isolated
 * world, so they register a probe here and a single listener answers for all of them.
 */
type Probe = () => Record<string, boolean | number | string>;
interface Registry {
  probes: Record<string, Probe>;
  listening: boolean;
}
const KEY = '__aiShieldStatus';

/** Called when the popup's "show a test notification" button is pressed. */
let testNotice: (() => void) | undefined;
export function onTestNotification(fn: () => void): void {
  testNotice = fn;
}

export function registerPageStatus(part: string, probe: Probe): void {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  const reg = (g[KEY] ??= { probes: {}, listening: false });
  reg.probes[part] = probe;
  if (reg.listening) return;
  reg.listening = true;
  chrome.runtime.onMessage.addListener((msg: { kind?: string }, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (msg?.kind === 'TEST_NOTIFICATION') {
      testNotice?.();
      sendResponse({ shown: !!testNotice });
      return false;
    }
    if (msg?.kind !== 'PAGE_STATUS') return false;
    const status: PageStatus = { parts: Object.entries(reg.probes).map(([name, fn]) => ({ part: name, detail: fn() })) };
    sendResponse(status);
    return false;
  });
}

/* ---------- diagnostics: what on this page looks like a message box? (attributes only, never text) ---------- */

export interface EditableCandidate {
  el: string; // e.g. div#prompt-textarea
  role?: string;
  testid?: string;
  aria?: string;
  editable?: string;
  inShadow: boolean;
  w: number;
  h: number;
}

const EDITABLE = 'textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], input[type="text"], input[type="search"], input:not([type])';

/** Walks the document, going into open shadow roots, and returns elements matching `selector`. */
function* deepQuery(root: ParentNode, selector: string, inShadow = false): Generator<{ el: Element; inShadow: boolean }> {
  for (const el of root.querySelectorAll(selector)) yield { el, inShadow };
  for (const host of root.querySelectorAll('*')) {
    if (host.shadowRoot) yield* deepQuery(host.shadowRoot, selector, true);
  }
}

/** Largest visible editable elements. Reports attributes only: never value, text content or placeholder. */
export function editableCandidates(doc: Document, limit = 5): EditableCandidate[] {
  const out: Array<EditableCandidate & { area: number }> = [];
  for (const { el, inShadow } of deepQuery(doc, EDITABLE)) {
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 12 || !el.getClientRects().length) continue;
    const id = el.id ? `#${el.id.slice(0, 40)}` : '';
    out.push({
      el: `${el.tagName.toLowerCase()}${id}`,
      role: el.getAttribute('role') ?? undefined,
      testid: el.getAttribute('data-testid') ?? undefined,
      aria: el.getAttribute('aria-label')?.slice(0, 40) ?? undefined,
      editable: el.getAttribute('contenteditable') ?? undefined,
      inShadow,
      w: Math.round(r.width),
      h: Math.round(r.height),
      area: r.width * r.height,
    });
  }
  return out
    .sort((a, b) => b.area - a.area)
    .slice(0, limit)
    .map(({ area: _a, ...c }) => c);
}

export interface ButtonCandidate {
  testid?: string;
  aria?: string;
  type?: string;
  disabled: boolean;
}

/** Buttons in the nearest ancestor of `near` that has any (the composer's toolbar). Attributes only, never label text. */
export function buttonCandidates(near: Element, limit = 8): ButtonCandidate[] {
  let scope: Element | null = near;
  for (let i = 0; i < 7 && scope; i++, scope = scope.parentElement) {
    const buttons = [...scope.querySelectorAll('button, [role="button"]')];
    if (buttons.length)
      return buttons.slice(0, limit).map((b) => ({
        testid: b.getAttribute('data-testid') ?? undefined,
        aria: b.getAttribute('aria-label')?.slice(0, 40) ?? undefined,
        type: b.getAttribute('type') ?? undefined,
        disabled: (b as HTMLButtonElement).disabled === true || b.getAttribute('aria-disabled') === 'true',
      }));
  }
  return [];
}
