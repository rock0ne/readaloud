// ReadAloud's own Android plugin: Kokoro made in the app from voice files it downloads once,
// and the screen-on flag (ADR-27, ADR-37, docs/05-ANDROID-KOKORO.md). The Java side is in
// android/app/src/main/java/uk/rocksonarthur/readaloud/.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface ReadAloudTts {
  /** Whether the voice files are on the phone; the download's size; what an earlier try left. */
  voice(): Promise<{ installed: boolean; bytes: number; downloaded: number }>;
  /** Downloads, checks and unpacks the voice files, going on from an earlier try (ADR-37). */
  downloadVoice(): Promise<void>;
  removeVoice(): Promise<void>;
  addListener(event: 'download', fn: (p: { loaded: number; total: number }) => void): Promise<PluginListenerHandle>;
  /** Loads the model, once. */
  init(): Promise<void>;
  /** One clip as a WAV file from a piece of text's phonemes; `sid` is the speaker number in the model. */
  synthesize(opts: { phonemes: string; sid: number }): Promise<{ path: string }>;
  stop(): Promise<void>;
  keepScreenOn(opts: { on: boolean }): Promise<void>;
}

/** true inside the Android app, false in a browser */
export const IN_ANDROID_APP = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const readAloudTts = registerPlugin<ReadAloudTts>('ReadAloudTts');

/** Reads a file the plugin wrote, through the app's own web server. */
export async function readAppFile(path: string): Promise<ArrayBuffer> {
  const res = await fetch(Capacitor.convertFileSrc(path));
  if (!res.ok) throw new Error(`Could not read the voice clip (${res.status}).`);
  return res.arrayBuffer();
}
