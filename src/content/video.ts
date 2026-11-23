import type { PeopleResult } from '../types/shield';
import { newRequestId, send } from '../shared/messages';
import { installVideoSampler } from './interceptors/videoInterceptor';
import { onTestNotification, registerPageStatus } from './status';
import { showToast } from './ui/Toast';
import { removePill, updatePill } from './ui/PeopleUI';

onTestNotification(() => showToast('AI Shield test: notifications show on this page'));
registerPageStatus('video', () => ({ videos: document.querySelectorAll('video').length }));

installVideoSampler(window, {
  async send(frame) {
    const r = await send({
      kind: 'SHIELD_REQUEST',
      request: { requestId: newRequestId(), shield: 'PEOPLE', payload: frame },
    });
    if (!r.ok || !('response' in r) || !r.response.data) return null; // disabled/allowlisted -> no UI
    return r.response.data as PeopleResult;
  },
  onResult: updatePill,
  onCallStarted: () => void send({ kind: 'CALL_STARTED' }),
  onVideoGone: removePill,
});
