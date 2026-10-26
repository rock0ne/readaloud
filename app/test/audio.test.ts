// The <audio> output: taking the audio focus before a clip that does not follow on, and no stall
// while the phone has paused a clip (ADR-39).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEFORE_START_WAIT_MS, FOLLOW_ON_MS, HtmlAudioOutput, STALL_GRACE_MS } from '../src/ui/audio';

const elOf = (out: HtmlAudioOutput) => (out as unknown as { el: HTMLAudioElement }).el;
const clip = () => new Blob([new Uint8Array(4)], { type: 'audio/wav' });

describe('HtmlAudioOutput', () => {
  let plays: number;
  beforeEach(() => {
    vi.useFakeTimers();
    plays = 0;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => void plays++);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => 'blob:clip');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('takes the focus before the first clip and after a gap, not for a clip that follows on', async () => {
    let t = 0;
    const order: string[] = [];
    const out = new HtmlAudioOutput({ beforeStart: async () => void order.push('focus'), now: () => t });
    const el = elOf(out);
    const playNext = async () => {
      const p = out.play(clip(), 1, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(0);
      order.push(`play${plays}`);
      el.dispatchEvent(new Event('ended'));
      await p;
    };
    await playNext();
    t += FOLLOW_ON_MS - 100;
    await playNext();
    t += FOLLOW_ON_MS + 100;
    await playNext();
    expect(order).toEqual(['focus', 'play1', 'play2', 'focus', 'play3']);
  });

  it('plays anyway when taking the focus is slow or refused', async () => {
    const slow = new HtmlAudioOutput({ beforeStart: () => new Promise(() => undefined) });
    void slow.play(clip(), 1, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(BEFORE_START_WAIT_MS - 1);
    expect(plays).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(plays).toBe(1);
    const refused = new HtmlAudioOutput({ beforeStart: () => Promise.reject(new Error('no')) });
    void refused.play(clip(), 1, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(plays).toBe(2);
  });

  it('does not count a clip the phone has paused as stalled, and finishes when it plays on', async () => {
    const out = new HtmlAudioOutput();
    const el = elOf(out);
    Object.defineProperty(el, 'duration', { value: 2, configurable: true });
    let settled = '';
    const p = out.play(clip(), 1, new AbortController().signal).then(
      () => void (settled = 'ended'),
      (e: Error) => void (settled = e.message),
    );
    await vi.advanceTimersByTimeAsync(0);
    el.dispatchEvent(new Event('loadedmetadata'));
    el.dispatchEvent(new Event('pause'));
    await vi.advanceTimersByTimeAsync(2000 + STALL_GRACE_MS + 60_000);
    expect(settled).toBe('');
    el.dispatchEvent(new Event('playing'));
    el.dispatchEvent(new Event('ended'));
    await p;
    expect(settled).toBe('ended');
  });

  it('still counts a clip that plays but never ends as stalled', async () => {
    const out = new HtmlAudioOutput();
    const el = elOf(out);
    Object.defineProperty(el, 'duration', { value: 2, configurable: true });
    const p = out.play(clip(), 1, new AbortController().signal);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(0);
    el.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(2000 + STALL_GRACE_MS);
    expect(await caught).toBe('Audio did not finish playing.');
  });
});
