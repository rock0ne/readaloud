// Plays audio-engine clips through one reused <audio> element (spec 8.2). Reusing it keeps the
// phone's media session alive between sentences.
import type { AudioOutput } from '../core/player/player';

/** Extra time a clip may take beyond its length before it counts as stalled (ADR-14). */
export const STALL_GRACE_MS = 5000;
/** A clip that starts this soon after the last one ended follows straight on from it (ADR-39). */
export const FOLLOW_ON_MS = 1500;
/** The longest wait for `beforeStart` before the clip plays anyway (ADR-39). */
export const BEFORE_START_WAIT_MS = 300;

export interface HtmlAudioOptions {
  /**
   * Runs before a clip that does not follow straight on from the last one: the first after Play,
   * after a pause or after a long wait. The Android app takes the audio focus here (ADR-39).
   */
  beforeStart?: () => Promise<unknown>;
  now?: () => number;
}

export class HtmlAudioOutput implements AudioOutput {
  private readonly el: HTMLAudioElement;
  private readonly beforeStart?: () => Promise<unknown>;
  private readonly now: () => number;
  private rearm: (() => void) | null = null;
  private lastEnded = -Infinity;

  constructor(options: HtmlAudioOptions = {}) {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.beforeStart = options.beforeStart;
    this.now = options.now ?? (() => Date.now());
  }

  setRate(rate: number): void {
    this.el.defaultPlaybackRate = rate;
    this.el.playbackRate = rate;
    this.rearm?.();
  }

  async play(blob: Blob, rate: number, signal: AbortSignal, onProgress?: (fraction: number) => void): Promise<void> {
    if (this.beforeStart && this.now() - this.lastEnded > FOLLOW_ON_MS) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, BEFORE_START_WAIT_MS)));
      // A refusal or a slow answer never keeps the reading waiting.
      await Promise.race([this.beforeStart().catch(() => undefined), waited]);
      clearTimeout(timer);
    }
    return this.playClip(blob, rate, signal, onProgress);
  }

  private playClip(blob: Blob, rate: number, signal: AbortSignal, onProgress?: (fraction: number) => void): Promise<void> {
    const el = this.el;
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) return resolve();
      const url = URL.createObjectURL(blob);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let done = false;
      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('error', onError);
        el.removeEventListener('loadedmetadata', arm);
        el.removeEventListener('playing', arm);
        el.removeEventListener('pause', onPause);
        el.removeEventListener('timeupdate', onTime);
        signal.removeEventListener('abort', onAbort);
        this.rearm = null;
        URL.revokeObjectURL(url);
        if (err) reject(err);
        else resolve();
      };
      // The watchdog follows the clip's real remaining length at the current speed.
      function arm() {
        clearTimeout(timer);
        const ms = ((el.duration - el.currentTime) / el.playbackRate) * 1000 + STALL_GRACE_MS;
        if (Number.isFinite(ms)) {
          timer = setTimeout(() => {
            el.pause();
            finish(new Error('Audio did not finish playing.'));
          }, ms);
        }
      }
      // Paused by the phone (a call, or another player taking the audio): not a stall. The
      // watchdog starts again when the clip plays on.
      const onPause = () => clearTimeout(timer);
      const onTime = () => {
        if (el.duration > 0) onProgress?.(el.currentTime / el.duration);
      };
      const onEnded = () => {
        this.lastEnded = this.now();
        finish();
      };
      const onError = () => finish(new Error(`Audio could not play (${el.error?.message || `code ${el.error?.code ?? '?'}`}).`));
      const onAbort = () => {
        el.pause();
        finish();
      };
      el.addEventListener('ended', onEnded);
      el.addEventListener('error', onError);
      el.addEventListener('loadedmetadata', arm);
      el.addEventListener('playing', arm);
      el.addEventListener('pause', onPause);
      el.addEventListener('timeupdate', onTime);
      signal.addEventListener('abort', onAbort);
      this.rearm = arm;
      el.src = url;
      // Loading a new source resets playbackRate to the default, so set both.
      el.defaultPlaybackRate = rate;
      el.playbackRate = rate;
      el.preservesPitch = true;
      el.play().catch((e: unknown) => {
        if (!done && !signal.aborted) finish(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }
}
