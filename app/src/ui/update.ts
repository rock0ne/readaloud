// What the page does when a new version of ReadAloud takes over (ADR-25).
import type { Player } from '../core/player/player';

type Reading = Pick<Player, 'state' | 'subscribe'>;

export interface WorkerContainer {
  readonly controller: unknown;
  addEventListener(type: 'controllerchange', fn: () => void): void;
  removeEventListener(type: 'controllerchange', fn: () => void): void;
}

/** Whether a service worker already controlled this page when it loaded. */
export const STARTED_CONTROLLED = typeof navigator !== 'undefined' && navigator.serviceWorker?.controller != null;

/**
 * The service worker updates itself (spec 12, autoUpdate), and the new version deletes the old
 * version's files. A page still running the old code then fails on anything it has not loaded yet
 * (a file reader, the voice worker), so it reloads: at once, or when reading pauses or stops, so
 * no sentence is cut off. The first install also changes the controller; that is not an update.
 * Returns a function that stops watching.
 */
export function reloadOnUpdate(
  sw: WorkerContainer,
  hadController: boolean,
  player: Reading,
  reload: () => void,
  notify: (text: string) => void,
): () => void {
  const reading = () => player.state.status === 'playing' || player.state.status === 'buffering';
  let unsubscribe: (() => void) | undefined;
  const onChange = () => {
    if (!hadController || unsubscribe) return;
    if (!reading()) {
      reload();
      return;
    }
    notify('ReadAloud was updated. It reloads when you pause or stop.');
    unsubscribe = player.subscribe((e) => {
      if (e.type === 'state' && !reading()) reload();
    });
  };
  sw.addEventListener('controllerchange', onChange);
  return () => {
    sw.removeEventListener('controllerchange', onChange);
    unsubscribe?.();
  };
}
