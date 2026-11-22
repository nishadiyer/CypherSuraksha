const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

let creating: Promise<void> | null = null;

async function exists(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

/**
 * Singleton guard. Concurrent callers share one in-flight createDocument()
 * promise, so N tabs requesting inference at once produce exactly one document.
 */
export async function ensureOffscreen(): Promise<void> {
  if (creating) return creating;
  if (await exists()) return;
  // Re-check after the await: another caller may have started creating meanwhile.
  if (creating) return creating;
  creating = chrome.offscreen
    .createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_PATH),
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run on-device ONNX inference for privacy, image and video shields.',
    })
    .catch(async (err: unknown) => {
      // Lost a race with another context; fine if a document now exists.
      if (!(await exists())) throw err;
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}
