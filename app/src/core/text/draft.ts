// Plain-text paragraph edits, not HTML injection or an EPUB/typesetting round trip.
import type { DocRecord } from '../types';
import { sentencesFor } from './build';

export const DRAFT_HISTORY_LIMIT = 50;
export const DRAFT_PARAGRAPH_LIMIT = 100_000;

export function reviseDraft(doc: DocRecord, blockId: string, text: string, undo = false): DocRecord {
  if (!doc.draft) throw new Error('Enable editing this document first.');
  const last = doc.draft.edits.at(-1);
  if (undo) {
    if (!last) throw new Error('There is no saved edit to undo.');
    blockId = last.blockId; text = last.before;
  }
  const old = doc.blocks.find((b) => b.id === blockId);
  if (!old) throw new Error('This paragraph is no longer in the draft. Reopen Edit draft.');
  text = text.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('Keep some text in this paragraph. Removing whole paragraphs is not supported yet.');
  if (text.length > DRAFT_PARAGRAPH_LIMIT) throw new Error('Edit up to 100,000 characters in one paragraph.');
  if (text === old.text) return doc;
  const block = { ...old, text, sentences: [] as typeof old.sentences };
  block.sentences = sentencesFor(block, doc.language);
  const blocks = doc.blocks.map((b) => b.id === blockId ? block : b);
  return {
    ...doc, blocks, charCount: blocks.reduce((n, b) => n + b.text.length, 0),
    chapters: doc.chapters.map((c) => old.type === 'heading' && c.firstBlockId === blockId ? { ...c, title: text } : c),
    toc: doc.toc.map((t) => t.blockId === blockId && old.type === 'heading' ? { ...t, title: text } : t),
    draft: { ...doc.draft, revision: doc.draft.revision + 1, edits: undo ? doc.draft.edits.slice(0, -1)
      : [...doc.draft.edits, { blockId, before: old.text, after: text, at: new Date().toISOString() }].slice(-DRAFT_HISTORY_LIMIT) },
  };
}

/** Reading text only. No annotations, AI replies, keys, hidden history or recovery source. */
export function draftText(doc: DocRecord): string {
  return `${doc.blocks.map((b) => b.text).join('\n\n')}\n`;
}

export function draftMarkdown(doc: DocRecord, storedSource = false): string {
  const escape = (s: string) => s.replace(/([\\`*_{}\[\]<>()#+.!|>-])/g, '\\$1');
  const blocks = doc.blocks.map((b) => {
    if (b.type === 'code') {
      const runs = b.text.match(/`+/g) ?? [];
      const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
      return `${fence}\n${b.text}\n${fence}`;
    }
    const text = escape(b.text);
    if (b.type === 'heading') return `${'#'.repeat(b.level ?? 2)} ${text}`;
    if (b.type === 'list-item') return `- ${text}`;
    if (b.type === 'quote') return text.split('\n').map((s) => `> ${s}`).join('\n');
    return text;
  });
  const identity = storedSource ? `<!-- ReadAloud draft ${doc.id} session ${doc.draft?.sessionId ?? 'legacy'} revision ${doc.draft?.revision ?? 0} -->\n\n` : '';
  return `${identity}${blocks.join('\n\n')}\n`;
}

export function draftFileName(doc: DocRecord, extension: 'txt' | 'md'): string {
  return `${doc.title.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 100).trim() || 'book'}-edited-draft.${extension}`;
}
