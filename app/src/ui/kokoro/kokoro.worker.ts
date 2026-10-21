// Runs the Kokoro model off the main thread (spec 7.4, ADR-22). One job at a time, in order.
import { KokoroTTS, env } from 'kokoro-js';
import { KOKORO_MODEL as MODEL, VOICE_CACHE, type FromWorker, type KokoroDevice, type ToWorker } from './protocol';

// The app's TypeScript config has DOM types only, so describe the worker scope it uses here.
const scope = self as unknown as {
  postMessage(message: FromWorker, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent<ToWorker>) => void) | null;
};

// kokoro-js fetches a voice the first time it is used; storing them all at download time means
// every voice also works offline.
const voiceUrl = (id: string) => `https://huggingface.co/${MODEL}/resolve/main/voices/${id}.bin`;
// Used when a response has no Content-Length, so the progress bar still has a real total.
const EXPECTED_BYTES: Record<string, number> = { 'onnx/model.onnx': 325_532_232 };
const PROGRESS_EVERY_MS = 250;

let tts: KokoroTTS | null = null;
let device: KokoroDevice = 'wasm';
const queue: Array<{ id: number; text: string; voice: string }> = [];
let busy = false;

const post = (m: FromWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

/** Stores every listed voice now, so any of them works offline later. */
async function cacheVoices(ids: string[]): Promise<void> {
  const cache = await caches.open(VOICE_CACHE);
  await Promise.all(
    ids.map(async (id) => {
      if (await cache.match(voiceUrl(id))) return;
      const r = await fetch(voiceUrl(id));
      if (r.ok) await cache.put(voiceUrl(id), r);
    }),
  );
}

async function load(wasmPaths: string, voices: string[]): Promise<void> {
  env.wasmPaths = wasmPaths;
  const files = new Map<string, { loaded: number; total: number }>();
  let lastPost = 0;
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return;
    const size = p.total || EXPECTED_BYTES[p.file] || 0;
    if (!size) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: size });
    const now = performance.now();
    if (now - lastPost < PROGRESS_EVERY_MS && (p.loaded ?? 0) < size) return;
    lastPost = now;
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: 'progress', loaded, total });
  };
  device = (await hasWebGpu()) ? 'webgpu' : 'wasm';
  try {
    // fp32 everywhere: it is what Rockson approved by ear, and WebGPU needs it.
    tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'fp32', device, progress_callback });
  } catch (e) {
    if (device !== 'webgpu') throw e;
    console.warn('[kokoro] WebGPU failed, using WebAssembly', e);
    device = 'wasm';
    tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'fp32', device, progress_callback });
  }
  await cacheVoices(voices).catch((e: unknown) => console.warn('[kokoro] could not store the voices', e));
  // The first sentence on WebGPU compiles its shaders (several seconds); do it now, not on Play.
  await tts.generate('Ready.', { voice: 'bf_emma' }).catch(() => undefined);
  post({ type: 'ready', device });
}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        if (!tts) throw new Error('The voice model is not loaded.');
        const t0 = performance.now();
        const audio = await tts.generate(job.text, { voice: job.voice as keyof KokoroTTS['voices'] });
        const samples = audio.audio;
        post({ type: 'audio', id: job.id, samples, sampleRate: audio.sampling_rate, ms: performance.now() - t0 }, [samples.buffer]);
      } catch (e) {
        post({ type: 'error', id: job.id, message: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    busy = false;
  }
}

scope.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'load') {
    load(m.wasmPaths, m.voices).catch((e: unknown) => post({ type: 'load-error', message: e instanceof Error ? e.message : String(e) }));
  } else if (m.type === 'generate') {
    queue.push({ id: m.id, text: m.text, voice: m.voice });
    void drain();
  } else if (m.type === 'cancel') {
    const at = queue.findIndex((j) => j.id === m.id);
    if (at >= 0) queue.splice(at, 1);
  }
};
