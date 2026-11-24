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

/** Longest side of the frame sent for analysis. The whole frame goes (aspect kept) so the offscreen worker can find and crop the face. */
const FRAME_MAX_SIDE = 640;
const MIN_W = 160;
const MIN_H = 120;
const MAX_TRACKED = 4;

/** Grab one frame (aspect preserved, longest side <= FRAME_MAX_SIDE) onto an OffscreenCanvas; returns base64 RGBA, then zeroes and frees buffers. */
export function grabFrame(video: HTMLVideoElement, maxSide = FRAME_MAX_SIDE): { b64: string; width: number; height: number } | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, width, height);
    const img = ctx.getImageData(0, 0, width, height); // throws SecurityError for tainted (cross-origin) video
    const b64 = bytesToB64(new Uint8Array(img.data.buffer));
    img.data.fill(0);
    return { b64, width, height };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

const eligible = (v: HTMLVideoElement): boolean =>
  !v.paused && !v.ended && v.readyState >= 2 && v.videoWidth >= MIN_W && v.videoHeight >= MIN_H && v.clientWidth >= MIN_W && v.clientHeight >= MIN_H;

/** What the popup shows about video tracking (counts and sizes only). */
export const videoStats: { eligible: number; skippedDuplicates: number; tracked: Array<{ w: number; h: number; source: string }> } = { eligible: 0, skippedDuplicates: 0, tracked: [] };

/**
 * Identifies the source behind a video so the same camera shown in several elements (for example a call's main tile plus a
 * thumbnail) is analysed once. A local camera is identified by its device id (clones of one camera share it); any other
 * stream by its track id. `key` is null when the source cannot be told (no MediaStream).
 */
export function sourceOf(v: HTMLVideoElement): { key: string | null; kind: 'local-camera' | 'stream' | 'unknown' } {
  const so = v.srcObject as MediaStream | null;
  const track = so && typeof so.getVideoTracks === 'function' ? so.getVideoTracks()[0] : undefined;
  if (!track) return { key: null, kind: 'unknown' };
  const deviceId = typeof track.getSettings === 'function' ? track.getSettings().deviceId : undefined;
  return deviceId ? { key: `local:${deviceId}`, kind: 'local-camera' } : { key: `track:${track.id}`, kind: 'stream' };
}

/** One video per source, largest first (input must already be sorted by size, descending). Unknown sources are all kept. */
export function chooseVideos(videos: HTMLVideoElement[], describe: (v: HTMLVideoElement) => { key: string | null } = sourceOf): HTMLVideoElement[] {
  const seen = new Set<string>();
  const out: HTMLVideoElement[] = [];
  for (const v of videos) {
    const { key } = describe(v);
    if (key !== null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(v);
  }
  return out;
}

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
              if (r.status !== 'no-face') sampler.setBackend(r.backend); // a no-face reply says nothing about the backend
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
    const eligibleVideos = [...doc.querySelectorAll('video')].filter(eligible).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    const chosen = chooseVideos(eligibleVideos);
    // a duplicate of an already-tracked source (a second element showing the same camera) loses its pill
    for (const [v, t] of [...tracked]) if (eligibleVideos.includes(v) && !chosen.includes(v)) t.stop();
    for (const v of chosen) track(v);
    videoStats.eligible = eligibleVideos.length;
    videoStats.skippedDuplicates = eligibleVideos.length - chosen.length;
    videoStats.tracked = [...tracked.keys()].map((v) => ({ w: v.clientWidth, h: v.clientHeight, source: sourceOf(v).kind }));
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
