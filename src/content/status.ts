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

export function registerPageStatus(part: string, probe: Probe): void {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  const reg = (g[KEY] ??= { probes: {}, listening: false });
  reg.probes[part] = probe;
  if (reg.listening) return;
  reg.listening = true;
  chrome.runtime.onMessage.addListener((msg: { kind?: string }, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || msg?.kind !== 'PAGE_STATUS') return false;
    const status: PageStatus = { parts: Object.entries(reg.probes).map(([name, fn]) => ({ part: name, detail: fn() })) };
    sendResponse(status);
    return false;
  });
}
