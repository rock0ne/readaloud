// Server-sent events read from a fetch body (spec 17.2). Comments and keep-alives are skipped.

export interface SseEvent {
  event: string;
  data: string;
}

function parseEvent(raw: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A lone '\r' at the end may be the first half of '\r\n', so it waits for the next read.
      buf = buf.replace(/\r\n/g, '\n').replace(/\r(?=[\s\S])/g, '\n');
      if (done) buf = buf.replace(/\r$/, '\n') + '\n\n';
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) !== -1) {
        const ev = parseEvent(buf.slice(0, cut));
        buf = buf.slice(cut + 2);
        if (ev) yield ev;
      }
      if (done) return;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
