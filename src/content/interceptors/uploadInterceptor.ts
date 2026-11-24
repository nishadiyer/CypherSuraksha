export interface UploadDeps {
  /** Resolve to the cloaked file; reject/return null when it could not be cloaked. */
  cloak(file: File): Promise<File | null>;
  onProcessing(anchor: Anchor): void;
  /** True when the returned file went out re-encoded but with nothing to cloak (no face found). */
  isNoFace?(file: File): boolean;
  onResult(anchor: Anchor, cloaked: number, failed: number, noFace: number): void;
}

/** Counters for the popup: how many file selections / drops this page showed us, and how many web components we looked inside. */
export const uploadStats = { selections: 0, shadowRoots: 0 };

/** The element an event really came from. Events from inside a web component are re-targeted to the component at the window. */
const realTarget = (e: Event): EventTarget | null => (typeof e.composedPath === 'function' ? (e.composedPath()[0] ?? e.target) : e.target);

export interface Anchor {
  x: number;
  y: number;
}

const isImage = (f: File): boolean => f.type.startsWith('image/');

function anchorForInput(input: HTMLInputElement): Anchor {
  const r = (input.closest('form, label, [role="dialog"], div') ?? input).getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.bottom + 4 } : { x: 16, y: Math.max(16, innerHeight - 64) };
}

async function cloakAll(files: File[], deps: UploadDeps): Promise<{ out: File[]; cloaked: number; failed: number; noFace: number }> {
  let cloaked = 0;
  let failed = 0;
  let noFace = 0;
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
      if (isImage(files[i]!)) {
        if (deps.isNoFace?.(r)) noFace++;
        else cloaked++;
      }
    }
  });
  return { out, cloaked, failed, noFace };
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
    const input = realTarget(e);
    if (passthrough || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
    const files = Array.from(input.files ?? []);
    if (!files.some(isImage)) return;
    e.stopImmediatePropagation(); // page must not see the original image
    if (pending.has(input)) return; // second of input+change; already being handled
    pending.add(input);
    uploadStats.selections++;
    const anchor = anchorForInput(input);
    deps.onProcessing(anchor);
    void cloakAll(files, deps).then(({ out, cloaked, failed, noFace }) => {
      pending.delete(input);
      const dt = new DataTransfer();
      out.forEach((f) => dt.items.add(f));
      input.files = dt.files;
      deps.onResult(anchor, cloaked, failed, noFace);
      if (out.length === 0) return; // nothing safe to forward
      redispatch(() => {
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
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
    uploadStats.selections++;
    const target = realTarget(e);
    const anchor = { x: e.clientX, y: e.clientY };
    deps.onProcessing(anchor);
    void cloakAll(files, deps).then(({ out, cloaked, failed, noFace }) => {
      deps.onResult(anchor, cloaked, failed, noFace);
      if (out.length === 0 || !(target instanceof EventTarget)) return;
      const dt = new DataTransfer();
      out.forEach((f) => dt.items.add(f));
      if (target instanceof HTMLInputElement && target.type === 'file') {
        target.files = dt.files;
        redispatch(() => {
          target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        });
        return;
      }
      redispatch(() =>
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: anchor.x, clientY: anchor.y })),
      );
    });
  };

  win.addEventListener('change', onInputEvent, true);
  win.addEventListener('input', onInputEvent, true);
  win.addEventListener('drop', onDrop, true);

  // `change` does not leave a web component's shadow root, and a handler inside it would receive the ORIGINAL file before
  // we cloak it. So also listen inside every open shadow root, discovering them as the page builds its components.
  const roots = new Set<ShadowRoot>();
  const observers: MutationObserver[] = [];
  const doc = win.document;
  const visit = (node: Node): void => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.shadowRoot) watch(el.shadowRoot);
    for (const d of el.querySelectorAll('*')) if (d.shadowRoot) watch(d.shadowRoot);
  };
  const watch = (root: ShadowRoot): void => {
    if (roots.has(root)) return;
    roots.add(root);
    uploadStats.shadowRoots++;
    root.addEventListener('change', onInputEvent, true);
    root.addEventListener('input', onInputEvent, true);
    root.addEventListener('drop', onDrop as EventListener, true);
    const mo = new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(visit)));
    mo.observe(root, { childList: true, subtree: true });
    observers.push(mo);
    for (const d of root.querySelectorAll('*')) if (d.shadowRoot) watch(d.shadowRoot);
  };
  const top = new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(visit)));
  const startWatching = (): void => {
    if (doc.documentElement) {
      top.observe(doc.documentElement, { childList: true, subtree: true });
      visit(doc.documentElement);
    }
  };
  startWatching();
  observers.push(top);
  return () => {
    win.removeEventListener('change', onInputEvent, true);
    win.removeEventListener('input', onInputEvent, true);
    win.removeEventListener('drop', onDrop, true);
    observers.forEach((o) => o.disconnect());
    roots.forEach((r) => {
      r.removeEventListener('change', onInputEvent, true);
      r.removeEventListener('input', onInputEvent, true);
      r.removeEventListener('drop', onDrop as EventListener, true);
    });
  };
}
