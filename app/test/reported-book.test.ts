// Optional local regression on the owner's supplied book. No fixture text/EPUB is committed.
import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { parseBytes } from '../src/core/ingest';
import { PageIndex } from '../src/core/text/pages';
import { Player } from '../src/core/player/player';
import { EngineRegistry } from '../src/core/engines/registry';
import { defaultSettings, withDefaults } from '../src/core/store/settings';
import type { DocRecord, Voice, VoiceEngine } from '../src/core/types';

const source = process.env.READALOUD_QA_EPUB;
it.runIf(!!source)('binds the supplied EPUB revision and reads past its two reported page endings', async () => {
  const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const bytes = await readFile(source!); const before = hash(bytes);
  const parsed = await parseBytes(new Uint8Array(bytes).buffer, basename(source!));
  const after = hash(await readFile(source!)); expect(after).toBe(before);
  const doc: DocRecord = { ...parsed, id: 'owner-boundary-qa', sourceName: basename(source!), sourceHash: before, addedAt: '2026-11-10T00:00:00.000Z' };
  const pages = new PageIndex(doc).pages;
  const sentences = doc.blocks.flatMap((b) => b.sentences);
  expect(sentences.find((s) => s.id === pages[0]?.lastSentenceId)?.text).toContain('corrects the fixes in Chapters 13 and 15');
  expect(sentences.find((s) => s.id === pages[1]?.lastSentenceId)?.text).toContain('judgement to AI-written code');
  const voice: Voice = { id: 'synthetic', engineId: 'webspeech', name: 'No-network QA stub', lang: 'en-GB', offline: true, quality: 'neural' };
  let spoken = 0;
  const engine: VoiceEngine = { id: 'webspeech', kind: 'direct', label: voice.name, maxEngineRate: 2,
    isAvailable: async () => ({ ok: true }), listVoices: async () => [voice], speak: async () => { spoken++; } };
  const settings = withDefaults({ ...defaultSettings(), schemaVersion: 4, stopAtPageEnd: true, layout: 'pages', twoPages: true,
    pauseAfterHeadingMs: 0, pauseBetweenParagraphsMs: 0, pauseBetweenSentencesMs: 0 });
  const player = new Player({ positions: { savePosition: async () => {} }, registry: new EngineRegistry([engine]), settings: () => settings });
  await player.load(doc);
  const crossed: number[] = [];
  for (const page of pages.slice(0, 2)) {
    spoken = 0;
    player.seek(page.lastSentenceId);
    await player.playReader(); await player.settled;
    expect(player.state.status).toBe('ended'); expect(spoken).toBeGreaterThan(2);
    crossed.push(spoken);
  }
  console.info('SOURCE_BOUND_QA', JSON.stringify({ sourceHashBefore: before, sourceHashAfter: after,
    pages: pages.length, verifiedEndingPages: [pages[0]!.label, pages[1]!.label], spokenSentencesFromEachEnding: crossed,
    playback: 'no-network stub; not an auditory TTS check', result: 'passed' }));
}, 30000);
