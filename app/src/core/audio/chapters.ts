export interface AudioChapter { title: string; seconds: number; }

export function validateChapters(value: unknown, duration?: number): AudioChapter[] {
  if (!Array.isArray(value) || !value.length || value.length > 1000) throw new Error('A chapter map needs 1–1000 chapters.');
  let previous = -1;
  return value.map((item) => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 1000
      || typeof item.seconds !== 'number' || !Number.isFinite(item.seconds) || item.seconds < 0 || item.seconds <= previous
      || (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || item.seconds >= duration)))
      throw new Error('Chapter names and strictly increasing start times must fit this audio file.');
    previous = item.seconds;
    return { title: item.title.replace(/[\x00-\x1f]/g, ' ').trim(), seconds: item.seconds };
  });
}

export function chapterEnd(chapters: AudioChapter[], selected: number, duration: number): number {
  return chapters[selected + 1]?.seconds ?? duration;
}

/** Portable ReadAloud timing document, also carried in RIFF/ID3 metadata. */
export function timingDocument(chapters: AudioChapter[], durationSeconds: number): string {
  const json = JSON.stringify({ schema: 'readaloud.chapter-timings/1', durationSeconds, chapters: validateChapters(chapters, durationSeconds) });
  if (new TextEncoder().encode(json).length > 1024 * 1024) throw new Error('Chapter metadata exceeds 1 MiB.');
  return json;
}

/** RIFF permits application-specific chunks; players that do not know ralc skip it. */
export function wavChapterChunk(chapters: AudioChapter[], duration: number): Uint8Array<ArrayBuffer> {
  const payload = new TextEncoder().encode(timingDocument(chapters, duration));
  const chunk = new Uint8Array(8 + payload.length + payload.length % 2);
  chunk.set(new TextEncoder().encode('ralc')); new DataView(chunk.buffer).setUint32(4, payload.length, true);
  chunk.set(payload, 8); return chunk;
}

const tag = (bytes: Uint8Array, at: number, length = 4) => String.fromCharCode(...bytes.subarray(at, at + length));
const synchsafe = (b: Uint8Array, at: number) => {
  const values = b.subarray(at, at + 4);
  if (values.length !== 4 || values.some(v => v > 127)) throw new Error('Invalid ID3 size.');
  return values.reduce((n, v) => n * 128 + v, 0);
};

async function wavChapters(file: Blob): Promise<AudioChapter[]> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') return [];
  const end = new DataView(head.buffer).getUint32(4, true) + 8;
  if (end > file.size) throw new Error('Truncated WAV container.');
  for (let at = 12, count = 0; at + 8 <= end; count++) {
    if (count > 10000) throw new Error('Too many WAV chunks.');
    const h = new Uint8Array(await file.slice(at, at + 8).arrayBuffer());
    const size = new DataView(h.buffer).getUint32(4, true);
    if (at + 8 + size > end) throw new Error('Truncated WAV chunk.');
    if (tag(h, 0) === 'ralc') {
      if (size > 1024 * 1024) throw new Error('Chapter metadata exceeds 1 MiB.');
      return parseTimingDocument(await file.slice(at + 8, at + 8 + size).text());
    }
    at += 8 + size + size % 2;
  }
  return [];
}

async function mp3Chapters(file: Blob): Promise<AudioChapter[]> {
  // Read only bounded ID3v2.4 frames emitted by our pinned muxer, never the audio payload.
  const h = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (tag(h, 0, 3) !== 'ID3') return [];
  if (h[3] !== 4 || h[5] !== 0) return []; // Other schemes remain playable, not guessed.
  const end = 10 + synchsafe(h, 6);
  if (end > file.size) throw new Error('Truncated ID3 tag.');
  for (let at = 10, count = 0; at + 10 <= end; count++) {
    if (count > 10000) throw new Error('Too many ID3 frames.');
    const frame = new Uint8Array(await file.slice(at, at + 10).arrayBuffer());
    if (frame[0] === 0) break;
    const size = synchsafe(frame, 4);
    if (at + 10 + size > end) throw new Error('Truncated ID3 frame.');
    if (tag(frame, 0) === 'TXXX' && frame[8] === 0 && frame[9] === 0) {
      if (size > 1024 * 1024 + 128) throw new Error('Chapter metadata exceeds 1 MiB.');
      const b = new Uint8Array(await file.slice(at + 10, at + 10 + size).arrayBuffer());
      if (b[0] === 0 || b[0] === 3) {
        const split = b.indexOf(0, 1);
        if (split > 0 && tag(b, 1, split - 1) === 'readaloud.chapters') {
          const value = b.subarray(split + 1);
          // The muxer chooses Latin-1 when all characters fit. TextDecoder's
          // "latin1" is actually Windows-1252, so decode ISO-8859-1 literally.
          let json = '';
          if (b[0] === 0) {
            for (let at = 0; at < value.length; at += 4096) json += String.fromCharCode(...value.subarray(at, at + 4096));
          } else json = new TextDecoder('utf-8', { fatal: true }).decode(value);
          json = json.replace(/\0+$/, '');
          return parseTimingDocument(json);
        }
      }
    }
    at += 10 + size;
  }
  return [];
}

function parseTimingDocument(json: string, duration?: number): AudioChapter[] {
  if (new TextEncoder().encode(json).length > 1024 * 1024) throw new Error('Chapter metadata exceeds 1 MiB.');
  const value = JSON.parse(json);
  if (value?.schema !== 'readaloud.chapter-timings/1' || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0
    || (duration !== undefined && Math.abs(value.durationSeconds - duration) > 1)) throw new Error('Chapter timings do not match this audio duration.');
  return validateChapters(value.chapters, duration ?? value.durationSeconds);
}

/** Read app-exported Nero chpl markers via bounded MP4 box reads; never load mdat. */
export async function embeddedChapters(file: Blob, name: string): Promise<AudioChapter[]> {
  if (/\.wav$/i.test(name)) return wavChapters(file);
  if (/\.mp3$/i.test(name)) return mp3Chapters(file);
  if (!/\.(m4a|m4b|mp4)$/i.test(name)) return [];
  let boxes = 0;
  async function scan(start: number, end: number, depth: number): Promise<AudioChapter[]> {
    if (depth > 4) throw new Error('Chapter metadata is too deeply nested.');
    let at = start;
    while (at + 8 <= end) {
      if (++boxes > 10000) throw new Error('Too many MP4 metadata boxes.');
      const header = new DataView(await file.slice(at, Math.min(end, at + 16)).arrayBuffer());
      const type = String.fromCharCode(...new Uint8Array(header.buffer, 4, 4));
      let size = header.getUint32(0, false), prefix = 8;
      if (size === 1) {
        if (header.byteLength < 16) throw new Error('Truncated MP4 box.');
        const big = header.getBigUint64(8, false);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 box is too large.');
        size = Number(big); prefix = 16;
      } else if (size === 0) size = end - at;
      if (size < prefix || at + size > end) throw new Error('Invalid MP4 chapter container.');
      if (type === 'chpl') {
        if (size - prefix > 300000) throw new Error('Chapter metadata is too large.');
        const bytes = new Uint8Array(await file.slice(at + prefix, at + size).arrayBuffer());
        if (bytes.length < 9 || bytes[0] !== 1) throw new Error('Unsupported chapter marker version.');
        const v = new DataView(bytes.buffer), result: AudioChapter[] = []; let offset = 9;
        for (let i = 0; i < bytes[8]!; i++) {
          if (offset + 9 > bytes.length) throw new Error('Truncated chapter markers.');
          const seconds = Number(v.getBigUint64(offset, false)) / 10000000; offset += 8;
          const length = bytes[offset++]!;
          if (offset + length > bytes.length) throw new Error('Truncated chapter name.');
          const title = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length)); offset += length;
          result.push({ title, seconds });
        }
        return validateChapters(result);
      }
      if (type === 'moov' || type === 'udta') {
        const result = await scan(at + prefix, at + size, depth + 1);
        if (result.length) return result;
      }
      at += size;
    }
    return [];
  }
  return scan(0, file.size, 0);
}

/** Explicit sidecar, not guessed boundaries. Size/duration are compatibility checks, not cryptographic identity. */
export function parseChapterMap(json: string, bytes: number, duration: number): AudioChapter[] {
  if (new TextEncoder().encode(json).length > 1024 * 1024) throw new Error('Chapter map exceeds 1 MiB.');
  const value = JSON.parse(json);
  if (value?.schema === 'readaloud.chapter-timings/1') return parseTimingDocument(json, duration);
  if (value?.schema !== 'readaloud.audio-chapters/1' || value.audioBytes !== bytes
    || typeof value.durationSeconds !== 'number' || !Number.isFinite(value.durationSeconds)
    || Math.abs(value.durationSeconds - duration) > 1) throw new Error('This chapter map does not match the audio size/duration.');
  return validateChapters(value.chapters, duration);
}
