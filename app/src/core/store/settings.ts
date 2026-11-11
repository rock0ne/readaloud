// Settings defaults (spec 4) and migration (spec 9). `touch` decides pauseOnFlag's default.
import type { EngineId, Settings } from '../types';
import { DEFAULT_PRONUNCIATION, validPronunciation } from '../text/pronunciation';

export function defaultSettings(touch = false): Settings {
  return {
    schemaVersion: 5,
    enginePreference: ['kokoro', 'webspeech'],
    voiceByEngine: {},
    rate: 1.0,
    locale: 'en-GB',
    azure: null,
    skipCodeBlocks: true,
    preparedAudioOnly: false,
    pronunciation: { ...DEFAULT_PRONUNCIATION },
    announceHeadings: true,
    pauseAfterHeadingMs: 600,
    pauseBetweenSentencesMs: 0,
    pauseBetweenParagraphsMs: 700,
    keepAwake: true,
    pauseOnFlag: touch,
    fontSizePx: 18,
    readerFont: 'serif',
    readerTone: 'system',
    lineSpacing: 1.7,
    layout: 'scroll',
    twoPages: true,
    stopAtPageEnd: false,
    theme: 'auto',
    ai: { provider: null, models: {} },
  };
}

type StoredSettings = Omit<Partial<Settings>, 'schemaVersion'> & { schemaVersion?: number };

/** Brings settings saved by an older version up to date. */
export function migrateSettings(saved: StoredSettings): Partial<Settings> {
  const out = { ...saved };
  if ((out.schemaVersion ?? 1) < 2) {
    // v2 (ADR-21, ADR-22): Kokoro becomes the main voice and Azure is dropped. A saved browser
    // voice stays saved, but no longer outranks Kokoro unless chosen again.
    const rest = (out.enginePreference ?? []).filter((e): e is EngineId => e !== 'kokoro' && e !== 'azure');
    out.enginePreference = ['kokoro', ...rest.filter((e, i) => rest.indexOf(e) === i)];
    if (!out.enginePreference.includes('webspeech')) out.enginePreference.push('webspeech');
    out.azure = null;
  }
  if ((out.schemaVersion ?? 1) < 3) {
    // v3 (ADR-30): the AI assistant, off until the user adds a key.
    out.ai = { provider: null, models: {} };
    // ADR-31: a full stop no longer gets the old fixed 0.15 s; paragraphs get their own pause.
    if (out.pauseBetweenSentencesMs === 150) out.pauseBetweenSentencesMs = 0;
  }
  // v4 (ADR-33, ADR-35): the reading font, line spacing and page-by-page settings are new and
  // come from the defaults.
  if ((out.schemaVersion ?? 1) < 5) {
    // Earlier versions defaulted this to true, making a visual layout choice interrupt listening.
    // Start upgraded readers in continuous flow. Page-study pauses are an explicit v5 opt-in;
    // all book, narration, voice, position and visual preferences remain unchanged.
    out.stopAtPageEnd = false;
  }
  delete out.schemaVersion;
  return out as Partial<Settings>;
}

export function withDefaults(saved: StoredSettings | undefined, touch = false): Settings {
  const d = defaultSettings(touch);
  if (!saved) return d;
  const m = migrateSettings(saved);
  return {
    ...d,
    ...m,
    schemaVersion: d.schemaVersion,
    readerTone: ['system', 'paper', 'sepia', 'night'].includes(m.readerTone ?? '') ? m.readerTone! : d.readerTone,
    voiceByEngine: { ...d.voiceByEngine, ...(m.voiceByEngine ?? {}) },
    // Preserve pre-0.5.1 prepared clips on upgrade. New installations still default to hints on.
    pronunciation: validPronunciation(m.pronunciation) ? { ...m.pronunciation }
      : m.pronunciation === undefined ? { enabled: false, list: '' } : { ...DEFAULT_PRONUNCIATION },
    ai: { ...d.ai, ...(m.ai ?? {}), models: { ...(m.ai?.models ?? {}) } },
  };
}

export const RATE_MIN = 0.8;
export const RATE_MAX = 3.0;

export function clampRate(r: number): number {
  return Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, r)) * 10) / 10;
}
