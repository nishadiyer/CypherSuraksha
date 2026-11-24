import type { Anchor } from '../interceptors/uploadInterceptor';
import { Mark } from './Brand';
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
  show(
    anchor,
    <div class="cs-wrap cs-badge" role="status">
      <span class="cs-spin"><Mark /></span>
      <span>Cloaking photo…</span>
    </div>,
    0,
  );
}

export function showCloakResult(anchor: Anchor, cloaked: number, failed: number, noFace: number, onBypass: () => void): void {
  const ok = failed === 0;
  const text = !ok
    ? `${failed} photo${failed > 1 ? 's' : ''} not uploaded`
    : cloaked === 0 && noFace > 0
      ? 'No face found — location data removed'
      : `Cloaked${cloaked > 1 ? ` (${cloaked})` : ''}${noFace > 0 ? `, ${noFace} had no face` : ''}`;
  show(
    anchor,
    <div role="status" class={`cs-wrap cs-badge ${ok ? 'ok' : 'bad'}`}>
      <Mark />
      <span>{ok ? '✓ ' : '⚠ '}{text}</span>
      <button class="cs-link" onClick={() => { onBypass(); current?.destroy(); }}>
        Bypass on this site
      </button>
    </div>,
    9000,
  );
}
