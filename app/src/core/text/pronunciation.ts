// English speech-only hints, not a language model. Uncertain meanings are left to the voice.
export interface PronunciationSettings { enabled: boolean; list: string; }
export const DEFAULT_PRONUNCIATION: PronunciationSettings = { enabled: true, list: '' };

/** Literal, case-sensitive whole words/phrases. No regex, markup, executable rules or IPA. */
export function parsePronunciations(list: string): Map<string, string> {
  if (list.length > 20000) throw new Error('Pronunciation list is limited to 20,000 characters.');
  const rules = new Map<string, string>();
  for (const [i, raw] of list.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const word = line.slice(0, at).trim(), spoken = line.slice(at + 1).trim();
    if (at < 1 || !word || !spoken || word.length > 100 || spoken.length > 200 || /[<>=\u0000-\u001f]/.test(word + spoken)) {
      throw new Error(`Line ${i + 1}: use word = spoken spelling (plain text, up to 100/200 characters).`);
    }
    if (rules.has(word)) throw new Error(`Line ${i + 1}: duplicate entry for ${word}.`);
    rules.set(word, spoken);
    if (rules.size > 200) throw new Error('Use at most 200 pronunciation entries.');
  }
  return rules;
}

export function validPronunciation(value: unknown): value is PronunciationSettings {
  if (!value || typeof value !== 'object') return false;
  const p = value as PronunciationSettings;
  if (typeof p.enabled !== 'boolean' || typeof p.list !== 'string') return false;
  try { parsePronunciations(p.list); return true; } catch { return false; }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const letter = (s: string) => /[\p{L}\p{N}_]/u.test(s);

/** Custom entries win; replacements never feed back into another rule. Offsets refer to input. */
export function pronunciationText(text: string, p: PronunciationSettings = DEFAULT_PRONUNCIATION, locale = 'en-GB'): string {
  if (!/^en(?:-|$)/i.test(locale)) return text;
  const custom = parsePronunciations(p.list);
  const alternatives = [...custom.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp([...alternatives, '[A-Za-z]+'].join('|'), 'gu');
  return text.replace(pattern, (word: string, offset: number) => {
    if ((offset && letter(text[offset - 1]!)) || letter(text[offset + word.length] ?? '')) return word;
    if (custom.has(word)) return custom.get(word)!;
    if (!p.enabled) return word;
    const before = text.slice(Math.max(0, offset - 90), offset).toLowerCase();
    const after = text.slice(offset + word.length, offset + word.length + 90).toLowerCase();
    const w = word.toLowerCase();
    // Only literal uppercase abbreviations. "Who are you?" and ordinary pronouns stay intact.
    if (['OT', 'IT', 'US', 'WHO'].includes(word)) return word.split('').join('. ') + (after.startsWith('.') ? '' : '.');
    if (w === 'leave') return 'leeve';
    // Strong grammatical/collocation cues only: "live better" must not become "lyve better".
    if (w === 'live') {
      if (/\b(go|goes|going|went|gone|come|comes|came)\s+$/.test(before)
        || /^[-–]/.test(after)
        || /^\s+(systems?|data|events?|alerts?|environments?|telemetry|feeds?|streams?|broadcasts?|music|shows?|performances?|audiences?|sessions?|traffic|services?|production|demonstrations?|demos?|video|recordings?|tv|radio|on\s+(?:air|tv|television|radio))\b/.test(after)) return 'lyve';
      if (/\b(i|you|we|they|to|can|could|will|would|should|must|where)\s+$/.test(before)
        || /^\s+(in|with|at|abroad|alone|together|longer|well|happily|here|there)\b/.test(after)) return 'liv';
    }
    if (w === 'read') {
      if (/\b(have|has|had|already|yesterday)\s+(?:just\s+)?$/.test(before) || /^\s+it\s+yesterday\b/.test(after)) return 'red';
      if (/\b(to|will|can|please|must|should)\s+$/.test(before)) return 'reed';
    }
    if (w === 'lead') {
      if (/\b(made\s+of|molten|heavy\s+metal)\s+$/.test(before) || /^\s+(poisoning|paint|pipes?|metal)\b/.test(after)) return 'led';
      if (/\b(to|will|can|please|must|should)\s+$/.test(before) || /^\s+(the\s+team|analyst|engineer|developer|role)\b/.test(after)) return 'leed';
    }
    if (w === 'wind') {
      if (/\b(to|please|will)\s+$/.test(before) || /^\s+(up|down|the\s+clock)\b/.test(after)) return 'wined';
      if (/\b(the|strong|cold|warm)\s+$/.test(before)) return 'wind';
    }
    if (w === 'close') {
      if (/\b(to|please|will|can|must)\s+$/.test(before) || /^\s+(the\s+(door|window|ticket|case)|it)\b/.test(after)) return 'cloze';
      if (/^\s+(to|by|friends?|relatives?)\b/.test(after)) return 'clohss';
    }
    if (w === 'record') {
      if (/\b(to|please|will|can|must|should)\s+$/.test(before)) return 'recórd';
      if (/\b(a|the|this|that|your|our|my)\s+$/.test(before)) return 'record';
    }
    if (w === 'present') {
      if (/\b(to|please|will|can|must|should)\s+$/.test(before)) return 'prezent';
      if (/\b(a|the|at|is|was|are|were)\s+$/.test(before)) return 'present';
    }
    if (w === 'minute') {
      if (/^\s+(details?|differences?|quantities|amounts?|particles?)\b/.test(after)) return 'my-noot';
      if (/\b(a|one|each|every|per|last|next)\s+$/.test(before)) return 'min-it';
    }
    if (w === 'tear') {
      if (/\b(to|please|will|can|must)\s+$/.test(before) || /^\s+(up|apart|down|the\s+paper)\b/.test(after)) return 'tair';
      if (/^\s+(in\s+(?:her|his|my|your|their)\s+eye|rolled|fell)\b/.test(after)) return 'teer';
    }
    if (w === 'wound') {
      if (/\b(had|has|have)\s+$/.test(before) || /^\s+(up|the\s+clock)\b/.test(after)) return 'wownd';
      if (/\b(a|the|open|deep|her|his)\s+$/.test(before)) return 'woond';
    }
    if (w === 'object') {
      if (/\b(to|will|may|i|we|they)\s+$/.test(before) || /^\s+to\b/.test(after)) return 'objèct';
      if (/\b(an|the|this|that|a)\s+$/.test(before)) return 'object';
    }
    if (w === 'content') {
      if (/\b(feel|felt|seem|seemed)\s+$/.test(before) || /^\s+(with|to\s+stay)\b/.test(after)) return 'contènt';
      if (/\b(the|this|that|your|our|digital|training)\s+$/.test(before)) return 'content';
    }
    if (w === 'use') {
      if (/\b(to|please|will|can|must|should|i|we|they|you)\s+$/.test(before)) return 'yooz';
      if (/\b(the|a|its|in|for|of)\s+$/.test(before)) return 'yooss';
    }
    if (w === 'desert') {
      if (/\b(to|will|would|must|never)\s+$/.test(before)) return 'dessert';
      if (/\b(the|a|sahara)\s+$/.test(before)) return 'desert';
    }
    if (w === 'bow') {
      if (/\b(to|please|will|must|take\s+a)\s+$/.test(before) || /^\s+(down|before)\b/.test(after)) return 'bough';
      if (/\b(tie\s+a|a\s+violin|a\s+hair)\s+$/.test(before) || /^\s+(tie|and\s+arrow)\b/.test(after)) return 'boh';
    }
    if (w === 'row') {
      if (/\b(had\s+a|an\s+angry|a\s+heated)\s+$/.test(before) || /^\s+about\b/.test(after)) return 'rau';
      if (/\b(to|please|will|front|back)\s+$/.test(before) || /^\s+(of|the\s+boat)\b/.test(after)) return 'roh';
    }
    return word;
  });
}
