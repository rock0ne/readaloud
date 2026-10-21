// Settings defaults (spec 4) and migration (spec 9). `touch` decides pauseOnFlag's default.
import type { EngineId, Settings } from '../types';

export function defaultSettings(touch = false): Settings {
  return {
    schemaVersion: 3,
    enginePreference: ['kokoro', 'webspeech'],
    voiceByEngine: {},
    rate: 1.0,
    locale: 'en-GB',
    azure: null,
    skipCodeBlocks: true,
    announceHeadings: true,
    pauseAfterHeadingMs: 600,
    pauseBetweenSentencesMs: 0,
    pauseBetweenParagraphsMs: 700,
    keepAwake: true,
    pauseOnFlag: touch,
    fontSizePx: 18,
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
    voiceByEngine: { ...d.voiceByEngine, ...(m.voiceByEngine ?? {}) },
    ai: { ...d.ai, ...(m.ai ?? {}), models: { ...(m.ai?.models ?? {}) } },
  };
}

export const RATE_MIN = 0.8;
export const RATE_MAX = 3.0;

export function clampRate(r: number): number {
  return Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, r)) * 10) / 10;
}
