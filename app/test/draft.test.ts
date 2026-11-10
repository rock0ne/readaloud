import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { Repo } from '../src/core/store/repo';
import { draftMarkdown, draftText, reviseDraft } from '../src/core/text/draft';
import { audioKey, inspectNarration } from '../src/core/audio/narration';
import { sha256Hex } from '../src/core/util/hash';
import { DocIndex } from '../src/core/model';
import { createNote } from '../src/core/notes/notes';
import { Player } from '../src/core/player/player';
import { EngineRegistry } from '../src/core/engines/registry';
import { defaultSettings } from '../src/core/store/settings';
import type { VoiceEngine } from '../src/core/types';
import { makeDoc, makeFlag, sampleBlocks } from './helpers/docs';

// Node structuredClone (fake IndexedDB) cannot clone jsdom Blob, unlike real browsers.
vi.stubGlobal('Blob', NodeBlob);

const repos: Repo[] = [];
async function fixture() {
  const repo = await Repo.open(`draft-${crypto.randomUUID()}`); repos.push(repo);
  const bytes = new TextEncoder().encode('Original manuscript bytes').buffer;
  const original = await repo.addDocument(makeDoc(sampleBlocks), bytes, 'original.epub', await sha256Hex(bytes));
  return { repo, original, bytes };
}
afterEach(() => { repos.splice(0).forEach((r) => r.close()); vi.restoreAllMocks(); });

describe('direct document editing', () => {
  it('edits the existing entry, preserving original recovery bytes, position and annotation identities', async () => {
    const { repo, original, bytes } = await fixture();
    const flag = makeFlag(original, 'b1.s0'); await repo.putFlag(flag);
    const note = createNote(new DocIndex(original), original.id, 'b1.s0', 'Keep this note')!; await repo.putNote(note);
    await repo.savePosition({ docId: original.id, sentenceId: 'b1.s0', ordinal: 1, updatedAt: 'now' });
    const [draft, again] = await Promise.all([repo.enableEditing(original.id), repo.enableEditing(original.id)]);
    expect(again.id).toBe(draft.id); expect(draft.id).toBe(original.id);
    expect((await repo.enableEditing(draft.id)).id).toBe(draft.id);
    expect(await repo.getOriginalDocument(original.id)).toEqual(original);
    expect((await repo.listSummaries()).length).toBe(1);
    expect((await repo.listFlags(draft.id))[0]).toMatchObject({ docId: draft.id, quote: flag.quote });
    expect((await repo.listFlags(draft.id))[0]?.id).toBe(flag.id);
    expect((await repo.listNotes(draft.id))[0]?.id).toBe(note.id);
    expect((await repo.getPosition(draft.id))?.sentenceId).toBe('b1.s0');
    expect(await sha256Hex((await repo.getSource(draft.id))!)).toBe(draft.sourceHash);
    await repo.restoreOriginalDocument(draft.id, 0);
    expect(await repo.getSource(original.id)).toEqual(bytes);
    expect(await repo.getDocument(original.id)).toEqual(original);
  });
  it('saves and re-segments one paragraph without moving other block IDs or changing the original', async () => {
    const { repo, original, bytes } = await fixture();
    const draft = await repo.enableEditing(original.id);
    const saved = await repo.saveDraft(draft.id, 0, 'b1', 'A revised first sentence. A different second. A third.');
    expect(saved.blocks[1]?.sentences.map((s) => s.text)).toEqual(['A revised first sentence.', 'A different second.', 'A third.']);
    expect(saved.blocks[3]).toEqual(original.blocks[3]);
    expect(saved.draft?.revision).toBe(1); expect(saved.draft?.edits).toHaveLength(1);
    expect(saved.charCount).toBe(saved.blocks.reduce((n, b) => n + b.text.length, 0));
    expect((await repo.getPosition(draft.id))?.sentenceId).toBe('b1.s0');
    expect(await sha256Hex((await repo.getSource(draft.id))!)).toBe(saved.sourceHash);
    expect(await repo.getOriginalDocument(original.id)).toEqual(original);
    expect(await sha256Hex(bytes)).toBe(original.sourceHash);
    repo.close(); const reopened = await Repo.open((repo as unknown as { db: { name: string } }).db.name); repos.push(reopened);
    expect((await reopened.getDocument(draft.id))?.blocks[1]?.text).toBe(saved.blocks[1]?.text);
  });
  it('rejects edits to originals, missing blocks, empty and oversized text without changes', async () => {
    const { repo, original } = await fixture();
    await expect(repo.saveDraft(original.id, 0, 'b1', 'new')).rejects.toThrow();
    const draft = await repo.enableEditing(original.id);
    for (const [id, text] of [['missing', 'hello'], ['b1', '  '], ['b1', 'x'.repeat(100001)]]) {
      await expect(repo.saveDraft(draft.id, 0, id!, text!)).rejects.toThrow();
    }
    expect(await repo.getDocument(draft.id)).toEqual(draft);
  });
  it('rejects stale/concurrent writes and does not lose a committed revision to touchOpened', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    const results = await Promise.allSettled([
      repo.saveDraft(draft.id, 0, 'b1', 'First contender wins.'),
      repo.saveDraft(draft.id, 0, 'b1', 'Second contender wins.'), repo.touchOpened(draft.id),
    ]);
    expect(results.slice(0, 2).filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await repo.getDocument(draft.id))?.draft?.revision).toBe(1);
    await expect(repo.saveDraft(draft.id, 0, 'b1', 'stale')).rejects.toThrow('another window');
  });
  it('undo restores the text and advances the revision; keeps a bounded last-50 history', async () => {
    const { repo, original } = await fixture(); let draft = await repo.enableEditing(original.id);
    for (let i = 0; i < 52; i++) draft = reviseDraft(draft, 'b1', `Changed paragraph number ${i}.`);
    expect(draft.draft?.edits).toHaveLength(50);
    expect(draft.draft?.revision).toBe(52);
    const saved = await repo.saveDraft((await repo.enableEditing(original.id)).id, 0, 'b1', 'Replace my paragraph.');
    const undone = await repo.saveDraft(saved.id, 1, '', '', true);
    expect(undone.blocks[1]?.text).toBe(original.blocks[1]?.text);
    expect(undone.draft).toMatchObject({ revision: 2, edits: [] });
    await expect(repo.saveDraft(saved.id, 2, '', '', true)).rejects.toThrow('no saved edit');
  });
  it('preserves/reanchors annotations and marks removed quotes unplaced, including after undo', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    await repo.putFlag(makeFlag(draft, 'b1.s0'));
    await repo.putFlag(makeFlag(draft, 'b1.s1'));
    await repo.putNote(createNote(new DocIndex(draft), draft.id, 'b1.s0', 'Old words')!);
    const saved = await repo.saveDraft(draft.id, 0, 'b1', 'New first sentence. Second sentence here.');
    const flags = await repo.listFlags(draft.id);
    expect(flags.find((f) => f.quote === 'First sentence here.')?.sentenceId).toMatch(/^unplaced:/);
    expect(flags.find((f) => f.quote === 'Second sentence here.')?.sentenceId).toBe('b1.s1');
    expect((await repo.listNotes(draft.id))[0]?.sentenceId).toMatch(/^unplaced:/);
    await repo.saveDraft(draft.id, saved.draft!.revision, '', '', true);
    expect((await repo.listFlags(draft.id)).find((f) => f.quote === 'First sentence here.')?.sentenceId).toBe('b1.s0');
    expect((await repo.listNotes(draft.id))[0]?.sentenceId).toBe('b1.s0');
  });
  it('updates heading navigation and rejects reparse rather than discarding edits', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    const saved = await repo.saveDraft(draft.id, 0, 'b0', 'A new chapter title');
    expect(saved.chapters[0]?.title).toBe('A new chapter title'); expect(saved.toc[0]?.title).toBe('A new chapter title');
    await expect(repo.replaceParsed(draft.id, makeDoc(sampleBlocks))).rejects.toThrow('Edit draft');
  });
  it('does not infer local draft rights/audio references from imported metadata', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    const imported = await repo.addDocument(draft, new ArrayBuffer(0), 'untrusted.transfer', 'other-hash');
    expect(imported.draft).toBeUndefined();
    await repo.replaceParsed(imported.id, draft);
    expect((await repo.getDocument(imported.id))?.draft).toBeUndefined();
  });
  it('reuses only exact voice/text clips and never marks a revised missing clip ready', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    const key = await audioKey('kokoro', 'bf_emma', 'First sentence here.');
    await repo.putPreparedAudio(original.id, key, new Blob(['old recording']));
    expect((await repo.getPreparedAudio(draft.id, key))?.size).toBe(13);
    expect(await repo.getPreparedAudio(draft.id, await audioKey('kokoro', 'am_michael', 'First sentence here.'))).toBeUndefined();
    const revised = await repo.saveDraft(draft.id, 0, 'b1', 'Completely revised words.');
    const plan = { docId: revised.id, sourceHash: revised.sourceHash, units: [], texts: ['Completely revised words.'] };
    expect((await inspectNarration(plan, 'bf_emma', repo)).ready).toBe(false);
    expect((await repo.getDocument(draft.id))?.blocks[1]?.text).toBe('Completely revised words.');
  });
  it('reads saved new words through the real player state machine, not the old sentence with its reused ID', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    const spoken: string[] = [];
    const voice = { id: 'fake', engineId: 'webspeech' as const, name: 'Test', lang: 'en-GB', offline: true, quality: 'standard' as const };
    const engine: VoiceEngine = { id: 'webspeech', label: 'Test', kind: 'direct', maxEngineRate: 2,
      isAvailable: async () => ({ ok: true }), listVoices: async () => [voice], speak: async (text) => { spoken.push(text); } };
    const player = new Player({ positions: repo, registry: new EngineRegistry([engine]), settings: () => ({ ...defaultSettings(), pauseBetweenParagraphsMs: 0, pauseAfterHeadingMs: 0 }) });
    await player.load(draft, 'b1.s0');
    const saved = await repo.saveDraft(draft.id, 0, 'b1', 'The saved draft now sounds different.');
    await player.load(saved, 'b1.s0'); await player.playReader(); await player.settled;
    expect(spoken[0]).toBe('The saved draft now sounds different.'); expect(spoken.join(' ')).not.toContain('First sentence here.');
    expect(player.state.source).toBe('reader'); player.stop();
  });
  it('does not overwrite the new draft anchor by flushing an old longer revision on player reload', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    const player = new Player({ positions: repo, registry: new EngineRegistry([]), settings: defaultSettings });
    await player.load(draft, 'b3.s0');
    player.flushPosition();
    const saved = await repo.saveDraft(draft.id, 0, 'b1', 'Shortened paragraph.');
    await player.load(saved, 'b1.s0');
    // Flush any pending IDB transactions; the saved paragraph, not the old final sentence, wins.
    expect(await repo.getPosition(draft.id)).toMatchObject({ sentenceId: 'b1.s0', ordinal: new DocIndex(saved).get('b1.s0')!.ordinal });
    player.stop();
  });
  it('removing narration keeps edits/recovery, and deleting the document cascades its recovery', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    const key = await audioKey('kokoro', 'bf_emma', 'First sentence here.');
    await repo.putPreparedAudio(original.id, key, new Blob(['original clip']));
    expect(await repo.getPreparedAudio(draft.id, key)).toBeDefined();
    await repo.deleteNarration(draft.id);
    expect(await repo.getPreparedAudio(draft.id, key)).toBeUndefined();
    expect(await repo.getOriginalDocument(original.id)).toBeDefined();
    await repo.saveDraft(draft.id, 0, 'b3', 'Another edit after removing audio.');
    expect(await repo.getPreparedAudio(draft.id, key)).toBeUndefined();
    await repo.deleteDocument(draft.id);
    expect(await repo.getOriginalDocument(draft.id)).toBeUndefined();
  });
  it('drops in-memory old audio on load, reuses untouched clips, and synthesizes the edited words only', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    const generated: string[] = [], played: string[] = [];
    const voice = { id: 'bf_emma', engineId: 'kokoro' as const, name: 'Test', lang: 'en-GB', offline: true, quality: 'neural' as const };
    const engine: VoiceEngine = { id: 'kokoro', label: 'Test', kind: 'audio', maxEngineRate: 1,
      isAvailable: async () => ({ ok: true }), listVoices: async () => [voice],
      synthesize: async (text) => { generated.push(text); return new Blob([`new:${text}`]); } };
    const player = new Player({ positions: repo, registry: new EngineRegistry([engine]), audioCache: repo,
      audio: { play: async (blob) => { played.push(await blob.text()); } },
      settings: () => ({ ...defaultSettings(), pauseBetweenParagraphsMs: 0, pauseAfterHeadingMs: 0 }) });
    await player.load(draft);
    for (const text of player.narrationPlan().texts) await repo.putPreparedAudio(original.id, await audioKey('kokoro', voice.id, text), new Blob([`old:${text}`]));
    await player.playReader(); await player.settled;
    expect(generated).toEqual([]); expect(played.join(' ')).toContain('old:First sentence here.');
    played.length = 0;
    const saved = await repo.saveDraft(draft.id, 0, 'b1', 'This is the newly saved wording.');
    await player.load(saved, 'b1.s0'); await player.playReader(); await player.settled;
    expect(generated).toEqual(['This is the newly saved wording.']);
    expect(played[0]).toBe('new:This is the newly saved wording.'); expect(played.join(' ')).not.toContain('old:First');
    expect(played.join(' ')).toContain('old:Final paragraph.'); player.stop();
  });
  it('exports only revised reading text, escaping HTML/Markdown and enclosing code safely', async () => {
    const { repo, original } = await fixture(); const draft = await repo.enableEditing(original.id);
    const saved = await repo.saveDraft(draft.id, 0, 'b1', '<script>alert(1)</script> **bold** literal.');
    expect(draftText(saved)).toContain('<script>alert(1)</script> **bold** literal.');
    expect(draftMarkdown(saved)).not.toContain('<script>');
    expect(draftMarkdown(saved)).not.toContain('baseSourceHash'); expect(draftMarkdown(saved)).not.toContain('First sentence here.');
    expect(draftMarkdown(saved)).toContain('```\nlet x = 1;\n```');
  });
  it('restores the complete original import after many edits, and rejects a stale session after re-enabling', async () => {
    const { repo, original, bytes } = await fixture(); const first = await repo.enableEditing(original.id);
    const edited = await repo.saveDraft(first.id, 0, 'b1', 'A saved change.', false, first.sourceHash);
    await expect(repo.restoreOriginalDocument(first.id, 0, first.sourceHash)).rejects.toThrow('another window');
    const restored = await repo.restoreOriginalDocument(first.id, edited.draft!.revision, edited.sourceHash);
    expect(restored).toEqual(original); expect(await repo.getSource(first.id)).toEqual(bytes);
    expect((await repo.listSummaries()).length).toBe(1);
    const second = await repo.enableEditing(first.id);
    expect(second.sourceHash).not.toBe(first.sourceHash);
    await expect(repo.saveDraft(first.id, 0, 'b1', 'Stale edit.', false, first.sourceHash)).rejects.toThrow('another window');
    await expect(repo.restoreOriginalDocument(first.id, 0, first.sourceHash)).rejects.toThrow('another window');
    expect(await repo.getDocument(first.id)).toEqual(second);
  });
  it('does not overwrite another library entry when restoring the same original source', async () => {
    const { repo, original, bytes } = await fixture(); const editable = await repo.enableEditing(original.id);
    const other = await repo.addDocument(original, bytes, 'original-again.epub', original.sourceHash);
    await expect(repo.restoreOriginalDocument(editable.id, 0)).rejects.toThrow('separate library entry');
    expect(await repo.getDocument(other.id)).toEqual(other);
    expect(await repo.getDocument(editable.id)).toEqual(editable);
  });
});
