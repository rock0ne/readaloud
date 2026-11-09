import { expect, it } from 'vitest';
import { AUDIO_FORMATS, chapterPayload } from '../src/core/audio/formats';
it('offers real WAV/MP3/AAC containers without extra runtime formats', () => {
  expect(Object.keys(AUDIO_FORMATS)).toEqual(['wav', 'mp3', 'm4a', 'm4b']);
  expect(AUDIO_FORMATS.mp3.mime).toBe('audio/mpeg');
  expect(AUDIO_FORMATS.m4b.mime).toBe('audio/mp4');
});
it('writes counted big-endian Nero markers at exact sample-derived times', () => {
  const p = chapterPayload([{ title: 'Opening', seconds: 0 }, { title: 'Chapter Two', seconds: 12.5 }]);
  expect(p[0]).toBe(1); expect(p[8]).toBe(2);
  const v = new DataView(p.buffer); expect(v.getBigUint64(9, false)).toBe(0n);
  const next = 9 + 9 + new TextEncoder().encode('Opening').length;
  expect(v.getBigUint64(next, false)).toBe(125000000n);
});
it('bounds counts/times and truncates titles without splitting UTF-8', () => {
  expect(() => chapterPayload([])).toThrow();
  expect(() => chapterPayload(Array.from({ length: 256 }, (_, i) => ({ title: 'x', seconds: i })))).toThrow();
  expect(() => chapterPayload([{ title: 'x', seconds: NaN }])).toThrow();
  expect(() => chapterPayload([{ title: 'a', seconds: 2 }, { title: 'b', seconds: 1 }])).toThrow();
  const p = chapterPayload([{ title: '😀'.repeat(100), seconds: 0 }]);
  expect(p[17]).toBe(252);
  expect(new TextDecoder('utf-8', { fatal: true }).decode(p.slice(18))).toBe('😀'.repeat(63));
});
