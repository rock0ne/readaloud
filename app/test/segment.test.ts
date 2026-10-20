import { afterEach, describe, expect, it, vi } from 'vitest';
import { segmentSentences } from '../src/core/text/segment';

function check(text: string) {
  const segs = segmentSentences(text);
  for (const s of segs) expect(text.slice(s.start, s.end)).toBe(s.text);
  return segs.map((s) => s.text);
}

describe('U1 segmentSentences', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('splits simple sentences with offsets', () => {
    expect(check('Hello there. How are you? Fine!')).toEqual(['Hello there.', 'How are you?', 'Fine!']);
  });

  it('does not split after titles or inside p.m.', () => {
    expect(check('Dr. Smith met Mrs. Jones at 3 p.m. They left.')).toEqual([
      'Dr. Smith met Mrs. Jones at 3 p.m.',
      'They left.',
    ]);
  });

  it('keeps a closing quote attached', () => {
    const out = check('She said, “It is late.” Then she went home.');
    expect(out[0]).toBe('She said, “It is late.”');
    expect(out).toHaveLength(2);
  });

  it('trims surrounding whitespace', () => {
    const text = '   One.   Two.  ';
    const segs = segmentSentences(text);
    expect(segs.map((s) => s.text)).toEqual(['One.', 'Two.']);
    expect(segs[0]?.start).toBe(3);
  });

  it('regex fallback gives the same counts', () => {
    const intl = globalThis.Intl;
    vi.stubGlobal('Intl', { ...intl, Segmenter: undefined });
    expect(check('Hello there. How are you? Fine!')).toHaveLength(3);
    expect(check('Dr. Smith met Mrs. Jones at 3 p.m. They left.')).toHaveLength(2);
  });
});
