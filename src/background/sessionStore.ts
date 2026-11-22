import type { EntityMap } from '../types/shield';

/**
 * Per-tab ephemeral redaction maps. chrome.storage.session lives in RAM only,
 * is cleared when the browser closes, and is not exposed to content scripts
 * (default TRUSTED_CONTEXTS access level).
 */
const key = (tabId: number) => `entities:${tabId}`;

export async function getMap(tabId: number): Promise<EntityMap> {
  const r = await chrome.storage.session.get(key(tabId));
  return (r[key(tabId)] as EntityMap | undefined) ?? {};
}

export async function mergeMap(tabId: number, add: EntityMap): Promise<EntityMap> {
  const merged = { ...(await getMap(tabId)), ...add };
  await chrome.storage.session.set({ [key(tabId)]: merged });
  return merged;
}

export async function purgeTab(tabId: number): Promise<void> {
  await chrome.storage.session.remove(key(tabId));
}

export function registerSessionCleanup(): void {
  chrome.tabs.onRemoved.addListener((tabId) => void purgeTab(tabId));
  // `status: loading` fires on real navigations/reloads, not on history.pushState
  // route changes, so SPA chats keep their map while page loads purge it.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') void purgeTab(tabId);
  });
}
