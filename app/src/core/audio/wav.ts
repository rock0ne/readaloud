// 16-bit mono PCM WAV, for audio engines that produce raw samples (Kokoro).
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Reads a 16-bit PCM WAV (mono, or the first channel of more), such as the files Android's
 * TextToSpeech.synthesizeToFile writes (ADR-27). A data size left at 0 or past the end means
 * "to the end of the file".
 */
export function decodeWav(bytes: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes);
  const tag = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
  let at = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | null = null;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data comes before its format.');
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`Only 16-bit PCM WAV can be read (format ${fmt.format}, ${fmt.bits} bits).`);
      const end = size === 0 || body + size > bytes.byteLength ? bytes.byteLength : body + size;
      const frame = 2 * fmt.channels;
      const samples = new Float32Array(Math.floor((end - body) / frame));
      for (let i = 0; i < samples.length; i++) samples[i] = v.getInt16(body + i * frame, true) / 0x8000;
      return { samples, sampleRate: fmt.sampleRate };
    }
    at = body + size + (size % 2);
  }
  throw new Error('WAV file has no audio data.');
}

/** Joins sample runs end to end. */
export function concatSamples(parts: Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
