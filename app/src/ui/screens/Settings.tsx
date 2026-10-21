// Settings (spec 11.6) with the voice reality check (ADR-17).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EngineId, Settings, Voice } from '../../core/types';
import { RATE_MAX, RATE_MIN } from '../../core/store/settings';
import { AiSettings } from '../components/AiSettings';
import { DataTransfer } from '../components/DataTransfer';
import { KokoroDownload } from '../components/KokoroDownload';
import { VoicePicker, shortVoiceName } from '../components/VoicePicker';
import { useKokoro, useServices, useSettings } from '../services';

const CHECK_SENTENCES = [
  'This is the first test sentence, read by the voice you chose.',
  'The second sentence checks that speech carries on without a gap or a cut-off.',
  'If you heard all three sentences clearly and naturally, the voice check has passed.',
];

interface CheckResult {
  sentence: number;
  ok: boolean;
  seconds?: number;
  error?: string;
}

const engineLabels: Record<EngineId, string> = {
  kokoro: 'Kokoro natural voices (made on this device)',
  webspeech: 'Browser voices (Microsoft, Google or Samsung)',
  azure: 'Azure Speech (dropped, ADR-21)',
};

export function SettingsScreen() {
  const services = useServices();
  const { registry } = services;
  const s = useSettings();
  const kokoroInstalled = useKokoro().installed;
  const [voices, setVoices] = useState<Voice[]>([]);
  const [chosen, setChosen] = useState<Voice | null>(null);
  const [check, setCheck] = useState<CheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const update = (p: Partial<Settings>) => void services.updateSettings(p);

  useEffect(() => {
    void (async () => {
      registry.invalidate();
      const list = (await Promise.all(registry.all().map((e) => registry.voices(e.id)))).flat();
      setVoices(list);
      const pick = await registry.pick(services.getSettings());
      setChosen(pick?.voice ?? null);
    })();
    return () => abort.current?.abort();
  }, [registry, services, kokoroInstalled]);

  const speakAll = async (sentences: string[], record: boolean) => {
    if (!chosen) return;
    const engine = registry.get(chosen.engineId);
    if (!engine) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setChecking(true);
    const results: CheckResult[] = [];
    if (record) setCheck([]);
    for (let i = 0; i < sentences.length; i++) {
      const t0 = performance.now();
      try {
        if (engine.speak) await engine.speak(sentences[i]!, { voice: chosen, rate: 1 }, ac.signal);
        else if (engine.synthesize) {
          const clip = await engine.synthesize(sentences[i]!, { voice: chosen, rate: 1 }, ac.signal);
          await services.audio.play(clip, 1, ac.signal);
        }
        if (ac.signal.aborted) break;
        results.push({ sentence: i + 1, ok: true, seconds: (performance.now() - t0) / 1000 });
      } catch (e) {
        results.push({ sentence: i + 1, ok: false, error: (e as Error).message });
        if (record) setCheck([...results]);
        break;
      }
      if (record) setCheck([...results]);
    }
    setChecking(false);
  };

  const pickVoice = async (engineId: EngineId, voiceId: string) => {
    const v = voices.find((x) => x.engineId === engineId && x.id === voiceId) ?? null;
    setChosen(v);
    setCheck(null);
    const pref = [engineId, ...s.enginePreference.filter((e) => e !== engineId)];
    await services.updateSettings({ voiceByEngine: { ...s.voiceByEngine, [engineId]: voiceId }, enginePreference: pref });
    if (v) await services.player.setVoice(engineId, voiceId);
  };

  const move = (i: number, d: -1 | 1) => {
    const pref = [...s.enginePreference];
    const j = i + d;
    if (j < 0 || j >= pref.length) return;
    [pref[i], pref[j]] = [pref[j]!, pref[i]!];
    update({ enginePreference: pref });
  };

  const passed = check !== null && check.length === CHECK_SENTENCES.length && check.every((r) => r.ok);

  return (
    <main class="settings">
      <header class="bar">
        <a class="button" href="#/" aria-label="Back to library">
          ←
        </a>
        <h1>Settings</h1>
      </header>

      <section>
        <h2>Voice</h2>
        <div class="hint">
          <KokoroDownload removable />
        </div>
        <div class="row-field">
          <VoicePicker
            voices={voices}
            locale={s.locale}
            value={chosen ? { engineId: chosen.engineId, voiceId: chosen.id } : null}
            onPick={(e, v) => void pickVoice(e, v)}
          />
          <button onClick={() => void speakAll(['The quick brown fox jumps over the lazy dog.'], false)} disabled={!chosen || checking}>
            Test
          </button>
          <button class="primary" onClick={() => void speakAll(CHECK_SENTENCES, true)} disabled={!chosen || checking}>
            Read 3 sentences
          </button>
          {checking && <button onClick={() => abort.current?.abort()}>Stop</button>}
        </div>
        {chosen && (
          <p class="hint">
            Using {chosen.quality === 'neural' ? 'natural' : 'basic'} voice {shortVoiceName(chosen)}. Automatic choice always prefers a natural voice.
          </p>
        )}
        {check && (
          <div class={`check-result ${passed ? 'pass' : check.some((r) => !r.ok) ? 'fail' : ''}`} aria-live="polite">
            <strong>Voice check: </strong>
            {check.map((r) => (r.ok ? `sentence ${r.sentence} spoke in ${r.seconds?.toFixed(1)} s` : `sentence ${r.sentence} failed (${r.error})`)).join('; ')}
            {passed && '. All three finished. If they also sounded natural to you, this voice works on this device.'}
          </div>
        )}

        <h3>Engine order</h3>
        <p class="hint">When choosing automatically, the first engine with a natural voice wins. Basic voices are only a last resort.</p>
        <ol class="engine-order">
          {s.enginePreference.map((id, i) => (
            <li key={id}>
              <span>{engineLabels[id]}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === s.enginePreference.length - 1} aria-label="Move down">
                ↓
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>Reading</h2>
        <label class="field">
          Speed <strong>{s.rate.toFixed(1)}×</strong>
          <input
            type="range"
            min={RATE_MIN}
            max={RATE_MAX}
            step={0.1}
            value={s.rate}
            onInput={(e) => {
              const rate = Number(e.currentTarget.value);
              services.player.setRate(rate);
              update({ rate });
            }}
          />
        </label>
        <p class="hint">Kokoro voices play up to 3.0×. Browser voices are capped at 2.0×.</p>
        <label class="field">
          Extra pause at a full stop <strong>{s.pauseBetweenSentencesMs === 0 ? 'none' : `${(s.pauseBetweenSentencesMs / 1000).toFixed(2)} s`}</strong>
          <input type="range" min={0} max={1000} step={50} value={s.pauseBetweenSentencesMs} onInput={(e) => update({ pauseBetweenSentencesMs: Number(e.currentTarget.value) })} />
        </label>
        <label class="field">
          Pause between paragraphs <strong>{(s.pauseBetweenParagraphsMs / 1000).toFixed(1)} s</strong>
          <input type="range" min={0} max={3000} step={100} value={s.pauseBetweenParagraphsMs} onInput={(e) => update({ pauseBetweenParagraphsMs: Number(e.currentTarget.value) })} />
        </label>
        <p class="hint">
          Pauses get shorter as you speed up. With no extra pause at a full stop the voice moves on as a person reading aloud would, and browser
          voices read a paragraph at a time. An extra pause makes browser voices read one sentence at a time, which adds about half a second at
          each full stop.
        </p>
        <label class="field">
          Language
          <select value={s.locale} onChange={(e) => update({ locale: e.currentTarget.value })}>
            <option value="en-GB">English (United Kingdom)</option>
            <option value="en-US">English (United States)</option>
            <option value="en-IE">English (Ireland)</option>
            <option value="en-AU">English (Australia)</option>
            <option value="en-CA">English (Canada)</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={s.announceHeadings} onChange={(e) => update({ announceHeadings: e.currentTarget.checked })} />
          Pause around headings
        </label>
        <label class="field">
          Pause after a heading <strong>{(s.pauseAfterHeadingMs / 1000).toFixed(1)} s</strong>
          <input type="range" min={0} max={2000} step={100} value={s.pauseAfterHeadingMs} onInput={(e) => update({ pauseAfterHeadingMs: Number(e.currentTarget.value) })} />
        </label>
        <label class="check">
          <input type="checkbox" checked={s.skipCodeBlocks} onChange={(e) => update({ skipCodeBlocks: e.currentTarget.checked })} />
          Skip code blocks
        </label>
        <label class="check">
          <input type="checkbox" checked={s.pauseOnFlag} onChange={(e) => update({ pauseOnFlag: e.currentTarget.checked })} />
          Pause when I flag a sentence
        </label>
        <label class="check">
          <input type="checkbox" checked={s.keepAwake} onChange={(e) => update({ keepAwake: e.currentTarget.checked })} />
          Keep the screen awake while reading
        </label>
      </section>

      <section>
        <h2>Display</h2>
        <label class="field">
          Text size <strong>{s.fontSizePx}px</strong>
          <input type="range" min={14} max={30} step={1} value={s.fontSizePx} onInput={(e) => update({ fontSizePx: Number(e.currentTarget.value) })} />
        </label>
        <label class="field">
          Theme
          <select value={s.theme} onChange={(e) => update({ theme: e.currentTarget.value as Settings['theme'] })}>
            <option value="auto">Match the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <AiSettings />

      <section>
        <h2>Your data</h2>
        <p>
          Documents, flags, notes and reading positions stay on this device. Kokoro voices are made on this device, so your text never leaves
          it. Browser voices may send each sentence to Microsoft or Google to be spoken. The AI assistant sends only the part you ask about, and
          only to the company whose key you added. Export a JSON file to move positions, flags and notes between your PC and phone; AI keys are
          never put in it.
        </p>
        <div class="row-field">
          <DataTransfer />
        </div>
      </section>

      <section>
        <h2>Keyboard</h2>
        <table class="keys">
          <tbody>
            <tr><td>Space</td><td>Play or pause</td></tr>
            <tr><td>← / →</td><td>Previous or next sentence</td></tr>
            <tr><td>R</td><td>Replay the sentence</td></tr>
            <tr><td>F</td><td>Flag the current sentence</td></tr>
            <tr><td>N</td><td>Flag with a note about the mistake</td></tr>
            <tr><td>M</td><td>Write a note on the sentence</td></tr>
            <tr><td>[ / ]</td><td>Slower or faster</td></tr>
            <tr><td>G</td><td>Open contents</td></tr>
            <tr><td>Esc</td><td>Close a panel or a note</td></tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
