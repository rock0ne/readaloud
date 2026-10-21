// @vitest-environment node
// The phone's text-to-phonemes step, ported from kokoro-js 1.2.1 (ADR-27). eSpeak's module reads its
// packed data with Blob.stream, which jsdom lacks, so these tests run in Node.
import { describe, expect, it } from 'vitest';
import { normalizeText, textToPhonemes } from '../src/ui/android/phonemes';

describe('textToPhonemes (kokoro-js 1.2.1, ported)', () => {
  it('spells out years, money, decimals and titles as the PC does', () => {
    expect(normalizeText('In 1962 Dr. Penrose paid £3.50 for 2.5 kg.')).toBe('In 19 62 Doctor Penrose paid 3 pounds and 50 pence for 2 point 5 kg.');
    expect(normalizeText('From 1905 to 2000, at 7:05.')).toBe("From 19 oh 5 to 2000, at 7 oh 5.");
  });

  it('gives sounds for every word, numbers and unknown names included', async () => {
    const out = await textToPhonemes('In 1962 Porthwen had 43 boats.', 'b');
    // Each word of the sentence has sounds; nothing is dropped as it was by the lexicon.
    expect(out.split(' ').length).toBeGreaterThanOrEqual(7);
    expect(out).toMatch(/fˈɔːti|fˈɔːɹti/);
    expect(out.endsWith('.')).toBe(true);
    // Kokoro's own sounds: eSpeak's r becomes ɹ, as on the PC.
    expect(out).not.toMatch(/r/);
  });

  it('speaks British and American English differently', async () => {
    expect(await textToPhonemes('water', 'b')).not.toBe(await textToPhonemes('water', 'a'));
  });
});
