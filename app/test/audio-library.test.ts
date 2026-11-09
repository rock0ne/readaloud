import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { AUDIO_ACCEPT, AudioLibraryStore, audioMime, validateAudioFile } from '../src/core/audio/library';
import { encodeWav } from '../src/core/audio/wav';
vi.stubGlobal('Blob', NodeBlob);
const stores: AudioLibraryStore[] = []; let n = 0;
afterEach(() => { for (const store of stores) store.close(); stores.length = 0; });

it('accepts common audio formats without a ZIP', () => {
  for (const ext of ['wav', 'mp3', 'm4a', 'm4b', 'mp4', 'aac', 'ogg', 'opus', 'flac']) {
    expect(audioMime(`Book.${ext.toUpperCase()}`)).toMatch(/^audio\//);
    expect(AUDIO_ACCEPT).toContain(`.${ext}`);
  }
  expect(() => audioMime('Book.zip')).toThrow('not a ZIP');
});

it('rejects empty files and ZIPs renamed to audio', async () => {
  await expect(validateAudioFile(new Blob([]), 'Book.wav')).rejects.toThrow('empty');
  await expect(validateAudioFile(new Blob([new Uint8Array([0x50, 0x4b, 3, 4])]), 'Book.mp3')).rejects.toThrow('ZIP');
});

it('stores the file Blob, preserves position on reopen and deletes only that audio copy', async () => {
  const name = `audio-library-${++n}`, store = await AudioLibraryStore.open(name); stores.push(store);
  const wav = encodeWav(new Float32Array([0.1, -0.1]), 24000);
  const item = await store.add(wav, 'Whole book.wav');
  const other = await store.add(wav, 'Chapter two.wav');
  await store.remember(item.id, 123.5, 1.25);
  const reopened = await AudioLibraryStore.open(name); stores.push(reopened);
  expect(await reopened.position(item.id)).toEqual({ id: item.id, seconds: 123.5, rate: 1.25 });
  expect((await reopened.list()).map((v) => v.name)).toContain('Whole book.wav');
  expect(new Uint8Array(await (await reopened.get(item.id))!.blob.arrayBuffer())).toEqual(new Uint8Array(await wav.arrayBuffer()));
  await reopened.remove(item.id);
  expect(await reopened.position(item.id)).toBeUndefined();
  expect(await reopened.get(other.id)).toBeDefined();
});

it('never reads a complete large audio file into JS memory while adding it', async () => {
  const store = await AudioLibraryStore.open(`audio-library-${++n}`); stores.push(store);
  const blob = new Blob([new Uint8Array(1024)]);
  Object.defineProperty(blob, 'arrayBuffer', { value: () => { throw new Error('Whole-file read forbidden'); } });
  expect((await store.add(blob, 'Book.mp3')).bytes).toBe(1024);
  await store.remember('x', Infinity, 1); expect(await store.position('x')).toBeUndefined();
});
