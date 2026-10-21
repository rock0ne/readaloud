import { describe, expect, it, vi } from 'vitest';
import { concatSamples, encodeWav, trimSilence } from '../src/core/audio/wav';
import { KOKORO_MAX_CHARS, KokoroEngine, splitForKokoro, type KokoroBackend } from '../src/core/engines/kokoro';
import { EngineRegistry } from '../src/core/engines/registry';
import { Player, STOPPED_MESSAGE, type AudioCache, type AudioOutput } from '../src/core/player/player';
import { defaultSettings } from '../src/core/store/settings';
import { sha256Hex } from '../src/core/util/hash';
import type { Settings, SpeakOptions, Voice, VoiceEngine } from '../src/core/types';
import { makeDoc, sampleBlocks } from './helpers/docs';

class FakeBackend implements KokoroBackend {
  ok = false;
  calls: string[] = [];
  async installed() {
    return this.ok;
  }
  async generate(text: string) {
    this.calls.push(text);
    return { samples: new Float32Array(text.length).fill(0.5), sampleRate: 24000 };
  }
}

describe('Kokoro engine (ADR-22)', () => {
  it('is unavailable until the model is stored, then lists Emma first', async () => {
    const backend = new FakeBackend();
    const engine = new KokoroEngine(backend);
    expect((await engine.isAvailable()).ok).toBe(false);
    backend.ok = true;
    expect((await engine.isAvailable()).ok).toBe(true);
    const voices = await engine.listVoices();
    expect(voices[0]).toMatchObject({ id: 'bf_emma', name: 'Emma (woman, United Kingdom)', lang: 'en-GB', quality: 'neural', offline: true });
    // Each name says woman or man, so Rockson can choose either.
    expect(voices.filter((v) => v.name.includes('(woman,')).map((v) => v.id)).toEqual(['bf_emma', 'bf_isabella', 'af_heart', 'af_bella', 'af_nicole']);
    expect(voices.filter((v) => v.name.includes('(man,')).map((v) => v.id)).toEqual(['bm_george', 'bm_fable', 'bm_lewis', 'am_michael', 'am_fenrir', 'am_puck']);
    expect(voices.map((v) => v.id)).not.toContain('am_adam');
  });

  it('is the automatic choice over a saved browser voice, until a browser voice is picked again', async () => {
    const backend = new FakeBackend();
    backend.ok = true;
    const browser: VoiceEngine = {
      id: 'webspeech',
      label: 'Browser',
      kind: 'direct',
      maxEngineRate: 2,
      isAvailable: async () => ({ ok: true }),
      listVoices: async () => [{ id: 'Sonia', engineId: 'webspeech', name: 'Sonia', lang: 'en-GB', quality: 'neural', offline: false }],
    };
    const reg = new EngineRegistry([new KokoroEngine(backend), browser]);
    const migrated = { ...defaultSettings(), voiceByEngine: { webspeech: 'Sonia' } };
    expect((await reg.pick(migrated))?.voice.id).toBe('bf_emma');
    const pickedBrowser = { ...migrated, enginePreference: ['webspeech' as const, 'kokoro' as const] };
    expect((await reg.pick(pickedBrowser))?.voice.id).toBe('Sonia');
    const pickedGeorge = { ...migrated, voiceByEngine: { ...migrated.voiceByEngine, kokoro: 'bm_george' } };
    expect((await reg.pick(pickedGeorge))?.voice.id).toBe('bm_george');
  });

  it('turns samples into a 16-bit mono WAV clip', async () => {
    const backend = new FakeBackend();
    const engine = new KokoroEngine(backend);
    const voice = (await engine.listVoices())[0]!;
    const blob = await engine.synthesize('Hello there.', { voice, rate: 1 }, new AbortController().signal);
    expect(blob.type).toBe('audio/wav');
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe('Hello there.'.length * 2);
    expect(view.getInt16(44, true)).toBe(16383); // 0.5 of full scale
    expect(backend.calls).toEqual(['Hello there.']);
  });

  it('splits text that would overflow the model window without losing words', async () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}${i % 15 === 14 ? ',' : ''}`);
    const text = words.join(' ');
    expect(text.length).toBeGreaterThan(KOKORO_MAX_CHARS);
    const parts = splitForKokoro(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(KOKORO_MAX_CHARS);
    expect(parts.join(' ').split(/\s+/)).toEqual(text.split(/\s+/));
    expect(parts[0]!.endsWith(',')).toBe(true); // prefers a comma to a bare space
    expect(splitForKokoro('Short sentence.')).toEqual(['Short sentence.']);

    const backend = new FakeBackend();
    const engine = new KokoroEngine(backend);
    const voice = (await engine.listVoices())[0]!;
    const blob = await engine.synthesize(text, { voice, rate: 1 }, new AbortController().signal);
    expect(backend.calls).toEqual(parts);
    expect(new DataView(await blob.arrayBuffer()).getUint32(40, true)).toBe(parts.join('').length * 2);
  });

  it('cuts a clip\'s quiet start and end down to a short lead and tail (ADR-31)', () => {
    const rate = 1000;
    const clip = new Float32Array(300 + 100 + 700);
    clip.fill(0.001, 0, 300);
    clip.fill(0.5, 300, 400);
    const out = trimSilence(clip, rate);
    expect(out.length).toBe(50 + 100 + 200);
    expect(out[50]).toBe(0.5);
    const quiet = new Float32Array(100);
    expect(trimSilence(quiet, rate)).toBe(quiet);
    const tight = new Float32Array([0.5, 0.5]);
    expect(trimSilence(tight, rate)).toBe(tight);
  });

  it('joins sample runs in order', () => {
    expect(Array.from(concatSamples([new Float32Array([1, 2]), new Float32Array([3])]))).toEqual([1, 2, 3]);
    const wav = encodeWav(new Float32Array([2, -2]), 8000);
    expect(wav.size).toBe(48);
  });
});

// ----- player with an audio engine: prefetch, cache, retry -----

const AVOICE: Voice = { id: 'bf_emma', engineId: 'kokoro', name: 'Emma', lang: 'en-GB', quality: 'neural', offline: true };

class FakeAudioEngine implements VoiceEngine {
  readonly id = 'kokoro' as const;
  readonly label = 'Fake Kokoro';
  readonly kind = 'audio' as const;
  readonly maxEngineRate = 1;
  made: string[] = [];
  aborted: string[] = [];
  failures = new Map<string, number>();
  /** when set, synthesize() waits until released or aborted */
  hold = false;
  private pending = new Map<string, () => void>();

  async isAvailable() {
    return { ok: true };
  }
  async listVoices() {
    return [AVOICE];
  }
  synthesize(text: string, _opts: SpeakOptions, signal: AbortSignal): Promise<Blob> {
    this.made.push(text);
    const f = this.failures.get(text) ?? 0;
    if (f > 0) {
      this.failures.set(text, f - 1);
      return Promise.reject(new Error('model failed'));
    }
    if (!this.hold) return Promise.resolve(new Blob([text]));
    return new Promise((resolve, reject) => {
      this.pending.set(text, () => resolve(new Blob([text])));
      signal.addEventListener('abort', () => {
        this.aborted.push(text);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }
  release(text: string) {
    this.pending.get(text)?.();
  }
}

class FakeOutput implements AudioOutput {
  played: string[] = [];
  rates: number[] = [];
  hold = false;
  private release: (() => void) | null = null;
  async play(blob: Blob, rate: number, signal: AbortSignal, onProgress?: (fraction: number) => void) {
    this.played.push(await blob.text());
    this.rates.push(rate);
    for (const f of [0.25, 0.5, 0.75, 0.99]) onProgress?.(f);
    if (!this.hold) return;
    await new Promise<void>((resolve) => {
      this.release = resolve;
      signal.addEventListener('abort', () => resolve());
    });
  }
  finish() {
    this.release?.();
  }
}

class MemoryCache implements AudioCache {
  map = new Map<string, Blob>();
  async getAudio(key: string) {
    return this.map.get(key);
  }
  async putAudio(key: string, blob: Blob) {
    this.map.set(key, blob);
  }
  async pruneAudio() {
    return 0;
  }
}

/** Cache lookups that finish in reverse order: the first one started finishes last. */
class ReorderingCache extends MemoryCache {
  private lookups = 0;
  override async getAudio(key: string) {
    const delay = Math.max(0, 40 - 10 * this.lookups++);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return super.getAudio(key);
  }
}

function setupAudio(over: Partial<Settings> = {}, cache: MemoryCache = new MemoryCache()) {
  const engine = new FakeAudioEngine();
  const audio = new FakeOutput();
  const settings: Settings = { ...defaultSettings(), pauseAfterHeadingMs: 0, pauseBetweenSentencesMs: 0, pauseBetweenParagraphsMs: 0, ...over };
  const player = new Player({
    positions: { savePosition: async () => undefined },
    registry: new EngineRegistry([engine]),
    settings: () => settings,
    audio,
    audioCache: cache,
  });
  return { engine, audio, cache, player };
}

describe('player with an audio engine (spec 8.3, 8.4)', () => {
  it('reads through the audio output at the user speed, skipping code', async () => {
    const { engine, audio, player } = setupAudio({ rate: 2.5 });
    player.setRate(2.5);
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await vi.waitFor(() => expect(player.state.status).toBe('ended'));
    expect(audio.played).toEqual(['Chapter One', 'First sentence here.', 'Second sentence here.', 'Final paragraph.']);
    expect(audio.rates.every((r) => r === 2.5)).toBe(true);
    expect(engine.made).toHaveLength(4);
  });

  it('prepares the next chunks while one plays', async () => {
    const { engine, audio, player } = setupAudio();
    audio.hold = true;
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await vi.waitFor(() => expect(audio.played).toEqual(['Chapter One']));
    expect(engine.made).toEqual(['Chapter One', 'First sentence here.', 'Second sentence here.', 'Final paragraph.']);
    player.stop();
  });

  it('asks the engine in reading order even when cache lookups finish out of order', async () => {
    // The phone makes one clip at a time in the order it is asked, so a later sentence asked
    // first would delay the one about to play (found in CI, 2026-10-21).
    const { engine, audio, player } = setupAudio({}, new ReorderingCache());
    audio.hold = true;
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await vi.waitFor(() => expect(engine.made).toHaveLength(4));
    expect(engine.made).toEqual(['Chapter One', 'First sentence here.', 'Second sentence here.', 'Final paragraph.']);
    player.stop();
  });

  it('keeps that order when a clip in between is already cached', async () => {
    const cache = new ReorderingCache();
    const cached = 'First sentence here.';
    cache.map.set(`kokoro|bf_emma|1.0|v2|${await sha256Hex(new TextEncoder().encode(cached))}`, new Blob([cached]));
    const { engine, audio, player } = setupAudio({}, cache);
    audio.hold = true;
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await vi.waitFor(() => expect(engine.made).toHaveLength(3));
    expect(engine.made).toEqual(['Chapter One', 'Second sentence here.', 'Final paragraph.']);
    player.stop();
  });

  it('prepares about 40 s of speech ahead when the sentences are short, but at least 3 chunks', async () => {
    const short = Array.from({ length: 30 }, (_, i) => `Short sentence number ${i + 1} is here.`).join(' ');
    const long = Array.from({ length: 6 }, (_, i) => `Long sentence ${i + 1} ${'goes on and on, '.repeat(16)}to the end.`).join(' ');
    for (const [text, expected] of [
      [short, 12],
      [long, 3],
    ] as const) {
      const { engine, audio, player } = setupAudio();
      audio.hold = true;
      await player.load(makeDoc([{ type: 'paragraph', text }]));
      await player.play();
      await vi.waitFor(() => expect(audio.played).toHaveLength(1));
      // the one playing, then the ones ahead of it
      expect(engine.made).toHaveLength(expected + 1);
      player.stop();
    }
  });

  it('uses stored audio the second time through', async () => {
    const { engine, audio, cache, player } = setupAudio();
    const doc = makeDoc(sampleBlocks);
    await player.load(doc);
    await player.play();
    await vi.waitFor(() => expect(player.state.status).toBe('ended'));
    await vi.waitFor(() => expect(cache.map.size).toBe(4));
    await player.load(doc);
    await player.play();
    await vi.waitFor(() => expect(audio.played).toHaveLength(8));
    expect(engine.made).toHaveLength(4);
    expect([...cache.map.keys()][0]).toMatch(/^kokoro\|bf_emma\|1\.0\|v2\|[0-9a-f]{64}$/);
  });

  it('cancels audio still being made for text no longer ahead after a seek', async () => {
    const { engine, audio, player } = setupAudio();
    engine.hold = true;
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await vi.waitFor(() => expect(engine.made).toHaveLength(4));
    player.seek('b3.s0');
    await vi.waitFor(() => expect([...engine.aborted].sort()).toEqual(['Chapter One', 'First sentence here.', 'Second sentence here.']));
    engine.release('Final paragraph.');
    await vi.waitFor(() => expect(player.state.status).toBe('ended'));
    expect(audio.played).toEqual(['Final paragraph.']);
  });

  it('keeps a clip that is being made across pause and play', async () => {
    const { engine, audio, player } = setupAudio();
    engine.hold = true;
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await vi.waitFor(() => expect(player.state.status).toBe('buffering'));
    player.pause();
    await player.settled;
    await player.play();
    await vi.waitFor(() => expect(engine.made).toContain('Chapter One'));
    engine.release('Chapter One');
    await vi.waitFor(() => expect(audio.played).toEqual(['Chapter One']));
    expect(engine.made.filter((t) => t === 'Chapter One')).toHaveLength(1);
    player.stop();
  });

  it('makes a one-word sentence in one clip with the sentence before it; the highlight follows', async () => {
    const { engine, audio, player } = setupAudio();
    const seen: string[] = [];
    player.subscribe((e) => e.type === 'sentence' && seen.at(-1) !== e.sentenceId && seen.push(e.sentenceId));
    await player.load(makeDoc([{ type: 'paragraph', text: 'Do you know how many times that happened? Four. She folded the letter.' }]));
    await player.play();
    await vi.waitFor(() => expect(player.state.status).toBe('ended'));
    expect(audio.played).toEqual(['Do you know how many times that happened? Four.', 'She folded the letter.']);
    expect(engine.made).toEqual(audio.played);
    expect(seen).toEqual(['b0.s0', 'b0.s1', 'b0.s2']);
  });

  it('joins a short first sentence to the next one, and leaves a short paragraph alone', async () => {
    const { audio, player } = setupAudio();
    await player.load(
      makeDoc([
        { type: 'paragraph', text: 'Yes. I will come tomorrow. Then we can talk it over.' },
        { type: 'paragraph', text: 'Seven.' },
      ]),
    );
    await player.play();
    await vi.waitFor(() => expect(player.state.status).toBe('ended'));
    expect(audio.played).toEqual(['Yes. I will come tomorrow.', 'Then we can talk it over.', 'Seven.']);
  });

  it('stops on the same sentence when its audio cannot be made (ADR-14)', async () => {
    const { engine, audio, player } = setupAudio();
    engine.failures.set('First sentence here.', 5);
    await player.load(makeDoc(sampleBlocks));
    await player.play();
    await vi.waitFor(() => expect(player.state.status).toBe('error'), { timeout: 3000 });
    expect(player.state.error).toBe(STOPPED_MESSAGE);
    expect(player.currentSentenceId).toBe('b1.s0');
    expect(audio.played).toEqual(['Chapter One']);
  });
});
