import { afterEach, describe, expect, it, vi } from 'vitest';
import { Player, STOPPED_MESSAGE } from '../src/core/player/player';
import { EngineRegistry } from '../src/core/engines/registry';
import { defaultSettings } from '../src/core/store/settings';
import type { PositionRecord, Settings, SpeakOptions, Voice, VoiceEngine } from '../src/core/types';
import { makeDoc, sampleBlocks } from './helpers/docs';

const VOICE: Voice = { id: 'v', engineId: 'webspeech', name: 'Natural', lang: 'en-GB', quality: 'neural', offline: false };

class FakeDirect implements VoiceEngine {
  readonly id = 'webspeech' as const;
  readonly label = 'Fake';
  readonly kind = 'direct' as const;
  readonly maxEngineRate = 2;
  spoken: string[] = [];
  rates: number[] = [];
  failures = new Map<string, number>();
  /** when set, speak() waits until released or aborted */
  hold = false;
  private release: (() => void) | null = null;

  async isAvailable() {
    return { ok: true };
  }
  async listVoices() {
    return [VOICE];
  }
  speak(text: string, opts: SpeakOptions, signal: AbortSignal): Promise<void> {
    this.spoken.push(text);
    this.rates.push(opts.rate);
    const f = this.failures.get(text) ?? 0;
    if (f > 0) {
      this.failures.set(text, f - 1);
      return Promise.reject(new Error('stalled'));
    }
    if (!this.hold) return Promise.resolve();
    return new Promise((resolve) => {
      this.release = resolve;
      signal.addEventListener('abort', () => resolve());
    });
  }
  finish() {
    this.release?.();
  }
}

function setup(over: Partial<Settings> = {}) {
  const engine = new FakeDirect();
  const saved: PositionRecord[] = [];
  const settings: Settings = { ...defaultSettings(), pauseAfterHeadingMs: 0, pauseBetweenSentencesMs: 0, ...over };
  const player = new Player({
    positions: { savePosition: async (p) => void saved.push(p) },
    registry: new EngineRegistry([engine]),
    settings: () => settings,
  });
  return { engine, player, saved, settings };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('U11 player', () => {
  afterEach(() => vi.useRealTimers());

  it('reads sentences in order, skips code blocks and ends', async () => {
    const { engine, player, saved } = setup();
    const events: string[] = [];
    player.subscribe((e) => e.type !== 'state' && events.push(e.type === 'sentence' ? e.sentenceId : e.type));
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await player.settled;
    expect(engine.spoken).toEqual(['Chapter One', 'First sentence here.', 'Second sentence here.', 'Final paragraph.']);
    expect(player.state.status).toBe('ended');
    expect(events.at(-1)).toBe('ended');
    expect(saved.at(-1)?.sentenceId).toBe('b3.s0');
  });

  it('a second Play while the voice is being chosen joins the first (ADR-23)', async () => {
    const { engine, player } = setup();
    await player.load(makeDoc(sampleBlocks));
    await Promise.all([player.play(), player.play()]);
    await player.settled;
    expect(engine.spoken).toEqual(['Chapter One', 'First sentence here.', 'Second sentence here.', 'Final paragraph.']);
  });

  it('Pause while the voice is being chosen cancels the start', async () => {
    const { engine, player } = setup();
    await player.load(makeDoc(sampleBlocks));
    const started = player.play();
    player.pause();
    await started;
    await player.settled;
    expect(engine.spoken).toEqual([]);
    expect(player.state.status).not.toBe('playing');
  });

  it('reads code blocks when skipCodeBlocks is off', async () => {
    const { engine, player } = setup({ skipCodeBlocks: false });
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await player.settled;
    expect(engine.spoken).toContain('let x = 1;');
  });

  it('caps the rate for direct engines at 2.0', async () => {
    const { engine, player } = setup();
    player.setRate(2.7);
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await player.settled;
    expect(player.state.rate).toBe(2.7);
    expect(new Set(engine.rates)).toEqual(new Set([2]));
  });

  it('pause aborts, and resume restarts the same sentence', async () => {
    const { engine, player } = setup();
    engine.hold = true;
    await player.load(makeDoc(sampleBlocks), 'b1.s1');
    await player.play();
    await tick();
    expect(engine.spoken).toEqual(['Second sentence here.']);
    player.pause();
    expect(player.state.status).toBe('paused');
    await player.settled;
    await player.resume();
    await tick();
    expect(engine.spoken).toEqual(['Second sentence here.', 'Second sentence here.']);
    player.stop();
  });

  it('next and prev move between sentences while idle', async () => {
    const { player } = setup();
    await player.load(makeDoc(sampleBlocks));
    player.next();
    player.next();
    expect(player.currentSentenceId).toBe('b1.s1');
    player.prev();
    expect(player.currentSentenceId).toBe('b1.s0');
    player.seek('b3.s0');
    expect(player.currentSentenceId).toBe('b3.s0');
  });

  it('retries a failed chunk once and carries on (ADR-14)', async () => {
    const { engine, player } = setup();
    engine.failures.set('First sentence here.', 1);
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await player.settled;
    expect(engine.spoken.filter((t) => t === 'First sentence here.')).toHaveLength(2);
    expect(player.state.status).toBe('ended');
  });

  it('stops in error on the same sentence after two failures and never advances (ADR-14)', async () => {
    const { engine, player, saved } = setup();
    engine.failures.set('Second sentence here.', 2);
    const errors: string[] = [];
    player.subscribe((e) => e.type === 'error' && errors.push(e.message));
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await player.settled;
    expect(player.state.status).toBe('error');
    expect(player.currentSentenceId).toBe('b1.s1');
    expect(engine.spoken).not.toContain('Final paragraph.');
    expect(errors).toEqual([STOPPED_MESSAGE]);
    expect(saved.at(-1)?.sentenceId).toBe('b1.s1');
    // Play retries from that sentence.
    await player.play();
    await player.settled;
    expect(player.state.status).toBe('ended');
  });

  it('debounces position saves by one second', async () => {
    vi.useFakeTimers();
    const { player, saved } = setup();
    await player.load(makeDoc(sampleBlocks));
    player.seek('b1.s1');
    await vi.advanceTimersByTimeAsync(999);
    expect(saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([expect.objectContaining({ sentenceId: 'b1.s1', ordinal: 2 })]);
  });

  it('waits for heading pauses', async () => {
    vi.useFakeTimers();
    const { engine, player } = setup({ pauseAfterHeadingMs: 600 });
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await vi.advanceTimersByTimeAsync(299);
    expect(engine.spoken).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.spoken).toEqual(['Chapter One']);
    await vi.advanceTimersByTimeAsync(599);
    expect(engine.spoken).toEqual(['Chapter One']);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.spoken).toContain('First sentence here.');
    player.stop();
  });

  it('reports an error when no voice exists', async () => {
    const player = new Player({
      positions: { savePosition: async () => {} },
      registry: new EngineRegistry([]),
      settings: () => defaultSettings(),
    });
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    expect(player.state.status).toBe('error');
  });
});
