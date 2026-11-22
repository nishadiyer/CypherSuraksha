export interface Ledger {
  promptsRedacted: number;
  photosCloaked: number;
  callsProtected: number;
}
export const EMPTY_LEDGER: Ledger = { promptsRedacted: 0, photosCloaked: 0, callsProtected: 0 };

let chain: Promise<void> = Promise.resolve();

/** Serialised read-modify-write so concurrent increments are not lost. Counters only; no content. */
export function bump(counter: keyof Ledger, by = 1): Promise<void> {
  chain = chain.then(async () => {
    const { ledger } = (await chrome.storage.local.get('ledger')) as { ledger?: Ledger };
    const next = { ...EMPTY_LEDGER, ...ledger };
    next[counter] += by;
    await chrome.storage.local.set({ ledger: next });
  });
  return chain;
}
