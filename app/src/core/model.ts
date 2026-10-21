// Read-only helpers over a parsed document: reading order, lookups, flag locations.
import type { Block, Chapter, DocRecord, ParsedDocument, Sentence } from './types';

export interface OrderedSentence {
  sentence: Sentence;
  block: Block;
  ordinal: number;
}

export class DocIndex {
  readonly order: OrderedSentence[] = [];
  private readonly byId = new Map<string, OrderedSentence>();
  private readonly blocksById = new Map<string, Block>();

  readonly doc: ParsedDocument;

  constructor(doc: ParsedDocument) {
    this.doc = doc;
    for (const block of doc.blocks) {
      this.blocksById.set(block.id, block);
      for (const sentence of block.sentences) {
        const entry = { sentence, block, ordinal: this.order.length };
        this.order.push(entry);
        this.byId.set(sentence.id, entry);
      }
    }
  }

  get(sentenceId: string): OrderedSentence | undefined {
    return this.byId.get(sentenceId);
  }

  block(blockId: string): Block | undefined {
    return this.blocksById.get(blockId);
  }

  chapter(index: number): Chapter | undefined {
    return this.doc.chapters[index];
  }

  chapterBlocks(index: number): Block[] {
    return this.doc.blocks.filter((b) => b.chapterIndex === index);
  }

  /** 1-based ordinal of a block within its chapter (spec 10.1). */
  paragraphInChapter(block: Block): number {
    const first = this.doc.blocks.findIndex((b) => b.chapterIndex === block.chapterIndex);
    return block.index - (first === -1 ? 0 : first) + 1;
  }

  firstSentenceOfChapter(index: number): OrderedSentence | undefined {
    return this.order.find((o) => o.block.chapterIndex === index);
  }

  findAllByQuote(quote: string): OrderedSentence[] {
    return this.order.filter((o) => o.sentence.text === quote);
  }

  /** Text of the sentences either side of one, in reading order. */
  neighbours(o: OrderedSentence): { before: string; after: string } {
    return { before: this.order[o.ordinal - 1]?.sentence.text ?? '', after: this.order[o.ordinal + 1]?.sentence.text ?? '' };
  }
}

export function sentenceCount(doc: ParsedDocument | DocRecord): number {
  return doc.blocks.reduce((n, b) => n + b.sentences.length, 0);
}
