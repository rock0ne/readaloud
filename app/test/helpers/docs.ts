import { buildDocument } from '../../src/core/text/build';
import type { RawBlock } from '../../src/core/ingest/raw';
import type { DocRecord, Flag } from '../../src/core/types';

let counter = 0;

export function makeDoc(blocks: RawBlock[], overrides: Partial<DocRecord> = {}): DocRecord {
  const parsed = buildDocument({ title: 'Doc', warnings: [], blocks }, { format: 'md', fallbackTitle: 'doc' });
  counter++;
  return {
    ...parsed,
    id: `doc-${counter}`,
    sourceName: 'doc.md',
    sourceHash: `hash-${counter}`,
    addedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

export const sampleBlocks: RawBlock[] = [
  { type: 'heading', level: 1, text: 'Chapter One' },
  { type: 'paragraph', text: 'First sentence here. Second sentence here.' },
  { type: 'code', text: 'let x = 1;' },
  { type: 'paragraph', text: 'Final paragraph.' },
];

export function makeFlag(doc: DocRecord, sentenceId: string, over: Partial<Flag> = {}): Flag {
  const block = doc.blocks.find((b) => b.sentences.some((s) => s.id === sentenceId))!;
  const sentence = block.sentences.find((s) => s.id === sentenceId)!;
  return {
    id: `flag-${sentenceId}`,
    docId: doc.id,
    sentenceId,
    blockId: block.id,
    chapterIndex: block.chapterIndex,
    chapterTitle: doc.chapters[block.chapterIndex]?.title ?? '',
    paragraphInChapter: 1,
    quote: sentence.text,
    note: '',
    fixedText: '',
    status: 'open',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...over,
  };
}
