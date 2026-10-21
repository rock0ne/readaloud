// JSON export and two-phase import (spec 9.2, ADR-16).
import type { DocRecord, DocSummary, ExportBundleV1, Flag, Note, PositionRecord } from '../types';
import { DocIndex } from '../model';
import { anchorFlag } from './repo';

export interface LibraryReader {
  listSummaries(): Promise<DocSummary[]>;
  getDocument(id: string): Promise<DocRecord | undefined>;
  findByHash(hash: string): Promise<DocRecord | undefined>;
  listFlags(docId: string): Promise<Flag[]>;
  listNotes(docId: string): Promise<Note[]>;
  getPosition(docId: string): Promise<PositionRecord | undefined>;
}

export interface LibraryWriter extends LibraryReader {
  getFlag(id: string): Promise<Flag | undefined>;
  putFlag(flag: Flag): Promise<void>;
  getNote(id: string): Promise<Note | undefined>;
  putNote(note: Note): Promise<void>;
  savePosition(pos: PositionRecord): Promise<void>;
}

export async function buildExport(lib: LibraryReader, now = new Date()): Promise<ExportBundleV1> {
  const docs: ExportBundleV1['docs'] = [];
  for (const s of await lib.listSummaries()) {
    const doc = await lib.getDocument(s.id);
    if (!doc) continue;
    const position = await lib.getPosition(s.id);
    const notes = await lib.listNotes(s.id);
    docs.push({
      id: doc.id,
      title: doc.title,
      format: doc.format,
      sourceName: doc.sourceName,
      sourceHash: doc.sourceHash,
      charCount: doc.charCount,
      ...(position ? { position } : {}),
      flags: await lib.listFlags(s.id),
      // Older versions of the app ignore this list (ADR-30).
      ...(notes.length ? { notes } : {}),
    });
  }
  // Settings are per device (voices differ) and keys must never leave it, so none are exported.
  // AI results are not exported either: they can be asked for again.
  return { version: 1, exportedAt: now.toISOString(), docs };
}

export function exportFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `readaloud-export-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.json`;
}

export function parseBundle(text: string): ExportBundleV1 {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const b = data as Partial<ExportBundleV1>;
  if (!b || b.version !== 1 || !Array.isArray(b.docs)) throw new Error('This is not a ReadAloud export file.');
  return b as ExportBundleV1;
}

export interface ImportPlan {
  exact: Array<{ bundleDocId: string; localId: string; by: 'id' | 'hash'; title: string }>;
  possible: Array<{ bundleDocId: string; localId: string; title: string }>;
  unmatched: Array<{ bundleDocId: string; title: string; sourceName: string }>;
}

export async function planImport(bundle: ExportBundleV1, lib: LibraryReader): Promise<ImportPlan> {
  const plan: ImportPlan = { exact: [], possible: [], unmatched: [] };
  const summaries = await lib.listSummaries();
  for (const d of bundle.docs) {
    if (await lib.getDocument(d.id)) {
      plan.exact.push({ bundleDocId: d.id, localId: d.id, by: 'id', title: d.title });
      continue;
    }
    const byHash = await lib.findByHash(d.sourceHash);
    if (byHash) {
      plan.exact.push({ bundleDocId: d.id, localId: byHash.id, by: 'hash', title: d.title });
      continue;
    }
    const maybe = summaries.find((s) => s.title === d.title && s.charCount === d.charCount);
    if (maybe) plan.possible.push({ bundleDocId: d.id, localId: maybe.id, title: d.title });
    else plan.unmatched.push({ bundleDocId: d.id, title: d.title, sourceName: d.sourceName });
  }
  return plan;
}

export interface ImportSummary {
  added: number;
  updated: number;
  unchanged: number;
  positionsUpdated: number;
  notesAdded: number;
  notesUpdated: number;
  /** Notes imported although their sentence is not in this copy of the text (ADR-30). */
  notesUnplaced: number;
  couldNotPlace: Array<{ docTitle: string; quote: string; note: string; fixedText: string }>;
  possibleSkipped: string[];
  unmatched: string[];
}

export async function applyImport(
  bundle: ExportBundleV1,
  plan: ImportPlan,
  confirmedPossible: string[],
  lib: LibraryWriter,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    added: 0,
    updated: 0,
    unchanged: 0,
    positionsUpdated: 0,
    notesAdded: 0,
    notesUpdated: 0,
    notesUnplaced: 0,
    couldNotPlace: [],
    possibleSkipped: plan.possible.filter((p) => !confirmedPossible.includes(p.bundleDocId)).map((p) => p.title),
    unmatched: plan.unmatched.map((u) => u.title),
  };
  const matches = [
    ...plan.exact,
    ...plan.possible.filter((p) => confirmedPossible.includes(p.bundleDocId)),
  ];
  for (const m of matches) {
    const incoming = bundle.docs.find((d) => d.id === m.bundleDocId);
    const local = await lib.getDocument(m.localId);
    if (!incoming || !local) continue;
    const index = new DocIndex(local);

    for (const flag of incoming.flags) {
      const placed = anchorFlag(flag, index, local.id);
      if (!placed) {
        summary.couldNotPlace.push({ docTitle: local.title, quote: flag.quote, note: flag.note, fixedText: flag.fixedText });
        continue;
      }
      const existing = await lib.getFlag(placed.id);
      if (!existing) {
        await lib.putFlag(placed);
        summary.added++;
      } else if (placed.updatedAt > existing.updatedAt) {
        await lib.putFlag(placed);
        summary.updated++;
      } else {
        summary.unchanged++;
      }
    }

    for (const note of incoming.notes ?? []) {
      // A note is never left behind: one that cannot be placed comes in as it is, marked in the panel.
      const placed = anchorFlag(note, index, local.id);
      if (!placed) summary.notesUnplaced++;
      const next: Note = placed ?? { ...note, docId: local.id };
      const existing = await lib.getNote(next.id);
      if (!existing) {
        await lib.putNote(next);
        summary.notesAdded++;
      } else if (next.updatedAt > existing.updatedAt) {
        await lib.putNote(next);
        summary.notesUpdated++;
      }
    }

    const pos = incoming.position;
    const at = pos ? index.get(pos.sentenceId) : undefined;
    if (pos && at) {
      const current = await lib.getPosition(local.id);
      if (!current || pos.updatedAt > current.updatedAt) {
        await lib.savePosition({ docId: local.id, sentenceId: pos.sentenceId, updatedAt: pos.updatedAt, ordinal: at.ordinal });
        summary.positionsUpdated++;
      }
    }
  }
  return summary;
}
