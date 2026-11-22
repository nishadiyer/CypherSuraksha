import type { PeopleResult } from '../../types/shield';
import { createShadowUI, type ShadowUI } from './shadowHost';

const COLORS = { GREEN: 'bg-emerald-600', YELLOW: 'bg-amber-500', RED: 'bg-red-600' } as const;
const NEUTRAL = 'bg-slate-400';

function label(r: PeopleResult): string {
  if (r.backend === 'unavailable') return 'Unverified — detector not installed';
  if (r.status === 'no-face') return 'No face in view — nothing to check';
  if (r.level === 'GREEN') return 'No sign of AI-generated video found (this does not prove the caller is real)';
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
  return (
    <div
      role="status"
      title={`${label(r)} · ${(r.smoothed * 100).toFixed(0)}% · ${r.backend} · ${fps.toFixed(1)} fps`}
      class="flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white shadow font-sans"
    >
      <span class={`inline-block h-2.5 w-2.5 rounded-full ${r.status === 'no-face' ? NEUTRAL : COLORS[r.level]}`} />
      <span>{r.status === 'no-face' ? 'No face' : r.level === 'GREEN' ? 'No fake found' : r.level === 'YELLOW' ? 'Unsure' : 'Fake?'}</span>
    </div>
  );
}

function CircuitBreaker({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div class="fixed inset-0 flex items-center justify-center bg-black/60 font-sans" style="width:100vw;height:100vh">
      <div role="alertdialog" aria-modal="true" aria-labelledby="cb-t" class="max-w-md rounded-xl bg-white p-6 text-slate-900 shadow-2xl">
        <h2 id="cb-t" class="mb-2 text-lg font-bold text-red-700">⚠️ This video may be AI-generated</h2>
        <p class="mb-3 text-sm">
          Our on-device check has repeatedly flagged this person's video as synthetic. Do <b>not</b> send money, gift cards, passwords or
          verification codes, and do not share personal details.
        </p>
        <p class="mb-4 text-sm">Hang up and call them back on a number you already know, or ask a question only the real person could answer.</p>
        <div class="flex justify-end gap-2">
          <button class="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white" onClick={onDismiss} autofocus>
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
