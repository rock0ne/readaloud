// Typed access to storage (spec 9.1). The only consumer of db.ts.
import type { AudioCacheRecord, DocRecord, DocSummary, Flag, ParsedDocument, PositionRecord, Settings } from '../types';
import { DocIndex, sentenceCount } from '../model';
import { newId, nowIso } from '../util/ids';
import { openReadAloudDb, type ReadAloudDb } from './db';
import { withDefaults } from './settings';

export class DuplicateDocumentError extends Error {
  readonly existingId: string;
  constructor(existingId: string) {
    super('Already in library');
    this.name = 'DuplicateDocumentError';
    this.existingId = existingId;
  }
}

export const AUDIO_BUDGET_BYTES = 300 * 1024 * 1024;
export const AUDIO_TARGET_BYTES = 250 * 1024 * 1024;

export function summaryOf(doc: DocRecord): DocSummary {
  return {
    id: doc.id,
    title: doc.title,
    format: doc.format,
    sourceName: doc.sourceName,
    addedAt: doc.addedAt,
    ...(doc.lastOpenedAt ? { lastOpenedAt: doc.lastOpenedAt } : {}),
    charCount: doc.charCount,
    sentenceCount: sentenceCount(doc),
  };
}

/** Places a flag on a document: same sentence if its text still matches, else the first sentence with the quoted text. */
export function anchorFlag(flag: Flag, index: DocIndex, docId: string): Flag | null {
  const same = index.get(flag.sentenceId);
  const hit = same && same.sentence.text === flag.quote ? same : index.findByQuote(flag.quote);
  if (!hit) return null;
  const chapter = index.chapter(hit.block.chapterIndex);
  return {
    ...flag,
    docId,
    sentenceId: hit.sentence.id,
    blockId: hit.block.id,
    chapterIndex: hit.block.chapterIndex,
    chapterTitle: chapter?.title ?? flag.chapterTitle,
    paragraphInChapter: index.paragraphInChapter(hit.block),
  };
}

export class Repo {
  private readonly db: ReadAloudDb;
  private readonly touch: boolean;

  private constructor(db: ReadAloudDb, touch: boolean) {
    this.db = db;
    this.touch = touch;
  }

  static async open(name?: string, touch = false): Promise<Repo> {
    return new Repo(await openReadAloudDb(name), touch);
  }

  close(): void {
    this.db.close();
  }

  // ----- documents -----

  async findByHash(hash: string): Promise<DocRecord | undefined> {
    return this.db.getFromIndex('docs', 'bySourceHash', hash);
  }

  async addDocument(parsed: ParsedDocument, bytes: ArrayBuffer, sourceName: string, sourceHash: string): Promise<DocRecord> {
    const existing = await this.findByHash(sourceHash);
    if (existing) throw new DuplicateDocumentError(existing.id);
    const doc: DocRecord = { ...parsed, id: newId(), sourceName, sourceHash, addedAt: nowIso() };
    const tx = this.db.transaction(['docs', 'summaries', 'sources'], 'readwrite');
    // put() can throw synchronously (e.g. a detached buffer). Without an explicit abort the
    // requests already queued would commit and leave a document with no source.
    const ops: Array<Promise<unknown>> = [];
    const track = (op: Promise<unknown>) => {
      op.catch(() => undefined);
      ops.push(op);
    };
    try {
      track(tx.objectStore('docs').add(doc));
      track(tx.objectStore('summaries').put(summaryOf(doc)));
      track(tx.objectStore('sources').put({ docId: doc.id, bytes }));
      await Promise.all([...ops, tx.done]);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        // already finished
      }
      await tx.done.catch(() => undefined);
      throw e;
    }
    return doc;
  }

  /** Replaces the parsed content (re-parse) and re-anchors flags; returns flags that could not be placed. */
  async replaceParsed(id: string, parsed: ParsedDocument): Promise<Flag[]> {
    const old = await this.getDocument(id);
    if (!old) throw new Error('Document not found');
    const doc: DocRecord = { ...old, ...parsed, id, sourceName: old.sourceName, sourceHash: old.sourceHash, addedAt: old.addedAt };
    const index = new DocIndex(doc);
    const flags = await this.listFlags(id);
    const lost: Flag[] = [];
    const tx = this.db.transaction(['docs', 'summaries', 'flags', 'positions'], 'readwrite');
    const ops: Array<Promise<unknown>> = [tx.objectStore('docs').put(doc), tx.objectStore('summaries').put(summaryOf(doc))];
    for (const f of flags) {
      const placed = anchorFlag(f, index, id);
      if (placed) ops.push(tx.objectStore('flags').put(placed));
      else lost.push(f);
    }
    const pos = await this.getPosition(id);
    if (pos && !index.get(pos.sentenceId)) ops.push(tx.objectStore('positions').delete(id));
    await Promise.all([...ops, tx.done]);
    return lost;
  }

  getDocument(id: string): Promise<DocRecord | undefined> {
    return this.db.get('docs', id);
  }

  async listSummaries(): Promise<DocSummary[]> {
    const all = await this.db.getAll('summaries');
    return all.sort((a, b) => (b.lastOpenedAt ?? b.addedAt).localeCompare(a.lastOpenedAt ?? a.addedAt));
  }

  async touchOpened(id: string): Promise<void> {
    const doc = await this.getDocument(id);
    if (!doc) return;
    doc.lastOpenedAt = nowIso();
    const tx = this.db.transaction(['docs', 'summaries'], 'readwrite');
    await Promise.all([tx.objectStore('docs').put(doc), tx.objectStore('summaries').put(summaryOf(doc)), tx.done]);
  }

  async getSource(docId: string): Promise<ArrayBuffer | undefined> {
    return (await this.db.get('sources', docId))?.bytes;
  }

  async deleteDocument(id: string): Promise<void> {
    const flagKeys = await this.db.getAllKeysFromIndex('flags', 'byDoc', id);
    const tx = this.db.transaction(['docs', 'summaries', 'sources', 'positions', 'flags'], 'readwrite');
    await Promise.all([
      tx.objectStore('docs').delete(id),
      tx.objectStore('summaries').delete(id),
      tx.objectStore('sources').delete(id),
      tx.objectStore('positions').delete(id),
      ...flagKeys.map((k) => tx.objectStore('flags').delete(k)),
      tx.done,
    ]);
  }

  // ----- positions -----

  getPosition(docId: string): Promise<PositionRecord | undefined> {
    return this.db.get('positions', docId);
  }

  async listPositions(): Promise<PositionRecord[]> {
    return this.db.getAll('positions');
  }

  async savePosition(pos: PositionRecord): Promise<void> {
    await this.db.put('positions', pos);
  }

  // ----- flags -----

  async listFlags(docId: string): Promise<Flag[]> {
    return this.db.getAllFromIndex('flags', 'byDoc', docId);
  }

  getFlag(id: string): Promise<Flag | undefined> {
    return this.db.get('flags', id);
  }

  async putFlag(flag: Flag): Promise<void> {
    await this.db.put('flags', flag);
  }

  async deleteFlag(id: string): Promise<void> {
    await this.db.delete('flags', id);
  }

  // ----- settings -----

  async getSettings(): Promise<Settings> {
    return withDefaults((await this.db.get('settings', 'settings'))?.value, this.touch);
  }

  async saveSettings(s: Settings): Promise<void> {
    await this.db.put('settings', { key: 'settings', value: s });
  }

  // ----- audio cache (Phase 2) -----

  async getAudio(key: string): Promise<Blob | undefined> {
    const rec = await this.db.get('audio', key);
    if (!rec) return undefined;
    rec.lastUsed = Date.now();
    await this.db.put('audio', rec);
    return rec.blob;
  }

  async putAudio(key: string, blob: Blob): Promise<void> {
    const rec: AudioCacheRecord = { key, blob, bytes: blob.size, lastUsed: Date.now() };
    await this.db.put('audio', rec);
  }

  async audioBytes(): Promise<number> {
    let total = 0;
    let cursor = await this.db.transaction('audio').store.openCursor();
    while (cursor) {
      total += cursor.value.bytes;
      cursor = await cursor.continue();
    }
    return total;
  }

  /** Deletes least-recently-used audio until under `target` once over `budget`. */
  async pruneAudio(budget = AUDIO_BUDGET_BYTES, target = AUDIO_TARGET_BYTES): Promise<number> {
    let total = await this.audioBytes();
    if (total <= budget) return 0;
    let removed = 0;
    const tx = this.db.transaction('audio', 'readwrite');
    let cursor = await tx.store.index('byLastUsed').openCursor();
    while (cursor && total > target) {
      total -= cursor.value.bytes;
      await cursor.delete();
      removed++;
      cursor = await cursor.continue();
    }
    await tx.done;
    return removed;
  }

  async clearAudio(): Promise<void> {
    await this.db.clear('audio');
  }
}
