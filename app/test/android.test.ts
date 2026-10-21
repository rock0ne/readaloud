// The Android app's voice: WAV files from the phone's Kokoro engine (ADR-27).
import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../src/core/audio/wav';
import { KokoroEngine } from '../src/core/engines/kokoro';
import { PHONE_VOICE, PhoneKokoro } from '../src/ui/android/phone-kokoro';
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
  const pending: Array<{ text: string; done: () => void; fail: (e: Error) => void }> = [];
  let stops = 0;
  const tts: ReadAloudTts = {
    engine: async () => ({ installed }),
    init: async () => undefined,
    synthesize: ({ text }) =>
      new Promise((resolve, reject) => {
        calls.push(text);
        pending.push({ text, done: () => resolve({ path: `/cache/${text}.wav` }), fail: reject });
      }),
    stop: async () => {
      stops++;
      pending.shift()?.fail(new Error('stopped'));
    },
    keepScreenOn: async () => undefined,
  };
  const finishNext = async () => {
    await flush();
    pending.shift()?.done();
    await flush();
  };
  return { tts, calls, finishNext, stops: () => stops };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const readFile = () => wavOf([0.1, 0.2, 0.3, 0.4]);

describe('PhoneKokoro', () => {
  it('offers the one voice the engine app has, through KokoroEngine', async () => {
    const engine = new KokoroEngine(new PhoneKokoro(fakePlugin().tts, readFile));
    expect(await engine.isAvailable()).toEqual({ ok: true });
    expect(await engine.listVoices()).toEqual([PHONE_VOICE]);
  });

  it('is not available when the engine app is missing', async () => {
    const kokoro = new PhoneKokoro(fakePlugin(false).tts, readFile);
    expect((await new KokoroEngine(kokoro).isAvailable()).ok).toBe(false);
    await expect(kokoro.load()).rejects.toThrow('not on this phone');
    expect(kokoro.status.phase).toBe('error');
  });

  it('sends one clip at a time and returns its samples', async () => {
    const p = fakePlugin();
    const kokoro = new PhoneKokoro(p.tts, readFile);
    const a = kokoro.generate('one', PHONE_VOICE.id, new AbortController().signal);
    const b = kokoro.generate('two', PHONE_VOICE.id, new AbortController().signal);
    await flush();
    expect(p.calls).toEqual(['one']);
    await p.finishNext();
    expect((await a).samples.length).toBe(4);
    expect(p.calls).toEqual(['one', 'two']);
    await p.finishNext();
    expect((await b).sampleRate).toBe(24000);
    expect(kokoro.status.phase).toBe('ready');
  });

  it('drops cancelled clips before they are sent, and stops the one being made', async () => {
    const p = fakePlugin();
    const kokoro = new PhoneKokoro(p.tts, readFile);
    const first = new AbortController();
    const second = new AbortController();
    const a = kokoro.generate('one', PHONE_VOICE.id, first.signal);
    const b = kokoro.generate('two', PHONE_VOICE.id, second.signal);
    const c = kokoro.generate('three', PHONE_VOICE.id, new AbortController().signal);
    await flush();
    second.abort();
    await expect(b).rejects.toThrow();
    first.abort();
    await expect(a).rejects.toThrow();
    expect(p.stops()).toBe(1);
    await p.finishNext();
    expect((await c).samples.length).toBe(4);
    expect(p.calls).toEqual(['one', 'three']);
  });
});
