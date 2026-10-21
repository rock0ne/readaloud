// Notes made while reading (spec 17.5, ADR-30) and notes.md.
import type { DocRecord, Note } from '../types';
import { DocIndex } from '../model';
import { fileBase, stamp } from '../flags/corrections';
import { replaceCitations } from '../ai/prompts';
import { newId, nowIso } from '../util/ids';

export function createNote(index: DocIndex, docId: string, sentenceId: string, text: string, opts: { sketch?: string; source?: Note['source'] } = {}): Note | null {
  const hit = index.get(sentenceId);
  if (!hit) return null;
  const now = nowIso();
  return {
    id: newId(),
    docId,
    sentenceId,
    blockId: hit.block.id,
    chapterIndex: hit.block.chapterIndex,
    chapterTitle: index.chapter(hit.block.chapterIndex)?.title ?? '',
    paragraphInChapter: index.paragraphInChapter(hit.block),
    quote: hit.sentence.text,
    context: index.neighbours(hit),
    text,
    ...(opts.sketch ? { sketch: opts.sketch } : {}),
    source: opts.source ?? 'me',
    createdAt: now,
    updatedAt: now,
  };
}

/** Reading order; notes whose sentence is no longer in the text go last. */
export function sortNotes(notes: Note[], index: DocIndex): Note[] {
  const pos = (n: Note) => index.get(n.sentenceId)?.ordinal ?? Number.MAX_SAFE_INTEGER;
  return [...notes].sort((a, b) => pos(a) - pos(b) || a.createdAt.localeCompare(b.createdAt));
}

export function isPlaced(note: Note, index: DocIndex): boolean {
  return index.get(note.sentenceId)?.sentence.text === note.quote;
}

export interface NotesOptions {
  /** The page a sentence is on, for "(p. 12)" in place of a citation. */
  pageOf?: (sentenceId: string) => string | undefined;
  now?: Date;
}

export function notesMarkdown(doc: DocRecord, notes: Note[], opts: NotesOptions = {}): string {
  const index = new DocIndex(doc);
  const sorted = sortNotes(notes, index);
  const cite = (ids: string[]) => {
    const pages = [...new Set(ids.map((id) => opts.pageOf?.(id)).filter((p): p is string => !!p))];
    return pages.length ? `(p. ${pages.join(', ')})` : '';
  };
  const lines: string[] = [
    `# Notes — ${doc.title}`,
    '',
    `Generated ${stamp(opts.now ?? new Date())}. ${sorted.length} note${sorted.length === 1 ? '' : 's'}.`,
    `Source: ${doc.sourceName}`,
  ];
  let chapter: number | null = null;
  for (const n of sorted) {
    if (n.chapterIndex !== chapter) {
      chapter = n.chapterIndex;
      lines.push('', `## ${n.chapterTitle || `Chapter ${n.chapterIndex + 1}`}`);
    }
    const page = opts.pageOf?.(n.sentenceId);
    lines.push('', `### Paragraph ${n.paragraphInChapter}${page ? ` · page ${page}` : ''}${n.source === 'ai' ? ' · from the AI assistant' : ''}`, '', `> ${n.quote.replace(/\n/g, ' ')}`);
    if (n.text.trim()) lines.push('', replaceCitations(n.text.trim(), cite));
    if (n.sketch) lines.push('', `![Drawing](${n.sketch})`);
  }
  return lines.join('\n') + '\n';
}

export function notesFileName(doc: DocRecord): string {
  return `notes-${fileBase(doc.title)}.md`;
}
