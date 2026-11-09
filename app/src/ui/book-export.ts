import { wholeBookWav, type NarrationPlan, type NarrationStore } from '../core/audio/narration';
import { IN_ANDROID_APP, readAloudTts } from './android/plugin';
import { AUDIO_FORMATS, type AudioExportFormat } from '../core/audio/formats';
import { wavChapterChunk } from '../core/audio/chapters';

interface DiskWriter { write(bytes: Uint8Array | { type: 'write'; data: Uint8Array; position: number }): Promise<void>; close(): Promise<void>; abort(): Promise<void>; }
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<DiskWriter> }>;

/** Call directly from a click: the desktop save picker needs transient user activation. */
export async function saveBookWav(name: string, plan: NarrationPlan, voice: string, store: NarrationStore,
  signal: AbortSignal, progress: (done: number, total: number) => void): Promise<void> {
  return saveAudioExport(name, plan, voice, store, signal, progress, 'wav', '', [], 128000);
}

export async function saveAudioExport(name: string, plan: NarrationPlan, voice: string, store: NarrationStore,
  signal: AbortSignal, progress: (done: number, total: number) => void, format: AudioExportFormat,
  title: string, chapters: { index: number; title: string }[], bitrate: number): Promise<void> {
  let writer: DiskWriter | undefined, token: string | undefined;
  try {
    const mime = AUDIO_FORMATS[format].mime;
    if (!IN_ANDROID_APP) {
      const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
      if (!picker) throw new Error('Whole-book export needs Windows Edge/Chrome or the updated Android app. Chapter exports remain available.');
      const handle = await picker.call(window, { suggestedName: name, types: [{ description: AUDIO_FORMATS[format].label, accept: { [mime]: [`.${format}`] } }] });
      writer = await handle.createWritable();
    }
    const book = await wholeBookWav(plan, voice, store, signal, format !== 'wav');
    const markers = book.chapterStarts.map((c) => ({ title: chapters.find((v) => v.index === c.chapter)?.title || `Chapter ${c.chapter + 1}`, seconds: c.sample / book.sampleRate }));
    // Validate marker limits before encoding or writing any audio.
    if (format === 'm4b' || format === 'm4a') { const { chapterPayload } = await import('../core/audio/formats'); chapterPayload(markers); }
    const wavMetadata = format === 'wav' ? wavChapterChunk(markers, (book.bytes - 44) / 2 / book.sampleRate) : undefined;
    const wavBytes = book.bytes + (wavMetadata?.length ?? 0);
    if (format === 'wav' && wavBytes > 0xfffffffe) throw new Error('WAV plus chapter metadata exceeds the 4 GiB limit. Use chapter exports.');
    signal.throwIfAborted();
    const cap = format === 'wav' ? wavBytes : Math.min(0xfffffffe, Math.ceil(book.bytes / 2 / book.sampleRate * bitrate / 8 * 1.5) + 16 * 1048576);
    if (IN_ANDROID_APP) token = (await readAloudTts.beginAudioExport({ name, ...(format === 'wav' ? { expectedBytes: wavBytes } : { maxBytes: cap }) })).token;
    const write = async (bytes: Uint8Array, position?: number) => {
      signal.throwIfAborted();
      if (position !== undefined && position + bytes.byteLength > cap) throw new Error('Export exceeds the supported file size. Use separate chapters.');
      if (writer) await writer.write(position === undefined ? bytes : { type: 'write', data: bytes, position });
      else {
        for (let at = 0; at < bytes.length; at += 65536) {
          signal.throwIfAborted();
          let binary = ''; for (const b of bytes.subarray(at, at + 65536)) binary += String.fromCharCode(b);
          await readAloudTts.appendAudioExport({ token: token!, data: btoa(binary), ...(position !== undefined ? { position: position + at } : {}) });
        }
      }
    };
    let done = 0;
    if (format === 'wav') {
      for await (const bytes of book.chunks) {
        if (done === 0) new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(4, wavBytes - 8, true);
        await write(bytes);
        done += bytes.byteLength; progress(done, wavBytes);
      }
      await write(wavMetadata!); progress(wavBytes, wavBytes);
    } else {
      const { encodePreparedAudio } = await import('../core/audio/encode');
      await encodePreparedAudio(book, format, title, markers, bitrate, write, signal, progress);
    }
    signal.throwIfAborted();
    if (writer) { await writer.close(); writer = undefined; }
    else await readAloudTts.finishAudioExport({ token: token!, name, mime });
  } finally {
    if (writer) await writer.abort().catch(() => undefined);
    if (token) await readAloudTts.cancelAudioExport({ token }).catch(() => undefined);
  }
}
