// ReadAloud's own Android plugin: Kokoro made in the app from voice files it downloads once,
// the screen-on flag, and reading with the screen off with lock-screen and car controls
// (ADR-27, ADR-37, ADR-39, docs/05-ANDROID-KOKORO.md). The Java side is in
// android/app/src/main/java/uk/rocksonarthur/readaloud/.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/** A button pressed on the lock screen, in the notification, or on a car or headset (ADR-39). */
export type MediaAction = 'play' | 'pause' | 'next' | 'previous';

/** What the reader tells the phone it is doing (ADR-39). */
export type PlaybackState = 'playing' | 'paused' | 'stopped';

export interface TtsEvents {
  download: { loaded: number; total: number };
  media: { action: MediaAction };
}

export interface ReadAloudTts {
  beginAudioExport(opts: { name: string; expectedBytes?: number; maxBytes?: number }): Promise<{ token: string }>;
  appendAudioExport(opts: { token: string; data: string; position?: number }): Promise<void>;
  finishAudioExport(opts: { token: string; name: string; mime?: string }): Promise<void>;
  cancelAudioExport(opts: { token: string }): Promise<void>;
  /** Whether the voice files are on the phone; the download's size; what an earlier try left. */
  voice(): Promise<{ installed: boolean; bytes: number; downloaded: number }>;
  /** Downloads, checks and unpacks the voice files, going on from an earlier try (ADR-37). */
  downloadVoice(): Promise<void>;
  removeVoice(): Promise<void>;
  addListener<E extends keyof TtsEvents>(event: E, fn: (p: TtsEvents[E]) => void): Promise<PluginListenerHandle>;
  /** Loads the model, once. */
  init(): Promise<void>;
  /** One clip as a WAV file from a piece of text's phonemes; `sid` is the speaker number in the model. */
  synthesize(opts: { phonemes: string; sid: number }): Promise<{ path: string }>;
  stop(): Promise<void>;
  keepScreenOn(opts: { on: boolean }): Promise<void>;
  /**
   * Starts, updates or ends the foreground service that keeps reading with the screen off, and
   * shows the title and chapter on the lock screen (ADR-39).
   */
  playback(opts: { state: PlaybackState; title: string; chapter: string }): Promise<void>;
  /**
   * Stops another player such as Spotify for good, just before a clip that does not follow
   * straight on from the last one; the focus is let go at once (ADR-39).
   */
  takeAudioFocus(): Promise<{ granted: boolean }>;
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
