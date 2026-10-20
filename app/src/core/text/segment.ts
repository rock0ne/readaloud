// Sentence segmentation (spec 6.1).

export interface Segment {
  text: string;
  start: number; // inclusive offset in the source text
  end: number;   // exclusive offset in the source text
}

// Abbreviations that are almost always followed by a name or number, so a
// sentence break after them is wrong whatever the next word looks like.
const ALWAYS_JOIN = new Set([
  'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'St.', 'No.', 'Fig.', 'Vol.', 'Ch.', 'pp.', 'vs.',
]);
// Abbreviations that can legitimately end a sentence; join only when the next
// segment starts with a lowercase letter or a digit.
const JOIN_IF_LOWER = new Set(['etc.', 'e.g.', 'i.e.', 'approx.', 'cf.']);

const CLOSERS_ONLY = /^["'”’)\]»]+$/;

export function segmentSentences(text: string, locale = 'en-GB'): Segment[] {
  const raw = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? viaIntl(text, locale)
    : viaRegex(text);
  return mergeSegments(text, raw);
}

function trimmed(source: string, start: number, end: number): Segment | null {
  while (start < end && /\s/.test(source[start] ?? '')) start++;
  while (end > start && /\s/.test(source[end - 1] ?? '')) end--;
  if (end <= start) return null;
  return { text: source.slice(start, end), start, end };
}

function viaIntl(text: string, locale: string): Segment[] {
  const out: Segment[] = [];
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  } catch {
    segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  }
  for (const s of segmenter.segment(text)) {
    const seg = trimmed(text, s.index, s.index + s.segment.length);
    if (seg) out.push(seg);
  }
  return out;
}

const FALLBACK_SPLIT = /(?<=[.!?…]["”’)\]]?)\s+(?=["“‘(\[]?[A-Z0-9])/g;

export function viaRegex(text: string): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  for (const m of text.matchAll(FALLBACK_SPLIT)) {
    const idx = m.index ?? 0;
    const seg = trimmed(text, start, idx);
    if (seg) out.push(seg);
    start = idx + m[0].length;
  }
  const last = trimmed(text, start, text.length);
  if (last) out.push(last);
  return out;
}

function lastToken(s: string): string {
  const parts = s.split(/\s+/);
  const tok = parts[parts.length - 1] ?? '';
  return tok.replace(/^["“‘(\[]+/, '');
}

function mergeSegments(source: string, segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segs) {
    const prev = out[out.length - 1];
    if (prev) {
      const tok = lastToken(prev.text);
      const nextFirst = seg.text[0] ?? '';
      const tinyOrClosers = CLOSERS_ONLY.test(seg.text) || seg.text.length < 2;
      const abbrevJoin =
        ALWAYS_JOIN.has(tok) ||
        (JOIN_IF_LOWER.has(tok.toLowerCase()) && /[a-z0-9]/.test(nextFirst));
      if (tinyOrClosers || abbrevJoin) {
        prev.end = seg.end;
        prev.text = source.slice(prev.start, prev.end);
        continue;
      }
    }
    out.push({ ...seg });
  }
  return out;
}
