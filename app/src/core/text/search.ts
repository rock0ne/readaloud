// Finding text and pages in a document (ADR-34).
import type { DocIndex } from '../model';
import type { Page } from './pages';

/** The most matches listed; the count shows "1000+" past it. */
export const MAX_HITS = 1000;

/** Lower case, straight quotes and single spaces, so "Don’t" finds "don't". */
export function searchKey(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The sentences that contain the query, in reading order; nothing for fewer than 2 characters. */
export function findSentences(index: DocIndex, query: string, max = MAX_HITS): string[] {
  const q = searchKey(query);
  if (q.length < 2) return [];
  const out: string[] = [];
  for (const { sentence } of index.order) {
    if (!searchKey(sentence.text).includes(q)) continue;
    out.push(sentence.id);
    if (out.length >= max) break;
  }
  return out;
}

/** The page number in what was typed: "12", "p. 12" or "page 12" give "12". */
export function typedPage(typed: string): string {
  return typed.trim().replace(/^p(?:age)?\.?\s*/i, '');
}

/** The page with the number typed. */
export function pageFor(pages: Page[], typed: string): Page | undefined {
  const label = typedPage(typed).toLocaleLowerCase();
  if (!label) return undefined;
  return pages.find((p) => p.label.toLocaleLowerCase() === label);
}
