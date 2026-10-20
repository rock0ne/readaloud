// Markdown loader (spec 5.3).
import { marked } from 'marked';
import { htmlToDocument } from './html';
import type { Loader } from './raw';
import { decodeText, stripExtension } from './txt';

export function stripFrontMatter(text: string): string {
  return text.replace(/^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/, '');
}

export const loadMd: Loader = async (bytes, opts) => {
  const source = stripFrontMatter(decodeText(bytes));
  const html = marked.parse(source, { gfm: true, async: false });
  const blocks = htmlToDocument(html);
  const h1 = blocks.find((b) => b.type === 'heading' && b.level === 1);
  return { title: h1?.text ?? stripExtension(opts.name), blocks, warnings: [] };
};
