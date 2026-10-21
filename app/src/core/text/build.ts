// RawBlock[] -> ParsedDocument (spec 5.7).
import type { Block, Chapter, DocFormat, ParsedDocument, Sentence, TocEntry } from '../types';
import type { LoaderResult, RawBlock } from '../ingest/raw';
import { segmentSentences } from './segment';
import { chunk, toSpeakText } from './normalize';

export interface BuildMeta {
  format: DocFormat;
  fallbackTitle: string;
  locale?: string;
}

const FRONT_MATTER_MIN_BLOCKS = 3;

export function buildDocument(raw: LoaderResult, meta: BuildMeta): ParsedDocument {
  const language = raw.language || meta.locale || 'en-GB';
  const title = raw.title.trim() || meta.fallbackTitle;

  // Drop empty blocks, remembering where each kept block came from.
  const indexMap = new Map<number, number>();
  const kept: RawBlock[] = [];
  raw.blocks.forEach((b, i) => {
    const text = b.text.trim();
    if (!text) return;
    indexMap.set(i, kept.length);
    kept.push({ ...b, text });
  });

  const blocks: Block[] = kept.map((b, i) => ({
    id: `b${i}`,
    index: i,
    type: b.type,
    ...(b.type === 'heading' ? { level: clampLevel(b.level ?? 2) } : {}),
    text: b.text,
    chapterIndex: 0,
    sentences: [],
    ...(b.page !== undefined ? { page: b.page } : {}),
  }));

  const starts = chapterStarts(raw, blocks, indexMap, title);
  const chapters: Chapter[] = [];
  starts.forEach((s, ci) => {
    const first = blocks[s.blockIndex];
    if (first) chapters.push({ index: ci, title: s.title, firstBlockId: first.id });
  });
  if (chapters.length === 0 && blocks.length > 0) {
    chapters.push({ index: 0, title, firstBlockId: 'b0' });
  }
  // Assign chapter indexes.
  let ci = 0;
  const startIdx = chapters.map((c) => Number(c.firstBlockId.slice(1)));
  for (const b of blocks) {
    while (ci + 1 < startIdx.length && b.index >= (startIdx[ci + 1] ?? Infinity)) ci++;
    b.chapterIndex = ci;
  }

  const toc: TocEntry[] = raw.toc
    ? raw.toc
        .map((t) => ({ t, idx: indexMap.get(t.blockIndex) }))
        .filter((x): x is { t: { title: string; level: number; blockIndex: number }; idx: number } => x.idx !== undefined)
        .map(({ t, idx }) => ({ title: t.title, level: t.level, blockId: `b${idx}` }))
    : blocks
        .filter((b) => b.type === 'heading' && (b.level ?? 9) <= 3)
        .map((b) => ({ title: b.text, level: b.level ?? 1, blockId: b.id }));

  for (const b of blocks) b.sentences = sentencesFor(b, language);

  return {
    title,
    language,
    format: meta.format,
    blocks,
    chapters,
    toc,
    charCount: blocks.reduce((n, b) => n + b.text.length, 0),
    warnings: raw.warnings,
  };
}

function clampLevel(n: number): number {
  return Math.min(6, Math.max(1, Math.round(n)));
}

function sentencesFor(b: Block, language: string): Sentence[] {
  const segs = b.type === 'code'
    ? [{ text: b.text, start: 0, end: b.text.length }]
    : segmentSentences(b.text, language);
  return segs.map((s, i) => {
    const speakText = toSpeakText(s.text, b.type);
    return {
      id: `${b.id}.s${i}`,
      blockId: b.id,
      index: i,
      text: s.text,
      start: s.start,
      end: s.end,
      speakText,
      chunks: speakText ? chunk(speakText) : [],
    };
  });
}

interface Start {
  blockIndex: number;
  title: string;
}

function chapterStarts(raw: LoaderResult, blocks: Block[], indexMap: Map<number, number>, docTitle: string): Start[] {
  let starts: Start[];
  if (raw.chapterStarts && raw.chapterStarts.length > 0) {
    starts = raw.chapterStarts
      .map((s) => ({ blockIndex: indexMap.get(s.blockIndex) ?? -1, title: s.title }))
      .filter((s) => s.blockIndex >= 0);
  } else {
    starts = headingStarts(blocks);
  }
  // De-duplicate and sort.
  const seen = new Set<number>();
  starts = starts
    .sort((a, b) => a.blockIndex - b.blockIndex)
    .filter((s) => (seen.has(s.blockIndex) ? false : (seen.add(s.blockIndex), true)));

  if (starts.length === 0) return blocks.length ? [{ blockIndex: 0, title: docTitle }] : [];

  const first = starts[0];
  if (first && first.blockIndex > 0) {
    if (first.blockIndex < FRONT_MATTER_MIN_BLOCKS) {
      // A title line or two before the first chapter: fold into chapter one.
      first.blockIndex = 0;
    } else {
      starts.unshift({ blockIndex: 0, title: 'Front matter' });
    }
  }
  return starts;
}

function headingStarts(blocks: Block[]): Start[] {
  const headings = blocks.filter((b) => b.type === 'heading');
  if (headings.length === 0) return [];
  const counts = new Map<number, number>();
  for (const h of headings) counts.set(h.level ?? 1, (counts.get(h.level ?? 1) ?? 0) + 1);
  const levels = [...counts.keys()].sort((a, b) => a - b);
  // Smallest level, unless it occurs once (a document title) and a deeper level repeats.
  let level = levels[0] ?? 1;
  if ((counts.get(level) ?? 0) < 2) {
    const deeper = levels.find((l) => l > level && (counts.get(l) ?? 0) >= 2);
    if (deeper !== undefined) level = deeper;
  }
  return headings.filter((h) => h.level === level).map((h) => ({ blockIndex: h.index, title: h.text }));
}
