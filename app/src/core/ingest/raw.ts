// Intermediate structures produced by loaders before buildDocument() (spec 5).
import type { BlockType, DocFormat } from '../types';

export interface RawBlock {
  type: BlockType;
  level?: number;
  text: string;
  anchor?: { href: string; ids: string[] };
}

export interface LoaderResult {
  title: string;
  language?: string;
  blocks: RawBlock[];
  warnings: string[];
  /** Optional explicit chapter starts (EPUB TOC). Indices into `blocks`. */
  chapterStarts?: Array<{ blockIndex: number; title: string }>;
  /** Optional explicit TOC (EPUB). Indices into `blocks`. */
  toc?: Array<{ title: string; level: number; blockIndex: number }>;
}

export type IngestErrorCode = 'unsupported' | 'drm' | 'scanned-pdf' | 'corrupt' | 'too-large' | 'empty';

export class IngestError extends Error {
  readonly code: IngestErrorCode;
  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
  }
}

export interface LoaderOptions {
  name: string;
  onProgress?: (done: number, total: number) => void;
}

export type Loader = (bytes: ArrayBuffer, opts: LoaderOptions) => Promise<LoaderResult>;

export type { DocFormat };
