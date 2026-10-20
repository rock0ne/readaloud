// Speak-text normalisation (spec 6.2) and chunking (spec 6.3).
import type { BlockType } from '../types';

const UNICODE_SPACES = /[   -   　]/g;
const ZERO_WIDTH = /[​-‍﻿­]/g;
const TRAILING_PUNCT = /[.,;:!?)\]"'”’]+$/;

function urlToWord(m: string): string {
  const trail = m.match(TRAILING_PUNCT)?.[0] ?? '';
  return 'link' + trail;
}

export function toSpeakText(text: string, blockType: BlockType): string {
  let s = text.replace(UNICODE_SPACES, ' ').replace(ZERO_WIDTH, '');
  s = s.replace(/\s+/g, ' ').trim();

  // URLs are not worth hearing character by character.
  s = s.replace(/\bhttps?:\/\/\S+/gi, urlToWord).replace(/\bwww\.\S+/gi, urlToWord);

  // Footnote markers.
  s = s.replace(/\[\d+\]/g, '').replace(/\^\d+/g, '').replace(/[¹²³⁰-⁹]+/g, '');

  // Number ranges read as "to"; other dashes become a pause.
  s = s.replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2');
  s = s.replace(/\s*[—–]\s*/g, ', ');

  // Ellipses.
  s = s.replace(/…/g, '...').replace(/\.\s\.\s\./g, '...');

  // Markdown leftovers at token boundaries.
  s = s.replace(/(^|\s)[*_#>]+(?=\S)/g, '$1');
  s = s.replace(/(?<=\S)[*_]+(?=\s|$|[.,;:!?])/g, '');

  if (blockType === 'table-row') {
    // keep the "; " separators produced by the HTML walker
  }

  // Tidy punctuation produced by the replacements above.
  s = s.replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*,/g, ',').replace(/,([.;:!?])/g, '$1');
  s = s.replace(/^[,;:\s]+/, '').replace(/\s+/g, ' ').trim();

  return /[\p{L}\p{N}]/u.test(s) ? s : '';
}

export function chunk(text: string, max = 280): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const cut = findSplit(t, max);
  return [...chunk(t.slice(0, cut), max), ...chunk(t.slice(cut), max)];
}

function findSplit(t: string, max: number): number {
  const lo = Math.floor(t.length * 0.3);
  const hi = Math.ceil(t.length * 0.7);
  const mid = t.length / 2;
  for (const p of [';', ':', ',']) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = t.indexOf(p); i !== -1; i = t.indexOf(p, i + 1)) {
      const cut = i + 1;
      if (cut < lo || cut > hi) continue;
      const d = Math.abs(cut - mid);
      if (d < bestDist) {
        best = cut;
        bestDist = d;
      }
    }
    if (best !== -1) return best;
  }
  const sp = t.lastIndexOf(' ', max);
  return sp > 0 ? sp : max;
}
