// Flags -> corrections.md (spec 10.2) and flag creation helpers (spec 10.1).
import type { DocRecord, Flag } from '../types';
import { DocIndex } from '../model';
import { newId, nowIso } from '../util/ids';

export function createFlag(index: DocIndex, docId: string, sentenceId: string, note = ''): Flag | null {
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
    note,
    fixedText: '',
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
}

/** Sorts flags by reading position; flags whose sentence no longer exists go last. */
export function sortFlags(flags: Flag[], index: DocIndex): Flag[] {
  const pos = (f: Flag) => index.get(f.sentenceId)?.ordinal ?? Number.MAX_SAFE_INTEGER;
  return [...flags].sort((a, b) => pos(a) - pos(b) || a.createdAt.localeCompare(b.createdAt));
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface CorrectionsOptions {
  includeDismissed?: boolean;
  now?: Date;
}

export function correctionsMarkdown(doc: DocRecord, flags: Flag[], opts: CorrectionsOptions = {}): string {
  const index = new DocIndex(doc);
  const included = sortFlags(flags, index).filter((f) => opts.includeDismissed || f.status !== 'dismissed');
  const open = included.filter((f) => f.status === 'open').length;
  const fixed = included.filter((f) => f.status === 'fixed').length;
  const lines: string[] = [
    `# Corrections — ${doc.title}`,
    '',
    `Generated ${stamp(opts.now ?? new Date())}. ${included.length} flag${included.length === 1 ? '' : 's'} (${open} open, ${fixed} fixed).`,
    `Source: ${doc.sourceName}`,
  ];
  let chapter: number | null = null;
  included.forEach((f, i) => {
    if (f.chapterIndex !== chapter) {
      chapter = f.chapterIndex;
      lines.push('', `## ${f.chapterTitle || `Chapter ${f.chapterIndex + 1}`}`);
    }
    lines.push(
      '',
      `### ${i + 1}. Paragraph ${f.paragraphInChapter}`,
      '',
      `> ${f.quote.replace(/\n/g, ' ')}`,
      '',
      `- Note: ${f.note.trim() || '—'}`,
      `- Fix: ${f.fixedText.trim() || '—'}`,
      `- Status: ${f.status}`,
    );
  });
  return lines.join('\n') + '\n';
}

export function correctionsFileName(doc: DocRecord): string {
  const base = doc.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document';
  return `corrections-${base}.md`;
}
