import { describe, expect, it, vi } from 'vitest';
import type { PlayerEvent, PlayerState } from '../src/core/types';
import { reloadOnUpdate, type WorkerContainer } from '../src/ui/update';

function fakeWorkers() {
  const target = new EventTarget();
  const sw: WorkerContainer & { change(): void } = {
    controller: {},
    addEventListener: (t, fn) => target.addEventListener(t, fn),
    removeEventListener: (t, fn) => target.removeEventListener(t, fn),
    change: () => target.dispatchEvent(new Event('controllerchange')),
  };
  return sw;
}

function fakePlayer(status: PlayerState['status']) {
  const listeners = new Set<(e: PlayerEvent) => void>();
  const player = {
    state: { status, rate: 1, engineId: 'kokoro' } as PlayerState,
    subscribe(fn: (e: PlayerEvent) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(s: PlayerState['status']) {
      player.state = { ...player.state, status: s };
      for (const fn of listeners) fn({ type: 'state', state: player.state });
    },
  };
  return player;
}

describe('a new version takes over the page (ADR-25)', () => {
  it('ignores the first install', () => {
    const sw = fakeWorkers();
    const reload = vi.fn();
    reloadOnUpdate(sw, false, fakePlayer('idle'), reload, vi.fn());
    sw.change();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads at once when nothing is being read', () => {
    const sw = fakeWorkers();
    const reload = vi.fn();
    reloadOnUpdate(sw, true, fakePlayer('paused'), reload, vi.fn());
    sw.change();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for reading to pause or stop, and says so', () => {
    const sw = fakeWorkers();
    const reload = vi.fn();
    const notify = vi.fn();
    const player = fakePlayer('playing');
    reloadOnUpdate(sw, true, player, reload, notify);
    sw.change();
    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('ReadAloud was updated. It reloads when you pause or stop.');
    player.set('buffering');
    expect(reload).not.toHaveBeenCalled();
    player.set('paused');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stops watching when cleaned up', () => {
    const sw = fakeWorkers();
    const reload = vi.fn();
    const stop = reloadOnUpdate(sw, true, fakePlayer('idle'), reload, vi.fn());
    stop();
    sw.change();
    expect(reload).not.toHaveBeenCalled();
  });
});
