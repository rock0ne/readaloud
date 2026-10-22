// Kokoro made inside the Android app by sherpa-onnx, one clip at a time (ADR-27,
// docs/05-ANDROID-KOKORO.md). The player asks for the next clips while one plays (spec 8.3).
import { decodeWav } from '../../core/audio/wav';
import type { KokoroBackend } from '../../core/engines/kokoro';
import type { KokoroService, KokoroStatus } from '../kokoro/client';
import type { ReadAloudTts } from './plugin';

/**
 * Speaker numbers of the spec's voices in sherpa-onnx's kokoro-multi-lang-v1_0 model (k2-fsa's
 * Kokoro model page, ADR-24).
 */
export const SHERPA_SPEAKERS: Readonly<Record<string, number>> = {
  bf_emma: 21,
  bf_isabella: 22,
  bm_george: 26,
  bm_fable: 25,
  bm_lewis: 27,
  af_heart: 3,
  af_bella: 2,
  af_nicole: 6,
  am_michael: 16,
  am_fenrir: 14,
  am_puck: 18,
};

/** UK voices are spoken with British phonemes, US voices with American ones, as kokoro-js does. */
export const accentOf = (voiceId: string): 'a' | 'b' => (voiceId.startsWith('b') ? 'b' : 'a');

export type Phonemize = (text: string, accent: 'a' | 'b') => Promise<string>;

/** eSpeak loads on first use, not with the app. */
const textToPhonemes: Phonemize = async (text, accent) => (await import('./phonemes')).textToPhonemes(text, accent);

interface Job {
  /** Started when the clip is asked for, so eSpeak works while the model makes earlier clips. */
  phonemes: Promise<string>;
  sid: number;
  signal: AbortSignal;
  resolve: (v: { samples: Float32Array; sampleRate: number }) => void;
  reject: (e: Error) => void;
}

const aborted = (signal: AbortSignal) => (signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));

export class PhoneKokoro implements KokoroBackend, KokoroService {
  private _status: KokoroStatus = { phase: 'absent', installed: false, source: 'phone' };
  private readonly listeners = new Set<(s: KokoroStatus) => void>();
  private readonly queue: Job[] = [];
  private busy = false;
  private checked: Promise<boolean> | null = null;
  private loading: Promise<void> | null = null;
  private readonly tts: ReadAloudTts;
  private readonly readFile: (path: string) => Promise<ArrayBuffer>;
  private readonly phonemize: Phonemize;

  constructor(tts: ReadAloudTts, readFile: (path: string) => Promise<ArrayBuffer>, phonemize: Phonemize = textToPhonemes) {
    this.tts = tts;
    this.readFile = readFile;
    this.phonemize = phonemize;
  }

  get status(): KokoroStatus {
    return this._status;
  }

  subscribe(fn: (s: KokoroStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(s: KokoroStatus): void {
    this._status = s;
    for (const fn of this.listeners) fn(s);
  }

  /** The voice files are downloaded once, from ReadAloud's own release (ADR-37). */
  installed(): Promise<boolean> {
    this.checked ??= this.tts.voice().then(
      ({ installed, bytes, downloaded }) => {
        if (this._status.phase === 'absent') this.emit({ ...this._status, phase: installed ? 'installed' : 'absent', installed, loaded: downloaded, total: bytes });
        return installed;
      },
      () => false,
    );
    return this.checked;
  }

  /** Downloads the voice the first time, as the PC does, then loads it. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      if (!(await this.installed())) await this.download();
      this.emit({ ...this._status, phase: 'loading' });
      await this.tts.init();
      this.emit({ ...this._status, phase: 'ready' });
    })().catch((e: unknown) => {
      this.loading = null;
      const message = e instanceof Error ? e.message : String(e);
      this.emit({ ...this._status, phase: 'error', error: message });
      throw e instanceof Error ? e : new Error(message);
    });
    return this.loading;
  }

  async generate(text: string, voiceId: string, signal: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }> {
    const sid = SHERPA_SPEAKERS[voiceId];
    if (sid === undefined) throw new Error(`The voice ${voiceId} is not in the phone's Kokoro model.`);
    await this.load();
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const phonemes = this.phonemize(text, accentOf(voiceId));
      // A dropped job's phonemes are not awaited; keep their failure from being unhandled.
      phonemes.catch(() => undefined);
      const job: Job = { phonemes, sid, signal, resolve, reject };
      signal.addEventListener(
        'abort',
        () => {
          // Not sent yet: drop it, so it is never made. One being made finishes and is discarded.
          const at = this.queue.indexOf(job);
          if (at >= 0) {
            this.queue.splice(at, 1);
            reject(aborted(signal));
          }
        },
        { once: true },
      );
      this.queue.push(job);
      this.next();
    });
  }

  private async download(): Promise<void> {
    this.emit({ ...this._status, phase: 'downloading' });
    const progress = await this.tts.addListener('download', ({ loaded, total }) => this.emit({ ...this._status, phase: 'downloading', loaded, total }));
    // A phone that locks can stop the download; a later try goes on from where it stopped.
    await this.tts.keepScreenOn({ on: true }).catch(() => undefined);
    try {
      await this.tts.downloadVoice();
    } finally {
      await progress.remove();
      await this.tts.keepScreenOn({ on: false }).catch(() => undefined);
    }
    this.checked = Promise.resolve(true);
    this.emit({ ...this._status, phase: 'installed', installed: true });
  }

  /** One request at a time: the plugin makes clips one after another anyway. */
  private next(): void {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    const started = performance.now();
    void (async () => {
      try {
        const phonemes = await job.phonemes;
        if (job.signal.aborted) throw aborted(job.signal);
        const { path } = await this.tts.synthesize({ phonemes, sid: job.sid });
        const out = decodeWav(await this.readFile(path));
        const made = out.samples.length / out.sampleRate / ((performance.now() - started) / 1000);
        if (Number.isFinite(made) && made > 0) {
          const speed = this._status.speed ? this._status.speed * 0.7 + made * 0.3 : made;
          this.emit({ ...this._status, speed });
        }
        if (job.signal.aborted) job.reject(aborted(job.signal));
        else job.resolve(out);
      } catch (e) {
        job.reject(job.signal.aborted ? aborted(job.signal) : e instanceof Error ? e : new Error(String(e)));
      } finally {
        this.busy = false;
        this.next();
      }
    })();
  }

  async remove(): Promise<void> {
    await this.tts.removeVoice();
    this.loading = null;
    this.checked = Promise.resolve(false);
    this.emit({ phase: 'absent', installed: false, source: 'phone', loaded: 0, ...(this._status.total ? { total: this._status.total } : {}) });
  }
}
