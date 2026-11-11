import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { exportTransfer, importTransfer } from '../src/core/audio/transfer';
import { TransferZipWriter, openTransferZip } from '../src/core/audio/transfer-zip';
import { sha256Hex } from '../src/core/util/hash';
import { prepareNarration, inspectNarration } from '../src/core/audio/narration';
import { encodeWav } from '../src/core/audio/wav';
import { Repo } from '../src/core/store/repo';
import { Player } from '../src/core/player/player';
import { EngineRegistry } from '../src/core/engines/registry';
import { defaultSettings } from '../src/core/store/settings';
import { makeDoc } from './helpers/docs';
import type { Voice, VoiceEngine } from '../src/core/types';
vi.stubGlobal('Blob', NodeBlob);
let count = 0; const repos: Repo[] = [];
afterEach(() => { for (const r of repos) r.close(); repos.length = 0; });

async function setup() {
  const a = await Repo.open(`transfer-a-${++count}`), b = await Repo.open(`transfer-b-${count}`); repos.push(a, b);
  const doc = makeDoc([{ type: 'heading', level: 1, text: 'One' }, { type: 'paragraph', text: 'Yes. A longer sentence here. Stop.' },
    { type: 'heading', level: 1, text: 'Two' }, { type: 'paragraph', text: 'Leave live systems to OT. I live in London.' }]);
  const voice: Voice = { id: 'bm_george', engineId: 'kokoro', name: 'George', lang: 'en-GB', quality: 'neural', offline: true };
  const engine: VoiceEngine = { id: 'kokoro', kind: 'audio', label: 'test', maxEngineRate: 1,
    listVoices: async () => [voice], isAvailable: async () => ({ ok: true }),
    synthesize: async () => encodeWav(new Float32Array([0.1, 0.2]), 24000) };
  const settings = defaultSettings();
  const player = new Player({ positions: a, registry: new EngineRegistry([engine]), settings: () => settings });
  await player.load(doc); const plan = player.narrationPlan(), signal = new AbortController().signal;
  await prepareNarration(plan, engine, voice, a, signal, () => undefined);
  return { a, b, doc, settings, engine, voice, player, plan, signal };
}

it('transfers chapters to one phone book and plays with no model or synthesis', async () => {
  const f = await setup(); let id = '';
  for (const chapter of f.doc.chapters) {
    const zip = await exportTransfer(f.doc, f.plan, chapter.index, f.voice.id, f.settings, f.a, f.signal);
    const result = await importTransfer(await zip.arrayBuffer(), f.b);
    if (id) expect(result.docId).toBe(id); id = result.docId;
  }
  const imported = (await f.b.getDocument(id))!;
  f.settings.preparedAudioOnly = true; f.settings.voiceByEngine.kokoro = f.voice.id;
  f.settings.pauseAfterHeadingMs = f.settings.pauseBetweenParagraphsMs = 0;
  f.engine.synthesize = vi.fn(async () => { throw new Error('Must not generate'); });
  f.engine.isAvailable = vi.fn(async () => ({ ok: false }));
  const phone = new Player({ positions: f.b, registry: new EngineRegistry([f.engine]), settings: () => f.settings,
    audioCache: f.b, audio: { play: async () => undefined } });
  await phone.load(imported);
  expect((await inspectNarration(phone.narrationPlan(), f.voice.id, f.b)).ready).toBe(true);
  await phone.playPrepared(); await phone.settled;
  expect(phone.state.status).toBe('ended'); expect(f.engine.synthesize).not.toHaveBeenCalled();
});

it('rejects tampered audio before importing a document', async () => {
  const f = await setup();
  const zip = await JSZip.loadAsync(await (await exportTransfer(f.doc, f.plan, 0, f.voice.id, f.settings, f.a, f.signal)).arrayBuffer());
  zip.file('audio/0.wav', new Uint8Array([1, 2, 3]));
  await expect(importTransfer(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }), f.b)).rejects.toThrow('hash mismatch');
  expect(await f.b.listSummaries()).toHaveLength(0);
});

it('carries a personal dictionary and sanitizes settings on import', async () => {
  const f = await setup();
  f.settings.pronunciation = { enabled: true, list: 'OT = operational technology' };
  const plan = f.player.narrationPlan();
  await prepareNarration(plan, f.engine, f.voice, f.a, f.signal, () => undefined);
  for (const chapter of f.doc.chapters) {
    const zip = await JSZip.loadAsync(await (await exportTransfer(f.doc, plan, chapter.index, f.voice.id, f.settings, f.a, f.signal)).arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    manifest.reading.azure = { key: 'must not become a setting' };
    zip.file('manifest.json', JSON.stringify(manifest));
    const result = await importTransfer(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }), f.b);
    expect(result.reading.pronunciation).toEqual(f.settings.pronunciation);
    expect(result.reading).not.toHaveProperty('azure');
    expect(manifest.doc.blocks.some((b: { text: string }) => b.text.includes('Leave live systems to OT.'))).toBe(true);
  }
});

it('imports old 0.5.0 transfers with context rules off so existing speech stays usable', async () => {
  const f = await setup();
  f.settings.pronunciation = { enabled: false, list: '' };
  const plan = f.player.narrationPlan();
  await prepareNarration(plan, f.engine, f.voice, f.a, f.signal, () => undefined);
  const zip = await JSZip.loadAsync(await (await exportTransfer(f.doc, plan, 1, f.voice.id, f.settings, f.a, f.signal)).arrayBuffer());
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  manifest.version = 1;
  delete manifest.reading.pronunciation; delete manifest.reading.locale;
  zip.file('manifest.json', JSON.stringify(manifest));
  const result = await importTransfer(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }), f.b);
  expect(result.reading.pronunciation).toEqual({ enabled: false, list: '' });
  expect(result.reading.locale).toBe('en-GB');
});

it('rejects compressed and path-injected packages', async () => {
  const f = await setup(); const zip = new JSZip();
  zip.file('manifest.json', ' '.repeat(10000));
  await expect(importTransfer(await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }), f.b)).rejects.toThrow();
  zip.file('../unexpected', 'x');
  await expect(importTransfer(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }), f.b)).rejects.toThrow();
});

it('imports a real transfer over 160 MiB without reading the entire file into memory', async () => {
  const f = await setup();
  const small = await exportTransfer(f.doc, f.plan, 0, f.voice.id, f.settings, f.a, f.signal);
  const original = await openTransferZip(small);
  const manifest = JSON.parse(new TextDecoder().decode(await original.get('manifest.json')!.read()));
  const header = new Uint8Array(await encodeWav(new Float32Array([0.1]), 24000).arrayBuffer()).slice(0, 44);
  const length = 20 * 1024 * 1024;
  new DataView(header.buffer).setUint32(4, length + 36, true);
  new DataView(header.buffer).setUint32(40, length, true);
  const audio = new Blob([header, new Uint8Array(length)]), digest = await sha256Hex(await audio.arrayBuffer());
  const zip = new TransferZipWriter(); manifest.clips = [];
  for (let i = 0; i < 9; i++) {
    const file = `audio/${i}.wav`;
    await zip.add(file, audio);
    manifest.clips.push({ file, text: `Passage ${i}`, sha256: digest });
  }
  await zip.add('manifest.json', new Blob([JSON.stringify(manifest)]));
  const file = zip.finish(); expect(file.size).toBeGreaterThan(160 * 1024 * 1024);
  // Individual slice reads work; the whole-file read must never be called.
  Object.defineProperty(file, 'arrayBuffer', { value: () => { throw new Error('Whole-file read forbidden'); } });
  const put = vi.spyOn(f.b, 'putPreparedAudio').mockResolvedValue();
  const result = await importTransfer(file, f.b);
  expect(result.clips).toBe(9); expect(put).toHaveBeenCalledTimes(9);
  expect(put.mock.calls.every((call) => call[2].size === audio.size)).toBe(true);
}, 60000);

it('rejects mismatched central directories and duplicate entries before writing', async () => {
  const f = await setup();
  const blob = await exportTransfer(f.doc, f.plan, 0, f.voice.id, f.settings, f.a, f.signal);
  const bytes = await blob.arrayBuffer(), view = new DataView(bytes);
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) at += 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true) + view.getUint32(at + 18, true);
  view.setUint32(at + 42, 1234, true);
  await expect(importTransfer(new Blob([bytes]), f.b)).rejects.toThrow('directory mismatch');
  const zip = new TransferZipWriter();
  await zip.add('manifest.json', new Blob(['{}'])); await zip.add('manifest.json', new Blob(['{}']));
  await expect(importTransfer(zip.finish(), f.b)).rejects.toThrow('damaged');
  expect(await f.b.listSummaries()).toHaveLength(0);
});

it('exports the whole book once and imports all chapters without synthesis', async () => {
  const f = await setup();
  const zip = await exportTransfer(f.doc, f.plan, undefined, f.voice.id, f.settings, f.a, f.signal);
  const result = await importTransfer(zip, f.b);
  const imported = (await f.b.getDocument(result.docId))!;
  const phone = new Player({ positions: f.b, registry: new EngineRegistry([f.engine]), settings: () => f.settings });
  await phone.load(imported);
  expect((await inspectNarration(phone.narrationPlan(), f.voice.id, f.b)).ready).toBe(true);
});

it('writes valid ZIP timestamps for phone archive tools', async () => {
  const f = await setup();
  const file = await exportTransfer(f.doc, f.plan, undefined, f.voice.id, f.settings, f.a, f.signal);
  const view = new DataView(await file.arrayBuffer());
  expect(view.getUint16(12, true)).toBe(0x21);
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) at += 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true) + view.getUint32(at + 18, true);
  expect(view.getUint16(at + 14, true)).toBe(0x21);
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true });
  expect(zip.file('manifest.json')!.date.getMonth()).toBe(0);
  expect(zip.file('manifest.json')!.date.getDate()).toBe(1);
});
