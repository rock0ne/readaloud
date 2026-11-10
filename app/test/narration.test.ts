import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { audioKey, exportChapter, inspectNarration, prepareNarration, wholeBookWav } from '../src/core/audio/narration';
import { decodeWav, encodeWav } from '../src/core/audio/wav';
import { EngineRegistry } from '../src/core/engines/registry';
import { Player } from '../src/core/player/player';
import { Repo } from '../src/core/store/repo';
import { defaultSettings } from '../src/core/store/settings';
import type { Voice, VoiceEngine } from '../src/core/types';
import { makeDoc } from './helpers/docs';

// fake-indexeddb uses Node structuredClone, which cannot clone jsdom's Blob implementation.
vi.stubGlobal('Blob', NodeBlob);

let counter = 0;
const opened: Repo[] = [];
afterEach(() => { for (const r of opened) r.close(); opened.length = 0; });

async function fixture() {
  const repo = await Repo.open(`narration-${++counter}`); opened.push(repo);
  const voice: Voice = { id: 'bf_emma', engineId: 'kokoro', name: 'Emma', lang: 'en-GB', offline: true, quality: 'neural' };
  const synthesize = vi.fn(async () => encodeWav(new Float32Array([0.2, 0.3]), 24000));
  const engine: VoiceEngine = { id: 'kokoro', label: 'Local test voice', kind: 'audio', maxEngineRate: 1,
    isAvailable: async () => ({ ok: true }), listVoices: async () => [voice], synthesize };
  const settings = { ...defaultSettings(), voiceByEngine: { kokoro: voice.id },
    pauseAfterHeadingMs: 0, pauseBetweenParagraphsMs: 0, pauseBetweenSentencesMs: 0 };
  const play = vi.fn(async () => undefined);
  const player = new Player({ positions: repo, registry: new EngineRegistry([engine]), settings: () => settings,
    audio: { play }, audioCache: repo });
  const doc = makeDoc([{ type: 'heading', level: 1, text: 'Chapter One' },
    { type: 'paragraph', text: 'Yes. Here is a longer sentence. Stop.' },
    { type: 'code', text: 'Do not narrate this code.' },
    { type: 'heading', level: 1, text: 'Chapter Two' },
    { type: 'paragraph', text: 'An entirely different chapter.' }]);
  await player.load(doc);
  return { repo, voice, engine, settings, play, player, doc, synthesize, plan: player.narrationPlan() };
}

describe('whole-book prepared narration', () => {
  it('reuses prepared audio and exact chapter timings after reader-only appearance changes', async () => {
    const f = await fixture();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined);
    const before = await inspectNarration(f.plan, f.voice.id, f.repo);
    const beforeWav = await wholeBookWav(f.plan, f.voice.id, f.repo, new AbortController().signal);
    const beforeChunks: Uint8Array[] = [];
    for await (const chunk of beforeWav.chunks) beforeChunks.push(chunk);
    const calls = f.synthesize.mock.calls.length;
    Object.assign(f.settings, { readerTone: 'night', readerFont: 'sans', fontSizePx: 24, lineSpacing: 2, layout: 'pages', twoPages: true });
    expect(f.player.narrationPlan()).toEqual(f.plan);
    const after = await inspectNarration(f.player.narrationPlan(), f.voice.id, f.repo);
    expect(after.key).toBe(before.key); expect(after.ready).toBe(true);
    expect(after.completed).toBe(before.completed);
    const afterWav = await wholeBookWav(f.player.narrationPlan(), f.voice.id, f.repo, new AbortController().signal);
    const afterChunks: Uint8Array[] = [];
    for await (const chunk of afterWav.chunks) afterChunks.push(chunk);
    expect(afterChunks).toEqual(beforeChunks);
    expect(afterWav.chapterStarts).toEqual(beforeWav.chapterStarts);
    expect(f.synthesize.mock.calls).toHaveLength(calls);
  });
  it('plays one chapter from the saved whole book, stops there, and can continue across chapters without synthesis', async () => {
    const f = await fixture();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined);
    f.settings.preparedAudioOnly = true; f.synthesize.mockClear();
    const heard: number[] = [];
    f.player.subscribe((event) => { if (event.type === 'sentence') {
      const block = f.doc.blocks.find((b) => b.sentences.some((s) => s.id === event.sentenceId));
      if (block) heard.push(block.chapterIndex);
    } });
    await f.player.playChapter(0); await f.player.settled;
    expect(heard.length).toBeGreaterThan(0); expect([...new Set(heard)]).toEqual([0]);
    expect(f.player.state.status).toBe('paused'); expect(f.player.chapterPlayback).toEqual({chapter:0,finished:true});
    heard.length = 0;
    await f.player.play(); await f.player.settled;
    expect([...new Set(heard)]).toEqual([0]);
    heard.length = 0;
    await f.player.playChapter(0, true); await f.player.settled;
    expect([...new Set(heard)]).toEqual([0,1]); expect(f.player.state.status).toBe('ended');
    expect(f.synthesize).not.toHaveBeenCalled();
  });
  it('plays/repeats the final chapter without jumping to the beginning and rejects missing chapters', async () => {
    const f = await fixture();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined);
    f.settings.preparedAudioOnly = true; f.synthesize.mockClear();
    await f.player.playChapter(1); await f.player.settled;
    expect(f.player.chapterPlayback).toEqual({chapter:1,finished:true});
    expect(f.player.state.status).toBe('paused');
    await f.player.play(); await f.player.settled;
    expect(f.player.chapterPlayback).toEqual({chapter:1,finished:true});
    await expect(f.player.playChapter(999)).rejects.toThrow('no readable');
    expect(f.synthesize).not.toHaveBeenCalled();
  });
  it('prepares/resumes only one selected chapter, exports it while the rest is unprepared, and reuses it for the whole book', async () => {
    const f = await fixture(); const signal = new AbortController().signal;
    const selected = f.player.narrationPlan(0);
    expect(selected.units.every((u) => u.chapter === 0)).toBe(true);
    expect(selected.texts).toContain('Stop.');
    expect(selected.texts.join(' ')).not.toContain('entirely different');
    await prepareNarration(selected, f.engine, f.voice, f.repo, signal, () => undefined);
    expect((await inspectNarration(selected, f.voice.id, f.repo)).ready).toBe(true);
    expect((await inspectNarration(f.player.narrationPlan(1), f.voice.id, f.repo)).completed).toBe(0);
    expect((await inspectNarration(f.plan, f.voice.id, f.repo)).ready).toBe(false);
    expect((await exportChapter(f.plan, 0, f.voice.id, f.repo, signal)).size).toBeGreaterThan(44);
    f.synthesize.mockClear();
    await prepareNarration(selected, f.engine, f.voice, f.repo, signal, () => undefined);
    expect(f.synthesize).not.toHaveBeenCalled();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, signal, () => undefined);
    expect(f.synthesize).toHaveBeenCalledTimes(f.plan.texts.filter((t) => !selected.texts.includes(t)).length);
    expect((await inspectNarration(f.plan, f.voice.id, f.repo)).ready).toBe(true);
  });
  it('streams every chapter into one WAV with the same PCM/order as chapter exports and no synthesis', async () => {
    const f = await fixture();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined);
    f.synthesize.mockClear();
    const signal = new AbortController().signal;
    // Distinct PCM per text proves order, not merely total length.
    for (const [i, text] of f.plan.texts.entries()) {
      await f.repo.putPreparedAudio(f.doc.id, await audioKey('kokoro', f.voice.id, text), encodeWav(new Float32Array([(i + 1) / 100]), 24000));
    }
    const book = await wholeBookWav(f.plan, f.voice.id, f.repo, signal);
    const chunks = []; for await (const c of book.chunks) { expect(c.length).toBeLessThanOrEqual(65536); chunks.push(c); }
    const wav = new Blob(chunks.map((c) => new Uint8Array(c).buffer));
    expect(wav.size).toBe(book.bytes);
    const pcm = new Uint8Array((await wav.arrayBuffer()).slice(44));
    const parts = [];
    for (const c of f.doc.chapters) parts.push((await (await exportChapter(f.plan, c.index, f.voice.id, f.repo, signal)).arrayBuffer()).slice(44));
    expect(pcm).toEqual(new Uint8Array(await new Blob(parts).arrayBuffer()));
    expect(decodeWav(await wav.arrayBuffer()).sampleRate).toBe(24000);
    expect(f.synthesize).not.toHaveBeenCalled();
  });

  it('refuses incomplete, mixed-rate or cancelled whole-book audio', async () => {
    const f = await fixture(); const signal = new AbortController().signal;
    await expect(wholeBookWav(f.plan, f.voice.id, f.repo, signal)).rejects.toThrow('incomplete');
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, signal, () => undefined);
    const book = await wholeBookWav(f.plan, f.voice.id, f.repo, signal);
    const ac = new AbortController(); const cancelled = await wholeBookWav(f.plan, f.voice.id, f.repo, ac.signal);
    ac.abort(); await expect(cancelled.chunks.next()).rejects.toThrow();
    const last = f.plan.units.at(-1)!.texts[0]!;
    await f.repo.putPreparedAudio(f.doc.id, await audioKey('kokoro', f.voice.id, last), encodeWav(new Float32Array([.2]), 16000));
    await expect(wholeBookWav(f.plan, f.voice.id, f.repo, signal)).rejects.toThrow('different sample rates');
    expect(book.bytes).toBeGreaterThan(44);
  });

  it('refuses oversized RIFF without allocating a giant book buffer', async () => {
    const f = await fixture(); const signal = new AbortController().signal;
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, signal, () => undefined);
    const unit = f.plan.units[0]!;
    const huge = { ...f.plan, units: Array.from({ length: 1600 }, () => ({ ...unit, beforeMs: 60000, afterMs: 0 })) };
    await expect(wholeBookWav(huge, f.voice.id, f.repo, signal)).rejects.toThrow('4 GiB');
  });
  it('keeps displayed text intact, prepares transformed speech and rejects stale audio after a pronunciation change', async () => {
    const f = await fixture();
    const doc = makeDoc([{ type: 'paragraph', text: 'Leave live systems to OT. I live in London.' }]);
    const original = JSON.stringify(doc);
    await f.player.load(doc);
    const plan = f.player.narrationPlan();
    expect(plan.texts.join(' ')).toContain('leeve lyve systems to O. T.');
    expect(JSON.stringify(doc)).toBe(original);
    await prepareNarration(plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined);
    expect(f.synthesize.mock.calls.flat().join(' ')).toContain('lyve');
    f.settings.preparedAudioOnly = true;
    f.synthesize.mockClear();
    await f.player.play(); await f.player.settled;
    expect(f.player.state.status).toBe('ended');
    expect(f.synthesize).not.toHaveBeenCalled();
    f.settings.pronunciation = { enabled: true, list: 'OT = operational technology' };
    f.player.resetVoice();
    expect((await inspectNarration(f.player.narrationPlan(), f.voice.id, f.repo)).ready).toBe(false);
    expect((await inspectNarration(plan, f.voice.id, f.repo)).ready).toBe(true);
  });
  it('covers chapters and mid-unit seeks, excludes skipped code, and resumes without generation', async () => {
    const f = await fixture();
    expect(new Set(f.plan.units.map((u) => u.chapter)).size).toBe(2);
    expect(f.plan.texts).toContain('Stop.');
    expect(f.plan.texts.join(' ')).not.toContain('Do not narrate');
    const progress = vi.fn();
    const r = await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, progress);
    expect(r.ready).toBe(true); expect(progress).toHaveBeenCalledTimes(f.plan.texts.length);
    f.synthesize.mockClear();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, progress);
    expect(f.synthesize).not.toHaveBeenCalled();
    expect((await inspectNarration(f.plan, f.voice.id, f.repo)).ready).toBe(true);
    expect((await inspectNarration(f.plan, 'bm_george', f.repo)).ready).toBe(false);
  });

  it('plays across chapters and after a mid-unit seek without initializing/synthesizing a voice', async () => {
    const f = await fixture();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined);
    f.settings.preparedAudioOnly = true;
    f.engine.isAvailable = vi.fn(async () => ({ ok: false }));
    f.synthesize.mockClear();
    await f.player.play(); await f.player.settled;
    expect(f.player.state.status).toBe('ended'); expect(f.synthesize).not.toHaveBeenCalled();
    expect(f.engine.isAvailable).not.toHaveBeenCalled(); expect(f.play.mock.calls.length).toBeGreaterThan(2);
    const sentence = f.doc.blocks.flatMap((b) => b.sentences).find((s) => s.text === 'Stop.')!;
    f.player.seek(sentence.id);
    await f.player.play(); await f.player.settled;
    expect(f.player.state.status).toBe('ended'); expect(f.synthesize).not.toHaveBeenCalled();
  });

  it('stops on missing prepared audio instead of silently generating', async () => {
    const f = await fixture(); f.settings.preparedAudioOnly = true;
    await f.player.play(); await f.player.settled;
    expect(f.player.state.status).toBe('error');
    expect(f.player.state.error).toContain('not prepared');
    expect(f.synthesize).not.toHaveBeenCalled(); expect(f.play).not.toHaveBeenCalled();
  });

  it('keeps completed audio on cancellation, then resumes only the missing passages', async () => {
    const f = await fixture(); const abort = new AbortController();
    await expect(prepareNarration(f.plan, f.engine, f.voice, f.repo, abort.signal, () => abort.abort())).rejects.toThrow();
    expect((await inspectNarration(f.plan, f.voice.id, f.repo)).completed).toBe(1);
    f.synthesize.mockClear();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined);
    expect(f.synthesize).toHaveBeenCalledTimes(f.plan.texts.length - 1);
  });

  it('does not label an unsuccessful quota write ready', async () => {
    const f = await fixture();
    vi.spyOn(f.repo, 'putPreparedAudio').mockRejectedValue(new DOMException('Disk full', 'QuotaExceededError'));
    await expect(prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined)).rejects.toThrow('Disk full');
    expect((await inspectNarration(f.plan, f.voice.id, f.repo)).ready).toBe(false);
  });

  it('survives a reopen and cache pruning/clear, but explicit narration deletion removes it', async () => {
    const f = await fixture();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined);
    await f.repo.pruneAudio(0, 0); await f.repo.clearAudio();
    expect((await inspectNarration(f.plan, f.voice.id, f.repo)).ready).toBe(true);
    const reopened = await Repo.open(`narration-${counter}`); opened.push(reopened);
    expect((await inspectNarration(f.plan, f.voice.id, reopened)).ready).toBe(true);
    await reopened.deleteNarration(f.doc.id);
    expect((await inspectNarration(f.plan, f.voice.id, reopened)).ready).toBe(false);
  });

  it('exports ordered chapter PCM with a valid WAV header and without re-synthesis', async () => {
    const f = await fixture();
    await prepareNarration(f.plan, f.engine, f.voice, f.repo, new AbortController().signal, () => undefined);
    f.synthesize.mockClear();
    const chapter = f.plan.units[0]!.chapter;
    const out = await exportChapter(f.plan, chapter, f.voice.id, f.repo, new AbortController().signal);
    const wav = decodeWav(await out.arrayBuffer());
    expect(wav.sampleRate).toBe(24000);
    expect(wav.samples.length).toBe(f.plan.units.filter((u) => u.chapter === chapter).flatMap((u) => u.texts).length * 2);
    expect(f.synthesize).not.toHaveBeenCalled();
  });

  it('rejects incomplete and malformed chapter audio', async () => {
    const f = await fixture();
    await expect(exportChapter(f.plan, 0, f.voice.id, f.repo, new AbortController().signal)).rejects.toThrow('incomplete');
    const text = f.plan.units[0]!.texts[0]!;
    await f.repo.putPreparedAudio(f.doc.id, await audioKey('kokoro', f.voice.id, text), new Blob(['broken']));
    await expect(exportChapter(f.plan, 0, f.voice.id, f.repo, new AbortController().signal)).rejects.toThrow('truncated');
  });
});
