import type { PeopleResult } from '../types/shield';
import { newRequestId, send } from '../shared/messages';
import { installVideoSampler, videoStats } from './interceptors/videoInterceptor';
import { onTestNotification, registerPageStatus } from './status';
import { showToast } from './ui/Toast';
import { removePill, updatePill } from './ui/PeopleUI';

onTestNotification(() => showToast('CypherSuraksha test: notifications show on this page'));
let last: { r: PeopleResult; fps: number } | undefined;
const pct = (v: number | undefined): number => (typeof v === 'number' ? Math.round(v * 100) : -1);
registerPageStatus('video', () => ({
  videos: document.querySelectorAll('video').length,
  tracked: videoStats.tracked.length,
  duplicatesSkipped: videoStats.skippedDuplicates,
  trackedSizes: videoStats.tracked.map((t) => `${t.w}x${t.h} ${t.source}`).join(', '),
  // the latest reading, so the popup can show WHY the pill says what it says (numbers only)
  hasReading: !!last,
  level: last?.r.status === 'no-face' ? 'NO-FACE' : (last?.r.level ?? ''),
  smoothed: pct(last?.r.smoothed),
  frame: pct(last?.r.frameScore),
  main: pct(last?.r.main),
  swap: pct(last?.r.gend),
  backend: last?.r.backend ?? '',
  fps: last ? Math.round(last.fps * 10) / 10 : 0,
}));

installVideoSampler(window, {
  async send(frame) {
    const r = await send({
      kind: 'SHIELD_REQUEST',
      request: { requestId: newRequestId(), shield: 'PEOPLE', payload: frame },
    });
    if (!r.ok || !('response' in r) || !r.response.data) return null; // disabled/allowlisted -> no UI
    return r.response.data as PeopleResult;
  },
  onResult: (video, r, fps) => {
    last = { r, fps };
    updatePill(video, r, fps);
  },
  onCallStarted: () => void send({ kind: 'CALL_STARTED' }),
  onVideoGone: removePill,
});
