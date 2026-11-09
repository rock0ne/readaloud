import type { BookWav } from './narration';
import type { AudioExportFormat } from './formats';

/** No encoder imports or runtime downloads are permitted in the public edition. */
export async function encodePreparedAudio(_pcm: BookWav, _format: Exclude<AudioExportFormat, 'wav'>,
  _title: string, _chapters: { title: string; seconds: number }[], _bitrate: number,
  _write: (bytes: Uint8Array, position: number) => Promise<void>, _signal: AbortSignal,
  _progress: (done: number, total: number) => void): Promise<void> {
  throw new Error('Compressed export is unavailable in this hosted edition while encoder redistribution is held. Use WAV export; existing MP3/M4A/M4B files can still be imported and played.');
}
