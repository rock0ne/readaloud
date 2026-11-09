export type AudioExportFormat = 'wav' | 'mp3' | 'm4a' | 'm4b';
export const AUDIO_FORMATS = {
  wav: { label: 'WAV — uncompressed editing master', mime: 'audio/wav' },
  mp3: { label: 'MP3 — widely compatible', mime: 'audio/mpeg' },
  m4a: { label: 'M4A — AAC compressed audio', mime: 'audio/mp4' },
  m4b: { label: 'M4B — AAC audiobook with chapter markers', mime: 'audio/mp4' },
} as const;

/** Nero-style MP4 udta/chpl payload, timestamps in 100 ns units. No silent truncation. */
export function chapterPayload(chapters: { title: string; seconds: number }[]): Uint8Array {
  if (!chapters.length || chapters.length > 255) throw new Error('M4B supports 1–255 chapter markers in this exporter.');
  let previous = -1;
  const values = chapters.map((c) => {
    if (!Number.isFinite(c.seconds) || c.seconds < 0 || c.seconds <= previous) throw new Error('Chapter times must be increasing.');
    previous = c.seconds;
    // Trim by Unicode code point, never halfway through a UTF-8 character.
    let title = c.title.trim() || 'Chapter';
    const enc = new TextEncoder();
    while (enc.encode(title).length > 255) title = Array.from(title).slice(0, -1).join('');
    return { time: BigInt(Math.round(c.seconds * 10000000)), title: enc.encode(title) };
  });
  const bytes = new Uint8Array(9 + values.reduce((n, c) => n + 9 + c.title.length, 0));
  bytes[0] = 1; bytes[8] = values.length;
  const view = new DataView(bytes.buffer); let at = 9;
  for (const c of values) { view.setBigUint64(at, c.time, false); at += 8; bytes[at++] = c.title.length; bytes.set(c.title, at); at += c.title.length; }
  return bytes;
}
