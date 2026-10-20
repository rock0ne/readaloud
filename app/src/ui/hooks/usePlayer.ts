import { useEffect, useState } from 'preact/hooks';
import type { Player } from '../../core/player/player';
import type { PlayerState } from '../../core/types';

export interface PlayerView extends PlayerState {
  currentId: string | undefined;
}

export function usePlayer(player: Player): PlayerView {
  const [view, setView] = useState<PlayerView>({ ...player.state, currentId: player.currentSentenceId });
  useEffect(
    () =>
      player.subscribe((e) => {
        if (e.type === 'state' || e.type === 'sentence') setView({ ...player.state, currentId: player.currentSentenceId });
      }),
    [player],
  );
  return view;
}
