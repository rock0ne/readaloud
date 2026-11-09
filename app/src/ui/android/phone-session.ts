// Reading with the screen off in the Android app, with the lock screen, notification, car and
// headset buttons working the player (ADR-39). The web side still makes and plays every clip;
// this only tells the phone what the reader is doing, so Android keeps the app running, and
// passes the buttons back.
import type { PluginListenerHandle } from '@capacitor/core';
import type { MediaAction, PlaybackState, ReadAloudTts } from './plugin';

export interface PhoneSessionControls {
  play(): Promise<void>;
  pause(): void;
  prev(): void;
  next(): void;
}

export class PhoneSession {
  private readonly tts: ReadAloudTts;
  private controls: PhoneSessionControls | null = null;
  private listening: Promise<PluginListenerHandle> | null = null;
  private last = 'stopped';

  constructor(tts: ReadAloudTts) {
    this.tts = tts;
  }

  /** Called whenever the reader's state, document or chapter changes; repeats are not sent. */
  update(state: PlaybackState, title: string, chapter: string, controls: PhoneSessionControls | null): void {
    // Opening a document does not start the service and its notification; the first Play does.
    if (state === 'paused' && this.last === 'stopped') state = 'stopped';
    this.controls = state === 'stopped' ? null : controls;
    if (state !== 'stopped') this.listen();
    const key = state === 'stopped' ? 'stopped' : `${state}\n${title}\n${chapter}`;
    if (key === this.last) return;
    this.last = key;
    void this.tts.playback({ state, title, chapter }).catch(() => {
      // The phone refused: reading goes on with the screen on, as before. Try again next time.
      this.last = '';
    });
  }

  private listen(): void {
    this.listening ??= this.tts.addListener('media', ({ action }) => this.press(action));
  }

  /** A button from the phone. Ignored when no document is being read. */
  press(action: MediaAction): void {
    const c = this.controls;
    if (!c) return;
    switch (action) {
      case 'play':
        void c.play();
        return;
      case 'pause':
        c.pause();
        return;
      case 'next':
        c.next();
        return;
      case 'previous':
        c.prev();
        return;
    }
  }
}
