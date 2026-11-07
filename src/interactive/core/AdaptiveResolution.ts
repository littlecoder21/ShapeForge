/* Keeps the shader smooth by trading resolution (then shader effort) for frame time — and gives it back.
 *
 * The previous logic only ever stepped down: after 18 slow frames it scaled the canvas by 0.8 and never recovered, and
 * "slow" was a fixed 20 ms, so a 30 Hz or 50 Hz display looked permanently slow. This controller:
 *   · judges slowness against the display's own frame interval (the fastest frames it has seen, never below 1/240 s),
 *   · after every step down, checks that frames really got faster; if they did not, the display (not the GPU) is the
 *     limit, so it undoes the step and accepts that frame time as normal,
 *   · steps resolution down first, then lowers shader effort (the renderer maps `effort` to fewer noise octaves),
 *   · recovers gradually once frames have been healthy for a while, effort first, then resolution,
 *   · backs off when a recovery is soon followed by another slowdown, so it cannot oscillate.
 * It is pure logic (no DOM, no GL): feed it frame durations, apply the `scale` / `effort` it reports. */

export interface AdaptiveOptions {
  /** frames slower than this are always slow, even if the display is fast (seconds) */
  slowSeconds: number;
  /** consecutive slow frames before stepping down (also the length of the check after a step) */
  slowFrames: number;
  downStep: number;
  upStep: number;
  minScale: number;
  maxEffort: number;
  /** healthy frames before stepping back up (multiplied by the back-off) */
  recoverFrames: number;
  /** a step down must cut the frame time to at most this fraction of before, or it is undone */
  requiredSpeedup: number;
  /** steps that shrink the resolution by less than this fraction are too small to judge, so they are never undone */
  minJudgedStep: number;
}

export interface AdaptiveChange {
  scale: number;
  effort: number;
  reason: 'slow' | 'recovered';
}

export const DEFAULT_ADAPTIVE: Readonly<AdaptiveOptions> = Object.freeze({
  slowSeconds: 0.02,
  slowFrames: 18,
  downStep: 0.8,
  upStep: 1.12,
  minScale: 0.5,
  maxEffort: 2,
  recoverFrames: 150,
  requiredSpeedup: 0.95,
  minJudgedStep: 0.1,
});

/** Common display / frame-cap rates. A frame time that sits on one of these is the display talking, not the GPU. */
const DISPLAY_RATES = [20, 24, 25, 30, 40, 48, 50];
const isDisplayInterval = (seconds: number) => DISPLAY_RATES.some(rate => Math.abs(seconds * rate - 1) < 0.1);

export class AdaptiveResolution {
  /** 1 = full resolution */
  scale = 1;
  /** 0 = full shader effort; each level removes a noise octave */
  effort = 0;

  private readonly options: AdaptiveOptions;
  private average = 0;
  private refresh = 1 / 60;
  private slowCount = 0;
  private goodCount = 0;
  private backoff = 1;
  private sinceRecovery = Infinity;
  /** set right after a step down: what it was before, so it can be judged (and undone) */
  private probe: { scale: number; effort: number; average: number; frames: number } | null = null;
  /** frames during which stepping down is paused because the last step did not help */
  private cooldown = 0;

  constructor(options: Partial<AdaptiveOptions> = {}) {
    this.options = { ...DEFAULT_ADAPTIVE, ...options };
  }

  /** Feed one frame's duration in seconds. Returns a change to apply, or null. */
  update(frameSeconds: number): AdaptiveChange | null {
    // a hidden tab or a debugger pause is not a performance problem
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds > 0.25) return null;
    const o = this.options;
    this.average = this.average ? this.average * 0.9 + frameSeconds * 0.1 : frameSeconds;
    this.refresh = Math.max(1 / 240, Math.min(this.refresh, frameSeconds));
    if (this.sinceRecovery !== Infinity) this.sinceRecovery += 1;
    if (this.cooldown > 0) this.cooldown -= 1;

    if (this.probe) {
      this.probe.frames += 1;
      if (this.probe.frames >= o.slowFrames) {
        const before = this.probe;
        this.probe = null;
        if (this.average > before.average * o.requiredSpeedup) {
          // lowering the quality did not make frames faster, so it was pointless: undo it. If the frame time is a
          // standard display rate the display is the limit and that is simply normal; otherwise pause stepping down.
          if (isDisplayInterval(this.average)) this.refresh = Math.max(this.refresh, this.average);
          else this.cooldown = 600;
          this.scale = before.scale;
          this.effort = before.effort;
          this.slowCount = 0;
          this.goodCount = 0;
          this.average = 0;
          return { scale: this.scale, effort: this.effort, reason: 'recovered' };
        }
      }
    }

    const slowAt = Math.max(o.slowSeconds, this.refresh * 1.45);
    const goodAt = Math.max(o.slowSeconds * 0.85, this.refresh * 1.2);
    if (this.average > slowAt) {
      this.slowCount += 1;
      this.goodCount = 0;
    } else {
      this.slowCount = 0;
      this.goodCount = this.average <= goodAt ? this.goodCount + 1 : 0;
    }

    if (this.slowCount >= o.slowFrames && this.cooldown > 0) this.slowCount = 0;
    if (this.slowCount >= o.slowFrames) {
      this.slowCount = 0;
      // slow again soon after recovering: wait longer before trying again
      if (this.sinceRecovery < o.recoverFrames * 2) this.backoff = Math.min(this.backoff * 2, 8);
      this.sinceRecovery = Infinity;
      const before = { scale: this.scale, effort: this.effort, average: this.average, frames: 0 };
      this.average = 0;
      if (this.scale > o.minScale + 1e-6) {
        this.scale = Math.max(o.minScale, this.scale * o.downStep);
        if (this.scale < before.scale * (1 - o.minJudgedStep)) this.probe = before;
        return { scale: this.scale, effort: this.effort, reason: 'slow' };
      }
      if (this.effort < o.maxEffort) {
        this.effort += 1;
        this.probe = before;
        return { scale: this.scale, effort: this.effort, reason: 'slow' };
      }
      return null;
    }

    if ((this.scale < 1 || this.effort > 0) && this.goodCount >= o.recoverFrames * this.backoff) {
      this.goodCount = 0;
      this.average = 0;
      this.sinceRecovery = 0;
      if (this.effort > 0) this.effort -= 1;
      else this.scale = Math.min(1, this.scale * o.upStep);
      return { scale: this.scale, effort: this.effort, reason: 'recovered' };
    }

    if (this.scale === 1 && this.effort === 0 && this.goodCount > o.recoverFrames * 4) this.backoff = 1;
    return null;
  }

  /** The lowest scale allowed (the renderer derives it from an absolute render-scale floor). */
  setMinScale(value: number): void {
    this.options.minScale = Math.min(1, Math.max(0.2, value));
    if (this.scale < this.options.minScale) this.scale = this.options.minScale;
  }

  reset(): void {
    this.scale = 1;
    this.effort = 0;
    this.average = 0;
    this.slowCount = 0;
    this.goodCount = 0;
    this.backoff = 1;
    this.sinceRecovery = Infinity;
    this.probe = null;
    this.cooldown = 0;
  }
}
