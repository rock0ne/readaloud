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
