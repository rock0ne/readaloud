import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Player } from '../src/core/player/player';
import { EngineRegistry } from '../src/core/engines/registry';
import { defaultSettings, withDefaults } from '../src/core/store/settings';
import { PageIndex } from '../src/core/text/pages';
import type { Voice, VoiceEngine } from '../src/core/types';
import { ReadRangePicker, ReadRangeNotice } from '../src/ui/components/ReadRange';
import { ReaderTransport } from '../src/ui/components/ReaderChrome';
import { makeDoc } from './helpers/docs';

const root = document.createElement('div'); document.body.append(root);
afterEach(() => act(() => render(null, root)));

async function fixture(audio = false) {
  const made: string[] = [];
  const voice: Voice = { id: 'test', engineId: audio ? 'kokoro' : 'webspeech', name: 'Test', lang: 'en-GB', offline: true, quality: 'neural' };
  const engine: VoiceEngine = { id: voice.engineId, label: 'Synthetic test', kind: audio ? 'audio' : 'direct', maxEngineRate: 2,
    isAvailable: async () => ({ ok: true }), listVoices: async () => [voice],
    ...(audio ? { synthesize: async (text: string) => { made.push(text); return new Blob(['test']); } }
      : { boundaries: true, speak: async (text: string) => { made.push(text); } }) };
  const settings = withDefaults({ ...defaultSettings(), schemaVersion: 4, stopAtPageEnd: true, layout: 'pages', twoPages: true,
    voiceByEngine: { [voice.engineId]: voice.id }, pronunciation: { enabled: false, list: '' },
    pauseAfterHeadingMs: 0, pauseBetweenParagraphsMs: 0, pauseBetweenSentencesMs: 0 });
  const doc = makeDoc([
    { type: 'heading', level: 1, text: 'Title page' },
    { type: 'paragraph', text: 'Draft corrects the fixes in Chapters 13 and 15.' },
    { type: 'heading', level: 1, text: 'Introduction' },
    { type: 'paragraph', text: 'This book will help you bring that judgement to AI-written code.' },
    { type: 'heading', level: 1, text: 'Chapter One' },
    { type: 'paragraph', text: 'Yes. Here is the next sentence. Stop.' },
  ]);
  const player = new Player({ positions: { savePosition: async () => {} }, registry: new EngineRegistry([engine]), settings: () => settings,
    audio: { play: async () => {} } });
  await player.load(doc);
  return { player, doc, pages: new PageIndex(doc), made, settings };
}

describe.each([false, true])('explicit live reading ranges, audio=%s', (audio) => {
  it('upgrades the old default and reads across the two reported endings into the following chapter', async () => {
    const f = await fixture(audio);
    expect(f.settings.stopAtPageEnd).toBe(false); expect(f.settings.layout).toBe('pages'); expect(f.settings.twoPages).toBe(true);
    await f.player.playReader(); await f.player.settled;
    expect(f.player.state).toMatchObject({ status: 'ended', readerRange: 'book', source: 'reader' });
    expect(f.made.join(' ')).toContain('corrects the fixes in Chapters 13 and 15.');
    expect(f.made.join(' ')).toContain('judgement to AI-written code.');
    expect(f.made.join(' ')).toContain('Here is the next sentence.');
  });
  it('reads one full page only, repeats it on Play, and continues the book without repeating/skipping a boundary sentence', async () => {
    const f = await fixture(audio), first = f.pages.pages[0]!;
    await f.player.selectReaderRange('page', first.firstSentenceId, first.lastSentenceId);
    expect(f.made).toEqual([]); // selecting a range never autoplays
    await f.player.playReader(); await f.player.settled;
    expect(f.player.readerRangeFinished).toBe(true); expect(f.player.state.status).toBe('paused');
    expect(f.made.join(' ')).not.toContain('Introduction');
    const once = [...f.made];
    await f.player.playReader(); await f.player.settled;
    if (!audio) expect(f.made).toEqual([...once, ...once]);
    f.made.length = 0;
    await f.player.selectReaderRange('book'); await f.player.playReader(); await f.player.settled;
    expect(f.player.state.status).toBe('ended');
    expect(f.made.join(' ')).toContain('Introduction');
    expect(f.made.join(' ')).not.toContain('corrects the fixes');
  });
  it('reads a chapter and stops at its end, including the final chapter', async () => {
    const f = await fixture(audio), items = f.doc.blocks.filter((b) => b.chapterIndex === 2).flatMap((b) => b.sentences);
    await f.player.selectReaderRange('chapter', items[0]!.id, items.at(-1)!.id);
    await f.player.playReader(); await f.player.settled;
    expect(f.player.state).toMatchObject({ status: 'paused', readerRange: 'chapter' });
    expect(f.player.readerRangeFinished).toBe(true);
    expect(f.made.join(' ')).not.toContain('Introduction'); expect(f.made.join(' ')).toContain('Stop.');
    await f.player.selectReaderRange('book'); await f.player.playReader(); await f.player.settled;
    expect(f.player.state.status).toBe('ended');
  });
  it('does not alter a saved narration plan or prefetch/speak beyond a selected sentence boundary', async () => {
    const f = await fixture(audio), paragraph = f.doc.blocks.at(-1)!;
    const plan = JSON.stringify(f.player.narrationPlan());
    await f.player.selectReaderRange('page', paragraph.sentences[0]!.id, paragraph.sentences[1]!.id);
    expect(JSON.stringify(f.player.narrationPlan())).toBe(plan);
    await f.player.playReader(); await f.player.settled;
    expect(f.made.join(' ')).toContain('Yes. Here is the next sentence.');
    expect(f.made.join(' ')).not.toContain('Stop.');
    expect(f.player.state.status).toBe('paused');
  });
});

it('puts all three scope choices beside main playback and clearly labels a deliberate range stop', () => {
  const select = vi.fn(), onward = vi.fn();
  act(() => render(<ReaderTransport playing={false} onNext={() => {}} onPrevious={() => {}} onReplay={() => {}} onToggle={() => {}}
    rangePicker={<ReadRangePicker value="book" onChange={select} />} />, root));
  expect([...root.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Whole book', 'This chapter only', 'This page only']);
  const picker = root.querySelector('select')!;
  act(() => { picker.value = 'page'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(select).toHaveBeenCalledWith('page');
  act(() => render(<ReadRangeNotice kind="chapter" onBook={onward} />, root));
  expect(root.textContent).toContain('Finished this chapter');
  act(() => root.querySelector('button')!.click()); expect(onward).toHaveBeenCalledOnce();
});

it('retains explicit v5 settings on repeated upgrades and does not alter voice, appearance or pronunciation', () => {
  const saved = { ...defaultSettings(), schemaVersion: 4, stopAtPageEnd: true, layout: 'pages' as const, twoPages: true,
    rate: 1.2, readerTone: 'sepia' as const, voiceByEngine: { kokoro: 'am_michael' }, pronunciation: { enabled: false, list: 'OT = O T' } };
  const upgraded = withDefaults(saved);
  expect(upgraded).toMatchObject({ ...saved, schemaVersion: 5, stopAtPageEnd: false });
  expect(withDefaults(upgraded)).toEqual(upgraded);
});
