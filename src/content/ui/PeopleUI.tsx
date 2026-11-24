import type { PeopleResult } from '../../types/shield';
import { Mark } from './Brand';
import { createShadowUI, type ShadowUI } from './shadowHost';

const COLORS = { GREEN: '#3ddc97', YELLOW: '#f6a94a', RED: '#ff6b73' } as const;
const NEUTRAL = '#8794b3';

function label(r: PeopleResult): string {
  if (r.backend === 'unavailable') return 'Unverified — detector not installed';
  if (r.status === 'no-face') return 'No face in view — nothing to check';
  if (r.level === 'GREEN') return 'No sign of AI-generated video found (this does not prove the caller is real)';
  // amber caused only by the experimental face-swap detector (the main model is below its own amber line)
  if (r.level === 'YELLOW' && r.gend !== undefined && (r.main ?? 0) < 0.4) return 'Unsure — the experimental face-swap detector thinks this may be a swapped face (it can be wrong; the main model sees nothing)';
  if (r.level === 'YELLOW') return 'Be cautious — possible manipulation';
  return 'Likely AI-generated video';
}

interface Entry {
  pill: ShadowUI;
  modal?: ShadowUI;
  dismissed: boolean;
}
const entries = new WeakMap<HTMLVideoElement, Entry>();
const live = new Set<HTMLVideoElement>();

function anchor(video: HTMLVideoElement, ui: ShadowUI): void {
  const r = video.getBoundingClientRect();
  ui.place({ left: `${Math.max(0, r.left + 8)}px`, top: `${Math.max(0, r.top + 8)}px` });
}

let rafPending = false;
function reanchorAll(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    live.forEach((v) => {
      const e = entries.get(v);
      if (e) anchor(v, e.pill);
    });
  });
}
addEventListener('scroll', reanchorAll, { capture: true, passive: true });
addEventListener('resize', reanchorAll, { passive: true });

function Pill({ r, fps }: { r: PeopleResult; fps: number }) {
  const color = r.status === 'no-face' ? NEUTRAL : COLORS[r.level];
  return (
    <div
      role="status"
      title={`${label(r)} · smoothed ${(r.smoothed * 100).toFixed(0)}% (this frame: main model ${r.main === undefined ? '-' : (r.main * 100).toFixed(0) + '%'}${r.gend === undefined ? '' : ', face-swap detector ' + (r.gend * 100).toFixed(0) + '%'}) · ${r.backend} · ${fps.toFixed(1)} fps`}
      class="cs-wrap cs-pill"
    >
      <Mark />
      <span class="cs-dot" style={`background:${color};box-shadow:0 0 8px ${color}`} />
      <span>{r.status === 'no-face' ? 'No face' : r.level === 'GREEN' ? 'No fake found' : r.level === 'YELLOW' ? 'Unsure' : 'Fake?'}</span>
    </div>
  );
}

function CircuitBreaker({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div class="cs-wrap cs-modal-bg">
      <div role="alertdialog" aria-modal="true" aria-labelledby="cb-t" class="cs-modal">
        <h2 id="cb-t"><Mark />This video may be AI-generated</h2>
        <p>
          Our on-device check has repeatedly flagged this person's video as synthetic. Do <b>not</b> send money, gift cards, passwords or
          verification codes, and do not share personal details.
        </p>
        <p>Hang up and call them back on a number you already know, or ask a question only the real person could answer.</p>
        <div style="display:flex;justify-content:flex-end;margin-top:14px">
          <button onClick={onDismiss} autofocus>
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}

export function updatePill(video: HTMLVideoElement, r: PeopleResult, fps: number): void {
  let e = entries.get(video);
  if (!e) {
    e = { pill: createShadowUI(), dismissed: false };
    entries.set(video, e);
  }
  live.add(video);
  anchor(video, e.pill);
  e.pill.mount(<Pill r={r} fps={fps} />);
  if (r.sustainedRed && !e.dismissed && !e.modal) {
    const modal = (e.modal = createShadowUI());
    modal.place({ left: '0px', top: '0px' });
    modal.mount(
      <CircuitBreaker
        onDismiss={() => {
          e!.dismissed = true; // silenced for the rest of this call
          modal.destroy();
          e!.modal = undefined;
        }}
      />,
    );
  }
}

export function removePill(video: HTMLVideoElement): void {
  const e = entries.get(video);
  e?.pill.destroy();
  e?.modal?.destroy();
  entries.delete(video);
  live.delete(video);
}
