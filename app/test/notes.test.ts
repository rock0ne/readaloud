import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openDB } from 'idb';
import { Repo } from '../src/core/store/repo';
import { DocIndex } from '../src/core/model';
import { createNote, isPlaced, notesFileName, notesMarkdown } from '../src/core/notes/notes';
import { applyImport, buildExport, planImport } from '../src/core/store/export';
import { keyRecord } from '../src/core/ai/keys';
import { makeDoc, sampleBlocks } from './helpers/docs';
import type { AiResult } from '../src/core/types';

let n = 0;
const open: Repo[] = [];
async function fresh(name = `notes-db-${++n}`) {
  const r = await Repo.open(name);
  open.push(r);
  return r;
}
afterEach(() => {
  for (const r of open.splice(0)) r.close();
});
const bytes = () => new TextEncoder().encode('x').buffer as ArrayBuffer;

describe('N1 notes', () => {
  it('makes a note on a sentence and writes notes.md with pages for citations', () => {
    const doc = makeDoc(sampleBlocks, { title: 'My Study Book' });
    const index = new DocIndex(doc);
    const note = createNote(index, doc.id, 'b1.s1', 'Remember this [b1.s0].', { sketch: 'data:image/png;base64,AAAA' })!;
    expect(note).toMatchObject({ sentenceId: 'b1.s1', blockId: 'b1', quote: 'Second sentence here.', source: 'me', paragraphInChapter: 2 });
    expect(createNote(index, doc.id, 'b99.s0', 'x')).toBeNull();
    const md = notesMarkdown(doc, [note], { pageOf: () => '4', now: new Date(2026, 9, 21, 9, 5) });
    expect(md).toContain('# Notes — My Study Book');
    expect(md).toContain('### Paragraph 2 · page 4');
    expect(md).toContain('> Second sentence here.');
    expect(md).toContain('Remember this (p. 4).');
    expect(md).toContain('![Drawing](data:image/png;base64,AAAA)');
    expect(notesFileName(doc)).toBe('notes-My-Study-Book.md');
  });

  it('stores notes and AI results, and deletes them with their document', async () => {
    const r = await fresh();
    const doc = await r.addDocument(makeDoc(sampleBlocks), bytes(), 'a.md', 'h-notes');
    const note = createNote(new DocIndex(doc), doc.id, 'b1.s0', 'n')!;
    await r.putNote(note);
    const ai: AiResult = { key: `${doc.id}|chapter-summary|c0`, docId: doc.id, kind: 'chapter-summary', scope: 'c0', text: 't', provider: 'anthropic', model: 'claude-opus-5-5', createdAt: 'x' };
    await r.putAiResult(ai);
    expect(await r.listNotes(doc.id)).toHaveLength(1);
    expect(await r.listAiResults(doc.id)).toEqual([ai]);
    await r.deleteDocument(doc.id);
    expect(await r.listNotes(doc.id)).toEqual([]);
    expect(await r.listAiResults(doc.id)).toEqual([]);
  });

  it('places notes again after a re-read and keeps one whose sentence is gone', async () => {
    const r = await fresh();
    const doc = await r.addDocument(makeDoc(sampleBlocks), bytes(), 'a.md', 'h-reparse');
    const index = new DocIndex(doc);
    const moves = createNote(index, doc.id, 'b3.s0', 'moves')!;
    const goes = createNote(index, doc.id, 'b1.s0', 'goes')!;
    await r.putNote(moves);
    await r.putNote(goes);
    const changed = makeDoc([{ type: 'paragraph', text: 'New opening.' }, { type: 'paragraph', text: 'Another new line.' }, ...sampleBlocks.filter((b) => b.type !== 'paragraph' || b.text !== 'First sentence here. Second sentence here.')]);
    await r.replaceParsed(doc.id, changed);
    const after = await r.listNotes(doc.id);
    const reread = new DocIndex((await r.getDocument(doc.id))!);
    const m = after.find((x) => x.id === moves.id)!;
    const g = after.find((x) => x.id === goes.id)!;
    expect(m.sentenceId).not.toBe('b3.s0');
    expect(isPlaced(m, reread)).toBe(true);
    expect(g.text).toBe('goes');
    expect(isPlaced(g, reread)).toBe(false);
  });

  it('carries notes in the JSON export and back, without keys', async () => {
    const pc = await fresh();
    const doc = await pc.addDocument(makeDoc(sampleBlocks), bytes(), 'a.md', 'h-export');
    const note = createNote(new DocIndex(doc), doc.id, 'b3.s0', 'from the PC')!;
    await pc.putNote(note);
    await pc.putKey(keyRecord('anthropic', 'secret-test-value', '2099-01-01T00:00:00.000Z', new Date()));
    const bundle = await buildExport(pc);
    expect(bundle.docs[0]?.notes).toEqual([note]);
    expect(JSON.stringify(bundle)).not.toContain('secret-test-value');

    const phone = await fresh();
    await phone.addDocument(makeDoc(sampleBlocks), bytes(), 'a.md', 'h-export');
    const plan = await planImport(bundle, phone);
    const summary = await applyImport(bundle, plan, [], phone);
    expect(summary.notesAdded).toBe(1);
    const local = (await phone.listSummaries())[0]!;
    const got = await phone.listNotes(local.id);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ text: 'from the PC', docId: local.id });
    expect((await applyImport(bundle, plan, [], phone)).notesAdded).toBe(0);
  });
});

describe('N2 AI keys in storage', () => {
  it('returns a saved key until it expires, then deletes it', async () => {
    const r = await fresh();
    const now = new Date('2026-10-21T10:00:00Z');
    await r.putKey(keyRecord('openai', 'k1', '2026-10-22T10:00:00.000Z', now));
    expect((await r.getKey('openai', now))?.key).toBe('k1');
    expect(await r.getKey('openai', new Date('2026-10-23T00:00:00Z'))).toBeUndefined();
    expect(await r.getKey('openai', now)).toBeUndefined();
    await r.putKey(keyRecord('gemini', 'k2', '2027-01-01T00:00:00.000Z', now));
    await r.deleteKey('gemini');
    expect(await r.getKey('gemini', now)).toBeUndefined();
  });

  it('upgrades a version 1 database and keeps what was in it', async () => {
    const name = `old-db-${++n}`;
    const old = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('docs', { keyPath: 'id' }).createIndex('bySourceHash', 'sourceHash', { unique: true });
        db.createObjectStore('summaries', { keyPath: 'id' });
        db.createObjectStore('sources', { keyPath: 'docId' });
        db.createObjectStore('positions', { keyPath: 'docId' });
        db.createObjectStore('flags', { keyPath: 'id' }).createIndex('byDoc', 'docId');
        db.createObjectStore('audio', { keyPath: 'key' }).createIndex('byLastUsed', 'lastUsed');
        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
    await old.put('positions', { docId: 'd1', sentenceId: 'b0.s0', updatedAt: 'x' });
    old.close();
    const r = await fresh(name);
    expect(await r.getPosition('d1')).toMatchObject({ sentenceId: 'b0.s0' });
    expect(await r.listNotes('d1')).toEqual([]);
  });
});

describe('N3 no keys in the repository', () => {
  // GitHub must never receive a key (ADR-30). These shapes match real Anthropic, OpenAI and Google keys.
  const KEY_SHAPES = [/sk-ant-[A-Za-z0-9_-]{20,}/, /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/, /AIza[0-9A-Za-z_-]{35}/];
  const root = join(__dirname, '..', '..');
  const skip = new Set(['node_modules', 'dist', 'dist-android', 'release', '.git', 'private', 'build', '.gradle', 'android']);

  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) files(p, out);
      else if (/\.(ts|tsx|js|mjs|json|md|txt|html|css|ya?ml|ps1|cmd|sh)$/.test(name) && st.size < 2_000_000) out.push(p);
    }
    return out;
  }

  it('finds no API key in the source, tests, docs or README', () => {
    const hits = files(root).filter((f) => KEY_SHAPES.some((re) => re.test(readFileSync(f, 'utf8'))));
    expect(hits).toEqual([]);
  });
});
