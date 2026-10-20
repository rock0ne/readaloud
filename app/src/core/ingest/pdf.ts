// PDF loader (spec 5.6). Pure reconstruction functions are exported for tests;
// pdf.js itself is loaded lazily.
import { IngestError, type Loader, type RawBlock } from './raw';
import { stripExtension } from './txt';

export interface PdfItem {
  str: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
}

export interface PdfLine {
  text: string;
  y: number;
  x0: number;
  x1: number;
  fontSize: number;
  page: number;
}

export interface PdfPage {
  lines: PdfLine[];
  height: number;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function mode(nums: number[]): number {
  const counts = new Map<number, number>();
  for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
  let best = nums[0] ?? 0;
  let bestCount = 0;
  for (const [n, c] of counts) if (c > bestCount) [best, bestCount] = [n, c];
  return best;
}

const round = (n: number, step = 0.5) => Math.round(n / step) * step;

/** Groups text items into lines, top to bottom (PDF y grows upward). */
export function itemsToLines(items: PdfItem[], page: number): PdfLine[] {
  const real = items.filter((i) => i.str.trim().length > 0);
  if (real.length === 0) return [];
  const tol = 0.5 * median(real.map((i) => i.fontSize));
  const sorted = [...real].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PdfItem[][] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs((g[0]?.y ?? 0) - it.y) <= tol) g.push(it);
    else groups.push([it]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let text = '';
    let prev: PdfItem | undefined;
    for (const it of g) {
      if (prev) {
        const gap = it.x - (prev.x + prev.width);
        if (gap > 0.25 * it.fontSize && !/\s$/.test(prev.str) && !/^\s/.test(it.str)) text += ' ';
      }
      text += it.str;
      prev = it;
    }
    const chars = new Map<number, number>();
    for (const it of g) chars.set(round(it.fontSize), (chars.get(round(it.fontSize)) ?? 0) + it.str.length);
    const fontSize = [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? g[0]!.fontSize;
    const last = g[g.length - 1]!;
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      y: g[0]!.y,
      x0: g[0]!.x,
      x1: last.x + last.width,
      fontSize,
      page,
    };
  });
}

const PAGE_NUMBER = /^(?:\d+|[ivxlcdm]+|page\s+\d+(?:\s+of\s+\d+)?|-\s*\d+\s*-)$/i;

/** Removes running headers/footers and page numbers from the top and bottom 10% of pages. */
export function dropRunningLines(pages: PdfPage[]): PdfPage[] {
  const inZone = (l: PdfLine, h: number) => l.y >= 0.9 * h || l.y <= 0.1 * h;
  const key = (t: string) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const counts = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const l of p.lines) if (inZone(l, p.height)) seen.add(key(l.text));
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const n = pages.length;
  const threshold = Math.max(Math.min(3, n), Math.ceil(0.3 * n));
  const running = new Set(n >= 2 ? [...counts].filter(([, c]) => c >= threshold).map(([k]) => k) : []);
  return pages.map((p) => ({
    height: p.height,
    lines: p.lines.filter((l) => !(inZone(l, p.height) && (running.has(key(l.text)) || PAGE_NUMBER.test(l.text)))),
  }));
}

const SENTENCE_END = /[.!?"”’)]$/;

/** Joins lines into paragraphs and detects headings by font size. */
export function linesToBlocks(lines: PdfLine[]): RawBlock[] {
  if (lines.length === 0) return [];
  const charsBySize = new Map<number, number>();
  for (const l of lines) charsBySize.set(round(l.fontSize), (charsBySize.get(round(l.fontSize)) ?? 0) + l.text.length);
  const body = [...charsBySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  const bodyLines = lines.filter((l) => Math.abs(round(l.fontSize) - body) < 0.01);

  const gaps: number[] = [];
  for (let i = 1; i < bodyLines.length; i++) {
    const a = bodyLines[i - 1]!;
    const b = bodyLines[i]!;
    if (a.page === b.page && a.y > b.y) gaps.push(a.y - b.y);
  }
  const lineGap = median(gaps) || body * 1.2;
  const widthMedian = median(bodyLines.map((l) => l.x1 - l.x0));
  const leftByPage = new Map<number, number>();
  for (const page of new Set(lines.map((l) => l.page))) {
    const xs = bodyLines.filter((l) => l.page === page).map((l) => round(l.x0, 1));
    leftByPage.set(page, xs.length ? mode(xs) : Math.min(...lines.filter((l) => l.page === page).map((l) => l.x0)));
  }

  interface Para {
    text: string;
    fontSize: number;
  }
  const paras: Para[] = [];
  let cur: Para | null = null;
  let prev: PdfLine | null = null;
  for (const line of lines) {
    let start = cur === null || prev === null;
    if (!start && prev && cur) {
      if (line.page !== prev.page) {
        start = SENTENCE_END.test(prev.text);
      } else if (prev.y - line.y > 1.5 * lineGap) {
        start = true;
      }
      if (line.x0 - (leftByPage.get(line.page) ?? line.x0) > 1.0 * line.fontSize) start = true;
      if (prev.x1 - prev.x0 < 0.6 * widthMedian && SENTENCE_END.test(prev.text) && line.page === prev.page) start = true;
      if (Math.abs(line.fontSize - prev.fontSize) > 0.15 * Math.max(line.fontSize, prev.fontSize)) start = true;
    }
    if (start || !cur) {
      cur = { text: line.text, fontSize: line.fontSize };
      paras.push(cur);
    } else if (/[A-Za-z]-$/.test(cur.text) && /^\p{Ll}/u.test(line.text)) {
      cur.text = cur.text.slice(0, -1) + line.text;
    } else {
      cur.text += ' ' + line.text;
    }
    prev = line;
  }

  const headingSizes = [...new Set(paras.filter((p) => p.fontSize >= 1.25 * body).map((p) => round(p.fontSize)))].sort((a, b) => b - a);
  return paras.map((p) => {
    const rank = headingSizes.indexOf(round(p.fontSize));
    if (rank !== -1 && p.text.length <= 200) return { type: 'heading', level: Math.min(3, rank + 1), text: p.text };
    return { type: 'paragraph', text: p.text };
  });
}

export function isScanned(totalChars: number, pageCount: number): boolean {
  return pageCount > 0 && totalChars / pageCount < 50;
}

export const loadPdf: Loader = async (bytes, opts) => {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  // Text extraction needs no image decoders; useWasm:false keeps pdf.js inside the CSP (no wasm-unsafe-eval).
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useWasm: false });
  let pdf: Awaited<typeof task.promise>;
  try {
    pdf = await task.promise;
  } catch (e) {
    throw new IngestError('corrupt', `Could not open ${opts.name} as a PDF: ${(e as Error).message}`);
  }
  const pages: PdfPage[] = [];
  let totalChars = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const height = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      const [a, b, , , e, f] = raw.transform as number[];
      items.push({ str: raw.str, x: e ?? 0, y: f ?? 0, fontSize: Math.hypot(a ?? 0, b ?? 0) || 10, width: raw.width });
      totalChars += raw.str.trim().length;
    }
    pages.push({ lines: itemsToLines(items, n), height });
    opts.onProgress?.(n, pdf.numPages);
    page.cleanup();
  }
  if (isScanned(totalChars, pdf.numPages)) {
    throw new IngestError('scanned-pdf', 'This PDF has no text layer. Export the text from the source document instead.');
  }
  const blocks = linesToBlocks(dropRunningLines(pages).flatMap((p) => p.lines));
  let title = '';
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as { Title?: unknown };
    if (typeof info.Title === 'string') title = info.Title.trim();
  } catch {
    // metadata is optional
  }
  await task.destroy();
  if (!title) title = blocks.find((b) => b.type === 'heading')?.text ?? stripExtension(opts.name);
  return { title, blocks, warnings: ['PDF reading order is reconstructed; prefer the .docx or .md source for proofreading.'] };
};
