import type { PrivacyResult } from '../types/shield';
import { newRequestId, send } from '../shared/messages';
import { showToast } from './ui/Toast';
import { adapterFor, findComposer, installPromptInterceptor, installRestorer } from './interceptors/promptInterceptor';
import { buttonCandidates, editableCandidates, onTestNotification, registerPageStatus } from './status';

const adapter = adapterFor(location.hostname);

onTestNotification(() => showToast('AI Shield test: notifications show on this page'));

if (adapter) {
  // The send button often only exists once there is text, so the popup treats it as informational.
  registerPageStatus('prompt', () => ({
    site: location.hostname,
    messageBox: !!findComposer(document, adapter.composer),
    sendButton: !!document.querySelector(adapter.send),
    // Only when the message box is missing: what on the page looks like one (attributes only), to fix the selector.
    candidates: findComposer(document, adapter.composer) ? '' : JSON.stringify(editableCandidates(document)),
    // Message box found but no Send button: the buttons around the message box (sites show Send only after you type).
    buttons: (() => {
      const box = findComposer(document, adapter.composer);
      return box && !document.querySelector(adapter.send) ? JSON.stringify(buttonCandidates(box)) : '';
    })(),
  }));
  const restorer = installRestorer(document);
  void send({ kind: 'GET_ENTITY_MAP' }).then((r) => {
    if (r.ok && 'map' in r) restorer.setMap(r.map);
  }).catch(() => undefined);

  installPromptInterceptor(window, adapter, {
    async redact(text) {
      const r = await send({ kind: 'SHIELD_REQUEST', request: { requestId: newRequestId(), shield: 'PRIVACY', payload: { text } } });
      if (!r.ok || !('response' in r)) throw new Error('shield unavailable');
      if (r.response.action !== 'MODIFY') return { map: {}, count: 0 };
      const d = r.response.data as PrivacyResult;
      return { redactedText: d.redactedText, map: d.map, count: d.count };
    },
    onRedacted(count, map) {
      restorer.setMap(map);
      showToast(`Redacted ${count} sensitive item${count === 1 ? '' : 's'}`);
    },
    onError: (m) => showToast(m, 8000),
  });
}
