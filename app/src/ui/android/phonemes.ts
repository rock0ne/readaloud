// Text to Kokoro phonemes for the Android app, exactly as kokoro-js 1.2.1 does it on the PC
// (its phonemize(), Apache-2.0, ported unchanged): normalise numbers, money and titles, then
// eSpeak-NG through the same `phonemizer` package. sherpa-onnx is then given the phonemes, so no
// word is skipped and the phone says each word as the PC does (ADR-27). eSpeak and its English data
// are 1.3 MB, so the app loads this module the first time the phone voice speaks.
import { phonemize as espeak } from 'phonemizer';

/** Years, clock times and decimals, as words eSpeak reads naturally. */
function splitNum(m: string): string {
  if (m.includes('.')) return m;
  if (m.includes(':')) {
    const [h, min] = m.split(':').map(Number) as [number, number];
    return min === 0 ? `${h} o'clock` : min < 10 ? `${h} oh ${min}` : `${h} ${min}`;
  }
  const year = parseInt(m.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return m;
  const left = m.slice(0, 2);
  const right = parseInt(m.slice(2, 4), 10);
  const s = m.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${s}`;
    if (right < 10) return `${left} oh ${right}${s}`;
  }
  return `${left} ${right}${s}`;
}

function flipMoney(m: string): string {
  const bill = m[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(m.slice(1)))) return `${m.slice(1)} ${bill}s`;
  if (!m.includes('.')) return `${m.slice(1)} ${bill}${m.slice(1) === '1' ? '' : 's'}`;
  const [b, c] = m.slice(1).split('.') as [string, string];
  const d = parseInt(c.padEnd(2, '0'), 10);
  const coins = m[0] === '$' ? (d === 1 ? 'cent' : 'cents') : d === 1 ? 'penny' : 'pence';
  return `${b} ${bill}${b === '1' ? '' : 's'} and ${d} ${coins}`;
}

function pointNum(m: string): string {
  const [a, b] = m.split('.') as [string, string];
  return `${a} point ${b.split('').join(' ')}`;
}

export function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .replace(/[“”]/g, '"')
    .replace(/\(/g, '«')
    .replace(/\)/g, '»')
    .replace(/、/g, ', ')
    .replace(/。/g, '. ')
    .replace(/！/g, '! ')
    .replace(/，/g, ', ')
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ')
    .replace(/  +/, ' ')
    .replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_RUN = new RegExp(`(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g');

/** Kokoro phonemes for the text: `accent` 'b' is British English, 'a' American (the voice id's first letter). */
export async function textToPhonemes(text: string, accent: 'a' | 'b'): Promise<string> {
  const normal = normalizeText(text);
  const parts: Array<{ punct: boolean; text: string }> = [];
  let at = 0;
  for (const m of normal.matchAll(PUNCTUATION_RUN)) {
    if (at < m.index) parts.push({ punct: false, text: normal.slice(at, m.index) });
    if (m[0].length > 0) parts.push({ punct: true, text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < normal.length) parts.push({ punct: false, text: normal.slice(at) });
  const lang = accent === 'a' ? 'en-us' : 'en';
  const raw = (await Promise.all(parts.map(async (p) => (p.punct ? p.text : (await espeak(p.text, lang)).join(' '))))).join('');
  let out = raw
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (accent === 'a') out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return out.trim();
}
