import { useEffect, useState } from 'preact/hooks';

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

/** Keeps the screen awake while `active` (Wake Lock API; silently does nothing where unsupported). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    nav.wakeLock
      ?.request('screen')
      .then((s) => {
        if (cancelled) void s.release();
        else sentinel = s;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => {
      removeEventListener('online', up);
      removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export const isEdge = () => typeof navigator !== 'undefined' && /\bEdg\//.test(navigator.userAgent);

interface MediaControls {
  play(): Promise<void>;
  pause(): void;
  prev(): void;
  next(): void;
}

/** Lock-screen and headset controls while an audio engine reads (spec 8.6). */
export function useMediaSession(active: boolean, title: string, chapter: string, playing: boolean, controls: MediaControls): void {
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!active || !ms) return;
    ms.metadata = new MediaMetadata({ title, artist: chapter, album: 'ReadAloud' });
    const handlers: Array<[MediaSessionAction, () => void]> = [
      ['play', () => void controls.play()],
      ['pause', () => controls.pause()],
      ['previoustrack', () => controls.prev()],
      ['nexttrack', () => controls.next()],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // an action this browser does not support
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // as above
        }
      }
      ms.metadata = null;
    };
  }, [active, title, chapter, controls]);

  useEffect(() => {
    if (active && typeof navigator !== 'undefined' && navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [active, playing]);
}
