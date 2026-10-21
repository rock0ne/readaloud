// EPUB loader (spec 5.5): container.xml -> OPF -> spine; TOC from nav.xhtml or toc.ncx.
import JSZip from 'jszip';
import { bodyOf, elementToBlocks, inlineText, parseHtml } from './html';
import { IngestError, type Loader, type LoaderResult, type RawBlock } from './raw';
import { stripExtension } from './txt';
import { dirname, resolveHref } from '../util/paths';

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string;
}

interface TocRaw {
  title: string;
  level: number;
  path: string;
  fragment: string;
}

const HTML_TYPES = new Set(['application/xhtml+xml', 'text/html', 'application/x-dtbook+xml']);

function byLocal(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);
}

function childrenByLocal(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((e) => e.localName === name);
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function findFile(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = zip.file(path);
  if (direct) return direct;
  const lower = path.toLowerCase();
  const key = Object.keys(zip.files).find((k) => k.toLowerCase() === lower);
  return key ? zip.file(key) : null;
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const f = findFile(zip, path);
  return f ? f.async('string') : null;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

// Pictures, fonts and media: never read aloud, and they can make an EPUB hundreds of MB (ADR-26).
const NOT_READ = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|svg|ttf|otf|woff2?|mp3|m4a|aac|ogg|wav|mp4|webm)$/i;

/** The same EPUB without its pictures, fonts and media: it reads to exactly the same text. */
export async function textOnlyEpub(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files)) if (NOT_READ.test(name)) zip.remove(name);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

export const loadEpub: Loader = async (bytes, opts) => {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    throw new IngestError('corrupt', `Could not open ${opts.name} as an EPUB: ${(e as Error).message}`);
  }
  const warnings: string[] = [];

  // 1. container.xml -> OPF path
  const containerXml = await readText(zip, 'META-INF/container.xml');
  if (!containerXml) throw new IngestError('corrupt', `${opts.name} has no META-INF/container.xml.`);
  const rootfile = byLocal(parseXml(containerXml), 'rootfile')[0];
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new IngestError('corrupt', `${opts.name} does not name its package file.`);
  const opfText = await readText(zip, opfPath);
  if (!opfText) throw new IngestError('corrupt', `${opts.name} is missing ${opfPath}.`);
  const opfDir = dirname(opfPath);
  const opf = parseXml(opfText);

  // 2. metadata
  const title = byLocal(opf, 'title')[0]?.textContent?.trim() || stripExtension(opts.name);
  const language = byLocal(opf, 'language')[0]?.textContent?.trim() || 'en';

  // 3. manifest
  const manifest = new Map<string, ManifestItem>();
  for (const item of byLocal(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      path: resolveHref(opfDir, href).path,
      mediaType: (item.getAttribute('media-type') ?? '').toLowerCase(),
      properties: item.getAttribute('properties') ?? '',
    });
  }

  // 4. DRM check
  const encryption = await readText(zip, 'META-INF/encryption.xml');
  if (encryption) {
    const uris = byLocal(parseXml(encryption), 'CipherReference').map((c) => resolveHref('', c.getAttribute('URI') ?? '').path);
    const htmlPaths = new Set([...manifest.values()].filter((m) => HTML_TYPES.has(m.mediaType)).map((m) => m.path));
    if (uris.some((u) => htmlPaths.has(u) || /\.x?html?$/i.test(u))) {
      throw new IngestError('drm', 'This EPUB is DRM-protected and cannot be read.');
    }
    if (uris.length > 0) warnings.push('Embedded fonts are obfuscated; they are not needed for reading.');
  }

  // 5. spine
  const spineEl = byLocal(opf, 'spine')[0];
  const spine: ManifestItem[] = [];
  for (const ref of spineEl ? childrenByLocal(spineEl, 'itemref') : []) {
    if ((ref.getAttribute('linear') ?? 'yes').toLowerCase() === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (item && HTML_TYPES.has(item.mediaType)) spine.push(item);
  }
  if (spine.length === 0) throw new IngestError('corrupt', `${opts.name} has no readable chapters.`);

  // 6. TOC
  let toc = await navToc(zip, manifest);
  if (toc.length === 0) toc = await ncxToc(zip, manifest, spineEl?.getAttribute('toc') ?? '');

  // 7. content
  const blocks: RawBlock[] = [];
  const spineStart = new Map<string, number>();
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i]!;
    const xhtml = await readText(zip, item.path);
    if (xhtml === null) {
      warnings.push(`Missing chapter file ${item.path}.`);
      continue;
    }
    const doc = parseHtml(xhtml, 'application/xhtml+xml');
    spineStart.set(item.path, blocks.length);
    blocks.push(...elementToBlocks(bodyOf(doc), item.path));
    opts.onProgress?.(i + 1, spine.length);
    if ((i + 1) % 10 === 0) await yieldToUi();
  }

  return mapToc({ title, language, blocks, warnings }, toc, spineStart, spine);
};

function mapToc(result: LoaderResult, toc: TocRaw[], spineStart: Map<string, number>, spine: ManifestItem[]): LoaderResult {
  const { blocks, warnings } = result;
  const mapped: Array<{ title: string; level: number; blockIndex: number }> = [];
  let unmapped = 0;
  for (const entry of toc) {
    const start = spineStart.get(entry.path);
    if (start === undefined) {
      unmapped++;
      continue;
    }
    let idx = start;
    if (entry.fragment) {
      for (let i = start; i < blocks.length; i++) {
        const a = blocks[i]?.anchor;
        if (!a || a.href !== entry.path) break;
        if (a.ids.includes(entry.fragment)) {
          idx = i;
          break;
        }
      }
    }
    if (idx >= blocks.length || blocks[idx]?.anchor?.href !== entry.path) {
      unmapped++;
      continue;
    }
    mapped.push({ title: entry.title, level: entry.level, blockIndex: idx });
    // Promote styled chapter titles (e.g. <div class="title">) to headings.
    const b = blocks[idx]!;
    if (b.type !== 'heading' && b.text.length <= 120 && titlesMatch(b.text, entry.title)) {
      b.type = 'heading';
      b.level = Math.min(6, Math.max(1, entry.level));
    }
  }
  if (unmapped > 0) warnings.push(`${unmapped} table-of-contents entr${unmapped === 1 ? 'y' : 'ies'} could not be matched to the text.`);

  if (mapped.length > 0) {
    const minLevel = Math.min(...mapped.map((m) => m.level));
    result.chapterStarts = mapped.filter((m) => m.level === minLevel).map((m) => ({ blockIndex: m.blockIndex, title: m.title }));
    result.toc = mapped;
  } else if (!blocks.some((b) => b.type === 'heading')) {
    // No TOC and no headings: one chapter per spine item.
    result.chapterStarts = spine
      .map((s, i) => ({ blockIndex: spineStart.get(s.path) ?? -1, title: `Section ${i + 1}` }))
      .filter((s) => s.blockIndex >= 0 && s.blockIndex < blocks.length);
  }
  for (const b of blocks) delete b.anchor;
  return result;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** True when a block's text is the chapter title, not merely a paragraph containing it. */
function titlesMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) && short.length / long.length >= 0.5;
}

async function navToc(zip: JSZip, manifest: Map<string, ManifestItem>): Promise<TocRaw[]> {
  const navItem = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('nav'));
  if (!navItem) return [];
  const text = await readText(zip, navItem.path);
  if (!text) return [];
  const doc = parseHtml(text, 'application/xhtml+xml');
  const navs = Array.from(doc.getElementsByTagName('nav'));
  const isToc = (n: Element) =>
    (n.getAttribute('epub:type') ?? n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '').split(/\s+/).includes('toc');
  const nav = navs.find(isToc) ?? navs[0];
  const ol = nav ? Array.from(nav.children).find((c) => c.localName === 'ol') : undefined;
  if (!ol) return [];
  const baseDir = dirname(navItem.path);
  const out: TocRaw[] = [];
  const walk = (list: Element, level: number) => {
    for (const li of childrenByLocal(list, 'li')) {
      const a = Array.from(li.children).find((c) => c.localName === 'a' || c.localName === 'span');
      const href = a?.getAttribute('href');
      const title = a ? inlineText(a) : '';
      if (href && title) {
        const r = resolveHref(baseDir, href);
        out.push({ title, level, path: r.path, fragment: r.fragment });
      }
      for (const nested of childrenByLocal(li, 'ol')) walk(nested, level + 1);
    }
  };
  walk(ol, 1);
  return out;
}

async function ncxToc(zip: JSZip, manifest: Map<string, ManifestItem>, tocId: string): Promise<TocRaw[]> {
  const ncxItem = manifest.get(tocId) ?? [...manifest.values()].find((m) => m.mediaType === 'application/x-dtbncx+xml');
  if (!ncxItem) return [];
  const text = await readText(zip, ncxItem.path);
  if (!text) return [];
  const doc = parseXml(text);
  const navMap = byLocal(doc, 'navMap')[0];
  if (!navMap) return [];
  const baseDir = dirname(ncxItem.path);
  const out: TocRaw[] = [];
  const walk = (parent: Element, level: number) => {
    for (const np of childrenByLocal(parent, 'navPoint')) {
      const label = childrenByLocal(np, 'navLabel')[0];
      const title = (label ? byLocal(label, 'text')[0]?.textContent : '')?.replace(/\s+/g, ' ').trim() ?? '';
      const src = childrenByLocal(np, 'content')[0]?.getAttribute('src');
      if (src && title) {
        const r = resolveHref(baseDir, src);
        out.push({ title, level, path: r.path, fragment: r.fragment });
      }
      walk(np, level + 1);
    }
  };
  walk(navMap, 1);
  return out;
}
