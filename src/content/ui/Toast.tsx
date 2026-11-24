import { Mark } from './Brand';
import { createShadowUI } from './shadowHost';

/** Short-lived toast rendered inside a closed shadow root. */
export function showToast(message: string, ms = 6000): void {
  const ui = createShadowUI();
  ui.place({ right: '16px', bottom: '16px', top: 'auto', left: 'auto' });
  ui.mount(
    <div role="status" class="cs-wrap cs-toast">
      <Mark />
      <span>{message}</span>
    </div>,
  );
  setTimeout(() => ui.destroy(), ms);
}
