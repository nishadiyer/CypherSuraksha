import type { ExtMessage, ExtReply, SiteState } from '../shared/messages';
import { hostOf, isAllowlisted, loadSettings, saveSettings } from '../shared/settings';
import type { PrivacyPayload, PrivacyResult, ShieldKind, ShieldRequest, ShieldResponse, VaultSnapshot } from '../types/shield';
import { bump } from './ledger';
import { ensureOffscreen } from './offscreenManager';
import { getMap, mergeMap } from './sessionStore';

const SHIELDS: ReadonlySet<string> = new Set<ShieldKind>(['PRIVACY', 'PIXELS', 'PEOPLE']);
const INFER_TIMEOUT_MS = 30_000;
/** Cloaking optimises each face (seconds) and photos queue, so it gets a much longer ceiling. */
const TIMEOUTS: Partial<Record<ShieldKind, number>> = { PIXELS: 180_000 };
const callsCounted = new Set<number>();

const allow = (requestId: string): ShieldResponse => ({ requestId, action: 'ALLOW', confidence: 0, latencyMs: 0 });

async function siteState(tabUrl: string | undefined): Promise<SiteState> {
  const s = await loadSettings();
  return { enabled: s.enabled, allowlisted: isAllowlisted(hostOf(tabUrl), s.allowlist), pillars: s.pillars };
}

async function loadVault(): Promise<VaultSnapshot> {
  const { vault } = (await chrome.storage.local.get('vault')) as { vault?: VaultSnapshot };
  return vault ?? { salt: '', hashes: [] };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('offscreen timeout')), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

/** A freshly created offscreen document may not have registered its listener yet: retry briefly. */
async function sendToOffscreen(req: ShieldRequest): Promise<ShieldResponse | undefined> {
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const r = (await chrome.runtime.sendMessage({ kind: 'OFFSCREEN_INFER', target: 'offscreen', request: req } satisfies ExtMessage)) as ShieldResponse | undefined;
      if (r) return r;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 150 * (i + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error('offscreen not ready');
}

async function runShield(req: ShieldRequest): Promise<ShieldResponse> {
  if (req.shield === 'PRIVACY') {
    const p = req.payload as { text: string };
    req = {
      ...req,
      payload: { text: p.text, existingMap: await getMap(req.tabId), vault: await loadVault() } satisfies PrivacyPayload,
    };
  }
  if (req.shield === 'PEOPLE') req = { ...req, payload: { ...(req.payload as object), faceSwap: (await loadSettings()).faceSwap } };
  await ensureOffscreen();
  const res = (await withTimeout(sendToOffscreen(req), TIMEOUTS[req.shield] ?? INFER_TIMEOUT_MS)) as ShieldResponse | undefined;
  if (!res || res.requestId !== req.requestId) throw new Error('offscreen returned no response');

  if (req.shield === 'PRIVACY' && res.action === 'MODIFY') {
    const r = res.data as PrivacyResult;
    // Offscreen returns the full map (existing + new); persist to session storage only.
    await mergeMap(req.tabId, r.map);
    void bump('promptsRedacted');
  } else if (req.shield === 'PIXELS' && res.action === 'MODIFY') {
    // Re-encoded-only photos (no face found) are not counted as cloaked.
    if ((res.data as { mode?: string } | undefined)?.mode !== 'no-face') void bump('photosCloaked');
  }
  return res;
}

export async function handleMessage(msg: ExtMessage, sender: chrome.runtime.MessageSender): Promise<ExtReply> {
  if (sender.id !== chrome.runtime.id) return { ok: false, error: 'untrusted sender' };
  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url ?? sender.url;

  switch (msg.kind) {
    case 'BYPASS_SITE': {
      const host = hostOf(tabUrl);
      if (!host) return { ok: false, error: 'no host' };
      const s = await loadSettings();
      if (!s.allowlist.includes(host)) await saveSettings({ ...s, allowlist: [...s.allowlist, host] });
      return { ok: true };
    }

    case 'GET_ENTITY_MAP':
      return tabId === undefined ? { ok: false, error: 'no tab' } : { ok: true, map: await getMap(tabId) };

    case 'CALL_STARTED': {
      if (tabId !== undefined && !callsCounted.has(tabId)) {
        callsCounted.add(tabId);
        await bump('callsProtected');
      }
      return { ok: true };
    }

    case 'SHIELD_REQUEST': {
      if (tabId === undefined) return { ok: false, error: 'no tab' };
      const r = msg.request;
      if (!SHIELDS.has(r.shield) || typeof r.requestId !== 'string') return { ok: false, error: 'bad request' };
      const domain = hostOf(tabUrl);
      const site = await siteState(tabUrl);
      if (!site.enabled || site.allowlisted || !site.pillars[r.shield]) return { ok: true, response: allow(r.requestId) };
      try {
        return { ok: true, response: await runShield({ ...r, tabId, domain }) };
      } catch (e) {
        // Fail open on infrastructure errors; never include payloads in the message.
        return { ok: false, error: e instanceof Error ? e.message : 'shield failure' };
      }
    }

    default:
      return { ok: false, error: 'unknown message' };
  }
}

export function registerRouter(): void {
  chrome.runtime.onMessage.addListener((msg: ExtMessage, sender, sendResponse) => {
    if ((msg as { target?: string }).target === 'offscreen') return false; // not for us
    void handleMessage(msg, sender).then(sendResponse);
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => callsCounted.delete(tabId));
}
