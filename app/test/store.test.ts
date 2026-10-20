import { afterEach, describe, expect, it } from 'vitest';
import { DuplicateDocumentError, Repo } from '../src/core/store/repo';
import { sha256Hex } from '../src/core/util/hash';
import { makeDoc, makeFlag, sampleBlocks } from './helpers/docs';

let n = 0;
let repo: Repo | null = null;
async function fresh(touch = false) {
  repo = await Repo.open(`test-db-${++n}`, touch);
  return repo;
}
afterEach(() => repo?.close());

const bytes = () => new TextEncoder().encode('source bytes').buffer as ArrayBuffer;

describe('U9 store', () => {
  it('adds, gets, lists and deletes a document with cascade', async () => {
    const r = await fresh();
    const parsed = makeDoc(sampleBlocks);
    const doc = await r.addDocument(parsed, bytes(), 'a.md', 'h1');
    expect((await r.getDocument(doc.id))?.title).toBe('Doc');
    const list = await r.listSummaries();
    expect(list).toHaveLength(1);
    expect(list[0]?.sentenceCount).toBe(5);
    expect(new TextDecoder().decode(await r.getSource(doc.id))).toBe('source bytes');

    await r.savePosition({ docId: doc.id, sentenceId: 'b1.s1', updatedAt: 'x', ordinal: 2 });
    const flag = makeFlag(doc, 'b1.s0');
    await r.putFlag(flag);
    expect(await r.listFlags(doc.id)).toHaveLength(1);

    await r.deleteDocument(doc.id);
    expect(await r.getDocument(doc.id)).toBeUndefined();
    expect(await r.listSummaries()).toHaveLength(0);
    expect(await r.getPosition(doc.id)).toBeUndefined();
    expect(await r.listFlags(doc.id)).toHaveLength(0);
    expect(await r.getSource(doc.id)).toBeUndefined();
  });

  it('rejects a duplicate source hash', async () => {
    const r = await fresh();
    const first = await r.addDocument(makeDoc(sampleBlocks), bytes(), 'a.md', 'same');
    const err = await r.addDocument(makeDoc(sampleBlocks), bytes(), 'b.md', 'same').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DuplicateDocumentError);
    expect((err as DuplicateDocumentError).existingId).toBe(first.id);
  });

  it('adds nothing when the source bytes cannot be stored', async () => {
    const r = await fresh();
    const detached = bytes();
    structuredClone(detached, { transfer: [detached] });
    const err = await r.addDocument(makeDoc(sampleBlocks), detached, 'a.pdf', 'h-detached').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await r.listSummaries()).toEqual([]);
    expect(await r.findByHash('h-detached')).toBeUndefined();
  });

  it('returns default settings and pauseOnFlag follows the device type', async () => {
    const desk = await fresh(false);
    const s = await desk.getSettings();
    expect(s.enginePreference).toEqual(['webspeech', 'azure', 'kokoro']);
    expect(s.pauseOnFlag).toBe(false);
    desk.close();
    const phone = await fresh(true);
    expect((await phone.getSettings()).pauseOnFlag).toBe(true);
    await phone.saveSettings({ ...(await phone.getSettings()), rate: 1.5 });
    expect((await phone.getSettings()).rate).toBe(1.5);
  });

  it('re-parse re-anchors flags by quote and reports flags it cannot place', async () => {
    const r = await fresh();
    const doc = await r.addDocument(makeDoc(sampleBlocks), bytes(), 'a.md', 'h');
    await r.putFlag(makeFlag(doc, 'b1.s1', { id: 'keep' }));
    await r.putFlag(makeFlag(doc, 'b3.s0', { id: 'lose' }));
    const revised = makeDoc([
      { type: 'heading', level: 1, text: 'Chapter One' },
      { type: 'paragraph', text: 'A new opening paragraph.' },
      { type: 'paragraph', text: 'First sentence here. Second sentence here.' },
    ]);
    const lost = await r.replaceParsed(doc.id, revised);
    expect(lost.map((f) => f.id)).toEqual(['lose']);
    const kept = await r.getFlag('keep');
    expect(kept?.sentenceId).toBe('b2.s1');
    expect(kept?.blockId).toBe('b2');
  });

  it('hashes bytes as sha-256 hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
