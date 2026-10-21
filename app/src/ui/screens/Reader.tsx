// Reader screen (spec 11.3, 11.4, 10.1, 14).
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DocIndex } from '../../core/model';
import { createFlag } from '../../core/flags/corrections';
import { RATE_MAX, RATE_MIN, clampRate } from '../../core/store/settings';
import type { DocRecord, EngineId, Flag, Voice } from '../../core/types';
import type { Pick } from '../../core/engines/registry';
import { TextPane } from '../components/TextPane';
import { FlagPanel } from '../components/FlagPanel';
import { TocPanel } from '../components/TocPanel';
import { NoteSheet } from '../components/NoteSheet';
import { KokoroDownload } from '../components/KokoroDownload';
import { VoicePicker, shortVoiceName } from '../components/VoicePicker';
import { usePlayer } from '../hooks/usePlayer';
import { useKeys } from '../hooks/useKeys';
import { useMediaSession, useOnline, useWakeLock } from '../hooks/useDevice';
import { toast, useKokoro, useServices, useSettings } from '../services';

type Panel = 'toc' | 'flags' | null;

export function Reader({ docId }: { docId: string }) {
  const services = useServices();
  const { repo, player, registry, kokoro, isTouch } = services;
  const settings = useSettings();
  const kokoroStatus = useKokoro();
  const [doc, setDoc] = useState<DocRecord | null | undefined>(undefined);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [panel, setPanel] = useState<Panel>(isTouch || innerWidth < 900 ? null : 'toc');
  const [noteFor, setNoteFor] = useState<Flag | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [auto, setAuto] = useState<Pick | null | undefined>(undefined);
  const view = usePlayer(player);
  const online = useOnline();
  const wasOnline = useRef(online);
  const index = useMemo(() => (doc ? new DocIndex(doc) : null), [doc]);

  // Load the document, its flags and the saved position.
  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await repo.getDocument(docId);
      if (!alive) return;
      if (!d) return setDoc(null);
      const [f, pos] = await Promise.all([repo.listFlags(docId), repo.getPosition(docId)]);
      if (!alive) return;
      setFlags(f);
      setDoc(d);
      await player.load(d, pos?.sentenceId);
      void repo.touchOpened(docId);
      document.title = `${d.title} · ReadAloud`;
    })();
    return () => {
      alive = false;
      player.stop();
      document.title = 'ReadAloud';
    };
  }, [docId, repo, player]);

  // Voices and the automatic choice (neural-first, ADR-13).
  const loadVoices = useCallback(async () => {
    const all = (await Promise.all(registry.all().map((e) => registry.voices(e.id)))).flat();
    setVoices(all);
    setAuto(await registry.pick(services.getSettings()));
  }, [registry, services]);
  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  // Load the Kokoro model while the reader opens, so the first Play starts quickly.
  useEffect(() => {
    void kokoro.installed().then((ok) => (ok ? kokoro.load() : undefined)).catch(() => undefined);
  }, [kokoro]);

  // The natural voice has just been downloaded: switch to it (ADR-22).
  const kokoroInstalled = kokoroStatus.installed;
  const hadKokoro = useRef(kokoroInstalled);
  useEffect(() => {
    if (hadKokoro.current === kokoroInstalled) return;
    hadKokoro.current = kokoroInstalled;
    void loadVoices();
    if (!kokoroInstalled) {
      if (player.currentVoice?.engineId === 'kokoro') player.resetVoice();
      return;
    }
    if (player.currentVoice?.engineId === 'kokoro') return;
    const playing = player.state.status === 'playing' || player.state.status === 'buffering';
    if (playing) player.pause();
    player.resetVoice();
    toast('The natural voice is ready.');
    if (playing) void player.play();
  }, [kokoroInstalled, player, loadVoices]);

  // Offline: online-only browser voices drop to a basic voice and back (spec 14). Kokoro is offline.
  useEffect(() => {
    if (wasOnline.current === online) return;
    wasOnline.current = online;
    const playing = player.state.status === 'playing' || player.state.status === 'buffering';
    const current = player.currentVoice;
    const needsSwitch = online ? current !== null && current.quality !== 'neural' : current !== null && !current.offline;
    registry.invalidate();
    void loadVoices();
    if (!needsSwitch) return;
    if (playing) player.pause();
    player.resetVoice();
    toast(online ? 'Back online: natural voices are available again.' : 'Offline: using a basic voice until you reconnect.');
    if (playing) void player.play();
  }, [online, player, registry, loadVoices]);

  useEffect(() => {
    if (view.status === 'error' && view.error) toast(view.error, 'error');
  }, [view.status, view.error]);

  useWakeLock(settings.keepAwake && (view.status === 'playing' || view.status === 'buffering'));

  const current = view.currentId && index ? index.get(view.currentId) : undefined;
  const chapterIndex = current?.block.chapterIndex ?? 0;
  const blocks = useMemo(() => (index ? index.chapterBlocks(chapterIndex) : []), [index, chapterIndex]);
  const flagged = useMemo(() => new Set(flags.filter((f) => f.status !== 'dismissed').map((f) => f.sentenceId)), [flags]);
  const audioEngine = (player.currentVoice ?? auto?.voice)?.engineId === 'kokoro';
  const isPlaying = view.status === 'playing' || view.status === 'buffering';
  useMediaSession(audioEngine, doc?.title ?? 'ReadAloud', index?.chapter(chapterIndex)?.title ?? '', isPlaying, player);

  const saveFlag = async (f: Flag) => {
    await repo.putFlag(f);
    setFlags((xs) => (xs.some((x) => x.id === f.id) ? xs.map((x) => (x.id === f.id ? f : x)) : [...xs, f]));
  };
  const deleteFlag = async (f: Flag) => {
    await repo.deleteFlag(f.id);
    setFlags((xs) => xs.filter((x) => x.id !== f.id));
  };

  const flagCurrent = async (withNote: boolean) => {
    if (!doc || !index || !view.currentId) return;
    const existing = flags.find((f) => f.sentenceId === view.currentId && f.status !== 'dismissed');
    let flag = existing;
    if (!flag) {
      const created = createFlag(index, doc.id, view.currentId);
      if (!created) return;
      flag = created;
      await saveFlag(flag);
      toast('Flagged.');
    } else if (!withNote) {
      toast('Already flagged. Press N to add a note.');
    }
    if (settings.pauseOnFlag || withNote) player.pause();
    if (withNote) setNoteFor(flag);
  };

  const go = (blockId: string) => {
    if (!index) return;
    const start = index.block(blockId);
    const first = start?.sentences[0] ?? index.order.find((o) => o.block.index >= (start?.index ?? 0))?.sentence;
    if (first) player.seek(first.id);
    if (isTouch || innerWidth < 900) setPanel(null);
  };

  const pickVoice = async (engineId: EngineId, voiceId: string) => {
    await player.setVoice(engineId, voiceId);
    setAuto(await registry.pick(services.getSettings()));
  };

  const setRate = (r: number) => {
    const rate = clampRate(r);
    player.setRate(rate);
    void services.updateSettings({ rate });
  };

  useKeys({
    Space: () => void player.toggle(),
    ArrowLeft: () => player.prev(),
    ArrowRight: () => player.next(),
    r: () => player.replay(),
    f: () => void flagCurrent(false),
    n: () => void flagCurrent(true),
    '[': () => setRate(view.rate - 0.1),
    ']': () => setRate(view.rate + 0.1),
    g: () => setPanel('toc'),
    Escape: () => (noteFor ? setNoteFor(null) : setPanel(null)),
  });

  if (doc === undefined) return <main class="boot">Opening…</main>;
  if (doc === null || !index)
    return (
      <main class="boot">
        <p>This document is not in the library on this device.</p>
        <a class="button" href="#/">
          Back to library
        </a>
      </main>
    );

  const playing = view.status === 'playing' || view.status === 'buffering';
  const activeVoice = player.currentVoice ?? auto?.voice ?? null;
  const kokoroBanner = !kokoroStatus.installed || kokoroStatus.phase === 'error';
  const status =
    view.status === 'buffering'
      ? activeVoice?.engineId === 'kokoro' && kokoroStatus.phase === 'loading'
        ? 'Loading the natural voice…'
        : 'Preparing audio…'
      : view.status === 'error'
        ? 'Stopped'
        : view.status === 'ended'
          ? 'Finished'
          : activeVoice
            ? `${activeVoice.quality === 'neural' ? 'Natural' : 'Basic'} voice: ${shortVoiceName(activeVoice)}`
            : 'Looking for voices…';

  return (
    <main class={`reader${panel ? ' with-panel' : ''}`}>
      <header class="bar">
        <a class="button" href="#/" aria-label="Back to library">
          ←
        </a>
        <div class="titles">
          <div class="doc-title">{doc.title}</div>
          <div class="chapter-title">{index.chapter(chapterIndex)?.title ?? ''}</div>
        </div>
        <div class="spacer" />
        <button class={panel === 'toc' ? 'active' : ''} onClick={() => setPanel(panel === 'toc' ? null : 'toc')}>
          Contents
        </button>
        <button class={panel === 'flags' ? 'active' : ''} onClick={() => setPanel(panel === 'flags' ? null : 'flags')}>
          Flags{flags.length ? ` (${flags.filter((f) => f.status === 'open').length})` : ''}
        </button>
      </header>

      {kokoroBanner && (
        <div class="banner" role="note">
          <KokoroDownload />
        </div>
      )}

      <div class="reader-body">
        <TextPane blocks={blocks} flagged={flagged} currentId={view.currentId} skipCode={settings.skipCodeBlocks} onSeek={(id) => player.seek(id)} />
        {panel && (
          <aside class="side-panel">
            {panel === 'toc' ? (
              <TocPanel doc={doc} currentChapter={chapterIndex} onGo={go} />
            ) : (
              <FlagPanel doc={doc} index={index} flags={flags} currentId={view.currentId} onSave={saveFlag} onDelete={deleteFlag} onJump={(id) => player.seek(id)} />
            )}
          </aside>
        )}
      </div>

      {noteFor && (
        <NoteSheet
          flag={noteFor}
          onClose={() => setNoteFor(null)}
          onSave={(note) => void saveFlag({ ...noteFor, note, updatedAt: new Date().toISOString() })}
        />
      )}

      <footer class="controls" aria-label="Playback">
        <div class="transport">
          <button onClick={() => player.prev()} aria-label="Previous sentence" title="Previous sentence (←)">
            ⏮
          </button>
          <button class="play" onClick={() => void player.toggle()} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)">
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => player.next()} aria-label="Next sentence" title="Next sentence (→)">
            ⏭
          </button>
          <button onClick={() => player.replay()} aria-label="Replay sentence" title="Replay sentence (R)">
            ↺
          </button>
        </div>
        <div class="speed" aria-label="Speed">
          <button onClick={() => setRate(view.rate - 0.1)} disabled={view.rate <= RATE_MIN} aria-label="Slower" title="Slower ([)">
            −
          </button>
          <span class="rate">{view.rate.toFixed(1)}×</span>
          <button onClick={() => setRate(view.rate + 0.1)} disabled={view.rate >= RATE_MAX} aria-label="Faster" title="Faster (])">
            +
          </button>
        </div>
        <VoicePicker
          voices={voices}
          locale={settings.locale}
          value={player.currentVoice ? { engineId: player.currentVoice.engineId, voiceId: player.currentVoice.id } : null}
          onPick={(e, v) => void pickVoice(e, v)}
        />
        <div class="status" aria-live="polite">
          {status}
          {view.rate > 2 && player.currentVoice?.engineId === 'webspeech' ? ' · capped at 2.0× for browser voices' : ''}
        </div>
        <button class="note" onClick={() => void flagCurrent(true)} title="Flag with a note (N)">
          Note
        </button>
        <button class="flag-btn" onClick={() => void flagCurrent(false)} title="Flag this sentence (F)">
          FLAG
        </button>
      </footer>
    </main>
  );
}
