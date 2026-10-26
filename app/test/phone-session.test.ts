// Reading with the screen off in the Android app: what the reader tells the phone, and the
// lock-screen, notification, car and headset buttons coming back (ADR-39).
import { describe, expect, it } from 'vitest';
import { PhoneSession } from '../src/ui/android/phone-session';
import type { MediaAction, PlaybackState, ReadAloudTts, TtsEvents } from '../src/ui/android/plugin';

function fakePlugin(refuse = false) {
  const sent: Array<{ state: PlaybackState; title: string; chapter: string }> = [];
  const media = new Set<(p: { action: MediaAction }) => void>();
  let listens = 0;
  const tts = {
    playback: async (opts: { state: PlaybackState; title: string; chapter: string }) => {
      sent.push(opts);
      if (refuse) throw new Error('refused');
    },
    addListener: (async (event: keyof TtsEvents, fn: (p: never) => void) => {
      if (event === 'media') {
        listens++;
        (media as Set<(p: never) => void>).add(fn);
      }
      return { remove: async () => undefined };
    }) as ReadAloudTts['addListener'],
  } as unknown as ReadAloudTts;
  const press = (action: MediaAction) => media.forEach((fn) => fn({ action }));
  return { tts, sent, press, listens: () => listens };
}

function controls() {
  const calls: string[] = [];
  return {
    calls,
    play: async () => void calls.push('play'),
    pause: () => void calls.push('pause'),
    prev: () => void calls.push('prev'),
    next: () => void calls.push('next'),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PhoneSession (ADR-39)', () => {
  it('starts the screen-off service at the first Play, not when a document is merely opened', () => {
    const p = fakePlugin();
    const s = new PhoneSession(p.tts);
    s.update('paused', 'The Next Human', 'Chapter 13', controls());
    expect(p.sent).toEqual([]);
    s.update('playing', 'The Next Human', 'Chapter 13', controls());
    expect(p.sent).toEqual([{ state: 'playing', title: 'The Next Human', chapter: 'Chapter 13' }]);
  });

  it('keeps the service through a pause, updates the chapter, and ends it when the reader closes', () => {
    const p = fakePlugin();
    const s = new PhoneSession(p.tts);
    const c = controls();
    s.update('playing', 'Book', 'Chapter 1', c);
    s.update('playing', 'Book', 'Chapter 1', c); // a repeat is not sent again
    s.update('paused', 'Book', 'Chapter 1', c);
    s.update('playing', 'Book', 'Chapter 2', c);
    s.update('stopped', '', '', null);
    s.update('stopped', '', '', null);
    expect(p.sent.map((x) => `${x.state}:${x.chapter}`)).toEqual(['playing:Chapter 1', 'paused:Chapter 1', 'playing:Chapter 2', 'stopped:']);
  });

  it('passes the phone and car buttons to the player while a document is being read', () => {
    const p = fakePlugin();
    const s = new PhoneSession(p.tts);
    const c = controls();
    s.update('playing', 'Book', 'Chapter 1', c);
    p.press('pause');
    p.press('play');
    p.press('next');
    p.press('previous');
    expect(c.calls).toEqual(['pause', 'play', 'next', 'prev']);
    s.update('playing', 'Book', 'Chapter 2', c);
    expect(p.listens()).toBe(1); // one listener for the life of the app
  });

  it('ignores the buttons once the reader has closed', () => {
    const p = fakePlugin();
    const s = new PhoneSession(p.tts);
    const c = controls();
    s.update('playing', 'Book', 'Chapter 1', c);
    s.update('stopped', '', '', null);
    p.press('play');
    expect(c.calls).toEqual([]);
  });

  it('tries again at the next change if the phone refused to start the service', async () => {
    const p = fakePlugin(true);
    const s = new PhoneSession(p.tts);
    const c = controls();
    s.update('playing', 'Book', 'Chapter 1', c);
    await flush();
    s.update('playing', 'Book', 'Chapter 1', c);
    expect(p.sent.length).toBe(2);
  });
});
