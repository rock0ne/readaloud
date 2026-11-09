import { AudioSample, AudioSampleSource, Mp3OutputFormat, Mp4OutputFormat, Output, StreamTarget } from 'mediabunny';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import type { BookWav } from '../src/core/audio/narration';
import { chapterPayload, type AudioExportFormat } from '../src/core/audio/formats';
import { timingDocument } from '../src/core/audio/chapters';

let registered = false;
/** Both software encoders are bundled; no device codec or runtime CDN download is required. */
export async function encodePreparedAudio(pcm: BookWav, format: Exclude<AudioExportFormat, 'wav'>,
  title: string, chapters: { title: string; seconds: number }[], bitrate: number,
  write: (bytes: Uint8Array, position: number) => Promise<void>, signal: AbortSignal,
  progress: (done: number, total: number) => void): Promise<void> {
  if (![96000, 128000].includes(bitrate)) throw new Error('Choose 96 or 128 kb/s.');
  if (!registered) { registerMp3Encoder(); registerAacEncoder(); registered = true; }
  const output = new Output({
    format: format === 'mp3' ? new Mp3OutputFormat() : new Mp4OutputFormat({ fastStart: false, metadataFormat: 'udta' }),
    target: new StreamTarget(new WritableStream({ write: async (chunk) => {
      signal.throwIfAborted(); await write(chunk.data, chunk.position);
    } }), { chunked: true, chunkSize: 65536 }),
  });
  output.setMetadataTags({ title, comment: 'Digital narration exported locally with ReadAloud.',
    raw: format === 'mp3' ? { TXXX: { 'readaloud.chapters': timingDocument(chapters, pcm.bytes / 2 / pcm.sampleRate) } }
      : { chpl: chapterPayload(chapters) } });
  const source = new AudioSampleSource({ codec: format === 'mp3' ? 'mp3' : 'aac', bitrate });
  output.addAudioTrack(source, { languageCode: 'und' });
  let done = 0, completed = false;
  try {
    signal.throwIfAborted(); await output.start();
    for await (const bytes of pcm.chunks) {
      signal.throwIfAborted();
      const sample = new AudioSample({ data: bytes, format: 's16', numberOfChannels: 1, sampleRate: pcm.sampleRate, timestamp: done / 2 / pcm.sampleRate });
      try { await source.add(sample); } finally { sample.close(); }
      done += bytes.byteLength; progress(done, pcm.bytes);
    }
    signal.throwIfAborted(); await output.finalize(); signal.throwIfAborted(); completed = true;
  } finally { if (!completed) await output.cancel().catch(() => undefined); }
}
