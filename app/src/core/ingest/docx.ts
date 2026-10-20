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
  const warnings = result.messages
    .filter((m) => m.type === 'warning' || m.type === 'error')
    .map((m) => m.message)
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .slice(0, 10);
  return { title: h1?.text ?? stripExtension(opts.name), blocks, warnings };
};
