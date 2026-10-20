import { afterEach, describe, expect, it } from 'vitest';
import { applyImport, buildExport, parseBundle, planImport } from '../src/core/store/export';
import { Repo } from '../src/core/store/repo';
import { makeDoc, makeFlag } from './helpers/docs';
import type { RawBlock } from '../src/core/ingest/raw';

const blocks: RawBlock[] = [
  { type: 'heading', level: 1, text: 'Chapter One' },
  { type: 'paragraph', text: 'Alpha sentence. Beta sentence.' },
  { type: 'paragraph', text: 'Gamma sentence.' },
];
const bytes = () => new TextEncoder().encode('x').buffer as ArrayBuffer;

let n = 0;
const repos: Repo[] = [];
async function open() {
  const r = await Repo.open(`export-db-${++n}`);
  repos.push(r);
  return r;
}
afterEach(() => repos.splice(0).forEach((r) => r.close()));

describe('U13 export and import (ADR-16)', () => {
  it('exports flags and positions but never settings or the Azure key', async () => {
    const pc = await open();
    await pc.saveSettings({ ...(await pc.getSettings()), azure: { region: 'uksouth', key: 'SECRET' } });
    const doc = await pc.addDocument(makeDoc(blocks), bytes(), 'book.md', 'H');
    await pc.putFlag(makeFlag(doc, 'b1.s0'));
    const bundle = await buildExport(pc);
    expect(JSON.stringify(bundle)).not.toContain('SECRET');
    expect(bundle.docs[0]?.flags).toHaveLength(1);
    expect(parseBundle(JSON.stringify(bundle)).version).toBe(1);
    expect(() => parseBundle('{"hello":1}')).toThrow();
  });

  it('matches by hash, remaps doc ids, merges by updatedAt, re-anchors and reports unplaceable flags', async () => {
    const phone = await open();
    const pc = await open();
    const onPhone = await phone.addDocument(makeDoc(blocks), bytes(), 'book.md', 'SAME');
    const onPc = await pc.addDocument(makeDoc(blocks), bytes(), 'book.md', 'SAME');
    expect(onPhone.id).not.toBe(onPc.id);

    // Same flag on both devices; the phone copy was edited later.
    const base = makeFlag(onPc, 'b1.s1', { id: 'shared', note: 'old note', updatedAt: '2026-10-20T10:00:00.000Z' });
    await pc.putFlag(base);
    await phone.putFlag({ ...base, docId: onPhone.id, note: 'edited on phone', updatedAt: '2026-10-20T11:00:00.000Z' });
    // An older copy of another PC flag must not overwrite the PC version.
    await pc.putFlag(makeFlag(onPc, 'b2.s0', { id: 'pc-newer', note: 'pc', updatedAt: '2026-10-20T12:00:00.000Z' }));
    await phone.putFlag(makeFlag(onPhone, 'b2.s0', { id: 'pc-newer', note: 'stale', updatedAt: '2026-10-20T09:00:00.000Z' }));
    // A flag whose sentence id is wrong but whose quote exists is re-anchored.
    await phone.putFlag(makeFlag(onPhone, 'b1.s0', { id: 'moved', sentenceId: 'b9.s9', quote: 'Gamma sentence.' }));
    // A flag whose quote no longer exists cannot be placed.
    await phone.putFlag(makeFlag(onPhone, 'b1.s0', { id: 'gone', quote: 'Deleted sentence.', note: 'keep me' }));
    await phone.savePosition({ docId: onPhone.id, sentenceId: 'b2.s0', updatedAt: '2026-10-20T13:00:00.000Z', ordinal: 3 });

    const bundle = await buildExport(phone);
    const plan = await planImport(bundle, pc);
    expect(plan.exact).toEqual([expect.objectContaining({ localId: onPc.id, by: 'hash' })]);

    const summary = await applyImport(bundle, plan, [], pc);
    expect(summary).toMatchObject({ added: 1, updated: 1, unchanged: 1, positionsUpdated: 1 });
    expect(summary.couldNotPlace).toEqual([expect.objectContaining({ quote: 'Deleted sentence.', note: 'keep me' })]);

    expect((await pc.getFlag('shared'))?.note).toBe('edited on phone');
    expect((await pc.getFlag('shared'))?.docId).toBe(onPc.id);
    expect((await pc.getFlag('pc-newer'))?.note).toBe('pc');
    expect((await pc.getFlag('moved'))).toMatchObject({ sentenceId: 'b2.s0', blockId: 'b2', docId: onPc.id });
    expect(await pc.getPosition(onPc.id)).toMatchObject({ sentenceId: 'b2.s0', ordinal: 3 });
  });

  it('treats title + charCount as a possible match that needs confirmation', async () => {
    const phone = await open();
    const pc = await open();
    const a = await phone.addDocument(makeDoc(blocks), bytes(), 'book.md', 'REV1');
    const b = await pc.addDocument(makeDoc(blocks), bytes(), 'book.md', 'REV2');
    await phone.putFlag(makeFlag(a, 'b1.s0', { id: 'f1' }));
    const bundle = await buildExport(phone);
    const plan = await planImport(bundle, pc);
    expect(plan.exact).toHaveLength(0);
    expect(plan.possible).toEqual([expect.objectContaining({ localId: b.id })]);

    const skipped = await applyImport(bundle, plan, [], pc);
    expect(skipped.added).toBe(0);
    expect(skipped.possibleSkipped).toEqual(['Doc']);

    const confirmed = await applyImport(bundle, plan, [a.id], pc);
    expect(confirmed.added).toBe(1);
    expect((await pc.getFlag('f1'))?.docId).toBe(b.id);
  });

  it('reports documents that are not in the library', async () => {
    const phone = await open();
    const pc = await open();
    await phone.addDocument(makeDoc([{ type: 'paragraph', text: 'Unique text only here.' }], { title: 'Other' }), bytes(), 'o.md', 'X');
    const plan = await planImport(await buildExport(phone), pc);
    expect(plan.unmatched.map((u) => u.title)).toEqual(['Other']);
  });
});
