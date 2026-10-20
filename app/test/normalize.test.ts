import { describe, expect, it } from 'vitest';
import { chunk, toSpeakText } from '../src/core/text/normalize';

describe('U2 toSpeakText', () => {
  it('replaces URLs with "link" and keeps trailing punctuation', () => {
    expect(toSpeakText('See https://example.com/a?b=c. Then go.', 'paragraph')).toBe('See link. Then go.');
    expect(toSpeakText('Visit www.example.com today', 'paragraph')).toBe('Visit link today');
  });

  it('removes footnote markers', () => {
    expect(toSpeakText('A claim[12] and another² here.', 'paragraph')).toBe('A claim and another here.');
  });

  it('turns dashes into pauses but keeps hyphens', () => {
    expect(toSpeakText('It was late — very late.', 'paragraph')).toBe('It was late, very late.');
    expect(toSpeakText('A well-known fact.', 'paragraph')).toBe('A well-known fact.');
    expect(toSpeakText('From 1990–1995 it rained.', 'paragraph')).toBe('From 1990 to 1995 it rained.');
  });

  it('collapses NBSP and other spaces', () => {
    expect(toSpeakText('A  b c', 'paragraph')).toBe('A b c');
  });

  it('strips markdown leftovers', () => {
    expect(toSpeakText('**Bold** and _it_ here.', 'paragraph')).toBe('Bold and it here.');
  });

  it('returns empty for symbol-only text', () => {
    expect(toSpeakText('* * *', 'paragraph')).toBe('');
  });
});

describe('U2 chunk', () => {
  const clause = 'the quick brown fox jumps over the lazy dog';
  it('returns one piece when short enough', () => {
    const s = 'x'.repeat(280);
    expect(chunk(s)).toEqual([s]);
  });

  it('splits long text into pieces <= 280 that rejoin to the original', () => {
    const long = Array.from({ length: 14 }, () => clause).join(', ') + '.';
    expect(long.length).toBeGreaterThan(600);
    const pieces = chunk(long);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(280);
    expect(pieces.join(' ')).toBe(long);
  });

  it('prefers a semicolon over commas', () => {
    const a = `${clause}, ${clause}, ${clause}`;
    const b = `${clause}, ${clause}, ${clause}`;
    const text = `${a}; ${b}.`;
    const pieces = chunk(text, 200);
    expect(pieces[0]).toBe(`${a};`);
  });

  it('falls back to the last space when there is no punctuation', () => {
    const text = Array.from({ length: 80 }, () => 'word').join(' ');
    const pieces = chunk(text);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(280);
    expect(pieces.join(' ')).toBe(text);
  });
});
