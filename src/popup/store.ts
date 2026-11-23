import { useEffect, useState } from 'preact/hooks';
import { EMPTY_LEDGER, type Ledger } from '../background/ledger';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../shared/settings';
import { EMPTY_VAULT, addToVault, type Vault } from '../shared/vault';

export function useSettings(): [Settings, (next: Settings) => void] {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    void loadSettings().then(setS);
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area === 'local' && c.settings) void loadSettings().then(setS);
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);
  return [s, (next) => { setS(next); void saveSettings(next); }];
}

export function useLedger(): Ledger {
  const [l, setL] = useState<Ledger>(EMPTY_LEDGER);
  useEffect(() => {
    const read = (): void => void chrome.storage.local.get('ledger').then((r) => setL({ ...EMPTY_LEDGER, ...(r.ledger as Ledger | undefined) }));
    read();
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area === 'local' && c.ledger) read();
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);
  return l;
}

export async function loadVault(): Promise<Vault> {
  const { vault } = (await chrome.storage.local.get('vault')) as { vault?: Vault };
  return vault ?? EMPTY_VAULT;
}

/** Hash first, then persist. The plaintext keyword never reaches storage. */
export async function addKeyword(keyword: string): Promise<Vault> {
  const next = await addToVault(await loadVault(), keyword);
  await chrome.storage.local.set({ vault: next });
  return next;
}

/* ---------- "This page": is AI Shield running on the current tab, and what does it see? ---------- */
import type { PageStatus } from '../shared/messages';

export type PageState =
  | { kind: 'loading' }
  | { kind: 'other' } // a page AI Shield does not apply to
  | { kind: 'inactive'; host: string } // a supported site, but the content script did not answer
  | { kind: 'active'; host: string; status: PageStatus };

function supportedHosts(): RegExp[] {
  const patterns = new Set<string>();
  for (const cs of chrome.runtime.getManifest().content_scripts ?? []) for (const m of cs.matches ?? []) patterns.add(m);
  return [...patterns].map((m) => {
    const host = m.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return new RegExp('^' + host.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*(?:\\.[^.]+)*') + '$');
  });
}

/** Asks the content script on the active tab to show a test toast. Resolves true if it answered. */
export async function showTestNotification(): Promise<boolean> {
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return false;
  try {
    const r = (await chrome.tabs.sendMessage(tab.id, { kind: 'TEST_NOTIFICATION' })) as { shown?: boolean } | undefined;
    return !!r?.shown;
  } catch {
    return false;
  }
}

export function usePageStatus(): PageState {
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  useEffect(() => {
    void (async () => {
      // `?tabId=N` lets the e2e suite point the panel at another tab (a real popup always inspects the active tab).
      const forced = Number(new URLSearchParams(location.search).get('tabId'));
      const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      let host = '';
      try {
        host = tab?.url ? new URL(tab.url).hostname : '';
      } catch {
        host = '';
      }
      if (!tab?.id) return setState({ kind: 'other' });
      try {
        const status = (await chrome.tabs.sendMessage(tab.id, { kind: 'PAGE_STATUS' })) as PageStatus | undefined;
        if (status?.parts) return setState({ kind: 'active', host, status });
      } catch {
        // no content script answered
      }
      setState(host && supportedHosts().some((re) => re.test(host)) ? { kind: 'inactive', host } : { kind: 'other' });
    })();
  }, []);
  return state;
}
