import { describe, expect, it } from 'vitest';
import { AdaptiveSampler, LATENCY_BUDGET_MS, MAX_FPS, MIN_FPS, WASM_FPS_CAP } from '../src/content/interceptors/videoInterceptor';
import { RED_T, SUSTAIN, TemporalSmoother, WINDOW } from '../src/offscreen/shields/people/smoother';
import { toScore } from '../src/offscreen/shields/people/classifier';

describe('temporal smoothing (5-frame rolling window)', () => {
  it('a single spike never flips the pill, and RED needs a full window', () => {
    const s = new TemporalSmoother();
    const levels = [0.05, 0.05, 0.05, 0.05, 0.05, 1.0].map((x) => s.push(x).level);
    expect(levels).toEqual(['GREEN', 'GREEN', 'GREEN', 'GREEN', 'GREEN', 'GREEN']); // mean = 0.2
  });
  it('does not report RED before the window is full, even for all-1.0 frames', () => {
    const s = new TemporalSmoother();
    const r = [1, 1, 1, 1].map((x) => s.push(x));
    expect(r.every((x) => x.level !== 'RED' && !x.sustainedRed)).toBe(true);
    expect(s.push(1).level).toBe('RED');
  });
  it('trips the circuit breaker only after SUSTAIN consecutive RED evaluations, and clears when scores fall', () => {
    const s = new TemporalSmoother();
    // first RED evaluation is push #WINDOW (window full); SUSTAIN consecutive REDs => push #(WINDOW+SUSTAIN-1)
    const out = Array.from({ length: WINDOW + SUSTAIN - 1 }, () => s.push(0.95));
    expect(out.slice(0, -1).some((x) => x.sustainedRed)).toBe(false);
    expect(out.at(-1)!.sustainedRed).toBe(true);
    expect(out.at(-1)!.smoothed).toBeGreaterThanOrEqual(RED_T);
    for (let i = 0; i < WINDOW; i++) s.push(0);
    expect(s.push(0)).toMatchObject({ level: 'GREEN', sustainedRed: false });
  });
  it('hysteresis: a mean hovering at the amber line does not flicker between GREEN and YELLOW', () => {
    const s = new TemporalSmoother();
    for (let i = 0; i < WINDOW; i++) s.push(0.45); // YELLOW
    const levels = [0.3, 0.38, 0.33, 0.37, 0.34, 0.36].map((x) => s.push(x).level);
    expect(new Set(levels)).toEqual(new Set(['YELLOW'])); // mean stays 0.3-0.4, above the 0.3 exit line
    for (let i = 0; i < WINDOW; i++) s.push(0.1);
    expect(s.push(0.1).level).toBe('GREEN');
  });
  it('sigmoid / prob / softmax2 output decoding', () => {
    expect(toScore(new Float32Array([0]), 'sigmoid')).toBeCloseTo(0.5);
    expect(toScore(new Float32Array([0.9]), 'prob')).toBeCloseTo(0.9);
    expect(toScore(new Float32Array([0, 5]), 'softmax2')).toBeGreaterThan(0.99);
  });
});

describe('one pill per video source', () => {
  const v = (id: string) => ({ id }) as unknown as HTMLVideoElement;
  it('keeps one video per source (the largest, since input is size-sorted) and every video of unknown source', async () => {
    const { chooseVideos } = await import('../src/content/interceptors/videoInterceptor');
    const keys: Record<string, string | null> = { big: 'local:cam1', thumb: 'local:cam1', remote: 'track:abc', blob1: null, blob2: null };
    const chosen = chooseVideos([v('big'), v('remote'), v('thumb'), v('blob1'), v('blob2')], (x) => ({ key: keys[(x as unknown as { id: string }).id] ?? null }));
    expect(chosen.map((c) => (c as unknown as { id: string }).id)).toEqual(['big', 'remote', 'blob1', 'blob2']);
  });
  it('returns nothing for no videos', async () => {
    const { chooseVideos } = await import('../src/content/interceptors/videoInterceptor');
    expect(chooseVideos([])).toEqual([]);
  });
});

describe('face-swap detector cap', () => {
  it('is below the red line, so the detector alone can never turn the pill red or trip the circuit breaker', async () => {
    const { GEND_CAP } = await import('../src/offscreen/shields/people/gend');
    expect(GEND_CAP).toBeLessThan(RED_T);
    const s = new TemporalSmoother();
    let last = s.push(0);
    for (let i = 0; i < 30; i++) last = s.push(Math.max(0, Math.min(1, Math.min(0.93, GEND_CAP)))); // detector at 93%, main model at 0%
    expect(last.level).toBe('YELLOW');
    expect(last.sustainedRed).toBe(false);
  });
});

describe('adaptive frame sampling (Gate 4: throttling)', () => {
  it('starts at 2 FPS on WebGPU and halves each time latency exceeds 150 ms, down to the floor', () => {
    const a = new AdaptiveSampler(0);
    a.setBackend('webgpu');
    expect(a.fps).toBe(MAX_FPS);
    expect(a.record(LATENCY_BUDGET_MS + 1)).toBe(1);
    expect(a.record(400)).toBe(MIN_FPS);
    expect(a.record(900)).toBe(MIN_FPS);
    expect(a.intervalMs).toBe(2000);
  });
  it('caps at 1 FPS when WebGPU is unavailable (wasm backend)', () => {
    const a = new AdaptiveSampler(0);
    a.setBackend('wasm');
    expect(a.fps).toBe(WASM_FPS_CAP);
    for (let i = 0; i < 50; i++) a.record(10);
    expect(a.fps).toBe(WASM_FPS_CAP);
  });
  it('recovers gradually after sustained fast responses, never above the cap', () => {
    const a = new AdaptiveSampler(0);
    a.setBackend('webgpu');
    a.record(500);
    a.record(500);
    expect(a.fps).toBe(MIN_FPS);
    for (let i = 0; i < 4; i++) a.record(20);
    expect(a.fps).toBe(1);
    for (let i = 0; i < 100; i++) a.record(20);
    expect(a.fps).toBe(MAX_FPS);
  });
  it('ignores the first warm-up samples (model load) when judging latency', () => {
    const a = new AdaptiveSampler(2);
    a.setBackend('webgpu');
    a.record(2500);
    a.record(900);
    expect(a.fps).toBe(MAX_FPS);
    a.record(900);
    expect(a.fps).toBe(1);
  });
  it('a lone fast sample between slow ones does not restore speed', () => {
    const a = new AdaptiveSampler(0);
    a.setBackend('webgpu');
    a.record(300);
    a.record(10);
    a.record(300);
    expect(a.fps).toBe(MIN_FPS);
  });
});
