// Durable whole-book narration. Preparation is explicit; playback never needs a network service.
import type { EngineId, NarrationRecord, Voice, VoiceEngine } from '../types';
import { sha256Hex } from '../util/hash';
import { encodeWav } from './wav';

export interface NarrationUnit { chapter: number; texts: string[]; beforeMs: number; afterMs: number; }
export interface NarrationPlan { docId: string; sourceHash: string; units: NarrationUnit[]; texts: string[]; }
export interface NarrationStore {
  getPreparedAudio(docId: string, key: string): Promise<Blob | undefined>;
  putPreparedAudio(docId: string, key: string, blob: Blob): Promise<void>;
  getNarration(key: string): Promise<NarrationRecord | undefined>;
  putNarration(value: NarrationRecord): Promise<void>;
}
export interface NarrationProgress { completed: number; total: number; bytes: number; }

export const audioKey = async (engine: EngineId, voice: string, text: string) =>
  `${engine}|${voice}|1.0|v2|${await sha256Hex(new TextEncoder().encode(text))}`;

export async function narrationIdentity(plan: NarrationPlan, voiceId: string): Promise<{ key: string; planHash: string }> {
  const planHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(plan)));
  return { key: `${plan.docId}|kokoro|${voiceId}|${planHash}`, planHash };
}

/** Re-check persisted clips, not just a stale ready flag, after restarts or storage loss. */
export async function inspectNarration(plan: NarrationPlan, voiceId: string, store: NarrationStore): Promise<NarrationRecord> {
  const id = await narrationIdentity(plan, voiceId);
  const result: NarrationRecord = { ...id, docId: plan.docId, voiceId, total: plan.texts.length,
    completed: 0, bytes: 0, ready: false, updatedAt: new Date().toISOString() };
  for (const text of plan.texts) {
    const blob = await store.getPreparedAudio(plan.docId, await audioKey('kokoro', voiceId, text));
    if (blob?.size) { result.completed++; result.bytes += blob.size; }
  }
  result.ready = result.total > 0 && result.completed === result.total;
  return result;
}

export async function prepareNarration(plan: NarrationPlan, engine: VoiceEngine, voice: Voice,
  store: NarrationStore, signal: AbortSignal, progress: (p: NarrationProgress) => void): Promise<NarrationRecord> {
  if (engine.id !== 'kokoro' || !voice.offline || !engine.synthesize) throw new Error('Choose a local Kokoro voice to prepare an audiobook.');
  if (!plan.texts.length) throw new Error('There is no speakable text with these reading settings.');
  const id = await narrationIdentity(plan, voice.id);
  const record: NarrationRecord = { ...id, docId: plan.docId, voiceId: voice.id, total: plan.texts.length,
    completed: 0, bytes: 0, ready: false, updatedAt: new Date().toISOString() };
  await store.putNarration(record);
  for (const text of plan.texts) {
    signal.throwIfAborted();
    const key = await audioKey(engine.id, voice.id, text);
    let blob = await store.getPreparedAudio(plan.docId, key);
    if (!blob?.size) {
      blob = await engine.synthesize(text, { voice, rate: 1 }, signal);
      signal.throwIfAborted();
      if (!blob.size) throw new Error('The voice returned an empty clip. Preparation stopped.');
      await store.putPreparedAudio(plan.docId, key, blob);
    }
    signal.throwIfAborted();
    record.completed++; record.bytes += blob.size;
    record.updatedAt = new Date().toISOString();
    await store.putNarration({ ...record });
    progress({ completed: record.completed, total: record.total, bytes: record.bytes });
  }
  signal.throwIfAborted();
  record.ready = true;
  await store.putNarration({ ...record });
  return record;
}

/** A chapter is assembled from committed WAVs; never asks the speech engine to generate. */
export async function exportChapter(plan: NarrationPlan, chapter: number, voiceId: string,
  store: NarrationStore, signal: AbortSignal): Promise<Blob> {
  const parts: Blob[] = [];
  let rate = 0, size = 0;
  const add = (pcm: Blob) => {
    size += pcm.size;
    // Do not accumulate an unbounded multi-gigabyte Blob on a phone.
    if (size > 256 * 1024 * 1024) throw new Error('This chapter exceeds the 256 MB export limit. Split it into smaller chapters first.');
    parts.push(pcm);
  };
  const silence = (ms: number) => { if (ms > 0) add(new Blob([new Uint8Array(Math.round(rate * ms / 1000) * 2)])); };
  for (const unit of plan.units.filter((u) => u.chapter === chapter)) {
    for (let i = 0; i < unit.texts.length; i++) {
      signal.throwIfAborted();
      const blob = await store.getPreparedAudio(plan.docId, await audioKey('kokoro', voiceId, unit.texts[i]!));
      if (!blob) throw new Error('Chapter audio is incomplete. Prepare the book first.');
      const { sampleRate, pcm } = await pcmOf(blob);
      if (rate && rate !== sampleRate) throw new Error('Chapter clips have different sample rates.');
      rate = sampleRate;
      if (i === 0) silence(unit.beforeMs);
      add(pcm);
    }
    silence(unit.afterMs);
  }
  signal.throwIfAborted();
  if (!size) throw new Error('This chapter has no prepared audio.');
  const header = new Uint8Array(await encodeWav(new Float32Array(), rate).arrayBuffer());
  const v = new DataView(header.buffer);
  v.setUint32(4, 36 + size, true); v.setUint32(40, size, true);
  return new Blob([header, ...parts], { type: 'audio/wav' });
}

async function pcmOf(blob: Blob): Promise<{ sampleRate: number; pcm: Blob }> {
  // The local engine emits canonical 44-byte, mono 16-bit PCM WAVs.
  const b = await blob.slice(0, 44).arrayBuffer();
  if (b.byteLength !== 44) throw new Error('Prepared audio has a truncated WAV header.');
  const v = new DataView(b);
  const tag = (at: number) => String.fromCharCode(...new Uint8Array(b, at, 4));
  const size = v.getUint32(40, true), sampleRate = v.getUint32(24, true);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data'
    || v.getUint32(16, true) !== 16 || v.getUint16(20, true) !== 1
    || v.getUint16(22, true) !== 1 || v.getUint16(34, true) !== 16
    || sampleRate < 8000 || sampleRate > 192000 || size % 2 || size !== blob.size - 44) {
    throw new Error('Prepared audio is not a complete mono 16-bit PCM WAV.');
  }
  return { sampleRate, pcm: blob.slice(44) };
}

// Classic WAV/RIFF uses 32-bit lengths. Keep the entire file below 4 GiB.
export const MAX_BOOK_WAV_BYTES = 0xfffffffe;
export interface BookWav { bytes: number; sampleRate: number; chapterStarts: { chapter: number; sample: number }[]; chunks: AsyncGenerator<Uint8Array>; }

/** Two bounded passes over committed clips. No synthesis, decoded book array or giant Blob. */
export async function wholeBookWav(plan: NarrationPlan, voiceId: string, store: NarrationStore,
  signal: AbortSignal, pcmOnly = false): Promise<BookWav> {
  let rate = 0, dataBytes = 0;
  const chapterStarts: BookWav['chapterStarts'] = [];
  const pauseSize = (ms: number, hz: number) => {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000) throw new Error('Invalid narration pause.');
    return Math.round(hz * ms / 1000) * 2;
  };
  const read = async (text: string) => {
    signal.throwIfAborted();
    const blob = await store.getPreparedAudio(plan.docId, await audioKey('kokoro', voiceId, text));
    if (!blob) throw new Error('Book audio is incomplete. Prepare the whole book first.');
    return pcmOf(blob);
  };
  let clips = 0;
  for (const unit of plan.units) {
    const start = dataBytes;
    for (let i = 0; i < unit.texts.length; i++) {
      const clip = await read(unit.texts[i]!);
      if (rate && rate !== clip.sampleRate) throw new Error('Book clips have different sample rates.');
      rate = clip.sampleRate;
      if (i === 0 && chapterStarts.at(-1)?.chapter !== unit.chapter) chapterStarts.push({ chapter: unit.chapter, sample: start / 2 });
      dataBytes += clip.pcm.size + (i === 0 ? pauseSize(unit.beforeMs, rate) : 0);
      clips++;
    }
    if (unit.texts.length) dataBytes += pauseSize(unit.afterMs, rate);
    if (!pcmOnly && dataBytes + 44 > MAX_BOOK_WAV_BYTES) throw new Error('This book exceeds the 4 GiB WAV limit. Use chapter WAVs instead.');
    if (!Number.isSafeInteger(dataBytes)) throw new Error('Prepared audio exceeds the supported length.');
  }
  signal.throwIfAborted();
  if (!clips || !dataBytes) throw new Error('This book has no prepared audio.');
  const header = pcmOnly ? new Uint8Array() : new Uint8Array(await encodeWav(new Float32Array(), rate).arrayBuffer());
  if (!pcmOnly) {
    const view = new DataView(header.buffer);
    view.setUint32(4, 36 + dataBytes, true); view.setUint32(40, dataBytes, true);
  }
  async function* silence(bytes: number) {
    for (let at = 0; at < bytes; at += 65536) {
      signal.throwIfAborted(); yield new Uint8Array(Math.min(65536, bytes - at));
    }
  }
  async function* chunks(): AsyncGenerator<Uint8Array> {
    signal.throwIfAborted(); if (!pcmOnly) yield header;
    let written = 0;
    for (const unit of plan.units) {
      for (let i = 0; i < unit.texts.length; i++) {
        const clip = await read(unit.texts[i]!);
        if (clip.sampleRate !== rate) throw new Error('Saved audio changed during export.');
        if (i === 0) {
          const n = pauseSize(unit.beforeMs, rate); written += n; yield* silence(n);
        }
        written += clip.pcm.size;
        if (written > dataBytes) throw new Error('Saved audio changed during export.');
        for (let at = 0; at < clip.pcm.size; at += 65536) {
          signal.throwIfAborted(); yield new Uint8Array(await clip.pcm.slice(at, at + 65536).arrayBuffer());
        }
      }
      if (unit.texts.length) {
        const n = pauseSize(unit.afterMs, rate); written += n; yield* silence(n);
      }
    }
    signal.throwIfAborted();
    if (written !== dataBytes) throw new Error('Saved audio changed during export.');
  }
  return { bytes: (pcmOnly ? 0 : 44) + dataBytes, sampleRate: rate, chapterStarts, chunks: chunks() };
}
