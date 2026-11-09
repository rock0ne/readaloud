import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ consume: vi.fn(), release: vi.fn() }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => native, Capacitor: { convertFileSrc: (path: string) => `https://localhost/_capacitor_file_${path}` } }));
import { consumeOpenedAudio } from '../src/ui/android/audio-open';
beforeEach(() => { vi.resetAllMocks(); native.release.mockResolvedValue(undefined); });

it('imports a native selected file and releases only its staging token', async () => {
  native.consume.mockResolvedValue({ ready: true, token: 'stage-1', path: '/cache/audio-open/stage-1', name: 'Book.mp3' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }) })));
  const add = vi.fn(async (file: File) => { expect(file.name).toBe('Book.mp3'); expect(file.size).toBe(5); });
  await consumeOpenedAudio(add);
  expect(add).toHaveBeenCalledTimes(1); expect(native.release).toHaveBeenCalledWith({ token: 'stage-1' });
  vi.unstubAllGlobals();
});

it('releases staging after a read failure without importing anything', async () => {
  native.consume.mockResolvedValue({ ready: true, token: 'stage-2', path: '/cache/audio-open/stage-2', name: 'Book.m4b' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  const add = vi.fn(); await expect(consumeOpenedAudio(add)).rejects.toThrow('Could not read');
  expect(add).not.toHaveBeenCalled(); expect(native.release).toHaveBeenCalledWith({ token: 'stage-2' });
  vi.unstubAllGlobals();
});

it('does nothing when there is no external audio request', async () => {
  native.consume.mockResolvedValue({ ready: false }); const add = vi.fn();
  await consumeOpenedAudio(add); expect(add).not.toHaveBeenCalled(); expect(native.release).not.toHaveBeenCalled();
});
