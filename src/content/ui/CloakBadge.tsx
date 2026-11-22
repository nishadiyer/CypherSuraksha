import type { Anchor } from '../interceptors/uploadInterceptor';
import { createShadowUI, type ShadowUI } from './shadowHost';

let current: ShadowUI | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function show(anchor: Anchor, body: preact.ComponentChild, ms: number): void {
  current?.destroy();
  clearTimeout(timer);
  const ui = (current = createShadowUI());
  const x = Math.max(8, Math.min(anchor.x, innerWidth - 280));
  const y = Math.max(8, Math.min(anchor.y, innerHeight - 56));
  ui.place({ left: `${x}px`, top: `${y}px` });
  ui.mount(body);
  if (ms) timer = setTimeout(() => ui.destroy(), ms);
}

export function showCloaking(anchor: Anchor): void {
  show(anchor, <div class="rounded-full bg-slate-900 px-3 py-1.5 text-xs text-white shadow-lg font-sans">🛡️ Cloaking photo…</div>, 0);
}

export function showCloakResult(anchor: Anchor, cloaked: number, failed: number, onBypass: () => void): void {
  const ok = failed === 0;
  show(
    anchor,
    <div
      role="status"
      class={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-white shadow-lg font-sans ${ok ? 'bg-emerald-700' : 'bg-amber-700'}`}
    >
      <span>{ok ? `🛡️ Cloaked${cloaked > 1 ? ` (${cloaked})` : ''}` : `⚠️ ${failed} photo${failed > 1 ? 's' : ''} not uploaded`}</span>
      <button class="underline underline-offset-2 hover:no-underline" onClick={() => { onBypass(); current?.destroy(); }}>
        Bypass on this site
      </button>
    </div>,
    9000,
  );
}
