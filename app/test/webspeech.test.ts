import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechStalledError, WebSpeechEngine, type SynthLike } from '../src/core/engines/webspeech';
import { EngineRegistry } from '../src/core/engines/registry';
import { defaultSettings } from '../src/core/store/settings';
import type { Voice, VoiceEngine } from '../src/core/types';

class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  rate = 1;
  pitch = 1;
  onend: ((ev: Event) => void) | null = null;
  onerror: ((ev: SpeechSynthesisErrorEvent) => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

const sv = (name: string, lang: string, localService: boolean) =>
  ({ name, lang, localService, voiceURI: name, default: false }) as SpeechSynthesisVoice;

const SONIA = sv('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', false);
const HAZEL = sv('Microsoft Hazel - English (United Kingdom)', 'en-GB', true);

class FakeSynth implements SynthLike {
  voices: SpeechSynthesisVoice[] = [];
  spoken: FakeUtterance[] = [];
  paused = false;
  cancel = vi.fn();
  private listeners: Array<() => void> = [];
  getVoices() {
    return this.voices;
  }
  speak(u: FakeUtterance) {
    this.spoken.push(u);
  }
  resume() {}
  addEventListener(_t: 'voiceschanged', fn: () => void) {
    this.listeners.push(fn);
  }
  removeEventListener() {}
  fireVoicesChanged() {
    for (const l of this.listeners) l();
  }
}

function setup(online = true) {
  const synth = new FakeSynth();
  let clock = 0;
  const engine = new WebSpeechEngine({ synth, Utterance: FakeUtterance, now: () => clock, online: () => online });
  return { synth, engine, advance: (ms: number) => (clock += ms) };
}

const LONG = 'This chunk is comfortably longer than forty characters in total.';

describe('U10 WebSpeechEngine', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for voiceschanged and maps natural voices to neural, listed first', async () => {
    const { synth, engine } = setup();
    const p = engine.listVoices();
    synth.voices = [HAZEL, SONIA];
    synth.fireVoicesChanged();
    const voices = await p;
    expect(voices.map((v) => [v.name.split(' ')[1], v.quality])).toEqual([
      ['Sonia', 'neural'],
      ['Hazel', 'standard'],
    ]);
  });

  it('drops online voices when offline', async () => {
    const { synth, engine } = setup(false);
    synth.voices = [HAZEL, SONIA];
    expect((await engine.listVoices()).map((v) => v.quality)).toEqual(['standard']);
  });

  async function speaking(text = LONG) {
    const ctx = setup();
    ctx.synth.voices = [SONIA];
    const [voice] = await ctx.engine.listVoices();
    const ac = new AbortController();
    const p = ctx.engine.speak(text, { voice: voice!, rate: 3 }, ac.signal);
    const u = ctx.synth.spoken[0]!;
    return { ...ctx, p, u, ac };
  }

  it('resolves on end after a plausible duration and caps the rate at 2.0', async () => {
    const { p, u, advance } = await speaking();
    expect(u.rate).toBe(2);
    expect(u.voice).toBe(SONIA);
    advance(2000);
    u.onend?.(new Event('end'));
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects an implausibly early end on a long chunk', async () => {
    const { p, u, advance } = await speaking();
    advance(10);
    u.onend?.(new Event('end'));
    await expect(p).rejects.toBeInstanceOf(SpeechStalledError);
  });

  it('rejects when no event arrives before the watchdog', async () => {
    vi.useFakeTimers();
    const { p, synth } = await speaking();
    const assertion = expect(p).rejects.toBeInstanceOf(SpeechStalledError);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('rejects an interruption it did not cause', async () => {
    const { p, u } = await speaking();
    u.onerror?.({ error: 'interrupted' } as SpeechSynthesisErrorEvent);
    await expect(p).rejects.toBeInstanceOf(SpeechStalledError);
  });

  it('explains a blocked start in plain words', async () => {
    const { p, u } = await speaking();
    u.onerror?.({ error: 'not-allowed' } as SpeechSynthesisErrorEvent);
    await expect(p).rejects.toThrow('the browser blocked speech until you click or press a key on the page');
  });

  it('abort cancels and resolves', async () => {
    const { p, u, ac, synth } = await speaking();
    ac.abort();
    u.onerror?.({ error: 'interrupted' } as SpeechSynthesisErrorEvent);
    await expect(p).resolves.toBeUndefined();
    expect(synth.cancel).toHaveBeenCalled();
  });
});

function fakeEngine(id: VoiceEngine['id'], voices: Array<Pick<Voice, 'id' | 'quality' | 'lang'>>): VoiceEngine {
  return {
    id,
    label: id,
    kind: 'audio',
    maxEngineRate: 1,
    isAvailable: async () => ({ ok: true }),
    listVoices: async () => voices.map((v) => ({ ...v, engineId: id, name: v.id, offline: false })),
  };
}

describe('U10 neural-first selection (ADR-13)', () => {
  it('picks a natural voice on a later engine over a basic voice on the first', async () => {
    const reg = new EngineRegistry([
      fakeEngine('webspeech', [{ id: 'Hazel', quality: 'standard', lang: 'en-GB' }]),
      fakeEngine('azure', [{ id: 'en-GB-SoniaNeural', quality: 'neural', lang: 'en-GB' }]),
    ]);
    const pick = await reg.pick(defaultSettings());
    expect(pick?.engine.id).toBe('azure');
    expect(pick?.basicFallback).toBe(false);
  });

  it('falls back to a basic voice only when no natural voice exists', async () => {
    const reg = new EngineRegistry([fakeEngine('webspeech', [{ id: 'Hazel', quality: 'standard', lang: 'en-GB' }])]);
    const pick = await reg.pick(defaultSettings());
    expect(pick?.voice.id).toBe('Hazel');
    expect(pick?.basicFallback).toBe(true);
  });

  it('honours an explicit user pick, and prefers the locale', async () => {
    const reg = new EngineRegistry([
      fakeEngine('webspeech', [
        { id: 'Aria', quality: 'neural', lang: 'en-US' },
        { id: 'Ryan', quality: 'neural', lang: 'en-GB' },
        { id: 'Hazel', quality: 'standard', lang: 'en-GB' },
      ]),
    ]);
    expect((await reg.pick(defaultSettings()))?.voice.id).toBe('Ryan');
    const s = { ...defaultSettings(), voiceByEngine: { webspeech: 'Hazel' } };
    expect((await reg.pick(s))?.voice.id).toBe('Hazel');
  });

  it('returns null when there are no voices at all', async () => {
    expect(await new EngineRegistry([fakeEngine('webspeech', [])]).pick(defaultSettings())).toBeNull();
  });
});
