import { bytesToB64 } from '../../shared/base64';
import type { PeopleResult } from '../../types/shield';

export const MAX_FPS = 2;
export const MIN_FPS = 0.5;
export const LATENCY_BUDGET_MS = 150;
/** Without WebGPU, inference is slower, so sample less often. */
export const WASM_FPS_CAP = 1;
const RECOVER_AFTER = 4; // fast samples in a row before speeding back up
/** The first samples include model/session load, which says nothing about steady-state cost. */
const WARMUP_SAMPLES = 2;

/**
 * Adaptive frame-rate controller. Halves the rate when round-trip latency
 * exceeds the 150 ms budget (or when only WASM is available) and creeps back up
 * after a run of comfortably fast samples.
 */
export class AdaptiveSampler {
  fps = MAX_FPS;
  private fast = 0;
  private cap = MAX_FPS;
  private seen = 0;

  constructor(private readonly warmup = WARMUP_SAMPLES) {}

  setBackend(backend: string): void {
    this.cap = backend === 'webgpu' ? MAX_FPS : WASM_FPS_CAP;
    this.fps = Math.min(this.fps, this.cap);
  }

  record(latencyMs: number): number {
    if (this.seen++ < this.warmup) return this.fps;
    if (latencyMs > LATENCY_BUDGET_MS) {
      this.fast = 0;
      this.fps = Math.max(MIN_FPS, this.fps / 2);
    } else if (latencyMs < LATENCY_BUDGET_MS * 0.6) {
      if (++this.fast >= RECOVER_AFTER) {
        this.fast = 0;
        this.fps = Math.min(this.cap, this.fps + 0.5);
      }
    } else {
      this.fast = 0;
    }
    return this.fps;
  }

  get intervalMs(): number {
    return 1000 / this.fps;
  }
}

export interface FrameSender {
  (frame: { b64: string; width: number; height: number; sessionId: string }): Promise<PeopleResult | null>;
}

export interface VideoDeps {
  send: FrameSender;
  onResult(video: HTMLVideoElement, r: PeopleResult, fps: number): void;
  onCallStarted(): void;
  onVideoGone(video: HTMLVideoElement): void;
}

const SAMPLE_SIZE = 224;
const MIN_W = 160;
const MIN_H = 120;
const MAX_TRACKED = 4;

/** Grab one frame onto an OffscreenCanvas; returns base64 RGBA, then zeroes and frees buffers. */
export function grabFrame(video: HTMLVideoElement, size = SAMPLE_SIZE): { b64: string; width: number; height: number } | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size); // throws SecurityError for tainted (cross-origin) video
    const b64 = bytesToB64(new Uint8Array(img.data.buffer));
    img.data.fill(0);
    return { b64, width: size, height: size };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

const eligible = (v: HTMLVideoElement): boolean =>
  !v.paused && !v.ended && v.readyState >= 2 && v.videoWidth >= MIN_W && v.videoHeight >= MIN_H && v.clientWidth >= MIN_W && v.clientHeight >= MIN_H;

/**
 * Watches the page for playing <video> elements (WebRTC streams render into these)
 * and samples each at an adaptive 0.5-2 FPS. At most one request per video is in flight.
 */
export function installVideoSampler(win: Window, deps: VideoDeps): () => void {
  const doc = win.document;
  const tracked = new Map<HTMLVideoElement, { stop: () => void }>();
  let announced = false;
  let stopped = false;

  function track(video: HTMLVideoElement): void {
    if (tracked.has(video) || tracked.size >= MAX_TRACKED) return;
    const sessionId = crypto.randomUUID();
    const sampler = new AdaptiveSampler();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dead = false;

    const tick = async (): Promise<void> => {
      if (dead || stopped) return;
      if (!doc.contains(video)) return stop();
      let delay = sampler.intervalMs;
      if (!doc.hidden && eligible(video)) {
        try {
          const frame = grabFrame(video);
          if (frame) {
            const t0 = performance.now();
            const r = await deps.send({ ...frame, sessionId });
            const latency = performance.now() - t0;
            if (!r) delay = 5000; // shield off or site allowlisted: poll lazily
            if (r) {
              sampler.setBackend(r.backend);
              sampler.record(latency);
              if (!announced) {
                announced = true;
                deps.onCallStarted();
              }
              deps.onResult(video, r, sampler.fps);
            }
            if (r) delay = Math.max(0, sampler.intervalMs - latency); // keep the cadence honest
          }
        } catch {
          return stop(); // tainted/blocked video or extension reloaded: stop quietly
        }
      }
      timer = setTimeout(() => void tick(), delay);
    };
    const stop = (): void => {
      dead = true;
      clearTimeout(timer);
      tracked.delete(video);
      deps.onVideoGone(video);
    };
    tracked.set(video, { stop });
    void tick();
  }

  const scan = (): void => {
    const videos = [...doc.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    for (const v of videos) if (eligible(v)) track(v);
  };

  const mo = new MutationObserver(scan);
  const start = (): void => {
    mo.observe(doc.documentElement, { childList: true, subtree: true });
    scan();
  };
  doc.addEventListener('playing', (e) => e.target instanceof HTMLVideoElement && scan(), true);
  if (doc.documentElement) start();
  const poll = setInterval(scan, 3000); // streams often start without DOM mutations

  return () => {
    stopped = true;
    mo.disconnect();
    clearInterval(poll);
    tracked.forEach((t) => t.stop());
  };
}
