import type { ExtMessage } from '../shared/messages';
import { disposeAll, dispatch, registerWorkerShield } from './registry';

registerWorkerShield('PRIVACY', () => new Worker(new URL('./workers/privacy.worker.ts', import.meta.url), { type: 'module' }));
registerWorkerShield('PIXELS', () => new Worker(new URL('./workers/pixel.worker.ts', import.meta.url), { type: 'module' }));
registerWorkerShield('PEOPLE', () => new Worker(new URL('./workers/people.worker.ts', import.meta.url), { type: 'module' }));

chrome.runtime.onMessage.addListener((msg: ExtMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!('target' in msg) || msg.target !== 'offscreen') return false;
  if (msg.kind === 'OFFSCREEN_INFER') {
    dispatch(msg.request).then(sendResponse, () =>
      sendResponse({ requestId: msg.request.requestId, action: 'ALLOW', confidence: 0, latencyMs: 0 }),
    );
    return true;
  }
  if (msg.kind === 'OFFSCREEN_DISPOSE') {
    void disposeAll().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

window.addEventListener('pagehide', () => void disposeAll());
