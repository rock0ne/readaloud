// Ingestion entry point (spec 5.0).
import type { DocFormat, ParsedDocument } from '../types';
import { buildDocument } from '../text/build';
import { IngestError, type Loader } from './raw';
import { stripExtension } from './txt';

export { IngestError } from './raw';
export type { IngestErrorCode } from './raw';

export const MAX_BYTES = 50 * 1024 * 1024;
export const ACCEPT = '.txt,.md,.markdown,.docx,.pdf,.epub';

const EXT: Record<string, DocFormat> = {
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  docx: 'docx',
  pdf: 'pdf',
  epub: 'epub',
};

export function detectFormat(name: string): DocFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return EXT[ext] ?? null;
}

async function sniff(bytes: ArrayBuffer): Promise<DocFormat | null> {
  const head = new Uint8Array(bytes.slice(0, 64));
  const ascii = String.fromCharCode(...head);
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) {
    if (ascii.includes('mimetypeapplication/epub+zip')) return 'epub';
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    if (zip.file('word/document.xml')) return 'docx';
    if (zip.file('META-INF/container.xml')) return 'epub';
  }
  return null;
}

async function loaderFor(format: DocFormat): Promise<Loader> {
  switch (format) {
    case 'txt':
      return (await import('./txt')).loadTxt;
    case 'md':
      return (await import('./md')).loadMd;
    case 'docx':
      return (await import('./docx')).loadDocx;
    case 'epub':
      return (await import('./epub')).loadEpub;
    case 'pdf':
      return (await import('./pdf')).loadPdf;
  }
}

export interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ParseOptions {
  locale?: string;
  onProgress?: (done: number, total: number) => void;
}

export async function parseBytes(bytes: ArrayBuffer, name: string, opts: ParseOptions = {}): Promise<ParsedDocument> {
  if (bytes.byteLength > MAX_BYTES) throw new IngestError('too-large', `${name} is larger than 50 MB.`);
  const format = detectFormat(name) ?? (await sniff(bytes));
  if (!format) throw new IngestError('unsupported', `${name}: only .txt, .md, .docx, .pdf and .epub files can be read.`);
  const loader = await loaderFor(format);
  const raw = await loader(bytes, { name, ...(opts.onProgress ? { onProgress: opts.onProgress } : {}) });
  const doc = buildDocument(raw, { format, fallbackTitle: stripExtension(name), ...(opts.locale ? { locale: opts.locale } : {}) });
  if (doc.blocks.every((b) => b.sentences.every((s) => s.speakText === ''))) {
    throw new IngestError('empty', `No readable text found in ${name}.`);
  }
  return doc;
}

export async function parseFile(file: FileLike, opts: ParseOptions = {}): Promise<ParsedDocument> {
  if (file.size > MAX_BYTES) throw new IngestError('too-large', `${file.name} is larger than 50 MB.`);
  return parseBytes(await file.arrayBuffer(), file.name, opts);
}
