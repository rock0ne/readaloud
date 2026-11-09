import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
interface IncomingAudio { ready: boolean; name?: string; path?: string; token?: string; }
interface AudioOpen {
  consume(): Promise<IncomingAudio>;
  release(opts: { token: string }): Promise<void>;
  addListener(event: 'available', fn: () => void): Promise<PluginListenerHandle>;
}
export const audioOpen = registerPlugin<AudioOpen>('AudioOpen');

export async function consumeOpenedAudio(importFile: (file: File) => Promise<void>): Promise<void> {
  const incoming = await audioOpen.consume();
  if (!incoming.ready) return;
  if (!incoming.path || !incoming.token || !incoming.name) throw new Error('The audio-open request is incomplete.');
  try {
    const response = await fetch(Capacitor.convertFileSrc(incoming.path));
    if (!response.ok) throw new Error('Could not read the selected audio. Use Import audio files.');
    const blob = await response.blob();
    await importFile(new File([blob], incoming.name, { type: blob.type }));
  } finally { await audioOpen.release({ token: incoming.token }); }
}
