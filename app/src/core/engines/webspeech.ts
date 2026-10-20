// Web Speech engine (spec 7.2). In Edge this reaches Microsoft's online natural voices.
import type { EngineAvailability, SpeakOptions, Voice, VoiceEngine } from '../types';

/** The engine could not confirm the text was spoken (ADR-14). The player must not advance. */
export class SpeechStalledError extends Error {
  constructor(reason: string) {
    super(`Speech did not complete: ${reason}`);
    this.name = 'SpeechStalledError';
  }
}

interface UtteranceLike {
  text: string;
  voice: SpeechSynthesisVoice | null;
  lang: string;
  rate: number;
  pitch: number;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: SpeechSynthesisErrorEvent) => void) | null;
}

export interface SynthLike {
  getVoices(): SpeechSynthesisVoice[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  resume(): void;
  readonly paused: boolean;
  addEventListener?(type: 'voiceschanged', fn: () => void): void;
  removeEventListener?(type: 'voiceschanged', fn: () => void): void;
  onvoiceschanged?: (() => void) | null;
}

export interface WebSpeechDeps {
  synth?: SynthLike | undefined;
  Utterance?: (new (text: string) => UtteranceLike) | undefined;
  now?: () => number;
  online?: () => boolean;
}

const CHARS_PER_SECOND = 14;
const VOICE_WAIT_MS = 3000;

// Chromium can garbage-collect an utterance before `end` fires; keep a reference.
let keepAlive: UtteranceLike | null = null;

export function isNaturalVoice(v: SpeechSynthesisVoice): boolean {
  return /natural/i.test(v.name) && !v.localService;
}

export function expectedSpeechMs(text: string, rate: number): number {
  return (text.length / (CHARS_PER_SECOND * rate)) * 1000;
}

export class WebSpeechEngine implements VoiceEngine {
  readonly id = 'webspeech' as const;
  readonly label = 'Browser voices';
  readonly kind = 'direct' as const;
  readonly maxEngineRate = 2.0;

  private readonly synth: SynthLike | undefined;
  private readonly Utterance: (new (text: string) => UtteranceLike) | undefined;
  private readonly now: () => number;
  private readonly online: () => boolean;
  private native = new Map<string, SpeechSynthesisVoice>();

  constructor(deps: WebSpeechDeps = {}) {
    const g = globalThis as unknown as { speechSynthesis?: SynthLike; SpeechSynthesisUtterance?: new (t: string) => UtteranceLike };
    this.synth = 'synth' in deps ? deps.synth : g.speechSynthesis;
    this.Utterance = 'Utterance' in deps ? deps.Utterance : g.SpeechSynthesisUtterance;
    this.now = deps.now ?? (() => performance.now());
    this.online = deps.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  }

  async isAvailable(): Promise<EngineAvailability> {
    return this.synth && this.Utterance ? { ok: true } : { ok: false, reason: 'This browser has no speech synthesis.' };
  }

  waitForVoices(): Promise<SpeechSynthesisVoice[]> {
    const synth = this.synth;
    if (!synth) return Promise.resolve([]);
    const now = synth.getVoices();
    if (now.length > 0) return Promise.resolve(now);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (synth.removeEventListener) synth.removeEventListener('voiceschanged', onChange);
        else synth.onvoiceschanged = null;
        resolve(synth.getVoices());
      };
      const onChange = () => finish();
      const timer = setTimeout(finish, VOICE_WAIT_MS);
      if (synth.addEventListener) synth.addEventListener('voiceschanged', onChange);
      else synth.onvoiceschanged = onChange;
    });
  }

  async listVoices(): Promise<Voice[]> {
    const raw = await this.waitForVoices();
    const online = this.online();
    this.native = new Map();
    const voices: Voice[] = [];
    for (const v of raw) {
      if (!online && !v.localService) continue;
      const id = v.voiceURI || v.name;
      this.native.set(id, v);
      voices.push({
        id,
        engineId: 'webspeech',
        name: v.name,
        lang: v.lang,
        quality: isNaturalVoice(v) ? 'neural' : 'standard',
        offline: v.localService,
      });
    }
    return voices.sort((a, b) => (a.quality === b.quality ? a.name.localeCompare(b.name) : a.quality === 'neural' ? -1 : 1));
  }

  speak(text: string, opts: SpeakOptions, signal: AbortSignal): Promise<void> {
    const synth = this.synth;
    const Utterance = this.Utterance;
    if (!synth || !Utterance) return Promise.reject(new Error('Speech synthesis is not available.'));
    if (signal.aborted) return Promise.resolve();

    const rate = Math.min(this.maxEngineRate, Math.max(0.5, opts.rate));
    const u = new Utterance(text);
    const native = this.native.get(opts.voice.id) ?? synth.getVoices().find((v) => (v.voiceURI || v.name) === opts.voice.id) ?? null;
    u.voice = native;
    u.lang = opts.voice.lang;
    u.rate = rate;
    u.pitch = 1;
    keepAlive = u;

    const expected = expectedSpeechMs(text, rate);
    const started = this.now();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (keepAlive === u) keepAlive = null;
        fn();
      };
      const onAbort = () =>
        settle(() => {
          synth.cancel();
          resolve();
        });
      const timer = setTimeout(
        () =>
          settle(() => {
            synth.cancel();
            reject(new SpeechStalledError('no end event before the watchdog expired'));
          }),
        expected * 2 + 3000,
      );
      signal.addEventListener('abort', onAbort);

      u.onend = () => {
        const elapsed = this.now() - started;
        if (text.length > 40 && elapsed < Math.max(300, 0.15 * expected)) {
          settle(() => reject(new SpeechStalledError('ended before the text could have been spoken')));
        } else {
          settle(resolve);
        }
      };
      u.onerror = (ev) => {
        // Our own cancel is handled by onAbort. Anything else means the text was not heard.
        settle(() => reject(new SpeechStalledError(`speech error "${ev.error}"`)));
      };

      if (synth.paused) synth.resume();
      synth.speak(u);
    });
  }
}
