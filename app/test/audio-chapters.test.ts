import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { chapterPayload } from '../src/core/audio/formats';
import { embeddedChapters, validateChapters, parseChapterMap, chapterEnd, timingDocument, wavChapterChunk } from '../src/core/audio/chapters';
vi.stubGlobal('Blob', NodeBlob);
const markers = [{ title: 'Opening', seconds: 0 }, { title: 'Chapter 二', seconds: 4.5 }];
function box(type: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + bytes.length), v = new DataView(out.buffer);
  v.setUint32(0, out.length, false); out.set(new TextEncoder().encode(type), 4); out.set(bytes, 8); return out;
}
it('reads the exporter chapter format with Unicode titles without a whole-file read', async () => {
  const audio = new Blob([box('mdat', new Uint8Array(1024 * 1024)), box('moov', box('udta', box('chpl', chapterPayload(markers))))]);
  Object.defineProperty(audio, 'arrayBuffer', { value: () => { throw new Error('Whole file read forbidden'); } });
  expect(await embeddedChapters(audio, 'BOOK.M4B')).toEqual(markers);
  expect(chapterEnd(markers, 0, 12)).toBe(4.5); expect(chapterEnd(markers, 1, 12)).toBe(12);
});
it('does not invent markers for MP3/WAV or MP4 without chapters', async () => {
  expect(await embeddedChapters(new Blob(['audio']), 'book.mp3')).toEqual([]);
  expect(await embeddedChapters(new Blob(['audio']), 'book.wav')).toEqual([]);
  expect(await embeddedChapters(new Blob([box('mdat', new Uint8Array(12))]), 'book.m4a')).toEqual([]);
});
it('rejects malformed sizes, truncated marker names, unordered and out-of-duration starts', async () => {
  const broken = box('moov', new Uint8Array(10)); new DataView(broken.buffer).setUint32(0, 999999, false);
  await expect(embeddedChapters(new Blob([broken]), 'book.m4b')).rejects.toThrow('Invalid MP4');
  const payload = chapterPayload(markers).slice(0, -1);
  await expect(embeddedChapters(new Blob([box('moov', box('udta', box('chpl', payload)))]), 'book.m4b')).rejects.toThrow('Truncated');
  expect(() => validateChapters([{title:'A',seconds:2},{title:'B',seconds:1}])).toThrow();
  expect(() => validateChapters(markers, 4)).toThrow();
  expect(() => validateChapters([{title:'A',seconds:NaN}])).toThrow();
});
it('accepts only a bounded explicit sidecar matching file size and duration', () => {
  const json = JSON.stringify({schema:'readaloud.audio-chapters/1',audioBytes:12345,durationSeconds:12,chapters:markers});
  expect(parseChapterMap(json,12345,12)).toEqual(markers);
  expect(() => parseChapterMap(json,12346,12)).toThrow('does not match');
  expect(() => parseChapterMap(json,12345,20)).toThrow('does not match');
  expect(() => parseChapterMap('x'.repeat(1024*1024+1),12345,12)).toThrow('exceeds');
});

it('reads WAV chapter metadata after skipping PCM without a whole-file read', async () => {
  const pcm = new Uint8Array(48000 * 12), extra = wavChapterChunk(markers, 12);
  const header = new Uint8Array(44), v = new DataView(header.buffer);
  header.set(new TextEncoder().encode('RIFF')); v.setUint32(4, 36 + pcm.length + extra.length, true);
  header.set(new TextEncoder().encode('WAVE'), 8); header.set(new TextEncoder().encode('data'), 36); v.setUint32(40, pcm.length, true);
  // Include an unknown fmt chunk to exercise bounded skipping.
  header.set(new TextEncoder().encode('fmt '), 12); v.setUint32(16, 16, true);
  const file = new Blob([header, pcm, extra]);
  Object.defineProperty(file, 'arrayBuffer', { value: () => { throw new Error('Whole file read forbidden'); } });
  expect(await embeddedChapters(file, 'old-or-new.WAV')).toEqual(markers);
  const bad = header.slice(); new DataView(bad.buffer).setUint32(4, 0xffffffff, true);
  await expect(embeddedChapters(new Blob([bad]), 'bad.wav')).rejects.toThrow('Truncated');
});

function safeSize(n: number) { return new Uint8Array([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]); }
it('reads bounded ID3v2.4 TXXX chapters including Unicode, and rejects truncated frames', async () => {
  const payload = new TextEncoder().encode('\x03readaloud.chapters\0' + timingDocument(markers, 12) + '\0');
  const frame = new Uint8Array(10 + payload.length); frame.set(new TextEncoder().encode('TXXX')); frame.set(safeSize(payload.length), 4); frame.set(payload, 10);
  const head = new Uint8Array([73,68,51,4,0,0,0,0,0,0]); head.set(safeSize(frame.length), 6);
  const file = new Blob([head, frame, new Uint8Array(1000000)]);
  Object.defineProperty(file, 'arrayBuffer', { value: () => { throw new Error('Whole file read forbidden'); } });
  expect(await embeddedChapters(file, 'book.mp3')).toEqual(markers);
  await expect(embeddedChapters(new Blob([head, frame.slice(0,-1)]), 'book.mp3')).rejects.toThrow('Truncated');
});

it('recovers old audio via timing-only export without requiring audio bytes or new synthesis', () => {
  const json = timingDocument(markers, 12);
  expect(parseChapterMap(json, 999, 12.02)).toEqual(markers);
  expect(() => parseChapterMap(json, 999, 14)).toThrow('duration');
  expect(() => timingDocument(markers, 3)).toThrow();
});

it('reads the muxer Latin-1 ID3 text encoding without corrupting accented titles', async () => {
  const chapters = [{title:'Café \u0080',seconds:0}];
  const text = '\0readaloud.chapters\0' + timingDocument(chapters,12) + '\0';
  const payload = Uint8Array.from(text, c => c.charCodeAt(0));
  const frame = new Uint8Array(10 + payload.length); frame.set(new TextEncoder().encode('TXXX')); frame.set(safeSize(payload.length),4); frame.set(payload,10);
  const head = new Uint8Array([73,68,51,4,0,0,0,0,0,0]); head.set(safeSize(frame.length),6);
  expect(await embeddedChapters(new Blob([head,frame,new Uint8Array(4)]),'accented.mp3')).toEqual(chapters);
});
