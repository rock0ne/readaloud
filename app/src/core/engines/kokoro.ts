// Kokoro neural voices, generated on this device (spec 7.4, ADR-22). The model runs in a Web
// Worker owned by the UI layer; this engine only sees the KokoroBackend interface.
import { concatSamples, encodeWav } from '../audio/wav';
import type { EngineAvailability, SpeakOptions, Voice, VoiceEngine } from '../types';

export interface KokoroBackend {
  /** true once the model files are stored on this device */
  installed(): Promise<boolean>;
  /** Raw samples for one piece of text; loads the model first if needed. */
  generate(text: string, voiceId: string, signal: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }>;
}

/**
 * The spec's UK and US voices, best-graded first within each accent (the model card's grades).
 * am_adam (graded F+) is replaced by better-graded US voices. Emma is first, so she is the
 * automatic en-GB choice.
 */
export const KOKORO_VOICES: ReadonlyArray<{ id: string; name: string; lang: 'en-GB' | 'en-US' }> = [
  { id: 'bf_emma', name: 'Emma', lang: 'en-GB' },
  { id: 'bm_george', name: 'George', lang: 'en-GB' },
  { id: 'bf_isabella', name: 'Isabella', lang: 'en-GB' },
  { id: 'bm_fable', name: 'Fable', lang: 'en-GB' },
  { id: 'bm_lewis', name: 'Lewis', lang: 'en-GB' },
  { id: 'af_heart', name: 'Heart', lang: 'en-US' },
  { id: 'af_bella', name: 'Bella', lang: 'en-US' },
  { id: 'af_nicole', name: 'Nicole', lang: 'en-US' },
  { id: 'am_michael', name: 'Michael', lang: 'en-US' },
  { id: 'am_fenrir', name: 'Fenrir', lang: 'en-US' },
  { id: 'am_puck', name: 'Puck', lang: 'en-US' },
];

/**
 * Kokoro silently drops phonemes past its 510-token window. Chunks are at most 280 characters
 * (spec 6.3), well inside it; anything longer is split here so no words are lost.
 */
export const KOKORO_MAX_CHARS = 350;

export function splitForKokoro(text: string, max = KOKORO_MAX_CHARS): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const punct = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '));
    const space = head.lastIndexOf(' ');
    const cut = punct > max / 2 ? punct + 1 : space > 0 ? space : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export class KokoroEngine implements VoiceEngine {
  readonly id = 'kokoro' as const;
  readonly label = 'Kokoro';
  readonly kind = 'audio' as const;
  readonly maxEngineRate = 1.0;
  private readonly backend: KokoroBackend;

  constructor(backend: KokoroBackend) {
    this.backend = backend;
  }

  async isAvailable(): Promise<EngineAvailability> {
    return (await this.backend.installed()) ? { ok: true } : { ok: false, reason: 'The Kokoro voice is not downloaded yet.' };
  }

  async listVoices(): Promise<Voice[]> {
    return KOKORO_VOICES.map((v) => ({
      id: v.id,
      engineId: 'kokoro',
      name: `${v.name} (${v.lang === 'en-GB' ? 'United Kingdom' : 'United States'})`,
      lang: v.lang,
      quality: 'neural',
      offline: true,
    }));
  }

  async synthesize(text: string, opts: SpeakOptions, signal: AbortSignal): Promise<Blob> {
    const parts: Float32Array[] = [];
    let sampleRate = 24000;
    for (const piece of splitForKokoro(text)) {
      signal.throwIfAborted();
      const out = await this.backend.generate(piece, opts.voice.id, signal);
      parts.push(out.samples);
      sampleRate = out.sampleRate;
    }
    return encodeWav(concatSamples(parts), sampleRate);
  }
}
