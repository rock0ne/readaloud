import { describe, expect, it } from 'vitest';
import { buildDocument } from '../src/core/text/build';
import type { RawBlock } from '../src/core/ingest/raw';

const meta = { format: 'md' as const, fallbackTitle: 'file' };
const b = (type: RawBlock['type'], text: string, level?: number): RawBlock => (level ? { type, text, level } : { type, text });

describe('U4 buildDocument', () => {
  it('uses the smallest repeated heading level for chapters and folds a title line in', () => {
    const doc = buildDocument(
      {
        title: 'Book',
        warnings: [],
        blocks: [b('heading', 'Book', 1), b('heading', 'One', 2), b('paragraph', 'A. B.'), b('heading', 'Two', 2), b('paragraph', 'C.')],
      },
      meta,
    );
    expect(doc.chapters.map((c) => c.title)).toEqual(['One', 'Two']);
    expect(doc.chapters[0]?.firstBlockId).toBe('b0');
    expect(doc.blocks.map((x) => x.chapterIndex)).toEqual([0, 0, 0, 1, 1]);
    expect(doc.toc.map((t) => t.title)).toEqual(['Book', 'One', 'Two']);
  });

  it('creates a front-matter chapter when 3+ blocks precede the first chapter', () => {
    const doc = buildDocument(
      {
        title: 'T',
        warnings: [],
        blocks: [b('paragraph', 'a'), b('paragraph', 'b'), b('paragraph', 'c'), b('heading', 'Ch1', 1), b('paragraph', 'd'), b('heading', 'Ch2', 1)],
      },
      meta,
    );
    expect(doc.chapters.map((c) => c.title)).toEqual(['Front matter', 'Ch1', 'Ch2']);
  });

  it('has one chapter named after the document when there are no headings', () => {
    const doc = buildDocument({ title: '', warnings: [], blocks: [b('paragraph', 'Only. Text.')] }, meta);
    expect(doc.title).toBe('file');
    expect(doc.chapters).toEqual([{ index: 0, title: 'file', firstBlockId: 'b0' }]);
  });

  it('sentence offsets match the block text; code is a single sentence; charCount sums', () => {
    const doc = buildDocument(
      { title: 'T', warnings: [], blocks: [b('paragraph', 'First one. Second one!'), b('code', 'a = 1. b = 2.'), b('paragraph', '  ')] },
      meta,
    );
    expect(doc.blocks).toHaveLength(2);
    for (const blk of doc.blocks) {
      for (const s of blk.sentences) expect(blk.text.slice(s.start, s.end)).toBe(s.text);
    }
    expect(doc.blocks[0]?.sentences.map((s) => s.id)).toEqual(['b0.s0', 'b0.s1']);
    expect(doc.blocks[1]?.sentences).toHaveLength(1);
    expect(doc.charCount).toBe('First one. Second one!'.length + 'a = 1. b = 2.'.length);
  });
});
