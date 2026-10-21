// Plays audio-engine clips through one reused <audio> element (spec 8.2). Reusing it keeps the
// phone's media session alive between sentences.
import type { AudioOutput } from '../core/player/player';

/** Extra time a clip may take beyond its length before it counts as stalled (ADR-14). */
export const STALL_GRACE_MS = 5000;

export class HtmlAudioOutput implements AudioOutput {
  private readonly el: HTMLAudioElement;
  private rearm: (() => void) | null = null;

  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
  }

  setRate(rate: number): void {
    this.el.defaultPlaybackRate = rate;
    this.el.playbackRate = rate;
    this.rearm?.();
  }

  play(blob: Blob, rate: number, signal: AbortSignal, onProgress?: (fraction: number) => void): Promise<void> {
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
      const onTime = () => {
        if (el.duration > 0) onProgress?.(el.currentTime / el.duration);
      };
      const onEnded = () => finish();
      const onError = () => finish(new Error(`Audio could not play (${el.error?.message || `code ${el.error?.code ?? '?'}`}).`));
      const onAbort = () => {
        el.pause();
        finish();
      };
      el.addEventListener('ended', onEnded);
      el.addEventListener('error', onError);
      el.addEventListener('loadedmetadata', arm);
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
