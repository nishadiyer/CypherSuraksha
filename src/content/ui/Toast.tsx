import { createShadowUI } from './shadowHost';

/** Short-lived toast rendered inside a closed shadow root. */
export function showToast(message: string, ms = 4000): void {
  const ui = createShadowUI();
  ui.place({ right: '16px', bottom: '16px', top: 'auto', left: 'auto' });
  ui.mount(
    <div role="status" class="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg font-sans">
      🛡️ {message}
    </div>,
  );
  setTimeout(() => ui.destroy(), ms);
}
