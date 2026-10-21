// The app side of the Kokoro worker: download, load and generate (spec 7.4, ADR-22).
import { KOKORO_VOICES, type KokoroBackend } from '../../core/engines/kokoro';
import { KOKORO_MODEL, MODEL_CACHE, VOICE_CACHE, type FromWorker, type KokoroDevice, type KokoroStage, type ToWorker } from './protocol';

const MODEL_URL = `https://huggingface.co/${KOKORO_MODEL}/resolve/main/onnx/model.onnx`;
export const KOKORO_DOWNLOAD_MB = 330;

export type KokoroPhase = 'absent' | 'downloading' | 'installed' | 'loading' | 'ready' | 'error';

export interface KokoroStatus {
  phase: KokoroPhase;
  /** the model files are stored on this device */
  installed: boolean;
  loaded?: number;
  total?: number;
  device?: KokoroDevice;
  /** the loading step the worker is on */
  stage?: KokoroStage;
  error?: string;
  /** seconds of speech made per second, from recent sentences */
  speed?: number;
}

interface Job {
  resolve: (v: { samples: Float32Array; sampleRate: number }) => void;
  reject: (e: Error) => void;
}

async function modelCached(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(MODEL_CACHE);
    return (await cache.match(MODEL_URL)) !== undefined;
  } catch {
    return false;
  }
}

export class KokoroClient implements KokoroBackend {
  private worker: Worker | null = null;
  private _status: KokoroStatus = { phase: 'absent', installed: false };
  private readonly listeners = new Set<(s: KokoroStatus) => void>();
  private loading: Promise<void> | null = null;
  private loadWaiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private readonly jobs = new Map<number, Job>();
  private nextId = 1;
  private checked: Promise<boolean> | null = null;
  /** A new version of the app took over this page; its old worker file may be gone. */
  private updated = false;
  /** The worker script loaded and ran (it says so first). */
  private started = false;

  constructor() {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const hadController = navigator.serviceWorker.controller !== null;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        this.updated = hadController;
      });
    }
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
    if (this._status.installed) return Promise.resolve(true);
    this.checked ??= modelCached().then((ok) => {
      if (ok && !this._status.installed) this.emit({ ...this._status, installed: true, phase: this._status.phase === 'absent' ? 'installed' : this._status.phase });
      return ok;
    });
    return this.checked;
  }

  /** Downloads the model the first time, then loads it into memory. Safe to call repeatedly. */
  load(): Promise<void> {
    if (this._status.phase === 'ready') return Promise.resolve();
    if (this.loading) return this.loading;
    const p = new Promise<void>((resolve, reject) => {
      this.loadWaiter = { resolve, reject };
      this.emit({ phase: this._status.installed ? 'loading' : 'downloading', installed: this._status.installed, loaded: 0, total: 0 });
      const wasmPaths = new URL(`${import.meta.env.BASE_URL}ort/`, location.href).href;
      this.post({ type: 'load', wasmPaths, voices: KOKORO_VOICES.map((v) => v.id) });
    });
    this.loading = p;
    p.catch(() => {
      this.loading = null;
    });
    return p;
  }

  async generate(text: string, voiceId: string, signal: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }> {
    await this.load();
    signal.throwIfAborted();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.jobs.delete(id);
        this.worker?.postMessage({ type: 'cancel', id } satisfies ToWorker);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.jobs.set(id, {
        resolve: (v) => {
          signal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        reject: (e) => {
          signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      });
      this.post({ type: 'generate', id, text, voice: voiceId });
    });
  }

  /** Deletes the stored model and voices (Settings). Browser voices take over again. */
  async remove(): Promise<void> {
    this.stopWorker(new Error('The natural voice was removed from this device.'));
    try {
      const cache = await caches.open(MODEL_CACHE);
      for (const req of await cache.keys()) if (req.url.includes(`/${KOKORO_MODEL}/`)) await cache.delete(req);
      await caches.delete(VOICE_CACHE);
    } finally {
      this.emit({ phase: 'absent', installed: false });
    }
  }

  private post(m: ToWorker): void {
    if (!this.worker) {
      const w = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module', name: 'kokoro' });
      w.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
      w.onerror = (ev) =>
        this.fail(
          this.updated
            ? 'the app was updated while it was open. Reload the app'
            : ev.message || (this.started ? 'the voice worker stopped' : 'the voice worker could not be loaded'),
        );
      this.worker = w;
    }
    this.worker.postMessage(m);
  }

  private onMessage(m: FromWorker): void {
    switch (m.type) {
      case 'started':
        this.started = true;
        break;
      case 'stage':
        this.emit({ ...this._status, stage: m.stage });
        break;
      case 'progress':
        this.emit({ ...this._status, loaded: m.loaded, total: m.total });
        break;
      case 'ready':
        this.checked = Promise.resolve(true);
        this.emit({ phase: 'ready', installed: true, device: m.device });
        this.loadWaiter?.resolve();
        this.loadWaiter = null;
        break;
      case 'load-error':
        this.fail(m.message);
        break;
      case 'audio': {
        const job = this.jobs.get(m.id);
        this.jobs.delete(m.id);
        if (m.ms > 0 && m.samples.length > 0) {
          const now = m.samples.length / m.sampleRate / (m.ms / 1000);
          const speed = this._status.speed ? this._status.speed * 0.7 + now * 0.3 : now;
          this.emit({ ...this._status, speed });
        }
        job?.resolve({ samples: m.samples, sampleRate: m.sampleRate });
        break;
      }
      case 'error': {
        const job = this.jobs.get(m.id);
        this.jobs.delete(m.id);
        job?.reject(new Error(`The Kokoro voice failed: ${m.message}`));
        break;
      }
    }
  }

  /** Stops the worker so the next request starts cleanly. */
  private fail(message: string): void {
    this.stopWorker(new Error(`The Kokoro voice could not start: ${message}`));
    this.emit({ phase: 'error', installed: this._status.installed, error: message });
  }

  private stopWorker(err: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.started = false;
    this.loading = null;
    this.loadWaiter?.reject(err);
    this.loadWaiter = null;
    for (const job of this.jobs.values()) job.reject(err);
    this.jobs.clear();
    this.checked = null;
  }
}
