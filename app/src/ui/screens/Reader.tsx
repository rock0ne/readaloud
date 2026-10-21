// Reader screen (spec 11.3, 11.4, 10.1, 14, 17.6).
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DocIndex } from '../../core/model';
import { createFlag } from '../../core/flags/corrections';
import { createNote } from '../../core/notes/notes';
import { RATE_MAX, RATE_MIN, clampRate } from '../../core/store/settings';
import { PageIndex } from '../../core/text/pages';
import type { AiResult, AiSuggestion, DocRecord, EngineId, Flag, Note, Voice } from '../../core/types';
import type { Pick } from '../../core/engines/registry';
import { TextPane } from '../components/TextPane';
import type { Sheet } from '../components/TextPane';
import { FlagPanel } from '../components/FlagPanel';
import { TocPanel } from '../components/TocPanel';
import { NoteSheet } from '../components/NoteSheet';
import { NoteEditor } from '../components/NoteEditor';
import { NotesPanel } from '../components/NotesPanel';
import { AiPanel } from '../components/AiPanel';
import { TextControls } from '../components/TextControls';
import { FindBar } from '../components/FindBar';
import type { CiteHelpers } from '../components/Reply';
import { useAiJob } from '../hooks/useAiJob';
import { KokoroDownload } from '../components/KokoroDownload';
import { VoicePicker, shortVoiceName } from '../components/VoicePicker';
import { usePlayer } from '../hooks/usePlayer';
import { useKeys } from '../hooks/useKeys';
import { useMediaSession, useOnline, useWakeLock } from '../hooks/useDevice';
import { toast, useKokoro, useServices, useSettings } from '../services';

type Panel = 'toc' | 'flags' | 'notes' | 'ai' | 'text' | null;

/** Two pages go side by side when the text pane is at least this many ems wide (ADR-35). */
const SPREAD_MIN_EM = 50;
type Editing = { sentenceId: string; note?: Note };

/** Says which kind of voice is reading, so "natural" is never ambiguous (ADR-30). */
function voiceLabel(v: Voice): string {
  const name = shortVoiceName(v);
  if (v.engineId === 'kokoro') return `Kokoro, on this device: ${name}`;
  if (v.quality === 'neural' && !v.offline) {
    const from = /microsoft/i.test(v.name) ? 'Microsoft' : /google/i.test(v.name) ? 'Google' : /samsung/i.test(v.name) ? 'Samsung' : 'browser';
    return `Online ${from} voice: ${name}`;
  }
  return `${v.quality === 'neural' ? 'Natural' : 'Basic'} voice on this device: ${name}`;
}

function upsert<T>(xs: T[], x: T, same: (a: T, b: T) => boolean): T[] {
  return xs.some((y) => same(y, x)) ? xs.map((y) => (same(y, x) ? x : y)) : [...xs, x];
}

export function Reader({ docId }: { docId: string }) {
  const services = useServices();
  const { repo, player, registry, kokoro, isTouch } = services;
  const settings = useSettings();
  const kokoroStatus = useKokoro();
  const [doc, setDoc] = useState<DocRecord | null | undefined>(undefined);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [panel, setPanel] = useState<Panel>(isTouch || innerWidth < 900 ? null : 'toc');
  const [noteFor, setNoteFor] = useState<Flag | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [aiResults, setAiResults] = useState<AiResult[]>([]);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [paneWidth, setPaneWidth] = useState(0);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [auto, setAuto] = useState<Pick | null | undefined>(undefined);
  const view = usePlayer(player);
  const online = useOnline();
  const wasOnline = useRef(online);
  const index = useMemo(() => (doc ? new DocIndex(doc) : null), [doc]);
  const pages = useMemo(() => (doc ? new PageIndex(doc) : null), [doc]);
  const ai = useAiJob(docId, doc ?? null, (rs) => setAiResults((xs) => rs.reduce((acc, r) => upsert(acc, r, (a, b) => a.key === b.key), xs)));

  // Load the document, its flags and the saved position.
  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await repo.getDocument(docId);
      if (!alive) return;
      if (!d) return setDoc(null);
      const [f, pos, n, results] = await Promise.all([repo.listFlags(docId), repo.getPosition(docId), repo.listNotes(docId), repo.listAiResults(docId)]);
      if (!alive) return;
      setFlags(f);
      setNotes(n);
      setAiResults(results);
      setReturnTo(null);
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

  // Page by page (ADR-35): the page being read, and the page facing it when two fit side by side.
  const paged = settings.layout === 'pages';
  const twoUp = paged && settings.twoPages && paneWidth >= settings.fontSizePx * SPREAD_MIN_EM;
  const hereKey = (view.currentId && pages?.ofSentence(view.currentId)?.key) || '';
  const sheets = useMemo((): Sheet[] | null => {
    if (!paged || !pages) return null;
    const inChapter = pages.inChapter(chapterIndex);
    const here = pages.get(hereKey) ?? inChapter[0];
    if (!here) return null;
    const i = inChapter.indexOf(here);
    const shown = twoUp && i >= 0 ? inChapter.slice(i - (i % 2), i - (i % 2) + 2) : [here];
    return shown.map((p) => ({ key: p.key, label: p.label, blocks: pages.blocksOf(p, blocks) }));
  }, [paged, twoUp, pages, chapterIndex, hereKey, blocks]);
  // ...and it can stop at the end of each page, to study it.
  const stopAtPages = paged && settings.stopAtPageEnd;
  useEffect(() => {
    player.setPageEnds(stopAtPages && pages ? new Set(pages.pages.map((p) => p.lastSentenceId).filter(Boolean)) : null);
    return () => player.setPageEnds(null);
  }, [player, pages, stopAtPages]);
  const turn = (dir: 1 | -1) => {
    if (!pages || !sheets?.length) return;
    const edge = dir === 1 ? sheets.at(-1) : sheets[0];
    const all = pages.pages;
    let at = all.findIndex((p) => p.key === edge?.key) + dir;
    while (all[at] && !all[at]!.firstSentenceId) at += dir;
    const target = all[at];
    if (target) player.seek(target.firstSentenceId);
  };
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

  const narrow = () => isTouch || innerWidth < 900;

  // A jump from a citation, a note or a suggestion can be undone with "Back to where I was".
  const jump = (sentenceId: string, play: boolean) => {
    const here = view.currentId;
    if (here && here !== sentenceId && returnTo === null) setReturnTo(here);
    player.seek(sentenceId);
    if (play && player.state.status !== 'playing' && player.state.status !== 'buffering') void player.play();
    if (narrow()) setPanel(null);
  };
  const goBack = () => {
    if (returnTo) player.seek(returnTo);
    setReturnTo(null);
  };

  const cite: CiteHelpers | null =
    index && pages
      ? {
          valid: (id) => index.get(id) !== undefined,
          pageOf: (id) => pages.ofSentence(id)?.label,
          quoteOf: (id) => index.get(id)?.sentence.text,
          onCite: (id) => jump(id, true),
        }
      : null;

  const saveNote = async (n: Note) => {
    await repo.putNote(n);
    setNotes((xs) => upsert(xs, n, (a, b) => a.id === b.id));
  };
  const deleteNote = async (n: Note) => {
    await repo.deleteNote(n.id);
    setNotes((xs) => xs.filter((x) => x.id !== n.id));
  };
  const writeNote = () => {
    const at = view.currentId ?? index?.order[0]?.sentence.id;
    if (!at) return;
    player.pause();
    setEditing({ sentenceId: at });
  };
  const saveAiNote = (sentenceId: string, text: string) => {
    if (!doc || !index) return;
    const n = createNote(index, doc.id, sentenceId, text, { source: 'ai' });
    if (!n) return;
    void saveNote(n).then(() => toast('Saved to your notes.'));
  };

  // A suggested mistake becomes a flag: the issue as its note and the fix as the corrected sentence.
  const flagSuggestion = async (s: AiSuggestion) => {
    if (!doc || !index) return;
    const existing = flags.find((f) => f.sentenceId === s.sentenceId && f.status !== 'dismissed');
    if (existing) {
      await saveFlag({ ...existing, note: existing.note || s.issue, fixedText: existing.fixedText || s.fix, updatedAt: new Date().toISOString() });
    } else {
      const created = createFlag(index, doc.id, s.sentenceId);
      if (!created) return;
      await saveFlag({ ...created, note: s.issue, fixedText: s.fix });
    }
    toast('Added as a flag.');
  };
  const updateAiResult = async (r: AiResult) => {
    await repo.putAiResult(r);
    setAiResults((xs) => upsert(xs, r, (a, b) => a.key === b.key));
  };
  const deleteAiResult = async (r: AiResult) => {
    await repo.deleteAiResult(r.key);
    setAiResults((xs) => xs.filter((x) => x.key !== r.key));
  };

  const go = (blockId: string) => {
    if (!index) return;
    const start = index.block(blockId);
    const first = start?.sentences[0] ?? index.order.find((o) => o.block.index >= (start?.index ?? 0))?.sentence;
    if (first) player.seek(first.id);
    if (narrow()) setPanel(null);
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
    m: () => writeNote(),
    g: () => setPanel('toc'),
    '/': () => setFinding(true),
    ...(paged ? { PageDown: () => turn(1), PageUp: () => turn(-1) } : {}),
    Escape: () => (editing ? setEditing(null) : noteFor ? setNoteFor(null) : finding ? setFinding(false) : setPanel(null)),
  });

  if (doc === undefined) return <main class="boot">Opening…</main>;
  if (doc === null || !index || !pages || !cite)
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
            ? voiceLabel(activeVoice)
            : 'Looking for voices…';
  const page = view.currentId ? pages.ofSentence(view.currentId) : undefined;
  const chapterLine = [index.chapter(chapterIndex)?.title ?? '', page ? `page ${page.label}` : ''].filter(Boolean).join(' · ');
  const toggle = (p: Exclude<Panel, null>) => setPanel(panel === p ? null : p);
  const editingAt = editing ? index.get(editing.sentenceId) : undefined;
  const placeOf = (chapter: number, title: string, paragraph: number) => `${title || `Chapter ${chapter + 1}`} · Paragraph ${paragraph}`;

  return (
    <main class={`reader${panel ? ' with-panel' : ''}${paged ? ' paged' : ''}`}>
      <header class="bar">
        <a class="button" href="#/" aria-label="Back to library">
          ←
        </a>
        <div class="titles">
          <div class="doc-title">{doc.title}</div>
          <div class="chapter-title">{chapterLine}</div>
        </div>
        <div class="spacer" />
        <div class="panel-buttons">
          <button class={panel === 'toc' ? 'active' : ''} onClick={() => toggle('toc')}>
            Contents
          </button>
          <button class={panel === 'flags' ? 'active' : ''} onClick={() => toggle('flags')}>
            Flags{flags.length ? ` (${flags.filter((f) => f.status === 'open').length})` : ''}
          </button>
          <button class={panel === 'notes' ? 'active' : ''} onClick={() => toggle('notes')}>
            Notes{notes.length ? ` (${notes.length})` : ''}
          </button>
          <button class={panel === 'ai' ? 'active' : ''} onClick={() => toggle('ai')} title="AI study assistant, with your own key">
            AI{ai.job ? ' …' : ''}
          </button>
          <button class={panel === 'text' ? 'active' : ''} onClick={() => toggle('text')} title="Font, spacing and layout" aria-label="Font, spacing and layout">
            Aa
          </button>
        </div>
      </header>

      {kokoroBanner && (
        <div class="banner" role="note">
          <KokoroDownload />
        </div>
      )}

      <div class="reader-body">
        <TextPane
          blocks={blocks}
          sheets={sheets}
          flagged={flagged}
          currentId={view.currentId}
          skipCode={settings.skipCodeBlocks}
          onSeek={(id) => player.seek(id)}
          onWidth={setPaneWidth}
        >
          {sheets && (
            <nav class="pager" aria-label="Pages">
              <button onClick={() => turn(-1)} disabled={sheets[0]?.key === pages.pages[0]?.key} title="Previous page (Page Up)">
                ‹ Previous
              </button>
              <span class="hint">
                {sheets.length > 1 ? `Pages ${sheets[0]?.label}–${sheets[1]?.label}` : `Page ${sheets[0]?.label}`} of {pages.pages.at(-1)?.label}
              </span>
              <button onClick={() => turn(1)} disabled={sheets.at(-1)?.key === pages.pages.at(-1)?.key} title="Next page (Page Down)">
                Next ›
              </button>
            </nav>
          )}
        </TextPane>
        {panel && (
          <aside class="side-panel">
            {panel === 'toc' ? (
              <TocPanel doc={doc} currentChapter={chapterIndex} onGo={go} />
            ) : panel === 'flags' ? (
              <FlagPanel doc={doc} index={index} flags={flags} currentId={view.currentId} onSave={saveFlag} onDelete={deleteFlag} onJump={(id) => jump(id, false)} />
            ) : panel === 'notes' ? (
              <NotesPanel
                doc={doc}
                index={index}
                pages={pages}
                notes={notes}
                currentId={view.currentId}
                cite={cite}
                onNew={writeNote}
                onJump={(id) => jump(id, false)}
                onEdit={(n) => setEditing({ sentenceId: n.sentenceId, note: n })}
                onDelete={(n) => void deleteNote(n)}
              />
            ) : panel === 'text' ? (
              <section class="text-panel" aria-label="Text and layout">
                <h2>Text and layout</h2>
                <TextControls />
              </section>
            ) : (
              <AiPanel
                doc={doc}
                index={index}
                pages={pages}
                currentId={view.currentId}
                chapterIndex={chapterIndex}
                results={aiResults}
                ai={ai}
                cite={cite}
                onSaveNote={saveAiNote}
                onAddFlag={flagSuggestion}
                onUpdateResult={(r) => void updateAiResult(r)}
                onDeleteResult={(r) => void deleteAiResult(r)}
              />
            )}
          </aside>
        )}
        {returnTo && (
          <div class="return-bar">
            <button class="primary" onClick={goBack}>
              ↩ Back to where I was
            </button>
            <button class="link" aria-label="Stay here" title="Stay here" onClick={() => setReturnTo(null)}>
              ×
            </button>
          </div>
        )}
      </div>

      {editing && (
        <NoteEditor
          key={editing.note?.id ?? editing.sentenceId}
          quote={editing.note?.quote ?? editingAt?.sentence.text ?? ''}
          place={
            editing.note
              ? placeOf(editing.note.chapterIndex, editing.note.chapterTitle, editing.note.paragraphInChapter)
              : editingAt
                ? placeOf(editingAt.block.chapterIndex, index.chapter(editingAt.block.chapterIndex)?.title ?? '', index.paragraphInChapter(editingAt.block))
                : ''
          }
          {...(editing.note ? { text: editing.note.text, sketch: editing.note.sketch } : {})}
          onClose={() => setEditing(null)}
          onSave={(text, sketch) => {
            const old = editing.note;
            if (old) {
              const { sketch: _old, ...rest } = old;
              void saveNote({ ...rest, text, ...(sketch ? { sketch } : {}), updatedAt: new Date().toISOString() });
              return;
            }
            const n = createNote(index, doc.id, editing.sentenceId, text, sketch ? { sketch } : {});
            if (n) void saveNote(n).then(() => toast('Note saved.'));
          }}
        />
      )}

      {noteFor && (
        <NoteSheet
          flag={noteFor}
          onClose={() => setNoteFor(null)}
          onSave={(note) => void saveFlag({ ...noteFor, note, updatedAt: new Date().toISOString() })}
        />
      )}

      {finding && <FindBar index={index} pages={pages} currentId={view.currentId} onGo={(id) => jump(id, false)} onClose={() => setFinding(false)} />}
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
          <button class={finding ? 'active' : ''} onClick={() => setFinding(!finding)} aria-label="Go to a page or find text" title="Go to a page or find text (/)">
            🔍
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
        <button class="jot" onClick={writeNote} title="Write a note on this sentence (M)">
          ✎ Note
        </button>
        <button class="note" onClick={() => void flagCurrent(true)} title="Flag with a note about the mistake (N)">
          Flag + note
        </button>
        <button class="flag-btn" onClick={() => void flagCurrent(false)} title="Flag this sentence (F)">
          FLAG
        </button>
      </footer>
    </main>
  );
}
