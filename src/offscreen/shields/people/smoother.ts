export type Level = 'GREEN' | 'YELLOW' | 'RED';

export const WINDOW = 5;
export const YELLOW_T = 0.4;
export const RED_T = 0.7;
/** Hysteresis: a level is only left once the mean falls this far below its entry line, so a score hovering at a line does not flicker. */
export const YELLOW_EXIT = 0.3;
export const RED_EXIT = 0.6;
/** consecutive RED evaluations (with a full window) before the circuit breaker trips */
export const SUSTAIN = 3;

export interface Smoothed {
  smoothed: number;
  level: Level;
  filled: boolean;
  sustainedRed: boolean;
}

/** Rolling mean over the last WINDOW frame scores so one noisy frame never flips the pill. */
export class TemporalSmoother {
  private scores: number[] = [];
  private redStreak = 0;
  private level: Level = 'GREEN';
  lastSeen = Date.now();

  push(score: number): Smoothed {
    this.lastSeen = Date.now();
    this.scores.push(Math.min(1, Math.max(0, score)));
    if (this.scores.length > WINDOW) this.scores.shift();
    const filled = this.scores.length === WINDOW;
    const smoothed = this.scores.reduce((a, b) => a + b, 0) / this.scores.length;
    // Until the window is full, never report RED: we do not have enough evidence.
    const prev = this.level;
    const level: Level =
      filled && (smoothed >= RED_T || (prev === 'RED' && smoothed >= RED_EXIT))
        ? 'RED'
        : smoothed >= YELLOW_T || (prev !== 'GREEN' && smoothed >= YELLOW_EXIT)
          ? 'YELLOW'
          : 'GREEN';
    this.level = level;
    this.redStreak = level === 'RED' ? this.redStreak + 1 : 0;
    return { smoothed, level, filled, sustainedRed: this.redStreak >= SUSTAIN };
  }

  reset(): void {
    this.scores = [];
    this.redStreak = 0;
    this.level = 'GREEN';
  }
}
