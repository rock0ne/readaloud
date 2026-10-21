import { describe, expect, it } from 'vitest';
import { DocIndex } from '../src/core/model';
import { PageIndex } from '../src/core/text/pages';
import { findSentences, pageFor, searchKey } from '../src/core/text/search';
import { makeDoc } from './helpers/docs';

describe('S1 find and go to a page (ADR-34)', () => {
  const doc = makeDoc([
    { type: 'heading', level: 1, text: 'One' },
    { type: 'paragraph', text: 'The river ran past the mill. Don’t   stop now.' },
    { type: 'heading', level: 1, text: 'Two' },
    { type: 'paragraph', text: 'The RIVER was high. Nobody came.' },
  ]);
  const index = new DocIndex(doc);
  const pages = new PageIndex(doc);

  it('finds sentences in reading order, ignoring case, curly quotes and extra spaces', () => {
    expect(findSentences(index, 'river')).toEqual(['b1.s0', 'b3.s0']);
    expect(findSentences(index, "don't stop")).toEqual(['b1.s1']);
    expect(searchKey('  Don’t   “Stop”  ')).toBe('don\'t "stop"');
    expect(findSentences(index, 'r')).toEqual([]);
    expect(findSentences(index, 'river', 1)).toEqual(['b1.s0']);
    expect(findSentences(index, 'nothing like this')).toEqual([]);
  });

  it('finds a page typed as a number or with "p." or "page"', () => {
    expect(pages.pages.map((p) => p.label)).toEqual(['1', '2']);
    expect(pageFor(pages.pages, '2')?.firstSentenceId).toBe('b2.s0');
    expect(pageFor(pages.pages, ' p. 2 ')?.label).toBe('2');
    expect(pageFor(pages.pages, 'Page 1')?.label).toBe('1');
    expect(pageFor(pages.pages, '9')).toBeUndefined();
    expect(pageFor(pages.pages, '')).toBeUndefined();
  });
});
