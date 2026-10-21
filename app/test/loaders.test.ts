import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBytes, pastedTitle, IngestError } from '../src/core/ingest';
import { loadEpub } from '../src/core/ingest/epub';
import { makeEpub } from './helpers/make-epub';
import { makeDocx } from './helpers/make-docx';
import type { ParsedDocument } from '../src/core/types';

const fixture = (name: string): ArrayBuffer => {
  const buf = readFileSync(join(__dirname, 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

function checkOffsets(doc: ParsedDocument) {
  for (const b of doc.blocks) for (const s of b.sentences) expect(b.text.slice(s.start, s.end)).toBe(s.text);
}

describe('U5 txt and md loaders', () => {
  it('txt: detects a heading line and joins hard-wrapped lines', async () => {
    const doc = await parseBytes(fixture('sample.txt'), 'sample.txt');
    expect(doc.title).toBe('sample');
    expect(doc.blocks[0]).toMatchObject({ type: 'heading', text: 'Part One' });
    expect(doc.blocks[2]?.text).toBe('This paragraph was hard-wrapped across two lines by an old editor.');
    checkOffsets(doc);
  });

  it('md: front matter removed, title from h1, two chapters, links read as text, code typed', async () => {
    const doc = await parseBytes(fixture('sample.md'), 'sample.md');
    expect(doc.title).toBe('Sample Book');
    expect(doc.blocks.some((b) => b.text.includes('Front matter title'))).toBe(false);
    expect(doc.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
    const all = doc.blocks.map((b) => b.text).join('\n');
    expect(all).toContain('Read more at the site');
    expect(all).not.toContain('example.com/x');
    expect(doc.blocks.find((b) => b.type === 'code')?.text).toContain('should not be read');
    expect(doc.blocks.filter((b) => b.type === 'list-item')).toHaveLength(3);
    const long = doc.blocks.flatMap((b) => b.sentences).find((s) => s.text.startsWith('This sentence is deliberately long'));
    expect(long?.chunks.length).toBeGreaterThanOrEqual(2);
    const bare = doc.blocks.flatMap((b) => b.sentences).find((s) => s.text.includes('example.org'));
    expect(bare?.speakText).toContain('link');
    checkOffsets(doc);
  });
});

describe('U6 epub loader', () => {
  it('reads metadata, spine order, TOC with fragments, and promotes styled titles', async () => {
    const doc = await parseBytes(await makeEpub(), 'book.epub');
    expect(doc.title).toBe('Test Book');
    expect(doc.language).toBe('en-GB');
    expect(doc.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two', 'Chapter Three']);
    const text = doc.blocks.map((b) => b.text);
    expect(text).not.toContain('Endnote text that is not in the reading order.');
    expect(text[text.length - 1]).toBe('Final words.');
    const twoTitle = doc.blocks.find((b) => b.text === 'Chapter Two');
    expect(twoTitle?.type).toBe('heading');
    const part2 = doc.toc.find((t) => t.title === 'Part Two');
    const part2Block = doc.blocks.find((b) => b.id === part2?.blockId);
    expect(part2Block?.text).toMatch(/^Part two begins/);
    expect(part2Block?.type).toBe('paragraph');
    expect(doc.toc.find((t) => t.title === 'Part Two')?.level).toBe(2);
    checkOffsets(doc);
  });

  it('EPUB 2 with an NCX gives the same chapters', async () => {
    const doc = await parseBytes(await makeEpub({ version: 2 }), 'book.epub');
    expect(doc.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two', 'Chapter Three']);
  });

  it('refuses DRM-protected books', async () => {
    await expect(loadEpub(await makeEpub({ drm: true }), { name: 'drm.epub' })).rejects.toMatchObject({ code: 'drm' });
  });

  it('reports progress per spine item', async () => {
    const seen: number[] = [];
    await parseBytes(await makeEpub(), 'book.epub', { onProgress: (d) => seen.push(d) });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('U7 docx loader', () => {
  it('reads a heading and two paragraphs', async () => {
    const doc = await parseBytes(await makeDocx(), 'chapter.docx');
    expect(doc.blocks.map((b) => [b.type, b.text])).toEqual([
      ['heading', 'My Chapter'],
      ['paragraph', 'The first body paragraph. It has two sentences.'],
      ['paragraph', 'The second body paragraph.'],
    ]);
    expect(doc.title).toBe('My Chapter');
    expect(doc.warnings).toEqual(['Word styles not recognised: UnknownStyle. Their text is read as normal paragraphs.']);
  });
});

describe('parseBytes input', () => {
  it('leaves the input buffer intact', async () => {
    const bytes = await makeDocx();
    const before = bytes.byteLength;
    await parseBytes(bytes, 'chapter.docx');
    expect(bytes.byteLength).toBe(before);
  });
});

describe('format errors', () => {
  it('rejects unknown formats', async () => {
    const err = await parseBytes(new TextEncoder().encode('hello').buffer as ArrayBuffer, 'x.rtf').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).code).toBe('unsupported');
  });

  it('sniffs an EPUB without an extension', async () => {
    const doc = await parseBytes(await makeEpub(), 'download');
    expect(doc.format).toBe('epub');
  });
});

describe('pasted text (ADR-24)', () => {
  it('titles pasted text by its first line, or the title typed, and reads it as plain text', async () => {
    const text = 'Chapter Three\n\nThe rain had not stopped. She said "Four."\n';
    expect(pastedTitle(text)).toBe('Chapter Three');
    expect(pastedTitle(text, '  My notes ')).toBe('My notes');
    expect(pastedTitle('   ')).toBe('Pasted text');
    expect(pastedTitle('a/b' + String.fromCharCode(92) + 'c')).toBe('a-b-c');
    expect(pastedTitle('x'.repeat(80))).toHaveLength(60);
    const doc = await parseBytes(new TextEncoder().encode(text).buffer as ArrayBuffer, `${pastedTitle(text)}.txt`);
    expect(doc.title).toBe('Chapter Three');
    expect(doc.blocks.flatMap((b) => b.sentences.map((s) => s.text))).toContain('The rain had not stopped.');
  });
});
