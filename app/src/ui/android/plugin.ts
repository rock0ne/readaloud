// ReadAloud's own Android plugin: the phone's Kokoro engine and the screen-on flag (ADR-27,
// docs/05-ANDROID-KOKORO.md). The Java side is in android/app/src/main/java/uk/rocksonarthur/readaloud/.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface ReadAloudTts {
  engine(): Promise<{ installed: boolean; label?: string }>;
  init(): Promise<void>;
  synthesize(opts: { text: string }): Promise<{ path: string }>;
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
