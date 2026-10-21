// What is sent to the AI and how its replies are read (spec 17.4, ADR-30).
import type { AiKind, AiSuggestion, Block, ParsedDocument } from '../types';
import type { Page, PageIndex } from '../text/pages';
import type { AiRequest } from './provider';

export type ScopeKind = 'paragraph' | 'page' | 'chapter' | 'book';

export interface AiScope {
  kind: ScopeKind;
  key: string; // AiResult.scope: 'b40', 'c3p12', 'c3' or 'book'
  label: string; // shown to the reader: 'Page 12', 'Chapter 3: The Storm', 'Whole document'
  phrase: string; // used inside a task: 'page 12', 'chapter 3, "The Storm"', 'the whole document'
  blocks: Block[];
  pages: Page[];
}

export type AiTask = 'summary' | 'page-summaries' | 'explain' | 'proofread' | 'answer';

/** The same instructions for every request, so the cached part of a request stays the same. */
export const SYSTEM_PROMPT = [
  'You are the reading assistant in ReadAloud, an app that reads documents aloud.',
  'The user is reading the document below and wants to understand it and learn from it quickly.',
  "Each sentence of the document has its id in square brackets before it, like [b12.s3], and lines like '=== Page 12 ===' mark where pages start.",
  'Work only from the text given. If it does not contain what is asked, say so plainly.',
  'Write in the language of the document unless the user asks otherwise.',
].join(' ');

const CITE =
  'Keep the names, numbers and dates, and any doubts, conditions or exceptions the text states; add nothing that is not in the text. ' +
  "Cite the sentences each point relies on with their ids in square brackets right after the point, like [b12.s3] or [b12.s3, b14.s0], at most three ids per point. Write plain text: short paragraphs, or lines that start with '- ' for lists. No headings, tables, bold or other formatting.";

function chapterName(doc: ParsedDocument, chapterIndex: number): { label: string; phrase: string } {
  const title = doc.chapters[chapterIndex]?.title.trim() ?? '';
  const n = chapterIndex + 1;
  if (!title || title === doc.title) return { label: `Chapter ${n}`, phrase: `chapter ${n}` };
  // A title that already names itself ("Chapter 3: The Storm", "Part Two") is used as it is.
  if (/^(chapter|part|book|section|prologue|epilogue|introduction|preface|appendix)\b/i.test(title)) return { label: title, phrase: `"${title}"` };
  return { label: `Chapter ${n}: ${title}`, phrase: `chapter ${n}, "${title}"` };
}

/** One paragraph with the paragraphs either side of it in its chapter, for "Explain". */
export function paragraphScope(doc: ParsedDocument, pages: PageIndex, blockId: string): AiScope | null {
  const at = doc.blocks.findIndex((b) => b.id === blockId);
  const block = doc.blocks[at];
  if (!block || !block.sentences[0]) return null;
  const near = [doc.blocks[at - 1], block, doc.blocks[at + 1]].filter((b): b is Block => !!b && b.chapterIndex === block.chapterIndex);
  const page = pages.ofBlock(blockId);
  const where = chapterName(doc, block.chapterIndex).label;
  return {
    kind: 'paragraph',
    key: blockId,
    label: `This paragraph (${page ? `page ${page.label}, ` : ''}${where})`,
    phrase: `the paragraph that starts at [${block.sentences[0].id}]`,
    blocks: near,
    pages: page ? [page] : [],
  };
}

export function pageScope(doc: ParsedDocument, page: Page): AiScope {
  const ids = new Set(page.blockIds);
  return { kind: 'page', key: page.key, label: `Page ${page.label}`, phrase: `page ${page.label}`, blocks: doc.blocks.filter((b) => ids.has(b.id)), pages: [page] };
}

export function chapterScope(doc: ParsedDocument, pages: PageIndex, chapterIndex: number): AiScope {
  const name = chapterName(doc, chapterIndex);
  return {
    kind: 'chapter',
    key: `c${chapterIndex}`,
    ...name,
    blocks: doc.blocks.filter((b) => b.chapterIndex === chapterIndex),
    pages: pages.inChapter(chapterIndex),
  };
}

export function bookScope(doc: ParsedDocument, pages: PageIndex): AiScope {
  return { kind: 'book', key: 'book', label: 'Whole document', phrase: 'the whole document', blocks: doc.blocks, pages: pages.pages };
}

export function summaryKind(kind: ScopeKind): AiKind {
  return kind === 'paragraph' ? 'explanation' : kind === 'page' ? 'page-summary' : kind === 'chapter' ? 'chapter-summary' : 'book-overview';
}

export function resultKey(docId: string, kind: AiKind, scope: string): string {
  return `${docId}|${kind}|${scope}`;
}

export function blockLine(b: Block): string {
  return b.sentences.map((s) => `[${s.id}] ${s.text}`).join(' ');
}

/** The document part of a request: a short header, then one line per paragraph with page marks. */
export function scopeText(doc: ParsedDocument, scope: AiScope): string {
  const starts = new Map(scope.pages.map((p) => [p.blockIds[0], p.label]));
  const lines = [`Title: ${doc.title}`, `Part: ${scope.label}`, ''];
  for (const b of scope.blocks) {
    const page = starts.get(b.id);
    if (page !== undefined) lines.push(`=== Page ${page} ===`);
    if (b.sentences.length) lines.push(blockLine(b));
  }
  return lines.join('\n');
}

export function scopeWords(scope: AiScope): number {
  let n = 0;
  for (const b of scope.blocks) n += b.text.split(/\s+/).filter(Boolean).length;
  return n;
}

export function scopeIds(scope: AiScope): Set<string> {
  return new Set(scope.blocks.flatMap((b) => b.sentences.map((s) => s.id)));
}

function taskText(scope: AiScope, task: AiTask, question: string): string {
  switch (task) {
    case 'explain':
      return `Explain ${scope.phrase} in plain words for someone learning the subject: what it says, what its terms, names or references mean, and how it connects to the paragraphs around it. Use the paragraphs around it only as context. ${CITE}`;
    case 'summary':
      if (scope.kind === 'paragraph') return taskText(scope, 'explain', question);
      if (scope.kind === 'page') return `Summarise ${scope.phrase} in two to four lines that start with '- '. ${CITE}`;
      if (scope.kind === 'chapter') {
        return `Summarise ${scope.phrase} for someone studying it. Start with one or two sentences on what it is about. Then give its key points in order, as 5 to 10 lines that start with '- '. End with a line that starts 'Key terms: ' and lists the names, terms or ideas worth remembering, if there are any. ${CITE}`;
      }
      return `Give an overview of ${scope.phrase} for someone studying it. Start with two or three sentences on what it is about and who it is for. Then give the main ideas or events in order, as 6 to 12 lines that start with '- '. Then write 'Chapters:' and one line per chapter, starting with '- ', saying what it covers. ${CITE}`;
    case 'page-summaries':
      return `Summarise each page of ${scope.phrase} separately. For every '=== Page N ===' section write a line 'Page N:', then two to four lines that start with '- ' with that page's key points. Keep the pages in order and include every page. ${CITE}`;
    case 'proofread':
      return `Proofread ${scope.phrase}. List the likely mistakes: spelling, typos, grammar, punctuation, missing or repeated words, and names spelled two ways. Do not suggest changes of style or wording that are not mistakes. Reply with one JSON object per line and nothing else, in this form: {"id": "b12.s3", "issue": "what is wrong, in a few words", "fix": "the whole sentence, corrected"}. If you find no mistakes, reply with the word NONE.`;
    case 'answer':
      return `Answer this question about ${scope.phrase}. Answer directly, in a few sentences or short lines that start with '- '. ${CITE}\n\nQuestion: ${question.trim()}`;
  }
}

export function buildRequest(doc: ParsedDocument, scope: AiScope, task: AiTask, question = ''): AiRequest {
  return { system: SYSTEM_PROMPT, document: scopeText(doc, scope), task: taskText(scope, task, question) };
}

// ----- reading replies -----

const CITE_RE = /\[\s*(b\d+\.s\d+(?:\s*[,;]\s*b\d+\.s\d+)*)\s*\]/g;

export type ReplyPart = { text: string } | { cite: string[] };

/** Splits a reply into text and citations. Ids that were not sent stay as plain text. */
export function splitCitations(reply: string, valid: (id: string) => boolean): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = parts[parts.length - 1];
    if (prev && 'text' in prev) prev.text += text;
    else parts.push({ text });
  };
  for (const m of reply.matchAll(CITE_RE)) {
    const at = m.index ?? 0;
    push(reply.slice(last, at));
    const ids = (m[1] ?? '').split(/\s*[,;]\s*/).filter(valid);
    if (ids.length) parts.push({ cite: ids });
    else push(m[0]);
    last = at + m[0].length;
  }
  push(reply.slice(last));
  return parts;
}

/** Replaces each citation with `label(ids)`, or removes it when that gives ''. */
export function replaceCitations(reply: string, label: (ids: string[]) => string): string {
  return reply
    .replace(CITE_RE, (_all, ids: string) => {
      const l = label(ids.split(/\s*[,;]\s*/));
      return l ? ` ${l}` : '';
    })
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/** A reply without its citations or list marks, for reading aloud. */
export function speakable(reply: string): string {
  return replaceCitations(reply, () => '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim())
    .filter(Boolean)
    .map((l) => (/[.!?:;]$/.test(l) ? l : `${l}.`))
    .join('\n');
}

/** Splits a page-by-page reply at its 'Page N:' lines. Pages not asked about are ignored. */
export function splitPages(reply: string, labels: readonly string[]): Map<string, string> {
  const wanted = new Set(labels);
  const out = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const close = () => {
    if (current !== null && !out.has(current)) {
      const text = lines.join('\n').trim();
      if (text) out.set(current, text);
    }
  };
  for (const line of reply.split('\n')) {
    const m = /^[\s#*_=]*page\s+([0-9ivxlcdm]+)\b[\s*_=]*:?[\s*_]*(.*)$/i.exec(line);
    if (m) {
      // A page that was not asked about ends the one before it and is left out.
      close();
      current = wanted.has(m[1] ?? '') ? (m[1] ?? null) : null;
      lines = m[2]?.trim() ? [m[2].trim()] : [];
    } else if (current !== null) {
      lines.push(line);
    }
  }
  close();
  return out;
}

/** Reads a mistakes reply: one JSON object per line; anything else is ignored. */
export function parseSuggestions(reply: string, sentences: ReadonlyMap<string, string>): AiSuggestion[] {
  const out: AiSuggestion[] = [];
  const seen = new Set<string>();
  const candidates: unknown[] = [];
  const trimmed = reply.replace(/```(?:json)?/g, '').trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(trimmed);
      if (Array.isArray(arr)) candidates.push(...arr);
    } catch {
      // fall back to lines
    }
  }
  if (candidates.length === 0) {
    for (const line of trimmed.split('\n')) {
      const a = line.indexOf('{');
      const b = line.lastIndexOf('}');
      if (a === -1 || b <= a) continue;
      try {
        candidates.push(JSON.parse(line.slice(a, b + 1)));
      } catch {
        // not an object
      }
    }
  }
  for (const c of candidates) {
    const o = c as { id?: unknown; issue?: unknown; fix?: unknown };
    if (typeof o.id !== 'string' || typeof o.issue !== 'string') continue;
    const original = sentences.get(o.id);
    const fix = typeof o.fix === 'string' ? o.fix.trim() : '';
    if (original === undefined || seen.has(o.id) || !o.issue.trim() || fix === original.trim()) continue;
    seen.add(o.id);
    out.push({ sentenceId: o.id, issue: o.issue.trim(), fix, state: 'new' });
  }
  return out;
}
