// Kokoro made by the phone's own voice engine, one clip at a time (ADR-27,
// docs/05-ANDROID-KOKORO.md). The player asks for the next clips while one plays (spec 8.3).
import { decodeWav } from '../../core/audio/wav';
import type { KokoroBackend } from '../../core/engines/kokoro';
import type { Voice } from '../../core/types';
import type { KokoroService, KokoroStatus } from '../kokoro/client';
import type { ReadAloudTts } from './plugin';

export const PHONE_VOICE: Voice = {
  id: 'phone-engine',
  engineId: 'kokoro',
  name: 'Kokoro (voice set in the Kokoro engine app)',
  lang: 'en-GB',
  quality: 'neural',
  offline: true,
};

interface Job {
  text: string;
  signal: AbortSignal;
  resolve: (v: { samples: Float32Array; sampleRate: number }) => void;
  reject: (e: Error) => void;
}

const aborted = (signal: AbortSignal) => (signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));

export class PhoneKokoro implements KokoroBackend, KokoroService {
  readonly voices: ReadonlyArray<Voice> = [PHONE_VOICE];
  private _status: KokoroStatus = { phase: 'absent', installed: false, source: 'phone-engine' };
  private readonly listeners = new Set<(s: KokoroStatus) => void>();
  private readonly queue: Job[] = [];
  private busy: Job | null = null;
  private checked: Promise<boolean> | null = null;
  private loading: Promise<void> | null = null;
  private readonly tts: ReadAloudTts;
  private readonly readFile: (path: string) => Promise<ArrayBuffer>;

  constructor(tts: ReadAloudTts, readFile: (path: string) => Promise<ArrayBuffer>) {
    this.tts = tts;
    this.readFile = readFile;
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

  installed(): Promise<boolean> {
    this.checked ??= this.tts.engine().then(
      ({ installed }) => {
        if (this._status.phase === 'absent' && installed) this.emit({ ...this._status, phase: 'installed', installed: true });
        return installed;
      },
      () => false,
    );
    return this.checked;
  }

  load(): Promise<void> {
    this.loading ??= (async () => {
      if (!(await this.installed())) throw new Error('The Kokoro voice engine app is not on this phone.');
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

  async generate(text: string, _voiceId: string, signal: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }> {
    await this.load();
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const job: Job = { text, signal, resolve, reject };
      signal.addEventListener(
        'abort',
        () => {
          const at = this.queue.indexOf(job);
          if (at >= 0) {
            // Not sent yet: drop it, so the engine never makes it.
            this.queue.splice(at, 1);
            reject(aborted(signal));
          } else if (this.busy === job) {
            // Being made: cut it short; the plugin's call then fails and the next one starts.
            void this.tts.stop().catch(() => undefined);
          }
        },
        { once: true },
      );
      this.queue.push(job);
      this.next();
    });
  }

  /** The engine makes one clip at a time, so only one request is ever with it. */
  private next(): void {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = job;
    const started = performance.now();
    void (async () => {
      try {
        const { path } = await this.tts.synthesize({ text: job.text });
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
        this.busy = null;
        this.next();
      }
    })();
  }

  /** Nothing to remove: the model belongs to the engine app. */
  async remove(): Promise<void> {}
}
