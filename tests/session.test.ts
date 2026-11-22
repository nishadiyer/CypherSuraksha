import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...a: unknown[]) => void;
const store = new Map<string, unknown>();
const removedListeners: Listener[] = [];
const updatedListeners: Listener[] = [];

beforeEach(() => {
  store.clear();
  removedListeners.length = 0;
  updatedListeners.length = 0;
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: async (k: string) => (store.has(k) ? { [k]: store.get(k) } : {}),
        set: async (o: Record<string, unknown>) => Object.entries(o).forEach(([k, v]) => store.set(k, v)),
        remove: async (k: string) => void store.delete(k),
      },
      local: { set: vi.fn(), get: vi.fn() },
    },
    tabs: {
      onRemoved: { addListener: (l: Listener) => removedListeners.push(l) },
      onUpdated: { addListener: (l: Listener) => updatedListeners.push(l) },
    },
  });
});

describe('ephemeral session map', () => {
  it('is keyed per tab, never touches storage.local, and purges on close and navigation', async () => {
    const s = await import('../src/background/sessionStore');
    s.registerSessionCleanup();
    await s.mergeMap(1, { '[PERSON_1]': 'Ada' });
    await s.mergeMap(2, { '[PERSON_1]': 'Grace' });
    expect(await s.getMap(1)).toEqual({ '[PERSON_1]': 'Ada' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    removedListeners.forEach((l) => l(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(await s.getMap(1)).toEqual({});
    expect(await s.getMap(2)).toEqual({ '[PERSON_1]': 'Grace' });

    updatedListeners.forEach((l) => l(2, { url: 'https://x/#spa' })); // SPA route change: kept
    await new Promise((r) => setTimeout(r, 0));
    expect(await s.getMap(2)).toEqual({ '[PERSON_1]': 'Grace' });
    updatedListeners.forEach((l) => l(2, { status: 'loading' })); // real navigation: purged
    await new Promise((r) => setTimeout(r, 0));
    expect(await s.getMap(2)).toEqual({});
  });
});
