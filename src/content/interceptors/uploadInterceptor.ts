export interface UploadDeps {
  /** Resolve to the cloaked file; reject/return null when it could not be cloaked. */
  cloak(file: File): Promise<File | null>;
  onProcessing(anchor: Anchor): void;
  onResult(anchor: Anchor, cloaked: number, failed: number): void;
}

export interface Anchor {
  x: number;
  y: number;
}

const isImage = (f: File): boolean => f.type.startsWith('image/');

function anchorForInput(input: HTMLInputElement): Anchor {
  const r = (input.closest('form, label, [role="dialog"], div') ?? input).getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.bottom + 4 } : { x: 16, y: Math.max(16, innerHeight - 64) };
}

async function cloakAll(files: File[], deps: UploadDeps): Promise<{ out: File[]; cloaked: number; failed: number }> {
  let cloaked = 0;
  let failed = 0;
  const out: File[] = [];
  const results = await Promise.all(
    files.map(async (f) => {
      if (!isImage(f)) return f;
      try {
        return await deps.cloak(f);
      } catch {
        return null;
      }
    }),
  );
  results.forEach((r, i) => {
    if (!r) failed++; // fail closed: an image that could not be cloaked is not forwarded
    else {
      out.push(r);
      if (isImage(files[i]!)) cloaked++;
    }
  });
  return { out, cloaked, failed };
}

/**
 * Intercepts <input type=file> change/input events and drop events in capture
 * phase, swaps image files for cloaked copies via a fresh DataTransfer, then
 * re-dispatches the event so the page sees only the protected files.
 */
export function installUploadInterceptor(win: Window, deps: UploadDeps): () => void {
  let passthrough = false;
  const pending = new WeakSet<HTMLInputElement>();

  const redispatch = (fn: () => void): void => {
    passthrough = true;
    try {
      fn();
    } finally {
      passthrough = false;
    }
  };

  const onInputEvent = (e: Event): void => {
    const input = e.target;
    if (passthrough || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
    const files = Array.from(input.files ?? []);
    if (!files.some(isImage)) return;
    e.stopImmediatePropagation(); // page must not see the original image
    if (pending.has(input)) return; // second of input+change; already being handled
    pending.add(input);
    const anchor = anchorForInput(input);
    deps.onProcessing(anchor);
    void cloakAll(files, deps).then(({ out, cloaked, failed }) => {
      pending.delete(input);
      const dt = new DataTransfer();
      out.forEach((f) => dt.items.add(f));
      input.files = dt.files;
      deps.onResult(anchor, cloaked, failed);
      if (out.length === 0) return; // nothing safe to forward
      redispatch(() => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  };

  const onDrop = (e: DragEvent): void => {
    if (passthrough || !e.dataTransfer) return;
    const files = Array.from(e.dataTransfer.files);
    if (!files.some(isImage)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = e.target;
    const anchor = { x: e.clientX, y: e.clientY };
    deps.onProcessing(anchor);
    void cloakAll(files, deps).then(({ out, cloaked, failed }) => {
      deps.onResult(anchor, cloaked, failed);
      if (out.length === 0 || !(target instanceof EventTarget)) return;
      const dt = new DataTransfer();
      out.forEach((f) => dt.items.add(f));
      if (target instanceof HTMLInputElement && target.type === 'file') {
        target.files = dt.files;
        redispatch(() => {
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        });
        return;
      }
      redispatch(() =>
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: anchor.x, clientY: anchor.y })),
      );
    });
  };

  win.addEventListener('change', onInputEvent, true);
  win.addEventListener('input', onInputEvent, true);
  win.addEventListener('drop', onDrop, true);
  return () => {
    win.removeEventListener('change', onInputEvent, true);
    win.removeEventListener('input', onInputEvent, true);
    win.removeEventListener('drop', onDrop, true);
  };
}
