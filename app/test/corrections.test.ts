import { describe, expect, it } from 'vitest';
import { correctionsMarkdown, createFlag } from '../src/core/flags/corrections';
import { DocIndex } from '../src/core/model';
import { makeDoc } from './helpers/docs';

const doc = makeDoc(
  [
    { type: 'heading', level: 2, text: 'Chapter One' },
    { type: 'paragraph', text: 'Their is a mistake here. Fine sentence.' },
    { type: 'heading', level: 2, text: 'Chapter Two' },
    { type: 'paragraph', text: 'Intro.' },
    { type: 'paragraph', text: 'The the doubled word.' },
  ],
  { title: 'My Book', sourceName: 'book.docx' },
);

describe('U12 corrections.md', () => {
  it('produces the exact format, in reading order, without dismissed flags', () => {
    const index = new DocIndex(doc);
    const later = { ...createFlag(index, doc.id, 'b4.s0', 'doubled word')!, fixedText: 'The doubled word.', status: 'fixed' as const };
    const first = createFlag(index, doc.id, 'b1.s0', 'there')!;
    const dismissed = { ...createFlag(index, doc.id, 'b1.s1')!, status: 'dismissed' as const };
    const md = correctionsMarkdown(doc, [later, dismissed, first], { now: new Date(2026, 9, 20, 9, 5) });
    expect(md).toBe(`# Corrections — My Book

Generated 2026-10-20 09:05. 2 flags (1 open, 1 fixed).
Source: book.docx

## Chapter One

### 1. Paragraph 2

> Their is a mistake here.

- Note: there
- Fix: —
- Status: open

## Chapter Two

### 2. Paragraph 3

> The the doubled word.

- Note: doubled word
- Fix: The doubled word.
- Status: fixed
`);
    const withDismissed = correctionsMarkdown(doc, [later, dismissed, first], { includeDismissed: true });
    expect(withDismissed).toContain('3 flags');
    expect(withDismissed).toContain('> Fine sentence.');
  });
});
