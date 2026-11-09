import { useEffect, useRef, useState } from 'preact/hooks';
import { AUDIO_ACCEPT, AudioLibraryStore, validateAudioFile, type AudioSummary } from '../../core/audio/library';
import { useServices } from '../services';
import { IN_ANDROID_APP, readAloudTts } from '../android/plugin';
import { audioOpen, consumeOpenedAudio } from '../android/audio-open';
import type { PluginListenerHandle } from '@capacitor/core';
import { chapterEnd, embeddedChapters, parseChapterMap, validateChapters, type AudioChapter } from '../../core/audio/chapters';

export function AudioLibrary() {
  const { player } = useServices();
  const [store, setStore] = useState<AudioLibraryStore | null>(null);
  const [items, setItems] = useState<AudioSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [chapters, setChapters] = useState<AudioChapter[]>([]);
  const [chapter, setChapter] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [mode, setMode] = useState('Entire audio');
  const mapInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const chapterLimit = useRef<{ start: number; end: number; finished: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null), audio = useRef<HTMLAudioElement>(null);
  const resume = useRef({ seconds: 0, rate: 1 });
  const lastSaved = useRef(0);
  const nativeState = (state: 'playing' | 'paused' | 'stopped') => {
    if (IN_ANDROID_APP) void readAloudTts.playback({ state, title: items.find((i) => i.id === selected)?.title ?? 'Audio file', chapter: 'Saved audio' })
      .catch(() => setMessage('Audio is playing, but Android background controls could not start. Keep the app open.'));
  };
  useEffect(() => {
    let alive = true; let opened: AudioLibraryStore | undefined;
    void AudioLibraryStore.open().then(async (s) => {
      opened = s; const list = await s.list();
      if (alive) { setStore(s); setItems(list); } else s.close();
    }).catch((e) => { if (alive) setMessage(`Audio library unavailable: ${String(e)}`); });
    return () => { alive = false; opened?.close(); };
  }, []);
  useEffect(() => {
    let alive = true, objectUrl = '';
    setUrl(''); setChapters([]); setChapter(0); setDuration(0); chapterLimit.current = null; setMode('Entire audio');
    if (store && selected) void Promise.all([store.chapters(selected), store.position(selected)]).then(([item, pos]) => {
      if (!alive || !item) return;
      resume.current = { seconds: pos?.seconds ?? 0, rate: pos?.rate ?? 1 };
      setChapters(item.chapters ?? []); setRate(resume.current.rate);
      if (item.chapterWarning) setMessage(item.chapterWarning);
      lastSaved.current = 0; objectUrl = URL.createObjectURL(item.blob); setUrl(objectUrl);
    }).catch((e) => { if (alive) setMessage(String(e)); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [store, selected]);
  const checkChapterEnd = () => {
    const el = audio.current, limit = chapterLimit.current;
    if (!el || !limit || limit.finished || el.currentTime < limit.end) return;
    limit.finished = true; el.pause(); el.currentTime = limit.end;
    remember(true); setMessage('Selected chapter finished. Play repeats this chapter; Continue from selected chapter reads on.');
  };
  useEffect(() => {
    if (!url) return;
    // timeupdate frequency varies across devices; the timer supplements it at boundaries.
    const timer = setInterval(checkChapterEnd, 100);
    return () => clearInterval(timer);
  }, [url]);
  useEffect(() => {
    if (!IN_ANDROID_APP || !store) return;
    let stopped = false, listener: PluginListenerHandle | undefined, chain = Promise.resolve();
    const consume = () => {
      chain = chain.then(async () => { if (!stopped) await consumeOpenedAudio((file) => add([file])); })
        .catch((e) => { if (!stopped) setMessage(`Could not open selected audio: ${String(e)}. Use Import audio files.`); });
    };
    void audioOpen.addListener('available', consume).then((handle) => { if (stopped) void handle.remove(); else listener = handle; }).catch((e) => setMessage(String(e)));
    consume();
    return () => { stopped = true; void listener?.remove(); };
  }, [store]);
  useEffect(() => {
    if (!IN_ANDROID_APP || !selected) return;
    let stopped = false, listener: PluginListenerHandle | undefined;
    void readAloudTts.addListener('media', ({ action }) => {
      const el = audio.current; if (stopped || !el) return;
      if (action === 'play') void el.play().catch(() => setMessage('Tap Play in ReadAloud to resume audio.'));
      else if (action === 'pause') el.pause();
      else el.currentTime = Math.max(0, Math.min(Number.isFinite(el.duration) ? el.duration : Infinity, el.currentTime + (action === 'next' ? 30 : -15)));
    }).then((handle) => { if (stopped) void handle.remove(); else listener = handle; }).catch(() => undefined);
    return () => { stopped = true; void listener?.remove(); void readAloudTts.playback({ state: 'stopped', title: '', chapter: '' }).catch(() => undefined); };
  }, [selected]);

  const remember = (force = false) => {
    const el = audio.current;
    if (!store || !selected || !el || (!force && Date.now() - lastSaved.current < 5000)) return;
    lastSaved.current = Date.now();
    void store.remember(selected, el.currentTime, el.playbackRate).catch(() => setMessage('Could not save your listening position. Check device storage.'));
  };
  useEffect(() => {
    const save = () => remember(true);
    window.addEventListener('pagehide', save);
    const hidden = () => { if (document.hidden) save(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', hidden); };
  }, [store, selected]);
  const add = async (files: File[]) => {
    if (!store) return;
    setBusy(true); setMessage(''); let last = '';
    try {
      for (const file of files) {
        setMessage(`Importing ${file.name}…`);
        const mime = await validateAudioFile(file, file.name);
        // Probe via the browser's media pipeline, never decode the entire book into PCM.
        await new Promise<void>((resolve, reject) => {
          const probe = document.createElement('audio'), src = URL.createObjectURL(file.slice(0, file.size, mime));
          const timer = setTimeout(() => done(new Error('The device could not read this audio within 30 seconds. Try WAV, MP3 or M4A.')), 30000);
          const done = (error?: Error) => { clearTimeout(timer); probe.onloadedmetadata = null; probe.onerror = null;
            probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(src); error ? reject(error) : resolve(); };
          probe.preload = 'metadata'; probe.onloadedmetadata = () => done();
          probe.onerror = () => done(new Error('This device cannot play this file. It may use an unsupported codec, be incomplete or be DRM-protected. Keep the original; try a WAV or MP3 export.'));
          probe.src = src;
        });
        last = (await store.add(file, file.name)).id;
      }
      setMessage(`Imported ${files.length} audio file${files.length === 1 ? '' : 's'}. No ZIP or speech generation needed.`);
    } catch (e) { setMessage(`Audio import stopped: ${e instanceof Error ? e.message : String(e)}. Earlier imported files are kept.`); }
    finally { setItems(await store.list()); if (last) setSelected(last); setBusy(false); }
  };

  const startPlayback = async (choice: 'whole' | 'chapter' | 'continue') => {
    const el = audio.current; if (!el || !Number.isFinite(el.duration)) return;
    try {
      const marker = chapters[chapter];
      if (choice !== 'whole' && !marker) throw new Error('Choose an available chapter.');
      chapterLimit.current = choice === 'chapter' ? { start: marker!.seconds, end: chapterEnd(chapters, chapter, el.duration), finished: false } : null;
      el.currentTime = choice === 'whole' ? 0 : marker!.seconds;
      setMode(choice === 'chapter' ? `Chapter only: ${marker!.title}` : choice === 'continue' ? `Continue from: ${marker!.title}` : 'Entire audio');
      await el.play();
    } catch (e) { setMessage(String(e)); }
  };

  return <section class="text-panel" aria-label="Audio files">
    <h2>Audio files</h2>
    <p>Play saved narration directly: WAV, MP3, M4A, M4B, MP4 audio, AAC, Ogg, Opus or FLAC (device codec support varies). No ZIP, model or speech generation. Audio-only files have no synchronised book text or sentence highlighting.</p>
    <button disabled={!store || busy} onClick={() => input.current?.click()}>Import audio files</button>
    <input ref={input} type="file" multiple accept={AUDIO_ACCEPT} hidden onChange={(e) => {
      const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; if (files.length) void add(files);
    }} />
    {message && <p role="status">{message}</p>}
    {items.length > 0 && <><p><label>Saved audio <select disabled={busy} aria-label="Saved audio" value={selected} onChange={(e) => { remember(true); setSelected(e.currentTarget.value); }}>
      <option value="">Choose audio</option>
      {items.map((item) => <option key={item.id} value={item.id}>{item.title} ({(item.bytes / 1048576).toFixed(1)} MB)</option>)}
    </select></label></p>
    {url && <><audio ref={audio} key={url} src={url} controls preload="metadata" style={{ width: '100%' }}
      onLoadedMetadata={() => { const el = audio.current; if (el) {
        setDuration(el.duration); el.playbackRate = resume.current.rate;
        if (resume.current.seconds < el.duration) el.currentTime = resume.current.seconds;
        try { if (chapters.length) setChapters(validateChapters(chapters, el.duration)); }
        catch (e) { setChapters([]); setMessage(`Audio remains playable, but its chapter markers are invalid: ${String(e)}`); }
      } }}
      onPlay={() => {
        const limit = chapterLimit.current, el = audio.current;
        if (limit?.finished && el) { limit.finished = false; el.currentTime = limit.start; }
        // The WebView already owns audio focus when this event fires. Requesting
        // native focus here can steal it from our own audio and cause a pause.
        player.pause(); nativeState('playing');
      }} onTimeUpdate={() => { checkChapterEnd(); remember(); }} onPause={() => { remember(true); nativeState('paused'); }} onRateChange={() => { if (audio.current) setRate(audio.current.playbackRate); remember(true); }}
      onEnded={() => { nativeState('stopped'); if (store && selected) void store.remember(selected, 0, audio.current?.playbackRate ?? 1); }}
      onError={() => setMessage('Playback failed on this device. The saved file is kept. Try a WAV or MP3 copy.')} />
      <p><label>Listening speed <select aria-label="Audio listening speed" value={rate} onChange={(e) => { if (audio.current) audio.current.playbackRate = Number(e.currentTarget.value); }}>
        {[0.75, 1, 1.1, 1.25, 1.5, 1.75, 2].map((rate) => <option value={rate}>{rate}×</option>)}
      </select></label></p>
      <h3>Playback options</h3>
      <p><button disabled={!duration} onClick={() => void startPlayback('whole')}>Play entire audio</button></p>
      {chapters.length > 0 ? <>
        <label>Playback chapter <select style={{ maxWidth: '100%' }} aria-label="Audio playback chapter" value={chapter} onChange={(e) => setChapter(Number(e.currentTarget.value))}>
          {chapters.map((c, i) => <option value={i}>{i + 1}. {c.title}</option>)}
        </select></label>
        <p><button onClick={() => void startPlayback('chapter')}>Play selected audio chapter only</button>{' '}
          <button onClick={() => void startPlayback('continue')}>Continue audio from selected chapter</button></p>
        <p role="status">{mode}</p>
      </> : <p>This older audio has no chapter timings. It still plays. Use chapters from a matching chaptered audio copy, or save only the small chapter timings from its existing prepared narration and import them here. No new narration or WAV download is needed. Boundaries are never guessed.</p>}
      <p><button disabled={!duration || busy} onClick={() => referenceInput.current?.click()}>Use chapters from matching audio</button></p>
      <input ref={referenceInput} type="file" accept=".wav,.mp3,.m4a,.m4b" hidden onChange={(e) => {
        const file = e.currentTarget.files?.[0]; e.currentTarget.value = '';
        if (!file || !store || !selected) return;
        const target = selected, targetDuration = duration;
        setBusy(true);
        void (async () => { try {
          const markers = await embeddedChapters(file, file.name);
          if (!markers.length) throw new Error('The reference audio has no supported chapter timings.');
          const seconds = await audioDuration(file);
          if (Math.abs(seconds - targetDuration) > 1) throw new Error('The reference audio duration does not match. Choose the same book and narrator.');
          validateChapters(markers, targetDuration);
          if (!confirm('Use these chapter timings? Confirm this is the SAME book, narrator and edit as the selected audio. Matching duration alone does not prove identity. Original audio is not changed.')) return;
          await store.setChapters(target, markers, targetDuration);
          if (target === selected) { setChapters(markers); setChapter(0); chapterLimit.current = null; }
          setMessage('Chapter timings copied. Existing audio retained; no speech generation or replacement audio download.');
        } catch (err) { setMessage(String(err)); } finally { setBusy(false); } })();
      }} />
      <button disabled={!duration} onClick={() => mapInput.current?.click()}>Import chapter-time map</button>
      <input ref={mapInput} type="file" accept=".json,application/json" hidden onChange={(e) => {
        const file = e.currentTarget.files?.[0]; e.currentTarget.value = '';
        if (!file || !store || !selected) return;
        void (async () => { try {
          if (file.size > 1024 * 1024) throw new Error('Chapter map exceeds 1 MiB.');
          const item = items.find((i) => i.id === selected); if (!item) return;
          const markers = parseChapterMap(await file.text(), item.bytes, duration);
          if (!confirm('Apply these chapter timings to this audio? Confirm the same book, narrator and edit. Duration checks are not proof of identity.')) return;
          await store.setChapters(selected, markers, duration); setChapters(markers); setChapter(0); chapterLimit.current = null;
          setMessage('Chapter map saved. Check that its titles and times match this narration; no audio was changed.');
        } catch (err) { setMessage(String(err)); } })();
      }} />
      </>}
    <button disabled={!selected || busy} onClick={async () => {
      if (!store || !selected || !confirm('Remove this imported audio copy and its listening position from this device? The original file and prepared book narration are not deleted.')) return;
      audio.current?.pause(); await store.remove(selected); setSelected(''); setItems(await store.list());
    }}>Remove selected audio copy</button></>}
    <p>Files and listening positions stay on this device. New ReadAloud whole-book WAV, MP3, M4A and M4B exports all include automatically imported chapters. WAV/MP3 use ReadAloud-specific metadata; M4A/M4B use Nero markers. Other metadata schemes may need a chapter-time map. Chapter stops use media-event/timer precision, not editing/sample precision. Keep original files as backups.</p>
  </section>;
}

async function audioDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = document.createElement('audio'), url = URL.createObjectURL(file);
    const timer = setTimeout(() => finish(new Error('Reference audio could not be read in 30 seconds.')), 30000);
    const finish = (error?: Error) => {
      const seconds = probe.duration;
      clearTimeout(timer); probe.onloadedmetadata = null; probe.onerror = null;
      probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(url);
      error ? reject(error) : Number.isFinite(seconds) && seconds > 0 ? resolve(seconds) : reject(new Error('Invalid reference duration.'));
    };
    probe.preload = 'metadata'; probe.onloadedmetadata = () => finish(); probe.onerror = () => finish(new Error('Reference audio is not playable on this device.'));
    probe.src = url;
  });
}
