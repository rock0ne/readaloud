// Pages for summaries and the reader (spec 17.1). PDFs keep their own page numbers; other
// formats get reading pages of about 1,800 characters (about 300 words, a printed page).
import type { Block, ParsedDocument } from '../types';

export const PAGE_CHARS = 1800;

export interface Page {
  key: string; // `c${chapterIndex}p${label}`, unique in the document
  label: string; // the page number shown
  chapterIndex: number;
  blockIds: string[];
  firstSentenceId: string;
  lastSentenceId: string; // where page by page can stop (ADR-35)
  chars: number;
}

export function makePages(doc: ParsedDocument): Page[] {
  const real = doc.blocks.some((b) => b.page !== undefined);
  const pages: Page[] = [];
  let cur: Page | null = null;
  let pdfPage: number | undefined;
  let count = 0;
  for (const b of doc.blocks) {
    const thisPage = real ? (b.page ?? pdfPage ?? 1) : undefined;
    const fresh = !cur || cur.chapterIndex !== b.chapterIndex || (real ? thisPage !== pdfPage : cur.chars + b.text.length > PAGE_CHARS);
    if (fresh || !cur) {
      const label = real ? String(thisPage) : String(++count);
      cur = { key: `c${b.chapterIndex}p${label}`, label, chapterIndex: b.chapterIndex, blockIds: [], firstSentenceId: '', lastSentenceId: '', chars: 0 };
      pages.push(cur);
      pdfPage = thisPage;
    }
    cur.blockIds.push(b.id);
    cur.chars += b.text.length;
    if (!cur.firstSentenceId && b.sentences[0]) cur.firstSentenceId = b.sentences[0].id;
    const last = b.sentences.at(-1);
    if (last) cur.lastSentenceId = last.id;
  }
  return pages;
}

export class PageIndex {
  readonly pages: Page[];
  private readonly byBlock = new Map<string, Page>();
  private readonly byKey = new Map<string, Page>();

  constructor(doc: ParsedDocument) {
    this.pages = makePages(doc);
    for (const p of this.pages) {
      this.byKey.set(p.key, p);
      for (const id of p.blockIds) this.byBlock.set(id, p);
    }
  }

  get(key: string): Page | undefined {
    return this.byKey.get(key);
  }

  ofBlock(blockId: string): Page | undefined {
    return this.byBlock.get(blockId);
  }

  /** "b12.s3" belongs to block "b12". */
  ofSentence(sentenceId: string): Page | undefined {
    return this.byBlock.get(sentenceId.split('.')[0] ?? '');
  }

  inChapter(chapterIndex: number): Page[] {
    return this.pages.filter((p) => p.chapterIndex === chapterIndex);
  }

  blocksOf(page: Page, blocks: Block[]): Block[] {
    const ids = new Set(page.blockIds);
    return blocks.filter((b) => ids.has(b.id));
  }
}
