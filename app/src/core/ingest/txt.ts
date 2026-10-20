// Plain text loader (spec 5.2).
import type { Loader, RawBlock } from './raw';

export function decodeText(bytes: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function stripExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function looksLikeHeading(line: string): boolean {
  return line.length <= 80 && /^[\p{Lu}\p{N}]/u.test(line) && !/[.!?,;:"'”’)]$/.test(line);
}

export function textToBlocks(text: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  for (const para of text.split(/\n[ \t]*\n/)) {
    const lines = para.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const joined = lines.join(' ').replace(/\s+/g, ' ');
    if (lines.length === 1 && looksLikeHeading(joined)) {
      blocks.push({ type: 'heading', level: 2, text: joined });
    } else {
      blocks.push({ type: 'paragraph', text: joined });
    }
  }
  return blocks;
}

export const loadTxt: Loader = async (bytes, opts) => {
  return { title: stripExtension(opts.name), blocks: textToBlocks(decodeText(bytes)), warnings: [] };
};
