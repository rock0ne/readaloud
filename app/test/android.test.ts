// The Android app's voice: Kokoro clips made in the app by sherpa-onnx (ADR-27).
import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../src/core/audio/wav';
import { KOKORO_VOICES, KokoroEngine } from '../src/core/engines/kokoro';
import { accentOf, PhoneKokoro, SHERPA_SPEAKERS } from '../src/ui/android/phone-kokoro';
import type { ReadAloudTts } from '../src/ui/android/plugin';

const wavOf = async (samples: number[], rate = 24000) => (await encodeWav(new Float32Array(samples), rate).arrayBuffer()) as ArrayBuffer;

describe('decodeWav', () => {
  it('reads back what encodeWav wrote', async () => {
    const out = decodeWav(await wavOf([0, 0.5, -0.5, 0.25]));
    expect(out.sampleRate).toBe(24000);
    expect([...out.samples].map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5, 0.25]);
  });

  it('reads to the end when the data size was left at 0', async () => {
    const bytes = await wavOf([0.5, 0.5, 0.5]);
    new DataView(bytes).setUint32(40, 0, true);
    expect(decodeWav(bytes).samples.length).toBe(3);
  });

  it('refuses what is not 16-bit PCM WAV', async () => {
    expect(() => decodeWav(new TextEncoder().encode('not a wav file at all').buffer as ArrayBuffer)).toThrow('Not a WAV file');
    const bytes = await wavOf([0.5]);
    new DataView(bytes).setUint16(34, 32, true);
    expect(() => decodeWav(bytes)).toThrow('16-bit');
  });
});

/** A plugin whose clips finish only when the test says so. */
function fakePlugin(installed = true) {
  const calls: string[] = [];
  const pending: Array<{ done: () => void }> = [];
  const tts: ReadAloudTts = {
    engine: async () => ({ installed }),
    init: async () => undefined,
    synthesize: ({ phonemes, sid }) =>
      new Promise((resolve) => {
        calls.push(`${sid}|${phonemes}`);
        pending.push({ done: () => resolve({ path: `/cache/${calls.length}.wav` }) });
      }),
    stop: async () => undefined,
    keepScreenOn: async () => undefined,
  };
  const finishNext = async () => {
    await flush();
    pending.shift()?.done();
    await flush();
  };
  return { tts, calls, finishNext };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const readFile = () => wavOf([0.1, 0.2, 0.3, 0.4]);
/** Stands in for eSpeak: the text and the accent it was asked for. */
const phonemize = async (text: string, accent: 'a' | 'b') => `${text}/${accent}`;

describe('PhoneKokoro', () => {
  it('knows a speaker number for every voice in the picker, and its accent', async () => {
    const engine = new KokoroEngine(new PhoneKokoro(fakePlugin().tts, readFile, phonemize));
    expect(await engine.isAvailable()).toEqual({ ok: true });
    for (const v of KOKORO_VOICES) expect(SHERPA_SPEAKERS[v.id], v.id).toBeTypeOf('number');
    expect(SHERPA_SPEAKERS.bf_emma).toBe(21);
    expect(SHERPA_SPEAKERS.bm_george).toBe(26);
    expect(accentOf('bm_george')).toBe('b');
    expect(accentOf('af_heart')).toBe('a');
  });

  it('is not available when the engine app is missing', async () => {
    const kokoro = new PhoneKokoro(fakePlugin(false).tts, readFile, phonemize);
    expect((await new KokoroEngine(kokoro).isAvailable()).ok).toBe(false);
    await expect(kokoro.load()).rejects.toThrow('not on this phone');
    expect(kokoro.status.phase).toBe('error');
  });

  it('sends one clip at a time, as phonemes in the voice accent, and returns its samples', async () => {
    const p = fakePlugin();
    const kokoro = new PhoneKokoro(p.tts, readFile, phonemize);
    const a = kokoro.generate('one', 'bf_emma', new AbortController().signal);
    const b = kokoro.generate('two', 'am_michael', new AbortController().signal);
    await flush();
    expect(p.calls).toEqual(['21|one/b']);
    await p.finishNext();
    expect((await a).samples.length).toBe(4);
    expect(p.calls).toEqual(['21|one/b', '16|two/a']);
    await p.finishNext();
    expect((await b).sampleRate).toBe(24000);
    expect(kokoro.status.phase).toBe('ready');
  });

  it('drops cancelled clips before they are sent, and discards the one being made', async () => {
    const p = fakePlugin();
    const kokoro = new PhoneKokoro(p.tts, readFile, phonemize);
    const first = new AbortController();
    const second = new AbortController();
    const a = kokoro.generate('one', 'bf_emma', first.signal);
    const b = kokoro.generate('two', 'bf_emma', second.signal);
    const c = kokoro.generate('three', 'bf_emma', new AbortController().signal);
    await flush();
    second.abort();
    await expect(b).rejects.toThrow();
    const aDropped = expect(a).rejects.toThrow();
    first.abort();
    await p.finishNext();
    await aDropped;
    await p.finishNext();
    expect((await c).samples.length).toBe(4);
    expect(p.calls).toEqual(['21|one/b', '21|three/b']);
  });

  it('refuses a voice the phone model does not have', async () => {
    const kokoro = new PhoneKokoro(fakePlugin().tts, readFile, phonemize);
    await expect(kokoro.generate('one', 'zz_nobody', new AbortController().signal)).rejects.toThrow('not in the phone');
  });
});
