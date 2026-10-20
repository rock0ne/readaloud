// Word .docx loader (spec 5.4). mammoth is loaded lazily to keep it out of the main bundle.
import { htmlToDocument } from './html';
import { IngestError, type Loader } from './raw';
import { stripExtension } from './txt';

interface MammothLike {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
}

async function loadMammoth(): Promise<MammothLike> {
  const mod = (await import('mammoth')) as unknown as { default?: MammothLike } & MammothLike;
  return mod.default ?? mod;
}

export const loadDocx: Loader = async (bytes, opts) => {
  const mammoth = await loadMammoth();
  // The browser build of mammoth reads `arrayBuffer`; the Node build (tests) reads `buffer`.
  const input = { arrayBuffer: bytes, buffer: bytes } as { arrayBuffer: ArrayBuffer };
  let result: Awaited<ReturnType<MammothLike['convertToHtml']>>;
  try {
    result = await mammoth.convertToHtml(input);
  } catch (e) {
    throw new IngestError('corrupt', `Could not read ${opts.name}: ${(e as Error).message}`);
  }
  const blocks = htmlToDocument(result.value);
  const h1 = blocks.find((b) => b.type === 'heading' && b.level === 1);
  return { title: h1?.text ?? stripExtension(opts.name), blocks, warnings: docxWarnings(result.messages) };
};

/**
 * mammoth reports each unknown Word style twice in its own words. Those are harmless (the text is
 * still read), so they become one plain sentence; other messages pass through unchanged.
 */
export function docxWarnings(messages: Array<{ type: string; message: string }>): string[] {
  const styles = new Set<string>();
  const other: string[] = [];
  for (const m of messages) {
    if (m.type !== 'warning' && m.type !== 'error') continue;
    const style = /Style ID: ([^)]+)\)|style with ID (\S+) was referenced/i.exec(m.message);
    if (style) styles.add((style[1] ?? style[2] ?? '').trim());
    else if (!other.includes(m.message)) other.push(m.message);
  }
  const out: string[] = [];
  if (styles.size > 0) {
    const names = [...styles].slice(0, 5).join(', ') + (styles.size > 5 ? ` and ${styles.size - 5} more` : '');
    out.push(`Word styles not recognised: ${names}. Their text is read as normal paragraphs.`);
  }
  return [...out, ...other].slice(0, 10);
}
