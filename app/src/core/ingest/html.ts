// HTML -> RawBlock[] (spec 5.1). Shared by md, docx and epub loaders.
import type { RawBlock } from './raw';

export interface HtmlOptions {
  mime?: DOMParserSupportedType;
  href?: string;
}

const REMOVE = ['script', 'style', 'noscript', 'svg', 'math', 'template', 'head', 'nav', 'aside', 'title'];

const BLOCK_TAGS = new Set([
  'address', 'article', 'blockquote', 'body', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]);

const HEADING = /^h([1-6])$/;

export function parseHtml(html: string, mime: DOMParserSupportedType = 'text/html'): Document {
  const parser = new DOMParser();
  let doc = parser.parseFromString(html, mime);
  if (mime !== 'text/html' && doc.getElementsByTagName('parsererror').length > 0) {
    doc = parser.parseFromString(html, 'text/html');
  }
  return doc;
}

export function htmlToDocument(html: string, opts: HtmlOptions = {}): RawBlock[] {
  const doc = parseHtml(html, opts.mime ?? 'text/html');
  return elementToBlocks(bodyOf(doc), opts.href);
}

export function bodyOf(doc: Document): Element {
  return doc.body ?? doc.getElementsByTagName('body')[0] ?? doc.documentElement;
}

/** Walks an element (normally <body>) and returns blocks in document order. */
export function elementToBlocks(root: Element, href?: string): RawBlock[] {
  for (const tag of REMOVE) {
    for (const el of Array.from(root.getElementsByTagName(tag))) el.remove();
  }
  const walker = new Walker(href);
  walker.container(root);
  walker.flushPending();
  return walker.blocks;
}

function isElement(n: Node): n is Element {
  return n.nodeType === 1;
}

function isBlock(n: Node): boolean {
  return isElement(n) && BLOCK_TAGS.has(n.localName);
}

function hasBlockDescendant(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAGS.has(child.localName) || hasBlockDescendant(child)) return true;
  }
  return false;
}

export function inlineText(node: Node, skip: ReadonlySet<string> = new Set()): string {
  return collapse(gather(node, skip));
}

function gather(node: Node, skip: ReadonlySet<string>): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? '';
  if (!isElement(node)) return '';
  const name = node.localName;
  if (name === 'br') return ' ';
  if (name === 'img' || skip.has(name) || REMOVE.includes(name)) return '';
  let s = '';
  for (const c of Array.from(node.childNodes)) s += gather(c, skip);
  return BLOCK_TAGS.has(name) ? ` ${s} ` : s;
}

function collapse(s: string): string {
  return s.replace(/[​-‍﻿­]/g, '').replace(/\s+/g, ' ').trim();
}

function idsWithin(nodes: Node[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    if (!isElement(n)) continue;
    if (n.id) ids.push(n.id);
    for (const d of Array.from(n.querySelectorAll('[id]'))) ids.push(d.id);
  }
  return ids;
}

class Walker {
  blocks: RawBlock[] = [];
  private pendingIds: string[] = [];
  private readonly href: string | undefined;

  constructor(href?: string) {
    this.href = href;
  }

  private emit(type: RawBlock['type'], text: string, nodes: Node[], level?: number): void {
    const ids = [...this.pendingIds, ...idsWithin(nodes)];
    if (!text) {
      // Keep ids for the next real block (e.g. an empty <a id> before a heading).
      this.pendingIds = ids;
      return;
    }
    this.pendingIds = [];
    const block: RawBlock = { type, text };
    if (level !== undefined) block.level = level;
    if (this.href !== undefined) block.anchor = { href: this.href, ids };
    this.blocks.push(block);
  }

  flushPending(): void {
    this.pendingIds = [];
  }

  /** Container with mixed content: runs of inline nodes become paragraphs. */
  container(el: Element): void {
    let inline: Node[] = [];
    const flush = () => {
      if (inline.length === 0) return;
      const text = collapse(inline.map((n) => gather(n, new Set())).join(''));
      this.emit('paragraph', text, inline);
      inline = [];
    };
    for (const child of Array.from(el.childNodes)) {
      if (isBlock(child)) {
        flush();
        this.element(child as Element);
      } else if (child.nodeType === 3 || child.nodeType === 4 || isElement(child)) {
        inline.push(child);
      }
    }
    flush();
  }

  element(el: Element): void {
    const name = el.localName;
    const h = HEADING.exec(name);
    if (h) {
      this.emit('heading', inlineText(el), [el], Number(h[1]));
      return;
    }
    switch (name) {
      case 'p':
        this.emit('paragraph', inlineText(el), [el]);
        return;
      case 'li': {
        this.emit('list-item', inlineText(el, new Set(['ul', 'ol'])), [el]);
        for (const nested of Array.from(el.querySelectorAll('ul, ol'))) {
          // only lists whose nearest li ancestor is this one
          if (nested.parentElement?.closest('li') === el) this.element(nested);
        }
        return;
      }
      case 'blockquote': {
        if (!hasBlockDescendant(el)) {
          this.emit('quote', inlineText(el), [el]);
          return;
        }
        const start = this.blocks.length;
        this.withId(el, () => this.container(el));
        for (let i = start; i < this.blocks.length; i++) {
          const b = this.blocks[i];
          if (b && b.type === 'paragraph') b.type = 'quote';
        }
        return;
      }
      case 'pre':
        this.emit('code', inlineText(el), [el]);
        return;
      case 'figcaption':
      case 'caption':
        this.emit('caption', inlineText(el), [el]);
        return;
      case 'tr': {
        const cells = Array.from(el.children)
          .filter((c) => c.localName === 'td' || c.localName === 'th')
          .map((c) => inlineText(c))
          .filter((t) => t.length > 0);
        this.emit('table-row', cells.join('; '), [el]);
        return;
      }
      case 'hr':
        return;
      case 'ul':
      case 'ol':
      case 'dl':
      case 'table':
      case 'thead':
      case 'tbody':
      case 'tfoot':
      case 'figure':
      case 'hgroup':
      case 'details':
        this.withId(el, () => this.container(el));
        return;
      default:
        // div, section, article, main, td, dd, dt, summary, header, footer, ...
        if (!hasBlockDescendant(el)) {
          this.emit('paragraph', inlineText(el), [el]);
        } else {
          this.withId(el, () => this.container(el));
        }
    }
  }

  private withId(el: Element, fn: () => void): void {
    if (el.id) this.pendingIds.push(el.id);
    fn();
  }
}
