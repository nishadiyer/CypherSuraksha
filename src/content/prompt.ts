import type { PrivacyResult } from '../types/shield';
import { newRequestId, send } from '../shared/messages';
import { showToast } from './ui/Toast';
import { adapterFor, installPromptInterceptor, installRestorer } from './interceptors/promptInterceptor';

const adapter = adapterFor(location.hostname);

if (adapter) {
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
