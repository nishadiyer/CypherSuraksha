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
