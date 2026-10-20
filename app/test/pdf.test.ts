import { describe, expect, it } from 'vitest';
import { dropRunningLines, isScanned, itemsToLines, linesToBlocks, type PdfItem } from '../src/core/ingest/pdf';

const H = 800;
const item = (str: string, x: number, y: number, fontSize = 10, width?: number): PdfItem => ({
  str,
  x,
  y,
  fontSize,
  width: width ?? str.length * fontSize * 0.5,
});

// Two synthetic pages: running header, title, body with an indented paragraph start,
// a hyphenated break across lines, and a page number at the bottom.
const page1: PdfItem[] = [
  item('My Book', 250, 780),
  item('The Title', 100, 700, 18),
  item('This is the first paragraph of the text and it is', 72, 650),
  item('wonderfully', 72, 638),
  item('incred-', 330, 638),
  item('ible to read on a page like this one.', 72, 626),
  item('A new paragraph starts with an indent here and', 92, 614),
  item('continues on the next line without one at all ok', 72, 602),
  item('12', 300, 40),
];
const page2: PdfItem[] = [
  item('My Book', 250, 780),
  item('and finishes on the following page.', 72, 700),
  item('13', 300, 40),
];

describe('U8 pdf reconstruction', () => {
  it('groups items into lines and adds spaces for gaps', () => {
    const lines = itemsToLines([item('Hello', 72, 500, 10, 25), item('world', 110, 500.5, 10, 25)], 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Hello world');
  });

  it('drops running headers and page numbers, joins hyphens, detects paragraphs and headings', () => {
    const pages = dropRunningLines([
      { lines: itemsToLines(page1, 1), height: H },
      { lines: itemsToLines(page2, 2), height: H },
    ]);
    const all = pages.flatMap((p) => p.lines).map((l) => l.text);
    expect(all).not.toContain('My Book');
    expect(all).not.toContain('12');
    expect(all).not.toContain('13');

    const blocks = linesToBlocks(pages.flatMap((p) => p.lines));
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: 'The Title' });
    expect(blocks[1]?.text).toBe('This is the first paragraph of the text and it is wonderfully incredible to read on a page like this one.');
    expect(blocks[2]?.text).toBe(
      'A new paragraph starts with an indent here and continues on the next line without one at all ok and finishes on the following page.',
    );
    expect(blocks).toHaveLength(3);
  });

  it('detects scanned PDFs', () => {
    expect(isScanned(30, 2)).toBe(true);
    expect(isScanned(3000, 2)).toBe(false);
  });
});
