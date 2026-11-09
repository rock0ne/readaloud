// File-backed chapter transfers reuse saved audio without a 160 MB total cap.
import { TransferZipWriter, openTransferZip, MANIFEST_MAX } from './transfer-zip';
import type { DocRecord, ParsedDocument, Settings } from '../types';
import type { Repo } from '../store/repo';
import { sha256Hex } from '../util/hash';
import { audioKey, type NarrationPlan } from './narration';
import { decodeWav } from './wav';
import { pronunciationText, validPronunciation } from '../text/pronunciation';

const TEXT_LIMIT = MANIFEST_MAX;
const PAUSES = ['skipCodeBlocks', 'announceHeadings', 'pauseAfterHeadingMs', 'pauseBetweenSentencesMs', 'pauseBetweenParagraphsMs', 'pronunciation', 'locale'] as const;
type ReadingSettings = Pick<Settings, typeof PAUSES[number]>;
interface Manifest {
  version: 1 | 2; doc: ParsedDocument; documentHash: string; voiceId: string;
  reading: ReadingSettings; clips: { file: string; text: string; sha256: string }[];
}

export async function exportTransfer(doc: DocRecord, plan: NarrationPlan, chapter: number | undefined, voiceId: string,
  settings: Settings, repo: Repo, signal: AbortSignal): Promise<Blob> {
  const chapterTexts = new Set(plan.units.filter((u) => chapter === undefined || u.chapter === chapter).flatMap((u) => u.texts));
  // Include all alternate unit starts used when seeking/pausing inside a short joined unit.
  const chapterChunks = doc.blocks.filter((b) => (chapter === undefined || b.chapterIndex === chapter) && !(b.type === 'code' && settings.skipCodeBlocks))
    .flatMap((b) => b.sentences.flatMap((s) => s.chunks.map((t) => pronunciationText(t, settings.pronunciation, settings.locale))));
  for (const text of plan.texts) if (chapterChunks.some((chunk) => text === chunk || text.startsWith(`${chunk} `))) chapterTexts.add(text);
  const { id: _id, sourceHash: _hash, sourceName: _name, addedAt: _added, lastOpenedAt: _opened, ...parsed } = doc;
  const json = JSON.stringify(parsed);
  if (new TextEncoder().encode(json).length > TEXT_LIMIT) throw new Error('Document text exceeds the 8 MB transfer limit.');
  const reading = Object.fromEntries(PAUSES.map((p) => [p, settings[p]])) as ReadingSettings;
  const manifest: Manifest = { version: 2, doc: parsed, documentHash: await sha256Hex(new TextEncoder().encode(json)), voiceId, reading, clips: [] };
  const zip = new TransferZipWriter();
  for (const text of chapterTexts) {
    signal.throwIfAborted();
    const blob = await repo.getPreparedAudio(doc.id, await audioKey('kokoro', voiceId, text));
    if (!blob) throw new Error('Prepare this chapter before exporting a transfer.');
    const bytes = await blob.arrayBuffer();
    const file = `audio/${manifest.clips.length}.wav`;
    manifest.clips.push({ file, text, sha256: await sha256Hex(bytes) });
    await zip.add(file, blob);
  }
  if (!manifest.clips.length) throw new Error('No narration in this chapter.');
  await zip.add('manifest.json', new Blob([JSON.stringify(manifest)]));
  signal.throwIfAborted();
  return zip.finish();
}

export async function importTransfer(input: Blob | ArrayBuffer, repo: Repo): Promise<{ docId: string; voiceId: string; reading: ReadingSettings; clips: number }> {
  // ArrayBuffers may originate in a different realm (worker/test/browser bridge).
  const zip = await openTransferZip(typeof (input as Blob).size === 'number' ? input as Blob : new Blob([input as ArrayBuffer]));
  const m = JSON.parse(new TextDecoder().decode(await zip.get('manifest.json')!.read())) as Manifest;
  if (![1, 2].includes(m.version) || typeof m.voiceId !== 'string' || !/^([ab][fm])_[a-z]+$/.test(m.voiceId) || !Array.isArray(m.clips) || !m.clips.length || m.clips.length > 50000) throw new Error('Invalid transfer manifest.');
  validateDocument(m.doc);
  if (await sha256Hex(new TextEncoder().encode(JSON.stringify(m.doc))) !== m.documentHash) throw new Error('Document hash mismatch.');
  if (!m.reading || typeof m.reading.skipCodeBlocks !== 'boolean' || typeof m.reading.announceHeadings !== 'boolean'
    || ['pauseAfterHeadingMs', 'pauseBetweenSentencesMs', 'pauseBetweenParagraphsMs'].some((p) => {
      const v = m.reading[p as keyof ReadingSettings];
      return typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 60000;
    })) throw new Error('Invalid reading settings.');
  // Old 0.5.0 transfers used the unmodified text: do not change their audio on import.
  if (m.version === 1) {
    m.reading.pronunciation ??= { enabled: false, list: '' };
    m.reading.locale ??= 'en-GB';
  }
  if (!validPronunciation(m.reading.pronunciation) || typeof m.reading.locale !== 'string'
    || m.reading.locale.length > 50) throw new Error('Invalid pronunciation settings.');
  const validated: { text: string; blob: Blob }[] = [];
  const seen = new Set<string>();
  for (const clip of m.clips) {
    if (!clip || typeof clip.text !== 'string' || !clip.text.trim() || clip.text.length > 10000 || !/^audio\/\d+\.wav$/.test(clip.file) || seen.has(clip.file)) throw new Error('Invalid audio reference.');
    seen.add(clip.file);
    const entry = zip.get(clip.file); if (!entry) throw new Error('A transfer clip is missing.');
    const audio = await entry.read();
    if (await sha256Hex(audio) !== clip.sha256) throw new Error('Audio hash mismatch.');
    decodeWav(audio); // reject non-audio or malformed data before writing any document/audio
    validated.push({ text: clip.text, blob: entry.blob });
  }
  const hash = `narration-transfer:${m.documentHash}`;
  let doc = await repo.findByHash(hash);
  // No notes, API keys, original source file or current position travel in this package.
  doc ??= await repo.addDocument(m.doc, new ArrayBuffer(0), 'prepared-audiobook.transfer', hash);
  for (const clip of validated) await repo.putPreparedAudio(doc.id, await audioKey('kokoro', m.voiceId, clip.text), clip.blob);
  const reading = Object.fromEntries(PAUSES.map((p) => [p, m.reading[p]])) as ReadingSettings;
  return { docId: doc.id, voiceId: m.voiceId, reading, clips: validated.length };
}

function validateDocument(doc: ParsedDocument): void {
  const text = (v: unknown, max = 1000000) => typeof v === 'string' && v.length <= max;
  if (!doc || !text(doc.title, 1000) || !text(doc.language, 50) || !['txt','md','docx','pdf','epub'].includes(doc.format)
    || !Array.isArray(doc.blocks) || !doc.blocks.length || doc.blocks.length > 100000 || !Array.isArray(doc.chapters) || !doc.chapters.length
    || !Array.isArray(doc.toc) || !Array.isArray(doc.warnings) || !Number.isFinite(doc.charCount)) throw new Error('Invalid document in transfer.');
  const ids = new Set<string>(), sentenceIds = new Set<string>();
  for (const [i, b] of doc.blocks.entries()) {
    if (!b || !text(b.id, 100) || ids.has(b.id) || b.index !== i || !text(b.text)
      || !['heading','paragraph','list-item','quote','code','caption','table-row'].includes(b.type)
      || !Number.isInteger(b.chapterIndex) || b.chapterIndex < 0 || b.chapterIndex >= doc.chapters.length || !Array.isArray(b.sentences)) throw new Error('Invalid block in transfer.');
    ids.add(b.id);
    for (const [j, s] of b.sentences.entries()) {
      if (!s || !text(s.id, 120) || sentenceIds.has(s.id) || s.blockId !== b.id || s.index !== j || !text(s.text) || !text(s.speakText)
        || !Array.isArray(s.chunks) || !s.chunks.every((c) => text(c, 10000)) || !Number.isInteger(s.start) || !Number.isInteger(s.end)
        || s.start < 0 || s.end < s.start || s.end > b.text.length) throw new Error('Invalid sentence in transfer.');
      sentenceIds.add(s.id);
    }
  }
  if (doc.chapters.some((c, i) => !c || c.index !== i || !text(c.title, 10000) || !ids.has(c.firstBlockId))
    || doc.toc.some((t) => !t || !text(t.title, 10000) || !ids.has(t.blockId) || !Number.isInteger(t.level))
    || !doc.warnings.every((w) => text(w, 10000))) throw new Error('Invalid contents in transfer.');
}
