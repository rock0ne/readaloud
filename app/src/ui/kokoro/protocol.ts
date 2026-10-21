// Messages between the app and the Kokoro worker, and the names they share.
export type KokoroDevice = 'webgpu' | 'wasm';

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** transformers.js keeps each model file in this cache, keyed by its download URL. */
export const MODEL_CACHE = 'transformers-cache';
/** kokoro-js keeps each voice file in this cache, keyed by its download URL. */
export const VOICE_CACHE = 'kokoro-voices';

export type ToWorker =
  | { type: 'load'; wasmPaths: string; voices: string[] }
  | { type: 'generate'; id: number; text: string; voice: string }
  | { type: 'cancel'; id: number };

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: KokoroDevice }
  | { type: 'load-error'; message: string }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number; ms: number }
  | { type: 'error'; id: number; message: string };
