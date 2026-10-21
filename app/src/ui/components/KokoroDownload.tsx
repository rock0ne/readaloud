// Download and status of the Kokoro voice (ADR-22), in the reader banner and in Settings.
import { KOKORO_DOWNLOAD_MB, type KokoroStatus } from '../kokoro/client';
import type { KokoroStage } from '../kokoro/protocol';
import { useOnline } from '../hooks/useDevice';
import { useKokoro, useServices } from '../services';

const mb = (bytes: number) => Math.round(bytes / 1e6);

const STAGE_TEXT: Record<KokoroStage, string> = {
  'gpu-check': 'looking for a graphics chip',
  model: 'reading the model',
  voices: 'storing the voices',
  'warm-up': 'making a first test sentence',
};

/** In the Android app the voice files come from the Kokoro engine app: nothing to download (ADR-27). */
function describePhone(s: KokoroStatus): string {
  switch (s.phase) {
    case 'absent':
      return 'The natural voice uses the files of the Kokoro engine app, which is not on this phone.';
    case 'downloading':
    case 'installed':
      return 'The natural voice is on this phone. It loads when you press Play.';
    case 'loading':
      return 'Loading the natural voice…';
    case 'ready': {
      const speed = s.speed ? `, making speech about ${s.speed.toFixed(1)}× faster than it plays` : '';
      return `The natural voice is ready on this phone${speed}.`;
    }
    case 'error':
      return `The natural voice could not start: ${(s.error ?? 'unknown error').replace(/\.$/, '')}.`;
  }
}

function describe(s: KokoroStatus, online: boolean): string {
  if (s.source === 'phone-engine') return describePhone(s);
  const pct = s.total ? Math.floor(((s.loaded ?? 0) / s.total) * 100) : 0;
  switch (s.phase) {
    case 'absent':
      return online
        ? `The natural voice (Kokoro) is not on this device yet. It downloads once, about ${KOKORO_DOWNLOAD_MB} MB, and then works offline.`
        : `Connect to the internet once to download the natural voice (about ${KOKORO_DOWNLOAD_MB} MB). A basic voice is used until then.`;
    case 'downloading':
      return s.total && s.total > 1e6
        ? `Downloading the natural voice: ${pct}% (${mb(s.loaded ?? 0)} of ${mb(s.total)} MB). Keep the app open.`
        : 'Starting the download of the natural voice…';
    case 'installed':
      return 'The natural voice is on this device. It loads when you press Play.';
    case 'loading': {
      if (!s.stage) return 'Loading the natural voice…';
      const read = s.stage === 'model' && s.total ? ` (${pct}%)` : '';
      return `Loading the natural voice: ${STAGE_TEXT[s.stage]}${read}…`;
    }
    case 'ready': {
      const where = s.device === 'webgpu' ? 'graphics chip' : 'processor';
      if (s.speed && s.speed < 1) {
        const slower = (1 / s.speed).toFixed(1);
        return `The natural voice is ready on this device's ${where}, but it makes speech about ${slower}× slower than it plays, so reading will keep pausing.`;
      }
      const speed = s.speed ? `, making speech about ${s.speed.toFixed(1)}× faster than it plays` : '';
      return `The natural voice is ready on this device's ${where}${speed}.`;
    }
    case 'error':
      return `The natural voice could not start: ${(s.error ?? 'unknown error').replace(/\.$/, '')}.`;
  }
}

/** `removable`: Settings also offers to delete the stored model. */
export function KokoroDownload({ removable = false }: { removable?: boolean }) {
  const { kokoro, player } = useServices();
  const s = useKokoro();
  const online = useOnline();
  const start = () => void kokoro.load().catch(() => undefined); // the failure is shown from the status
  const remove = () => {
    if (!confirm(`Remove the natural voice from this device? You can download it again later (about ${KOKORO_DOWNLOAD_MB} MB).`)) return;
    player.stop();
    player.resetVoice();
    void kokoro.remove();
  };
  const pct = s.total ? Math.floor(((s.loaded ?? 0) / s.total) * 100) : 0;
  return (
    <div class="kokoro-download" aria-live="polite">
      <span>{describe(s, online)}</span>
      {s.phase === 'downloading' && <progress max={100} value={pct} aria-label="Download progress" />}
      {s.phase === 'absent' && online && s.source !== 'phone-engine' && (
        <button class="primary" onClick={start}>
          Download natural voice
        </button>
      )}
      {s.phase === 'error' && (
        <button onClick={start} disabled={!online && !s.installed}>
          Try again
        </button>
      )}
      {removable && s.installed && s.source !== 'phone-engine' && s.phase !== 'downloading' && s.phase !== 'loading' && (
        <button onClick={remove}>Remove from this device</button>
      )}
    </div>
  );
}
