import { useEffect, useRef, useState } from 'preact/hooks';
import { exportChapter, inspectNarration, prepareNarration, wholeBookWav, type NarrationProgress } from '../../core/audio/narration';
import { timingDocument } from '../../core/audio/chapters';
import { KOKORO_VOICES } from '../../core/engines/kokoro';
import { exportTransfer } from '../../core/audio/transfer';
import type { DocRecord, NarrationRecord } from '../../core/types';
import { IN_ANDROID_APP, readAloudTts } from '../android/plugin';
import { toast, useServices, useSettings } from '../services';
import { saveAudioExport } from '../book-export';
import { AUDIO_FORMATS, type AudioExportFormat } from '../../core/audio/formats';
import { usePlayer } from '../hooks/usePlayer';

// Five included narrator choices; legacy reader voices remain available in the normal picker.
const NARRATORS = ['bf_emma', 'bf_isabella', 'bm_george', 'af_heart', 'am_michael'];
const filename = (s: string) => s.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 100).trim() || 'chapter';

export function AudiobookPanel({ doc }: { doc: DocRecord }) {
  const { player, repo, registry, kokoro } = useServices();
  const playback = usePlayer(player);
  const settings = useSettings();
  const [voiceId, setVoice] = useState(settings.voiceByEngine.kokoro ?? 'bf_emma');
  const [record, setRecord] = useState<NarrationRecord | null>(null);
  const [chapterRecord, setChapterRecord] = useState<NarrationRecord | null>(null);
  const [progress, setProgress] = useState<NarrationProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [error, setError] = useState('');
  const [chapter, setChapter] = useState(doc.chapters[0]?.index ?? 0);
  const [format, setFormat] = useState<AudioExportFormat>('wav');
  const [bitrate, setBitrate] = useState(128000);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    let current = true;
    setRecord(null); setError('');
    void Promise.resolve().then(() => inspectNarration(player.narrationPlan(), voiceId, repo))
      .then((whole) => { if (current) setRecord(whole); })
      .catch((e: unknown) => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [doc.id, voiceId, settings.skipCodeBlocks, settings.announceHeadings,
    settings.pronunciation, settings.locale,
    settings.pauseAfterHeadingMs, settings.pauseBetweenParagraphsMs, settings.pauseBetweenSentencesMs, player, repo]);
  useEffect(() => {
    let current = true;
    setChapterRecord(null);
    void Promise.resolve().then(() => inspectNarration(player.narrationPlan(chapter), voiceId, repo))
      .then((selected) => { if (current) setChapterRecord(selected); })
      .catch((e: unknown) => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [doc.id, voiceId, chapter, settings.skipCodeBlocks, settings.announceHeadings,
    settings.pronunciation, settings.locale,
    settings.pauseAfterHeadingMs, settings.pauseBetweenParagraphsMs, settings.pauseBetweenSentencesMs, player, repo]);

  const prepare = async (chapterOnly = false) => {
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setProgress(null); setRecord(null); setChapterRecord(null);
    player.pause(); await player.settled;
    try {
      // No paid/API narration, and no book text leaves the device.
      await kokoro.load();
      abort.signal.throwIfAborted();
      const engine = registry.get('kokoro');
      const voice = (await engine?.listVoices())?.find((v) => v.id === voiceId);
      if (!engine || !voice) throw new Error('The selected local narrator is unavailable.');
      await prepareNarration(player.narrationPlan(chapterOnly ? chapter : undefined), engine, voice, repo, abort.signal,
        (p) => { if (alive.current) setProgress(p); });
      if (alive.current) toast(chapterOnly ? 'Selected chapter prepared. You can now save this chapter.' : 'Whole audiobook prepared. You can now listen or save the whole book.');
    } catch (e) {
      if (alive.current) setError(abort.signal.aborted ? 'Preparation stopped. Saved passages are kept; Prepare resumes them.'
        : `Preparation stopped: ${e instanceof Error ? e.message : String(e)}. Saved passages are kept. Check free storage before retrying.`);
    } finally {
      if (alive.current) {
        try {
          const [whole, selected] = await Promise.all([inspectNarration(player.narrationPlan(), voiceId, repo), inspectNarration(player.narrationPlan(chapter), voiceId, repo)]);
          if (alive.current) { setRecord(whole); setChapterRecord(selected); }
        } catch (e) { if (alive.current) setError(String(e)); }
        if (alive.current) setBusy(false);
      }
      controller.current = null;
    }
  };

  const listen = async (mode: 'whole' | 'chapter' | 'continue' = 'whole') => {
    setError('');
    try {
      const r = await inspectNarration(player.narrationPlan(mode === 'chapter' ? chapter : undefined), voiceId, repo);
      if (!r.ready) throw new Error('The requested audio is not fully prepared for this narrator. No new speech was generated.');
      player.pause(); await player.settled;
      if (mode === 'whole') {
        const first = doc.chapters.find((c) => player.narrationPlan(c.index).texts.length > 0);
        if (!first) throw new Error('This book has no readable chapters.');
        await player.playChapter(first.index, true, voiceId);
      } else await player.playChapter(chapter, mode === 'continue', voiceId);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const save = async (transfer = false, wholeTransfer = false) => {
    if (!transfer && format !== 'wav') { await saveEncodedChapter(); return; }
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setProgress(null);
    try {
      const plan = player.narrationPlan();
      const blob = transfer ? await exportTransfer(doc, plan, wholeTransfer ? undefined : chapter, voiceId, settings, repo, abort.signal)
        : await exportChapter(plan, chapter, voiceId, repo, abort.signal);
      const title = doc.chapters.find((c) => c.index === chapter)?.title ?? `Chapter ${chapter + 1}`;
      const name = wholeTransfer ? `${filename(doc.title)}-whole-book.readaloud.zip`
        : `${String(chapter + 1).padStart(3, '0')}-${filename(title)}${transfer ? '.readaloud.zip' : '.wav'}`;
      await saveAudioFile(name, blob, abort.signal);
    } catch (e) { if (alive.current) setError(abort.signal.aborted ? 'Export cancelled.' : String(e)); }
    finally { if (alive.current) setBusy(false); controller.current = null; }
  };

  const saveWholeBook = async () => {
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setProgress(null); setExportProgress('Checking saved book audio…');
    player.pause();
    try {
      await saveAudioExport(`${filename(doc.title)}-whole-book.${format}`, player.narrationPlan(), voiceId, repo, abort.signal,
        (done, total) => { if (alive.current) setExportProgress(`Exporting whole book: ${(done / total * 100).toFixed(0)}% of prepared audio processed`); },
        format, doc.title, doc.chapters, bitrate);
      if (alive.current) toast(`Whole-book ${format.toUpperCase()} saved. No speech was generated again.`);
    } catch (e) { if (alive.current) setError(abort.signal.aborted ? 'Export cancelled.' : String(e)); }
    finally { if (alive.current) { setBusy(false); setExportProgress(''); } controller.current = null; }
  };

  const saveEncodedChapter = async () => {
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setProgress(null); setExportProgress('Checking selected chapter…');
    player.pause();
    try {
      const title = doc.chapters.find((c) => c.index === chapter)?.title || `Chapter ${chapter + 1}`;
      await saveAudioExport(`${String(chapter + 1).padStart(3, '0')}-${filename(title)}.${format}`, player.narrationPlan(chapter), voiceId, repo, abort.signal,
        (done, total) => { if (alive.current) setExportProgress(`Exporting chapter: ${(done / total * 100).toFixed(0)}% of prepared audio processed`); },
        format, `${doc.title} — ${title}`, doc.chapters, bitrate);
      if (alive.current) toast(`Chapter ${format.toUpperCase()} saved.`);
    } catch (e) { if (alive.current) setError(abort.signal.aborted ? 'Export cancelled.' : String(e)); }
    finally { if (alive.current) { setBusy(false); setExportProgress(''); } controller.current = null; }
  };

  const saveTimings = async () => {
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); player.pause();
    try {
      const book = await wholeBookWav(player.narrationPlan(), voiceId, repo, abort.signal, true);
      const markers = book.chapterStarts.map(c => ({ title: doc.chapters.find(v => v.index === c.chapter)?.title || `Chapter ${c.chapter + 1}`, seconds: c.sample / book.sampleRate }));
      const json = timingDocument(markers, book.bytes / 2 / book.sampleRate);
      await saveAudioFile(`${filename(doc.title)}-chapter-timings.json`, new Blob([json], { type: 'application/json' }), abort.signal);
      if (alive.current) toast('Chapter timings saved from existing narration. No speech or new audio file generated.');
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { if (alive.current) setBusy(false); controller.current = null; }
  };

  return <section class="text-panel" aria-label="Audiobook studio">
    <h2>Audiobook studio · {__APP_VERSION__}</h2>
    <p>Prepare the whole book before travelling. Every chapter is saved on this device, not generated while you listen.</p>
    <label>Narrator <select value={voiceId} disabled={busy} onChange={(e) => setVoice(e.currentTarget.value)}>
      {KOKORO_VOICES.filter((v) => NARRATORS.includes(v.id) || v.id === voiceId).map((v) =>
        <option key={v.id} value={v.id}>{v.name} ({v.lang})</option>)}
    </select></label>
    <details><summary>Preparation, pronunciation and storage advice</summary>
    <p>Preparation can take longer than the listening time on a slow phone. Do it while parked, with the app open and sufficient battery/storage. You can cancel and resume. Changing the narrator requires different audio.</p>
    <p>Set pronunciation in Settings before preparing. Changed speech needs new clips; old saved audio is kept, not silently reused for changed passages. Check a short sample before preparing a long book.</p>
    <p>Saved narration is separate from the temporary cache and is not removed by cache pruning. Browser/OS storage removal or uninstalling the app can still erase it; export chapters for a separate copy.</p>
    </details>
    <div role="status" aria-live="polite">
      {busy && progress ? <><progress max={progress.total} value={progress.completed} /> {progress.completed}/{progress.total} passages · {(progress.bytes / 1048576).toFixed(1)} MB saved</> :
        record?.ready ? `Whole audiobook ready · ${(record.bytes / 1048576).toFixed(1)} MB saved` :
        record ? `Whole audiobook: ${record.completed}/${record.total} passages saved — not ready yet` : 'Checking saved narration…'}
    </div>
    <p role="status">{chapterRecord?.ready ? 'Selected chapter ready to save.' : chapterRecord ? `Selected chapter: ${chapterRecord.completed}/${chapterRecord.total} passages saved — not ready yet` : 'Checking selected chapter…'}</p>
    {error && <p role="alert">{error}</p>}
    {exportProgress && <p role="status">{exportProgress}</p>}
    <h3>Prepare and save audio</h3>
    <label>Chapter <select value={chapter} disabled={busy} onChange={(e) => setChapter(Number(e.currentTarget.value))}>
      {doc.chapters.map((c) => <option key={c.index} value={c.index}>{c.title || `Chapter ${c.index + 1}`}</option>)}
    </select></label>
    <p><button class="primary" disabled={busy} onClick={() => void prepare(false)}>Prepare whole audiobook</button>{' '}
      <button disabled={busy} onClick={() => void prepare(true)}>Prepare selected chapter</button></p>
    <label>Export format <select aria-label="Export format" value={format} disabled={busy} onChange={(e) => setFormat(e.currentTarget.value as AudioExportFormat)}>
      {Object.entries(AUDIO_FORMATS).filter(([id]) => __COMPRESSED_EXPORTS__ || id === 'wav').map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}
    </select></label>
    {format !== 'wav' && <label>Audio quality <select aria-label="Audio quality" value={bitrate} disabled={busy} onChange={(e) => setBitrate(Number(e.currentTarget.value))}>
      <option value={96000}>96 kb/s — smaller speech files</option><option value={128000}>128 kb/s — higher quality</option>
    </select></label>}
    <p><button disabled={busy || !record?.ready} onClick={() => void saveWholeBook()}>Save whole book {format.toUpperCase()}</button>{' '}
      <button disabled={busy || !chapterRecord?.ready} onClick={() => void save()}>Save chapter {format.toUpperCase()}</button></p>
    {__COMPRESSED_EXPORTS__ ? <p>Every whole-book export (WAV, MP3, M4A and M4B) carries chapter timings inside the audio file. Import that one file in ReadAloud 0.7.1 or later for chapter selection: no separate map or ZIP. MP3 uses a ReadAloud ID3 text field, WAV a ReadAloud RIFF chunk; M4A/M4B use Nero markers (up to 255). Other players may play the audio without showing chapters. Encoding uses saved speech locally, not a paid service.</p>
      : <p>This hosted edition exports WAV with chapters. Creating MP3/M4A/M4B is unavailable here while encoder redistribution is held; their private-package export paths are unchanged. Importing and playing your existing compressed audio, chapter-map recovery, and saved narration still work.</p>}
    <button disabled={busy || !record?.ready} onClick={() => void saveTimings()}>Save chapter timings for older audio</button>
    <p>Already downloaded an older unmarked audio file? Save only these small timings, then use Import chapter-time map for that audio on your phone. Keep the same book, narrator, pronunciation and pause settings as the original export. Duration must match; no speech is generated and no new WAV download is needed.</p>
    <p>Both preparation options resume saved passages rather than starting again. Chapter preparation makes only the chapter selected above; whole-book preparation reuses any chapters already prepared.</p>
    <h3>Playback — use saved narration</h3>
    <p>The Chapter selector above also chooses where to listen. These controls reuse the prepared whole book; they do not generate or export audio.</p>
    <p><button disabled={busy || !record?.ready} onClick={() => void listen('whole')}>Play entire book</button>{' '}
      <button disabled={busy || !chapterRecord?.ready} onClick={() => void listen('chapter')}>Play selected chapter only</button>{' '}
      <button disabled={busy || !record?.ready} onClick={() => void listen('continue')}>Continue from selected chapter</button></p>
    <p>Chapter-only playback stops at that chapter's end. Resume saved audiobook repeats it after completion; Continue reads on through the book.</p>
    {playback.source === 'audiobook' && <p><button onClick={() => {
      if (playback.status === 'playing' || playback.status === 'buffering') player.pause();
      else void player.playPrepared();
    }}>{playback.status === 'playing' || playback.status === 'buffering' ? 'Pause audiobook' : 'Resume saved audiobook'}</button></p>}
    {busy && <button onClick={() => controller.current?.abort()}>Cancel</button>}
    <p class="hint">Audiobook playback always uses saved narration only and stops if a passage is missing. Reader Play remains separate: it reads immediately, reusing saved speech where available. No global prepared-only switch is needed.</p>
    <h3>Export narration</h3>
    <p>Whole-book export makes one continuous file in reading order. Windows Edge/Chrome streams to disk; Android uses temporary disk space before its save dialog. WAV is large (about 165 MiB/hour at 24 kHz); compressed files are roughly 41–55 MiB/hour at 96–128 kb/s. WAV and compressed output files must stay below 4 GiB. Keep the app open until saving finishes. Changing listening speed does not change the exported audio.</p>
    <p>One numbered WAV per chapter, at the local voice's native sample rate and normal speed. Your listening speed does not change the exported master. Export only material you have rights to narrate. Publishing still needs listening/QC, credits, metadata and the distributor's current format and digital-narration checks. This does not upload or publish.</p>
    <h3>Windows to phone</h3>
    <p>Prepare on Windows, then save a transfer for each chapter. Copy those files to your phone and use Import prepared audio in its library. Each transfer includes the book text and this chapter's narration (not notes or API keys). Chapters merge into one book without generating speech again. Import all chapters before choosing prepared-only listening. There is no 160 MB cap: transfers are processed one passage at a time. Both devices need version 0.6.1 or later for large transfers. ZIP32 files must stay below 4 GiB; available device storage still applies.</p>
    <button disabled={busy || !record?.ready} onClick={() => void save(true, true)}>Save whole book transfer ZIP</button>{' '}
    <button disabled={busy || !chapterRecord?.ready} onClick={() => void save(true)}>Save chapter transfer ZIP</button>
    <p><button disabled={busy} onClick={() => {
      if (!confirm('Delete all saved narrations for this document? Text, notes and position are kept. Exported copies are not deleted.')) return;
      player.pause(); player.resetVoice();
      void repo.deleteNarration(doc.id).then(async () => {
        setRecord(await inspectNarration(player.narrationPlan(), voiceId, repo));
        setChapterRecord(await inspectNarration(player.narrationPlan(chapter), voiceId, repo));
      }).catch((e: unknown) => setError(String(e)));
    }}>Remove saved narration</button></p>
  </section>;
}

async function saveAudioFile(name: string, blob: Blob, signal: AbortSignal): Promise<void> {
  if (IN_ANDROID_APP) {
    const { token } = await readAloudTts.beginAudioExport({ name, expectedBytes: blob.size });
    try {
      for (let at = 0; at < blob.size; at += 64 * 1024) {
        signal.throwIfAborted();
        const bytes = new Uint8Array(await blob.slice(at, at + 64 * 1024).arrayBuffer());
        let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
        await readAloudTts.appendAudioExport({ token, data: btoa(binary) });
      }
      signal.throwIfAborted();
      await readAloudTts.finishAudioExport({ token, name, mime: blob.type });
    } finally { await readAloudTts.cancelAudioExport({ token }).catch(() => undefined); }
    return;
  }
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
