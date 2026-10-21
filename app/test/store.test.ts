import { afterEach, describe, expect, it } from 'vitest';
import { DuplicateDocumentError, Repo } from '../src/core/store/repo';
import { sha256Hex } from '../src/core/util/hash';
import type { Settings } from '../src/core/types';
import type { RawBlock } from '../src/core/ingest/raw';
import { createFlag } from '../src/core/flags/corrections';
import { DocIndex } from '../src/core/model';
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
    expect(s.enginePreference).toEqual(['kokoro', 'webspeech']);
    expect(s.schemaVersion).toBe(4);
    expect(s.ai).toEqual({ provider: null, models: {} });
    expect(s.pauseOnFlag).toBe(false);
    desk.close();
    const phone = await fresh(true);
    expect((await phone.getSettings()).pauseOnFlag).toBe(true);
    await phone.saveSettings({ ...(await phone.getSettings()), rate: 1.5 });
    expect((await phone.getSettings()).rate).toBe(1.5);
  });

  it('moves version 1 settings to Kokoro first and drops Azure (ADR-22)', async () => {
    const r = await fresh();
    const v1 = {
      ...(await r.getSettings()),
      schemaVersion: 1,
      enginePreference: ['webspeech', 'azure', 'kokoro'],
      voiceByEngine: { webspeech: 'Microsoft Sonia Online (Natural)' },
      azure: { region: 'uksouth', key: 'k' },
      rate: 1.7,
    } as unknown as Settings;
    await r.saveSettings(v1);
    const s = await r.getSettings();
    expect(s.schemaVersion).toBe(4);
    expect(s.ai).toEqual({ provider: null, models: {} });
    expect(s.enginePreference).toEqual(['kokoro', 'webspeech']);
    expect(s.voiceByEngine).toEqual({ webspeech: 'Microsoft Sonia Online (Natural)' });
    expect(s.azure).toBeNull();
    expect(s.rate).toBe(1.7);
  });

  it('gives settings from 0.2.0 the book font, line spacing and one long scroll, keeping the rest (ADR-33, ADR-35)', async () => {
    const r = await fresh();
    const { readerFont: _f, lineSpacing: _l, layout: _y, twoPages: _t, stopAtPageEnd: _p, ...v3 } = await r.getSettings();
    await r.saveSettings({ ...v3, schemaVersion: 3, fontSizePx: 22, rate: 1.4 } as unknown as Settings);
    expect(await r.getSettings()).toMatchObject({
      schemaVersion: 4,
      readerFont: 'serif',
      lineSpacing: 1.7,
      layout: 'scroll',
      twoPages: true,
      stopAtPageEnd: true,
      fontSizePx: 22,
      rate: 1.4,
    });
  });

  it('drops the old fixed full-stop pause and adds a paragraph pause (ADR-31)', async () => {
    const r = await fresh();
    const base = await r.getSettings();
    expect(base.pauseBetweenSentencesMs).toBe(0);
    expect(base.pauseBetweenParagraphsMs).toBe(700);
    const { pauseBetweenParagraphsMs: _gone, ...old } = base;
    await r.saveSettings({ ...old, schemaVersion: 2, pauseBetweenSentencesMs: 150 } as unknown as Settings);
    expect(await r.getSettings()).toMatchObject({ pauseBetweenSentencesMs: 0, pauseBetweenParagraphsMs: 700 });
    await r.saveSettings({ ...old, schemaVersion: 2, pauseBetweenSentencesMs: 300 } as unknown as Settings);
    expect((await r.getSettings()).pauseBetweenSentencesMs).toBe(300);
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

  it('places a flag on a repeated quote by its neighbours, and leaves an old flag unplaced (ADR-23)', async () => {
    const r = await fresh();
    const dialogue: RawBlock[] = [
      { type: 'heading', level: 1, text: 'Chapter One' },
      { type: 'paragraph', text: 'Are you coming?' },
      { type: 'paragraph', text: 'Yes.' },
      { type: 'paragraph', text: 'Then hurry up.' },
      { type: 'paragraph', text: 'Yes.' },
      { type: 'paragraph', text: 'Good.' },
    ];
    const doc = await r.addDocument(makeDoc(dialogue), bytes(), 'a.md', 'h');
    const created = createFlag(new DocIndex(doc), doc.id, 'b4.s0')!;
    expect(created.context).toEqual({ before: 'Then hurry up.', after: 'Good.' });
    await r.putFlag(makeFlag(doc, 'b4.s0', { id: 'second', paragraphInChapter: 4, context: created.context! }));
    // A flag saved before flags kept their neighbours: no context, so only its exact old place counts.
    await r.putFlag(makeFlag(doc, 'b4.s0', { id: 'legacy', paragraphInChapter: 4 }));
    const revised = makeDoc([dialogue[0]!, { type: 'paragraph', text: 'A new opening paragraph.' }, ...dialogue.slice(1)]);
    const lost = await r.replaceParsed(doc.id, revised);
    expect((await r.getFlag('second'))?.sentenceId).toBe('b5.s0');
    expect(lost.map((f) => f.id)).toEqual(['legacy']);
  });

  it('re-read completes in one transaction when the saved position disappears', async () => {
    const r = await fresh();
    const doc = await r.addDocument(makeDoc(sampleBlocks), bytes(), 'a.md', 'h');
    await r.savePosition({ docId: doc.id, sentenceId: 'b3.s0', updatedAt: 'x', ordinal: 3 });
    const revised = makeDoc([{ type: 'heading', level: 1, text: 'Chapter One' }, { type: 'paragraph', text: 'Only this now.' }]);
    await expect(r.replaceParsed(doc.id, revised)).resolves.toEqual([]);
    expect((await r.getDocument(doc.id))?.blocks).toHaveLength(2);
    expect(await r.getPosition(doc.id)).toBeUndefined();
  });

  it('hashes bytes as sha-256 hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
