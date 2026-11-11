interface Props {
  audiobook: boolean;
  busy: boolean;
  playing: boolean;
  onReader: () => void;
  onResume: () => void;
}

export function PreparedModeNotice({ audiobook, busy, playing, onReader, onResume }: Props) {
  if (!audiobook) return null;
  return <section class="prepared-mode-notice" aria-label="Audiobook playback" role="note">
    <div><strong>Prepared audiobook.</strong> Saved narration only. Reader Play is separate and can generate live speech.</div>
    <div class="prepared-mode-actions">
      {!playing && <button disabled={busy} onClick={onResume}>Resume saved audiobook</button>}
      <button disabled={busy} onClick={onReader}>Return to live reader</button>
    </div>
  </section>;
}
