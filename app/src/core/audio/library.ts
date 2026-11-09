// Standalone audio is not a text-linked narration transfer. Keep it in its own
// additive database so importing/listening cannot rewrite a reader's book/audio.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { embeddedChapters, validateChapters, type AudioChapter } from './chapters';

export const AUDIO_ACCEPT = '.wav,.mp3,.m4a,.m4b,.mp4,.aac,.ogg,.opus,.flac,audio/*,video/mp4';
const MIME: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4',
  mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };
export interface AudioItem { id: string; name: string; title: string; mime: string; bytes: number; addedAt: string; blob: Blob; chapters?: AudioChapter[]; chapterWarning?: string; }
export type AudioSummary = Omit<AudioItem, 'blob'>;
export interface AudioPosition { id: string; seconds: number; rate: number; }
interface AudioSchema extends DBSchema {
  files: { key: string; value: AudioItem };
  positions: { key: string; value: AudioPosition };
}

export function audioMime(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME[extension];
  if (!mime) throw new Error('Choose a WAV, MP3, M4A, M4B, MP4, AAC, Ogg, Opus or FLAC file—not a ZIP.');
  return mime;
}

/** A small header read catches ZIPs renamed to audio; media playback checks codecs. */
export async function validateAudioFile(file: Blob, name: string): Promise<string> {
  const mime = audioMime(name);
  if (!file.size) throw new Error('This audio file is empty.');
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error('This is a ZIP, not an audio file. Use Import book transfer ZIP only for ZIPs exported by ReadAloud.');
  return mime;
}

export class AudioLibraryStore {
  private db: IDBPDatabase<AudioSchema>;
  private constructor(db: IDBPDatabase<AudioSchema>) { this.db = db; }
  static async open(name = 'readaloud-audio-library'): Promise<AudioLibraryStore> {
    const db = await openDB<AudioSchema>(name, 1, { upgrade(db) {
      db.createObjectStore('files', { keyPath: 'id' });
      db.createObjectStore('positions', { keyPath: 'id' });
    } });
    return new AudioLibraryStore(db);
  }
  close(): void { this.db.close(); }
  async list(): Promise<AudioSummary[]> {
    return (await this.db.getAll('files')).map(({ blob: _blob, ...summary }) => summary);
  }
  async add(file: Blob, name: string): Promise<AudioItem> {
    const mime = await validateAudioFile(file, name);
    const item: AudioItem = { id: crypto.randomUUID(), name, title: name.replace(/\.[^.]+$/, ''), mime,
      bytes: file.size, addedAt: new Date().toISOString(), blob: file.slice(0, file.size, mime) };
    try { item.chapters = await embeddedChapters(file, name); }
    catch (e) { item.chapterWarning = `Chapter markers unavailable: ${e instanceof Error ? e.message : String(e)}`; }
    // Store the Blob, not its complete bytes in JS memory. Quota errors propagate.
    await this.db.add('files', item); return item;
  }
  get(id: string): Promise<AudioItem | undefined> { return this.db.get('files', id); }
  async chapters(id: string): Promise<AudioItem | undefined> {
    const item = await this.get(id);
    if (item && item.chapters === undefined && !item.chapterWarning) {
      try { item.chapters = await embeddedChapters(item.blob, item.name); }
      catch (e) { item.chapterWarning = String(e); }
      await this.db.put('files', item);
    }
    return item;
  }
  async setChapters(id: string, chapters: AudioChapter[], duration: number): Promise<void> {
    const item = await this.get(id); if (!item) throw new Error('Audio file is unavailable.');
    item.chapters = validateChapters(chapters, duration); delete item.chapterWarning;
    await this.db.put('files', item);
  }
  position(id: string): Promise<AudioPosition | undefined> { return this.db.get('positions', id); }
  async remember(id: string, seconds: number, rate: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(rate) || rate < 0.5 || rate > 3) return;
    await this.db.put('positions', { id, seconds, rate });
  }
  async remove(id: string): Promise<void> {
    const tx = this.db.transaction(['files', 'positions'], 'readwrite');
    await Promise.all([tx.objectStore('files').delete(id), tx.objectStore('positions').delete(id)]); await tx.done;
  }
}
