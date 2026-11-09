import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/ui/android/plugin', () => ({ IN_ANDROID_APP: true, readAloudTts: {
  beginAudioExport: vi.fn(), appendAudioExport: vi.fn(), finishAudioExport: vi.fn(), cancelAudioExport: vi.fn(),
} }));
vi.mock('../src/core/audio/narration', () => ({ wholeBookWav: vi.fn() }));
vi.mock('../src/core/audio/encode', () => ({ encodePreparedAudio: vi.fn() }));
import { readAloudTts } from '../src/ui/android/plugin';
import { wholeBookWav, type NarrationStore } from '../src/core/audio/narration';
import { encodePreparedAudio } from '../src/core/audio/encode';
import { saveAudioExport } from '../src/ui/book-export';
import { embeddedChapters } from '../src/core/audio/chapters';
import { Blob as NodeBlob } from 'node:buffer';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readAloudTts.beginAudioExport).mockResolvedValue({ token: 'test-token' });
  vi.mocked(readAloudTts.appendAudioExport).mockResolvedValue();
  vi.mocked(readAloudTts.finishAudioExport).mockResolvedValue();
  vi.mocked(readAloudTts.cancelAudioExport).mockResolvedValue();
  vi.mocked(wholeBookWav).mockImplementation(async () => ({ bytes: 100000, sampleRate: 24000,
    chapterStarts: [{ chapter: 0, sample: 0 }], chunks: (async function* () { yield new Uint8Array(48); })() }));
  vi.mocked(encodePreparedAudio).mockImplementation(async (_p, _f, _t, _c, _b, write) => {
    await write(new Uint8Array(65546), 0); await write(new Uint8Array([1, 2, 3, 4]), 100);
  });
});
const plan = { docId: 'test', sourceHash: 'hash', units: [], texts: [] };
const store = {} as NarrationStore;

it.each(['mp3', 'm4a', 'm4b'] as const)('uses bounded positioned bridge chunks and correct MIME for %s', async (format) => {
  await saveAudioExport(`test.${format}`, plan, 'bf_emma', store, new AbortController().signal, () => {}, format, 'Title', [{ index: 0, title: 'One' }], 128000);
  expect(readAloudTts.beginAudioExport).toHaveBeenCalledWith(expect.objectContaining({ maxBytes: expect.any(Number) }));
  expect(readAloudTts.appendAudioExport).toHaveBeenCalledTimes(3);
  const calls = vi.mocked(readAloudTts.appendAudioExport).mock.calls;
  expect(calls.map((c) => c[0].position)).toEqual([0, 65536, 100]);
  expect(calls.every((c) => atob(c[0].data).length <= 65536)).toBe(true);
  expect(readAloudTts.finishAudioExport).toHaveBeenCalledWith({ token: 'test-token', name: `test.${format}`, mime: format === 'mp3' ? 'audio/mpeg' : 'audio/mp4' });
  expect(readAloudTts.cancelAudioExport).toHaveBeenCalledWith({ token: 'test-token' });
});
it('cancels temporary audio and does not finalize after a bridge write failure', async () => {
  vi.mocked(readAloudTts.appendAudioExport).mockRejectedValue(new Error('disk full'));
  await expect(saveAudioExport('test.mp3', plan, 'bf_emma', store, new AbortController().signal, () => {}, 'mp3', 'Title', [], 128000)).rejects.toThrow('disk full');
  expect(readAloudTts.finishAudioExport).not.toHaveBeenCalled();
  expect(readAloudTts.cancelAudioExport).toHaveBeenCalled();
});
it('does not begin a save for an already-cancelled operation', async () => {
  const ac = new AbortController(); ac.abort();
  await expect(saveAudioExport('test.mp3', plan, 'bf_emma', store, ac.signal, () => {}, 'mp3', 'Title', [], 128000)).rejects.toThrow();
  expect(readAloudTts.beginAudioExport).not.toHaveBeenCalled();
});

it('exports WAV with a correct RIFF length and embedded timings through the Android bridge', async () => {
  const header = new Uint8Array(44), v = new DataView(header.buffer);
  header.set(new TextEncoder().encode('RIFF')); v.setUint32(4, 96036, true);
  header.set(new TextEncoder().encode('WAVEfmt '), 8); v.setUint32(16, 16, true);
  header.set(new TextEncoder().encode('data'), 36); v.setUint32(40, 96000, true);
  vi.mocked(wholeBookWav).mockResolvedValue({ bytes: 96044, sampleRate: 24000,
    chapterStarts: [{chapter:0,sample:0},{chapter:1,sample:24000}],
    chunks: (async function*(){yield header; yield new Uint8Array(96000);})() });
  await saveAudioExport('whole.wav', plan, 'voice', store, new AbortController().signal, () => {}, 'wav', 'Book', [{index:0,title:'One'},{index:1,title:'Two'}], 128000);
  const parts = vi.mocked(readAloudTts.appendAudioExport).mock.calls.map(c => Uint8Array.from(atob(c[0].data), x => x.charCodeAt(0)));
  const file = new NodeBlob(parts);
  expect(new DataView(await file.slice(0, 44).arrayBuffer()).getUint32(4,true)).toBe(file.size-8);
  expect(readAloudTts.beginAudioExport).toHaveBeenCalledWith({name:'whole.wav',expectedBytes:file.size});
  expect(await embeddedChapters(file as unknown as Blob, 'whole.wav')).toEqual([{title:'One',seconds:0},{title:'Two',seconds:1}]);
});
